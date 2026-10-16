import io
import csv
import re
from datetime import datetime

from fastapi import APIRouter, Request, Depends, HTTPException, UploadFile, File, Response
from pydantic import BaseModel
from typing import Optional

from core import (db, iso, uid, current_admin, get_config, ledger_credit, ledger_debit, audit, notify, hash_pw,
                  gen_password, verify_pw, put_file, get_file, dec)
from game import liabilities, round_exposure
from payments import commission_summary, release_withdrawal, assign_withdrawal, OPEN_WITHDRAW
from routes_auth import reauth
from routes_verifier import refund_withdrawal

router = APIRouter(prefix="/admin")
P = {"_id": 0}


class ConfigIn(BaseModel):
    mode: Optional[str] = None
    min_stake: Optional[int] = None
    max_stake: Optional[int] = None
    paused: Optional[bool] = None
    max_round_exposure: Optional[int] = None
    company_reserve: Optional[int] = None
    commission_bps: Optional[int] = None
    commission_basis: Optional[str] = None
    promotions_enabled: Optional[bool] = None
    promo_reserve: Optional[int] = None


class AdjustIn(BaseModel):
    amount: int
    action: str
    reason: str
    reference: str = ""
    password: str
    code: str


class StatusIn(BaseModel):
    status: str


class VerifierIn(BaseModel):
    display_name: str
    account_name: str
    payment_details: str = ""
    upi_id: str
    deposit_capacity: int = 10
    deposit_limit: int = 10000000
    withdrawal_limit: int = 5000000
    commission_bps: int = 1000
    perm_deposit: bool = True
    perm_withdraw: bool = True
    opening_funds: int = 0


class VerifierUpd(BaseModel):
    display_name: Optional[str] = None
    deposit_capacity: Optional[int] = None
    withdrawal_limit: Optional[int] = None
    commission_bps: Optional[int] = None
    perm_deposit: Optional[bool] = None
    perm_withdraw: Optional[bool] = None
    status: Optional[str] = None


class AccountIn(BaseModel):
    name: str
    payment_details: str = ""
    upi_id: str
    verifier_id: str
    deposit_limit: int = 10000000
    withdrawal_limit: int = 5000000
    opening_funds: int = 0


class AccountUpd(BaseModel):
    name: Optional[str] = None
    payment_details: Optional[str] = None
    upi_id: Optional[str] = None
    verifier_id: Optional[str] = None
    deposit_limit: Optional[int] = None
    withdrawal_limit: Optional[int] = None
    status: Optional[str] = None


class FundsIn(BaseModel):
    amount: int
    reason: str


class RejectIn(BaseModel):
    reason: str = "Rejected by admin"


class CommissionIn(BaseModel):
    amount: int
    type: str
    note: str = ""
    account_id: str = ""


async def ssum(coll, match, field="$amount"):
    r = await db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "s": {"$sum": field}}}]).to_list(1)
    return r[0]["s"] if r else 0


# ---------- dashboard ----------
@router.get("/dashboard")
async def dashboard(admin=Depends(current_admin)):
    liab = await liabilities()
    stakes = await ssum("bets", {})
    payouts = await ssum("bets", {"status": "won"}, "$payout")
    unsettled = await ssum("bets", {"status": "accepted"})
    accrued = await ssum("commission_ledger", {"type": "accrual"})
    paid = await ssum("commission_ledger", {"type": "release"})
    adj = await ssum("commission_ledger", {"type": "adjustment"}) - await ssum("commission_ledger", {"type": "reversal"})
    accounts = await db.payment_accounts.find({}, {"_id": 0, "qr_path": 0}).to_list(500)
    recon = await reconcile_data()
    ggr = stakes - unsettled - payouts
    return {"total_deposits": await ssum("deposits", {"status": "verified"}),
            "total_withdrawals": await ssum("withdrawals", {"status": "completed"}),
            "pending_deposits": await ssum("deposits", {"status": "pending"}),
            "pending_withdrawals": await ssum("withdrawals", {"status": {"$in": OPEN_WITHDRAW}}),
            "wallet_liabilities": liab["total"], "total_stakes": stakes, "total_payouts": payouts, "ggr": ggr,
            "commission_accrued": accrued, "commission_paid": paid, "company_net": ggr - accrued - adj,
            "promo_expenditure": await ssum("ledger", {"type": "promotion"}),
            "accounts": accounts, "discrepancies": len(recon),
            "alerts": await db.admin_alerts.find({"resolved": False}, P).sort("created_at", -1).to_list(30),
            "users": await db.users.count_documents({"role": "user"})}


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, admin=Depends(current_admin)):
    await db.admin_alerts.update_one({"id": alert_id}, {"$set": {"resolved": True, "resolved_by": admin["username"]}})
    return {"ok": True}


@router.get("/game")
async def game_monitor(admin=Depends(current_admin)):
    cfg = await get_config()
    cur = await db.rounds.find_one({"status": {"$in": ["betting", "closed", "revealing"]}}, P, sort=[("number", -1)])
    exp = await round_exposure(cur, cur["multiplier_bps"]) if cur else None
    rounds = await db.rounds.find({}, {"_id": 0, "salt": 0}).sort("number", -1).to_list(30)
    if cur and cur["status"] == "betting":
        cur.pop("result", None)
        cur.pop("dice", None)
    cur and cur.pop("salt", None)
    pend = await ssum("withdrawals", {"status": {"$in": OPEN_WITHDRAW}})
    return {"config": cfg, "current": cur, "exposure": exp, "rounds": rounds,
            "risk": {**await liabilities(), "pending_withdrawals": pend, "company_reserve": cfg["company_reserve"],
                     "realized_pnl": await ssum("rounds", {"status": "settled"}, "$ggr")}}


@router.put("/config")
async def update_config(body: ConfigIn, request: Request, admin=Depends(current_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "mode" in upd and upd["mode"] not in ("random", "risk"):
        raise HTTPException(400, "Mode must be random or risk")
    if "commission_basis" in upd and upd["commission_basis"] not in ("deposits", "withdrawals", "both"):
        raise HTTPException(400, "Invalid commission basis")
    if upd.get("min_stake", 1) <= 0 or ("min_stake" in upd and "max_stake" in upd and upd["min_stake"] > upd["max_stake"]):
        raise HTTPException(400, "Invalid stake limits")
    before = await get_config()
    upd = {k: v for k, v in upd.items() if before.get(k) != v}
    if not upd:
        return before
    await db.config.update_one({"id": "game"}, {"$set": upd}, upsert=True)
    await db.config_history.insert_one({"id": uid(), "changes": upd, "before": {k: before.get(k) for k in upd},
                                        "by": admin["username"], "created_at": iso()})
    await audit(admin, "config.updated", "game", upd, request)
    return await get_config()


@router.get("/config/history")
async def config_history(admin=Depends(current_admin)):
    return await db.config_history.find({}, P).sort("created_at", -1).to_list(100)


# ---------- users ----------
@router.get("/users")
async def users(q: str = "", admin=Depends(current_admin)):
    query = {"role": "user"}
    if q:
        query["$or"] = [{"username": {"$regex": re.escape(q.lower())}}, {"id": q}]
    rows = await db.users.find(query, {"_id": 0, "id": 1, "username": 1, "status": 1, "created_at": 1}).sort("created_at", -1).to_list(200)
    wallets = {w["user_id"]: w for w in await db.wallets.find({"user_id": {"$in": [r["id"] for r in rows]}}, P).to_list(200)}
    for r in rows:
        r["balance"] = wallets.get(r["id"], {}).get("balance", 0)
        r["reserved"] = wallets.get(r["id"], {}).get("reserved", 0)
    return rows


@router.get("/users/{user_id}")
async def user_detail(user_id: str, admin=Depends(current_admin)):
    u = await db.users.find_one({"id": user_id, "role": "user"}, {"_id": 0, "id": 1, "username": 1, "status": 1, "created_at": 1})
    if not u:
        raise HTTPException(404, "User not found")
    q = {"user_id": user_id}
    bank = await db.bank_details.find_one(q, P)
    return {"user": u, "wallet": await db.wallets.find_one(q, P),
            "bank": {"holder_name": bank["holder_name"], "account_number": dec(bank.get("account_number_enc", "")),
                     "ifsc": bank.get("ifsc"), "upi_id": bank.get("upi_id")} if bank else None,
            "deposits": await db.deposits.find(q, P).sort("created_at", -1).to_list(100),
            "withdrawals": await db.withdrawals.find(q, {"_id": 0, "destination": 0}).sort("created_at", -1).to_list(100),
            "bets": await db.bets.find(q, P).sort("created_at", -1).to_list(100),
            "adjustments": await db.adjustments.find(q, P).sort("created_at", -1).to_list(100),
            "ledger": await db.ledger.find(q, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(200)}


@router.post("/users/{user_id}/status")
async def user_status(user_id: str, body: StatusIn, request: Request, admin=Depends(current_admin)):
    if body.status not in ("active", "suspended"):
        raise HTTPException(400, "Invalid status")
    await db.users.update_one({"id": user_id, "role": "user"}, {"$set": {"status": body.status}})
    if body.status == "suspended":
        await db.sessions.update_many({"user_id": user_id}, {"$set": {"revoked": True}})
    await audit(admin, f"user.{body.status}", user_id, request=request)
    return {"ok": True}


@router.post("/users/{user_id}/adjust")
async def adjust_wallet(user_id: str, body: AdjustIn, request: Request, admin=Depends(current_admin)):
    await reauth(admin, body.password, body.code)
    if body.action not in ("credit", "debit") or body.amount <= 0:
        raise HTTPException(400, "Invalid action or amount")
    if len(body.reason.strip()) < 3:
        raise HTTPException(400, "Reason is required")
    if not await db.users.find_one({"id": user_id, "role": "user"}):
        raise HTTPException(404, "User not found")
    adj_id = uid()
    meta = {"adjustment_id": adj_id, "reason": body.reason, "reference": body.reference, "by": admin["username"]}
    if body.action == "credit":
        await ledger_credit(user_id, body.amount, "manual_credit", f"adjust:{adj_id}", meta)
    else:
        await ledger_debit(user_id, body.amount, "manual_debit", f"adjust:{adj_id}", meta)
    w = await db.wallets.find_one({"user_id": user_id}, P)
    await db.adjustments.insert_one({"id": adj_id, "user_id": user_id, "action": body.action, "amount": body.amount,
                                     "reason": body.reason, "reference": body.reference, "by": admin["username"],
                                     "balance_after": w["balance"], "created_at": iso()})
    await notify(user_id, "Wallet adjusted", f"Your wallet was {body.action}ed ₹{body.amount / 100:.2f}. Reason: {body.reason}")
    await audit(admin, f"wallet.manual_{body.action}", user_id, meta | {"amount": body.amount}, request)
    return {"ok": True, "balance": w["balance"], "adjustment_id": adj_id}


# ---------- verifiers ----------
async def next_verifier_username():
    n = await db.counters.find_one_and_update({"id": "verifier"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"pv{1000 + n['seq']}"


@router.get("/verifiers")
async def list_verifiers(admin=Depends(current_admin)):
    rows = await db.verifiers.find({}, P).sort("created_at", -1).to_list(200)
    for v in rows:
        v["summary"] = await commission_summary(v["id"])
        v["accounts"] = await db.payment_accounts.find({"verifier_id": v["id"]}, {"_id": 0, "qr_path": 0}).to_list(20)
        v["deposit_workload"] = await db.deposits.count_documents({"verifier_id": v["id"], "status": "pending"})
    return rows


@router.post("/verifiers")
async def create_verifier(body: VerifierIn, request: Request, admin=Depends(current_admin)):
    username = await next_verifier_username()
    temp = gen_password()
    user = {"id": uid(), "username": username, "role": "verifier", "status": "active", "password_hash": hash_pw(temp),
            "must_change_password": True, "created_at": iso()}
    await db.users.insert_one(dict(user))
    v = {"id": uid(), "user_id": user["id"], "username": username, "display_name": body.display_name,
         "deposit_capacity": body.deposit_capacity, "withdrawal_limit": body.withdrawal_limit,
         "commission_bps": body.commission_bps, "perm_deposit": body.perm_deposit, "perm_withdraw": body.perm_withdraw,
         "status": "active", "online": False, "created_at": iso()}
    await db.verifiers.insert_one(dict(v))
    acc = await _create_account(AccountIn(name=body.account_name, payment_details=body.payment_details, upi_id=body.upi_id,
                                          verifier_id=v["id"], deposit_limit=body.deposit_limit,
                                          withdrawal_limit=body.withdrawal_limit, opening_funds=body.opening_funds))
    await audit(admin, "verifier.created", v["id"], {"username": username}, request)
    return {"verifier": v, "account": acc, "credentials": {"username": username, "temporary_password": temp}}


@router.put("/verifiers/{vid}")
async def update_verifier(vid: str, body: VerifierUpd, request: Request, admin=Depends(current_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in upd:
        if upd["status"] not in ("active", "disabled"):
            raise HTTPException(400, "Invalid status")
        if upd["status"] == "disabled":
            upd["online"] = False
    v = await db.verifiers.find_one_and_update({"id": vid}, {"$set": upd})
    if not v:
        raise HTTPException(404, "Verifier not found")
    if upd.get("status") == "disabled":
        await db.sessions.update_many({"user_id": v["user_id"]}, {"$set": {"revoked": True}})
    if "status" in upd:
        await db.users.update_one({"id": v["user_id"]}, {"$set": {"status": "active" if upd["status"] == "active" else "suspended"}})
    await audit(admin, "verifier.updated", vid, upd, request)
    return {"ok": True}


@router.post("/verifiers/{vid}/reset-credentials")
async def reset_verifier(vid: str, request: Request, admin=Depends(current_admin)):
    v = await db.verifiers.find_one({"id": vid}, P)
    if not v:
        raise HTTPException(404, "Verifier not found")
    temp = gen_password()
    await db.users.update_one({"id": v["user_id"]}, {"$set": {"password_hash": hash_pw(temp), "must_change_password": True}})
    await db.sessions.update_many({"user_id": v["user_id"]}, {"$set": {"revoked": True}})
    await db.verifiers.update_one({"id": vid}, {"$set": {"online": False}})
    await audit(admin, "verifier.credentials_reset", vid, request=request)
    return {"username": v["username"], "temporary_password": temp}


@router.get("/verifiers/{vid}/activity")
async def verifier_activity(vid: str, admin=Depends(current_admin)):
    v = await db.verifiers.find_one({"id": vid}, P)
    if not v:
        raise HTTPException(404, "Verifier not found")
    return {"audit": await db.audit_logs.find({"actor_id": v["user_id"]}, P).sort("created_at", -1).to_list(100),
            "commission_ledger": await db.commission_ledger.find({"verifier_id": vid}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(200),
            "summary": await commission_summary(vid)}


@router.post("/verifiers/{vid}/commission")
async def commission_entry(vid: str, body: CommissionIn, request: Request, admin=Depends(current_admin)):
    if body.type not in ("release", "adjustment", "reversal") or body.amount <= 0:
        raise HTTPException(400, "Invalid commission entry")
    s = await commission_summary(vid)
    if body.type == "release":
        if body.amount > s["pending"]:
            raise HTTPException(400, "Release exceeds pending commission")
        acc = await db.payment_accounts.find_one_and_update(
            {"id": body.account_id, "verifier_id": vid,
             "$expr": {"$gte": [{"$subtract": ["$available_funds", "$committed"]}, body.amount]}},
            {"$inc": {"available_funds": -body.amount}})
        if not acc:
            raise HTTPException(400, "Release would leave the processing account unable to cover outstanding obligations")
    await db.commission_ledger.insert_one({"id": uid(), "verifier_id": vid, "type": body.type, "amount": body.amount,
                                           "basis_amount": 0, "note": body.note, "account_id": body.account_id,
                                           "key": f"{body.type}:{uid()}", "by": admin["username"], "created_at": iso()})
    await audit(admin, f"commission.{body.type}", vid, {"amount": body.amount, "note": body.note}, request)
    return await commission_summary(vid)


# ---------- payment accounts ----------
async def _create_account(body: AccountIn) -> dict:
    if not await db.verifiers.find_one({"id": body.verifier_id}):
        raise HTTPException(400, "Verifier not found")
    acc = {"id": uid(), "name": body.name, "payment_details": body.payment_details, "upi_id": body.upi_id.strip(),
           "verifier_id": body.verifier_id, "deposit_limit": body.deposit_limit, "withdrawal_limit": body.withdrawal_limit,
           "available_funds": max(0, body.opening_funds), "committed": 0, "status": "active", "qr_path": "",
           "created_at": iso()}
    await db.payment_accounts.insert_one(dict(acc))
    acc.pop("qr_path")
    return acc


@router.get("/accounts")
async def list_accounts(admin=Depends(current_admin)):
    rows = await db.payment_accounts.find({}, P).sort("created_at", -1).to_list(500)
    for a in rows:
        a["has_qr"] = bool(a.pop("qr_path", ""))
    return rows


@router.post("/accounts")
async def create_account(body: AccountIn, request: Request, admin=Depends(current_admin)):
    acc = await _create_account(body)
    await audit(admin, "account.created", acc["id"], {"name": body.name}, request)
    return acc


@router.put("/accounts/{acc_id}")
async def update_account(acc_id: str, body: AccountUpd, request: Request, admin=Depends(current_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in upd and upd["status"] not in ("active", "inactive"):
        raise HTTPException(400, "Invalid status")
    if "verifier_id" in upd and not await db.verifiers.find_one({"id": upd["verifier_id"]}):
        raise HTTPException(400, "Verifier not found")
    await db.payment_accounts.update_one({"id": acc_id}, {"$set": upd})
    if "verifier_id" in upd:
        await db.withdrawals.update_many({"account_id": acc_id, "status": {"$in": OPEN_WITHDRAW}},
                                         {"$set": {"verifier_id": upd["verifier_id"]}})
    await audit(admin, "account.updated", acc_id, upd, request)
    return {"ok": True}


@router.post("/accounts/{acc_id}/funds")
async def account_funds(acc_id: str, body: FundsIn, request: Request, admin=Depends(current_admin)):
    acc = await db.payment_accounts.find_one_and_update(
        {"id": acc_id, "$expr": {"$gte": [{"$add": [{"$subtract": ["$available_funds", "$committed"]}, body.amount]}, 0]}},
        {"$inc": {"available_funds": body.amount}})
    if not acc:
        raise HTTPException(400, "Adjustment would leave outstanding obligations uncovered")
    await db.account_ledger.insert_one({"id": uid(), "account_id": acc_id, "amount": body.amount, "reason": body.reason,
                                        "by": admin["username"], "created_at": iso()})
    await audit(admin, "account.funds_adjusted", acc_id, {"amount": body.amount, "reason": body.reason}, request)
    return {"ok": True}


@router.post("/accounts/{acc_id}/qr")
async def upload_qr(acc_id: str, request: Request, file: UploadFile = File(...), admin=Depends(current_admin)):
    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(400, "Upload a PNG, JPG or WEBP image")
    data = await file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Image too large (max 3MB)")
    path = await put_file("qr", file.filename or "qr.png", data, file.content_type, admin["id"])
    await db.payment_accounts.update_one({"id": acc_id}, {"$set": {"qr_path": path}})
    await audit(admin, "account.qr_uploaded", acc_id, request=request)
    return {"ok": True}


@router.get("/accounts/{acc_id}/qr")
async def admin_qr(acc_id: str, admin=Depends(current_admin)):
    acc = await db.payment_accounts.find_one({"id": acc_id}, P)
    if not acc or not acc.get("qr_path"):
        raise HTTPException(404, "QR not available")
    data, ct = await get_file(acc["qr_path"])
    return Response(content=data, media_type=ct)


@router.get("/accounts/{acc_id}/transactions")
async def account_txns(acc_id: str, admin=Depends(current_admin)):
    return {"deposits": await db.deposits.find({"account_id": acc_id}, P).sort("created_at", -1).to_list(200),
            "withdrawals": await db.withdrawals.find({"account_id": acc_id}, {"_id": 0, "destination": 0}).sort("created_at", -1).to_list(200),
            "adjustments": await db.account_ledger.find({"account_id": acc_id}, P).sort("created_at", -1).to_list(100)}


# ---------- deposits / withdrawals ----------
@router.get("/deposits")
async def all_deposits(status: str = "", admin=Depends(current_admin)):
    q = {"status": status} if status else {}
    return await db.deposits.find(q, P).sort("created_at", -1).to_list(300)


@router.get("/withdrawals")
async def all_withdrawals(status: str = "", admin=Depends(current_admin)):
    q = {"status": status} if status else {}
    return await db.withdrawals.find(q, {"_id": 0, "destination": 0}).sort("created_at", -1).to_list(300)


@router.post("/withdrawals/{wid}/reassign")
async def reassign_wd(wid: str, request: Request, admin=Depends(current_admin)):
    w = await db.withdrawals.find_one({"id": wid}, P)
    if not w or w["status"] not in ("pending", "approved"):
        raise HTTPException(400, "Only pending or approved withdrawals can be reassigned")
    prev = w.get("account_id")
    await db.withdrawals.update_one({"id": wid}, {"$set": {"status": "pending"}})
    w["status"] = "pending"
    await release_withdrawal(w, "admin_reassign")
    w["account_id"] = None
    ok = await assign_withdrawal(w, exclude=[prev] if prev else [])
    await audit(admin, "withdrawal.reassigned", wid, {"assigned": ok}, request)
    return {"reassigned": ok}


@router.post("/withdrawals/{wid}/reject")
async def admin_reject_wd(wid: str, request: Request, body: RejectIn = None, admin=Depends(current_admin)):
    reason = (body.reason if body else "Rejected by admin")[:200]
    w = await db.withdrawals.find_one({"id": wid}, P)
    if not w or w["status"] not in ("pending", "approved"):
        raise HTTPException(400, "Withdrawal cannot be rejected")
    res = await db.withdrawals.update_one({"id": wid, "status": w["status"]}, {
        "$set": {"status": "rejected", "rejected_at": iso(), "reject_reason": reason},
        "$push": {"history": {"at": iso(), "event": "rejected", "by": admin["username"], "reject_reason": reason}}})
    if res.modified_count:
        await refund_withdrawal(w)
    await audit(admin, "withdrawal.rejected", wid, request=request)
    return {"ok": True}


# ---------- logs / reports ----------
@router.get("/audit")
async def audit_log(action: str = "", admin=Depends(current_admin)):
    q = {"action": {"$regex": re.escape(action)}} if action else {}
    return await db.audit_logs.find(q, P).sort("created_at", -1).to_list(500)


def report_query(start, end, user, typ):
    q = {}
    if start or end:
        q["created_at"] = {}
        if start:
            q["created_at"]["$gte"] = start
        if end:
            q["created_at"]["$lte"] = end + "T23:59:59.999999+00:00"
    if typ:
        q["type"] = typ
    return q


async def report_rows(start="", end="", user="", type="", status="", verifier="", account="", round=""):
    kind = type or "ledger"
    if kind in ("deposits", "withdrawals"):
        q = report_query(start, end, user, "")
        if status:
            q["status"] = status
        if verifier:
            q["verifier_id"] = verifier
        if account:
            q["account_id"] = account
    elif kind == "bets":
        q = report_query(start, end, user, "")
        if status:
            q["status"] = status
        if round:
            q["round_number"] = int(round) if round.isdigit() else -1
    else:
        q = report_query(start, end, user, status)
    if user:
        u = await db.users.find_one({"$or": [{"username": user.lower()}, {"id": user}]})
        q["user_id"] = u["id"] if u else "__none__"
    coll = {"deposits": "deposits", "withdrawals": "withdrawals", "bets": "bets"}.get(kind, "ledger")
    rows = await db[coll].find(q, {"_id": 0, "destination": 0, "key": 0, "history": 0}).sort("created_at", -1).to_list(2000)
    if coll == "ledger":
        names = {u["id"]: u["username"] for u in await db.users.find({"id": {"$in": list({r["user_id"] for r in rows})}}, {"_id": 0, "id": 1, "username": 1}).to_list(2000)}
        for r in rows:
            r["username"] = names.get(r["user_id"])
    return rows


@router.get("/reports")
async def reports(start: str = "", end: str = "", user: str = "", type: str = "", status: str = "",
                  verifier: str = "", account: str = "", round: str = "", admin=Depends(current_admin)):
    rows = await report_rows(start, end, user, type, status, verifier, account, round)
    return {"rows": rows, "count": len(rows), "total_amount": sum(r.get("amount", 0) for r in rows)}


@router.get("/reports/export")
async def export(request: Request, start: str = "", end: str = "", user: str = "", type: str = "", status: str = "",
                 verifier: str = "", account: str = "", round: str = "", admin=Depends(current_admin)):
    rows = await report_rows(start, end, user, type, status, verifier, account, round)
    buf = io.StringIO()
    cols = sorted({k for r in rows for k in r if not isinstance(r[k], (dict, list))})
    wr = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    wr.writeheader()
    for r in rows:
        wr.writerow({k: (r[k] / 100 if k in ("amount", "payout", "net", "balance_after") and isinstance(r.get(k), int) else r.get(k)) for k in cols if k in r})
    await audit(admin, "report.exported", type or "ledger", {"rows": len(rows)}, request)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=report-{type or 'ledger'}-{datetime.now().strftime('%Y%m%d%H%M')}.csv"})


async def reconcile_data():
    sums = {r["_id"]: r for r in await db.ledger.aggregate([{"$group": {
        "_id": "$user_id", "s": {"$sum": "$amount"}, "r": {"$sum": {"$ifNull": ["$reserved_change", 0]}},
        "wr": {"$sum": {"$cond": [{"$eq": ["$type", "withdraw_reserve"]}, {"$multiply": ["$amount", -1]}, 0]}},
        "wf": {"$sum": {"$cond": [{"$eq": ["$type", "withdraw_refund"]}, "$amount", 0]}}}}]).to_list(100000)}
    out = []
    async for w in db.wallets.find({}, P):
        s = sums.get(w["user_id"], {"s": 0, "r": 0, "wr": 0, "wf": 0})
        exp_res = s["wr"] - s["wf"] + s["r"]
        if s["s"] != w["balance"] or exp_res != w["reserved"]:
            out.append({"user_id": w["user_id"], "wallet_balance": w["balance"], "ledger_balance": s["s"],
                        "wallet_reserved": w["reserved"], "ledger_reserved": exp_res})
    return out


@router.get("/reconcile")
async def reconcile(admin=Depends(current_admin)):
    return {"discrepancies": await reconcile_data(), "checked_at": iso()}


async def seed_admin():
    import os
    from core import enc
    username = os.environ["ADMIN_USERNAME"]
    pw = os.environ["ADMIN_PASSWORD"]
    totp = os.environ.get("ADMIN_TOTP_SECRET", "")
    existing = await db.users.find_one({"username": username, "role": "admin"})
    if not existing:
        doc = {"id": uid(), "username": username, "role": "admin", "status": "active", "password_hash": hash_pw(pw),
               "created_at": iso(), "mfa_enabled": bool(totp), "backup_codes": []}
        if totp:
            doc["totp_secret"] = enc(totp)
        await db.users.insert_one(doc)
    elif not verify_pw(pw, existing["password_hash"]):
        await db.users.update_one({"id": existing["id"]}, {"$set": {"password_hash": hash_pw(pw)}})
    await db.config.update_one({"id": "game"}, {"$setOnInsert": {"id": "game"}}, upsert=True)
