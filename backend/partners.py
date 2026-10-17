import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import (db, now, iso, uid, sha, hash_pw, verify_pw, check_rate, client_ip, create_session,
                  current_admin, principal, audit)

router = APIRouter()
current_partner = principal("partner")
P = {"_id": 0}
WD_FLOW = {"review": ["requested"], "approve": ["requested", "under_review"], "reject": ["requested", "under_review", "approved"],
           "processing": ["approved"], "complete": ["processing"], "fail": ["processing"]}
WD_TO = {"review": "under_review", "approve": "approved", "reject": "rejected", "processing": "processing",
         "complete": "completed", "fail": "failed"}
RELEASE = {"rejected", "failed", "cancelled"}


def mask(s: str) -> str:
    s = s or ""
    return (s[:2] + "•" * max(len(s) - 4, 2) + s[-2:]) if len(s) > 4 else "••••"


# ---------- partner wallet / ledger ----------
async def wallet(pid: str) -> dict:
    return await db.partner_wallets.find_one_and_update(
        {"partner_id": pid}, {"$setOnInsert": {"partner_id": pid, "available": 0, "pending": 0, "reserved": 0,
                                               "total_earned": 0, "total_paid": 0}},
        upsert=True, projection=P, return_document=ReturnDocument.AFTER)


async def post_entry(pid: str, typ: str, amount: int, key: str, ref: str = "", reason: str = "", actor: str = "",
                     plan_version: str = ""):
    try:
        await db.partner_ledger.insert_one({"id": uid(), "partner_id": pid, "type": typ, "amount": amount, "currency": "INR",
                                            "status": "posted", "key": key, "ref": ref, "reason": reason, "actor": actor,
                                            "plan_version": plan_version, "created_at": iso()})
        return True
    except DuplicateKeyError:
        return False


async def move(pid: str, cond: dict, inc: dict) -> bool:
    await wallet(pid)
    r = await db.partner_wallets.update_one({"partner_id": pid, **cond}, {"$inc": inc})
    return r.modified_count == 1


async def partner_stats(pid: str) -> dict:
    users = [u["id"] async for u in db.users.find({"partner_id": pid, "role": "user"}, {"_id": 0, "id": 1})]
    verified = len(await db.deposits.distinct("user_id", {"user_id": {"$in": users}, "status": "verified"})) if users else 0
    since = iso(now() - timedelta(days=30))
    active = len(await db.bets.distinct("user_id", {"user_id": {"$in": users}, "created_at": {"$gte": since}})) if users else 0
    w = await wallet(pid)
    agg = {r["_id"]: r["s"] async for r in db.partner_ledger.aggregate([{"$match": {"partner_id": pid}},
                                                                     {"$group": {"_id": "$type", "s": {"$sum": "$amount"}}}])}
    pend_wd = await db.partner_withdrawals.aggregate([{"$match": {"partner_id": pid, "status": {"$in": ["requested", "under_review", "approved", "processing"]}}},
                                                     {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
    return {"registered_users": len(users), "verified_users": verified, "active_users_30d": active,
            "referral_rewards": agg.get("referral_reward", 0), "commissions": agg.get("commission", 0),
            "adjustments": agg.get("adjustment_credit", 0) - agg.get("adjustment_debit", 0),
            "total_earnings": w["total_earned"], "available": w["available"], "pending_earnings": w["pending"],
            "reserved": w["reserved"], "pending_withdrawals": pend_wd[0]["s"] if pend_wd else 0, "withdrawn": w["total_paid"]}


def public_partner(p: dict) -> dict:
    out = {k: p.get(k) for k in ("id", "partner_code", "name", "username", "email", "phone", "status", "created_at",
                                 "plan_id", "internal_ref", "business_details")}
    out["payout_masked"] = mask(p.get("payout_account", ""))
    out["payout_method"] = p.get("payout_method", "")
    return out


# ---------- partner auth ----------
class LoginIn(BaseModel):
    username: str
    password: str


class SetupIn(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class PwIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/partner/auth/login")
async def partner_login(body: LoginIn, request: Request, response: Response):
    await check_rate(f"plogin:{client_ip(request)}", 10, 15)
    u = await db.users.find_one({"username": body.username.strip().lower(), "role": "partner"})
    if not u or not u.get("password_hash") or not verify_pw(body.password, u["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    if u["status"] != "active":
        raise HTTPException(403, "Account is not active")
    await create_session(response, u, request)
    return {"user": {"id": u["id"], "username": u["username"], "role": "partner"}}


@router.post("/partner/auth/setup")
async def partner_setup(body: SetupIn, request: Request):
    await check_rate(f"psetup:{client_ip(request)}", 10, 15)
    inv = await db.partner_invites.find_one_and_update(
        {"token_hash": sha(body.token), "used": False, "expires_at": {"$gte": iso()}},
        {"$set": {"used": True, "used_at": iso()}})
    if not inv:
        raise HTTPException(400, "This setup link is invalid, used or expired")
    await db.users.update_one({"id": inv["user_id"]}, {"$set": {"password_hash": hash_pw(body.password), "status": "active"}})
    await db.partners.update_one({"user_id": inv["user_id"], "status": "invited"}, {"$set": {"status": "active"}})
    return {"ok": True}


@router.get("/partner/auth/me")
async def partner_me(user=Depends(current_partner)):
    p = await db.partners.find_one({"user_id": user["id"]}, P)
    return {"id": user["id"], "username": user["username"], "role": "partner", "partner": public_partner(p)}


@router.post("/partner/auth/logout")
async def partner_logout(response: Response, user=Depends(current_partner)):
    await db.sessions.update_one({"id": user["session_id"]}, {"$set": {"revoked": True}})
    response.delete_cookie("sess_partner", path="/", secure=True, samesite="none")
    return {"ok": True}


@router.post("/partner/auth/password")
async def partner_password(body: PwIn, user=Depends(current_partner)):
    u = await db.users.find_one({"id": user["id"]})
    if not verify_pw(body.current_password, u["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
    await db.sessions.update_many({"user_id": user["id"], "id": {"$ne": user["session_id"]}}, {"$set": {"revoked": True}})
    return {"ok": True}


@router.get("/partner/sessions")
async def partner_sessions(user=Depends(current_partner)):
    rows = await db.sessions.find({"user_id": user["id"]}, {"_id": 0, "expires_at": 0}).sort("created_at", -1).to_list(30)
    for r in rows:
        r["current"] = r["id"] == user["session_id"]
        r["id"] = r["id"][:10]
    return rows


@router.post("/partner/sessions/revoke-others")
async def partner_revoke(user=Depends(current_partner)):
    await db.sessions.update_many({"user_id": user["id"], "id": {"$ne": user["session_id"]}}, {"$set": {"revoked": True}})
    return {"ok": True}


async def me_partner(user) -> dict:
    p = await db.partners.find_one({"user_id": user["id"]}, P)
    if not p or p["status"] != "active":
        raise HTTPException(403, "Partner account is not active")
    return p


@router.get("/partner/dashboard")
async def partner_dashboard(user=Depends(current_partner)):
    p = await me_partner(user)
    return {"partner": public_partner(p), "stats": await partner_stats(p["id"])}


@router.get("/partner/users")
async def partner_users(q: str = "", user=Depends(current_partner)):
    p = await me_partner(user)
    flt = {"partner_id": p["id"], "role": "user"}
    if q:
        flt["id"] = {"$regex": "^" + re.escape(q.strip())}
    rows = await db.users.find(flt, {"_id": 0, "id": 1, "created_at": 1, "status": 1, "partner_id": 1}).sort("created_at", -1).to_list(500)
    dep = set(await db.deposits.distinct("user_id", {"user_id": {"$in": [r["id"] for r in rows]}, "status": "verified"}))
    return [{"user_id": r["id"][:8], "registered_at": r["created_at"], "registration": "verified" if r["status"] == "active" else r["status"],
             "deposit_verified": r["id"] in dep, "reward_status": "not eligible (no approved plan)", "partner_id": p["partner_code"]} for r in rows]


@router.get("/partner/ledger")
async def partner_ledger(user=Depends(current_partner)):
    p = await me_partner(user)
    return await db.partner_ledger.find({"partner_id": p["id"]}, {"_id": 0, "key": 0, "actor": 0}).sort("created_at", -1).to_list(500)


class PWdIn(BaseModel):
    amount: int = Field(gt=0)


@router.get("/partner/withdrawals")
async def partner_withdrawals(user=Depends(current_partner)):
    p = await me_partner(user)
    return await db.partner_withdrawals.find({"partner_id": p["id"]}, {"_id": 0, "reviewed_by": 0}).sort("created_at", -1).to_list(200)


@router.post("/partner/withdrawals")
async def partner_withdraw(body: PWdIn, request: Request, user=Depends(current_partner)):
    p = await me_partner(user)
    await check_rate(f"pwd:{p['id']}", 5, 60)
    if not p.get("payout_account"):
        raise HTTPException(400, "No approved payout method on file. Contact the platform admin.")
    if body.amount < 10000:
        raise HTTPException(400, "Minimum withdrawal is ₹100")
    wid = uid()
    if not await move(p["id"], {"available": {"$gte": body.amount}}, {"available": -body.amount, "reserved": body.amount}):
        raise HTTPException(400, "Insufficient available balance")
    await post_entry(p["id"], "reservation", -body.amount, f"pwd:reserve:{wid}", wid, "Withdrawal reserved")
    doc = {"id": wid, "reference": "PW" + secrets.token_hex(4).upper(), "partner_id": p["id"], "amount": body.amount,
           "method": p.get("payout_method", "UPI"), "destination_masked": mask(p["payout_account"]), "status": "requested",
           "created_at": iso(), "processed_at": None, "txn_ref": None, "reason": None}
    await db.partner_withdrawals.insert_one(dict(doc))
    return doc


@router.post("/partner/withdrawals/{wid}/cancel")
async def partner_cancel(wid: str, user=Depends(current_partner)):
    p = await me_partner(user)
    w = await db.partner_withdrawals.find_one_and_update({"id": wid, "partner_id": p["id"], "status": "requested"},
                                                         {"$set": {"status": "cancelled", "processed_at": iso()}})
    if not w:
        raise HTTPException(400, "Only requests that are not yet reviewed can be cancelled")
    await release(w)
    return {"ok": True}


async def release(w: dict):
    if await post_entry(w["partner_id"], "release", w["amount"], f"pwd:release:{w['id']}", w["id"], "Reservation released"):
        await move(w["partner_id"], {}, {"available": w["amount"], "reserved": -w["amount"]})


# ---------- admin: franchisee management ----------
class PartnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=5, max_length=120)
    phone: str = ""
    business_details: str = ""
    internal_ref: str = ""
    plan_id: str = ""
    payout_method: str = "UPI"
    payout_account: str = ""


async def new_invite(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.partner_invites.update_many({"user_id": user_id, "used": False}, {"$set": {"used": True}})
    await db.partner_invites.insert_one({"id": uid(), "user_id": user_id, "token_hash": sha(token), "used": False,
                                        "created_at": iso(), "expires_at": iso(now() + timedelta(hours=72))})
    return token


@router.get("/admin/partners")
async def admin_partners(q: str = "", status: str = "", sort: str = "created_at", page: int = 1, admin=Depends(current_admin)):
    flt = {}
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        flt["$or"] = [{"name": rx}, {"username": rx}, {"partner_code": rx}]
    if status:
        flt["status"] = status
    total = await db.partners.count_documents(flt)
    rows = await db.partners.find(flt, P).sort(sort if sort in ("created_at", "name", "username") else "created_at", -1) \
        .skip((max(page, 1) - 1) * 20).to_list(20)
    out = []
    for p in rows:
        s = await partner_stats(p["id"])
        out.append({**public_partner(p), "registered_users": s["registered_users"], "verified_users": s["verified_users"],
                    "total_earnings": s["total_earnings"], "available": s["available"], "pending_withdrawals": s["pending_withdrawals"]})
    return {"rows": out, "total": total, "page": page}


@router.post("/admin/partners")
async def admin_create_partner(body: PartnerIn, request: Request, admin=Depends(current_admin)):
    username = body.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,32}", username):
        raise HTTPException(400, "Username: 3-32 letters, numbers or underscore")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", body.email.strip()):
        raise HTTPException(400, "Enter a valid email")
    if await db.users.find_one({"username": username}):
        raise HTTPException(400, "Username already taken")
    user_id, pid = uid(), uid()
    code = "P" + secrets.token_hex(3).upper()
    while await db.partners.find_one({"partner_code": code}):
        code = "P" + secrets.token_hex(3).upper()
    await db.users.insert_one({"id": user_id, "username": username, "role": "partner", "status": "invited",
                               "password_hash": None, "created_at": iso()})
    await db.partners.insert_one({"id": pid, "user_id": user_id, "partner_code": code, "name": body.name.strip(),
                                  "username": username, "email": body.email.strip(), "phone": body.phone.strip(),
                                  "business_details": body.business_details, "internal_ref": body.internal_ref,
                                  "plan_id": body.plan_id, "payout_method": body.payout_method, "payout_account": body.payout_account,
                                  "status": "invited", "notes": [], "created_at": iso(), "created_by": admin["id"]})
    await wallet(pid)
    token = await new_invite(user_id)
    await audit(admin, "partner.create", pid, {"username": username, "code": code}, request)
    return {"id": pid, "partner_code": code, "setup_path": f"/partner/setup?token={token}", "login_path": "/partner/login"}


@router.get("/admin/partners/{pid}")
async def admin_partner(pid: str, admin=Depends(current_admin)):
    p = await db.partners.find_one({"id": pid}, P)
    if not p:
        raise HTTPException(404, "Partner not found")
    return {"partner": {**public_partner(p), "notes": p.get("notes", [])}, "stats": await partner_stats(pid),
            "ledger": await db.partner_ledger.find({"partner_id": pid}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(300),
            "withdrawals": await db.partner_withdrawals.find({"partner_id": pid}, P).sort("created_at", -1).to_list(200),
            "plan": await db.partner_plans.find_one({"id": p.get("plan_id")}, P) if p.get("plan_id") else None,
            "sessions": await db.sessions.find({"user_id": p["user_id"]}, {"_id": 0, "ip": 1, "ua": 1, "created_at": 1, "revoked": 1}).sort("created_at", -1).to_list(20),
            "audit": await db.audit_logs.find({"target": pid}, P).sort("created_at", -1).to_list(100)}


class StatusIn(BaseModel):
    status: str
    reason: str = Field(min_length=3, max_length=300)


@router.post("/admin/partners/{pid}/status")
async def admin_partner_status(pid: str, body: StatusIn, request: Request, admin=Depends(current_admin)):
    if body.status not in ("active", "suspended"):
        raise HTTPException(400, "Status must be active or suspended")
    p = await db.partners.find_one_and_update({"id": pid, "status": {"$in": ["active", "suspended"]}}, {"$set": {"status": body.status}})
    if not p:
        raise HTTPException(400, "Partner must finish setup first")
    await db.users.update_one({"id": p["user_id"]}, {"$set": {"status": body.status}})
    if body.status == "suspended":
        await db.sessions.update_many({"user_id": p["user_id"]}, {"$set": {"revoked": True}})
    await audit(admin, f"partner.{body.status}", pid, {"reason": body.reason}, request)
    return {"ok": True}


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post("/admin/partners/{pid}/notes")
async def admin_partner_note(pid: str, body: NoteIn, request: Request, admin=Depends(current_admin)):
    await db.partners.update_one({"id": pid}, {"$push": {"notes": {"text": body.text, "by": admin["username"], "at": iso()}}})
    await audit(admin, "partner.note", pid, {}, request)
    return {"ok": True}


@router.post("/admin/partners/{pid}/invite")
async def admin_partner_invite(pid: str, request: Request, admin=Depends(current_admin)):
    p = await db.partners.find_one({"id": pid, "status": "invited"})
    if not p:
        raise HTTPException(400, "Partner already completed setup")
    token = await new_invite(p["user_id"])
    await audit(admin, "partner.invite", pid, {}, request)
    return {"setup_path": f"/partner/setup?token={token}"}


class PayoutIn(BaseModel):
    payout_method: str = Field(min_length=2, max_length=20)
    payout_account: str = Field(min_length=4, max_length=80)


@router.post("/admin/partners/{pid}/payout")
async def admin_partner_payout(pid: str, body: PayoutIn, request: Request, admin=Depends(current_admin)):
    await db.partners.update_one({"id": pid}, {"$set": body.model_dump()})
    await audit(admin, "partner.payout_method", pid, {"method": body.payout_method, "account": mask(body.payout_account)}, request)
    return {"ok": True}


class AdjustIn(BaseModel):
    direction: str
    amount: int = Field(gt=0, le=10000000)
    reason: str = Field(min_length=5, max_length=300)


@router.post("/admin/partners/{pid}/adjust")
async def admin_partner_adjust(pid: str, body: AdjustIn, request: Request, admin=Depends(current_admin)):
    if not await db.partners.find_one({"id": pid}):
        raise HTTPException(404, "Partner not found")
    key = f"padj:{uid()}"
    if body.direction == "credit":
        await post_entry(pid, "adjustment_credit", body.amount, key, "", body.reason, admin["id"])
        await move(pid, {}, {"available": body.amount, "total_earned": body.amount})
    elif body.direction == "debit":
        if not await move(pid, {"available": {"$gte": body.amount}}, {"available": -body.amount, "total_earned": -body.amount}):
            raise HTTPException(400, "Available balance is lower than the debit")
        await post_entry(pid, "adjustment_debit", -body.amount, key, "", body.reason, admin["id"])
    else:
        raise HTTPException(400, "Direction must be credit or debit")
    await audit(admin, f"partner.adjust_{body.direction}", pid, {"amount": body.amount, "reason": body.reason}, request)
    return {"ok": True}


# ---------- compensation plans (inactive until compliance approval) ----------
class PlanIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    event: str = Field(min_length=2, max_length=80)
    basis: str = Field(min_length=2, max_length=80)
    rate: str = Field(min_length=1, max_length=40)
    conditions: str = ""
    start: str = ""
    end: str = ""
    jurisdiction: str = Field(min_length=2, max_length=60)
    reversal_rules: str = ""
    real_money: bool = True


@router.get("/admin/partner-plans")
async def plans(admin=Depends(current_admin)):
    return await db.partner_plans.find({}, P).sort("created_at", -1).to_list(200)


@router.post("/admin/partner-plans")
async def create_plan(body: PlanIn, request: Request, admin=Depends(current_admin)):
    n = await db.partner_plans.count_documents({"name": body.name})
    doc = {"id": uid(), **body.model_dump(), "version": n + 1, "status": "draft", "compliance_ref": None, "created_at": iso()}
    await db.partner_plans.insert_one(dict(doc))
    await audit(admin, "partner_plan.create", doc["id"], {"name": body.name, "version": n + 1}, request)
    return {k: v for k, v in doc.items() if k != "_id"}


class ComplianceIn(BaseModel):
    approval_ref: str = Field(min_length=4, max_length=120)


@router.post("/admin/partner-plans/{plan_id}/compliance")
async def plan_compliance(plan_id: str, body: ComplianceIn, request: Request, admin=Depends(current_admin)):
    await db.partner_plans.update_one({"id": plan_id}, {"$set": {"compliance_ref": body.approval_ref, "compliance_at": iso(), "compliance_by": admin["id"]}})
    await audit(admin, "partner_plan.compliance", plan_id, {"ref": body.approval_ref}, request)
    return {"ok": True}


@router.post("/admin/partner-plans/{plan_id}/activate")
async def plan_activate(plan_id: str, request: Request, admin=Depends(current_admin)):
    pl = await db.partner_plans.find_one({"id": plan_id})
    if not pl:
        raise HTTPException(404, "Plan not found")
    if not pl.get("compliance_ref"):
        raise HTTPException(400, "Record legal/compliance approval before activating this plan")
    await db.partner_plans.update_one({"id": plan_id}, {"$set": {"status": "active"}})
    await audit(admin, "partner_plan.activate", plan_id, {}, request)
    return {"ok": True}


# ---------- admin: partner withdrawal queue ----------
@router.get("/admin/partner-withdrawals")
async def admin_pwd(status: str = "", admin=Depends(current_admin)):
    flt = {"status": status} if status else {}
    rows = await db.partner_withdrawals.find(flt, P).sort("created_at", -1).to_list(300)
    names = {p["id"]: p["name"] async for p in db.partners.find({"id": {"$in": [r["partner_id"] for r in rows]}}, {"_id": 0, "id": 1, "name": 1})}
    for r in rows:
        r["partner_name"] = names.get(r["partner_id"], "")
    return rows


class WdActionIn(BaseModel):
    action: str
    reason: str = ""
    txn_ref: str = ""
    payment_verified: bool = False


@router.post("/admin/partner-withdrawals/{wid}/action")
async def admin_pwd_action(wid: str, body: WdActionIn, request: Request, admin=Depends(current_admin)):
    if body.action not in WD_FLOW:
        raise HTTPException(400, "Unknown action")
    if body.action in ("reject", "fail") and len(body.reason.strip()) < 3:
        raise HTTPException(400, "A reason is required")
    upd = {"status": WD_TO[body.action], "reason": body.reason or None, f"{body.action}_by": admin["id"], f"{body.action}_at": iso()}
    if body.action == "complete":
        ref = body.txn_ref.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{8,30}", ref):
            raise HTTPException(400, "Transaction reference must be 8-30 letters/numbers")
        if not body.payment_verified:
            raise HTTPException(400, "Confirm the payment was verified in the bank/provider statement")
        if await db.partner_withdrawals.find_one({"txn_ref": ref}):
            raise HTTPException(400, "This transaction reference is already used")
        upd.update(txn_ref=ref, processed_at=iso())
    if body.action in ("reject", "fail"):
        upd["processed_at"] = iso()
    w = await db.partner_withdrawals.find_one_and_update({"id": wid, "status": {"$in": WD_FLOW[body.action]}}, {"$set": upd})
    if not w:
        raise HTTPException(400, "Request is not in a state that allows this action")
    if WD_TO[body.action] in RELEASE:
        await release(w)
    if body.action == "complete":
        if await post_entry(w["partner_id"], "payout", -w["amount"], f"pwd:payout:{wid}", wid, f"Paid · ref {upd['txn_ref']}", admin["id"]):
            await move(w["partner_id"], {}, {"reserved": -w["amount"], "total_paid": w["amount"]})
    await audit(admin, f"partner_withdrawal.{body.action}", w["partner_id"], {"withdrawal": wid, "reason": body.reason, "txn_ref": upd.get("txn_ref")}, request)
    return {"ok": True}
