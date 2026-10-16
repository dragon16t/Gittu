from fastapi import APIRouter, Request, Depends, HTTPException, Response
from pydantic import BaseModel

from core import db, iso, current_verifier, ledger_credit, reserved_settle, audit, notify, dec, get_file
from payments import (commission_summary, accrue_commission, release_withdrawal, assign_withdrawal,
                      credit_deposit_notice)
from promotions import on_deposit_verified

router = APIRouter(prefix="/verifier")
P = {"_id": 0}


class OnlineIn(BaseModel):
    online: bool


class ReasonIn(BaseModel):
    reason: str


class RefIn(BaseModel):
    reference: str


async def vprofile(user: dict) -> dict:
    v = await db.verifiers.find_one({"user_id": user["id"]}, P)
    if not v or v["status"] != "active":
        raise HTTPException(403, "Verifier account disabled")
    return v


def wd_view(w: dict) -> dict:
    out = {k: v for k, v in w.items() if k not in ("destination", "client_key")}
    d = w.get("destination", {})
    out["destination"] = {"holder_name": d.get("holder_name"), "account_number": dec(d.get("account_number_enc", "")),
                          "ifsc": d.get("ifsc"), "upi_id": d.get("upi_id")}
    return out


@router.get("/dashboard")
async def dashboard(user=Depends(current_verifier)):
    v = await vprofile(user)
    accounts = await db.payment_accounts.find({"verifier_id": v["id"]}, P).to_list(50)
    deposits = await db.deposits.find({"verifier_id": v["id"]}, P).sort("created_at", -1).to_list(200)
    withdrawals = await db.withdrawals.find({"verifier_id": v["id"]}, P).sort("created_at", -1).to_list(200)
    commission = await db.commission_ledger.find({"verifier_id": v["id"]}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(200)
    for a in accounts:
        a["has_qr"] = bool(a.get("qr_path"))
        a.pop("qr_path", None)
    return {"verifier": v, "accounts": accounts, "deposits": deposits,
            "withdrawals": [wd_view(w) for w in withdrawals], "commission_ledger": commission,
            "stats": {**await commission_summary(v["id"]),
                      "available_funds": sum(a["available_funds"] for a in accounts),
                      "reserved_funds": sum(a["committed"] for a in accounts)},
            "must_change_password": user.get("must_change_password", False)}


@router.get("/alerts/poll")
async def poll_alerts(user=Depends(current_verifier)):
    rows = await db.notifications.find({"user_id": user["id"], "read": False}, P).sort("created_at", 1).to_list(10)
    if rows:
        await db.notifications.update_many({"id": {"$in": [r["id"] for r in rows]}}, {"$set": {"read": True}})
    return rows


@router.post("/online")
async def set_online(body: OnlineIn, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    if user.get("must_change_password"):
        raise HTTPException(400, "Change your temporary password first")
    await db.verifiers.update_one({"id": v["id"]}, {"$set": {"online": body.online, "status_changed_at": iso()}})
    await audit(user, "verifier.online" if body.online else "verifier.offline", v["id"], request=request)
    return {"online": body.online}


@router.get("/accounts/{acc_id}/qr")
async def account_qr(acc_id: str, user=Depends(current_verifier)):
    v = await vprofile(user)
    acc = await db.payment_accounts.find_one({"id": acc_id, "verifier_id": v["id"]}, P)
    if not acc or not acc.get("qr_path"):
        raise HTTPException(404, "QR not available")
    data, ct = await get_file(acc["qr_path"])
    return Response(content=data, media_type=ct)


async def my_deposit(v, dep_id):
    d = await db.deposits.find_one({"id": dep_id, "verifier_id": v["id"]}, P)
    if not d:
        raise HTTPException(404, "Deposit not found")
    return d


async def do_verify_deposit(v: dict, d: dict, user: dict, request: Request, allowed=("pending",), note=""):
    res = await db.deposits.update_one({"id": d["id"], "status": {"$in": list(allowed)}},
                                       {"$set": {"status": "verified", "verified_at": iso(), "verified_by": user["id"],
                                                 "verify_note": note}, "$unset": {"reject_reason": ""}})
    if not res.modified_count:
        raise HTTPException(400, "Deposit is not in a verifiable state")
    if await ledger_credit(d["user_id"], d["amount"], "deposit", f"deposit:{d['id']}", {"deposit_id": d["id"], "utr": d.get("utr")}):
        await db.payment_accounts.update_one({"id": d["account_id"]}, {"$inc": {"available_funds": d["amount"]}})
        await accrue_commission(v["id"], "deposits", d["id"], d["amount"])
        await on_deposit_verified(d)
        await credit_deposit_notice(d)
    await audit(user, "deposit.verified", d["id"], {"amount": d["amount"], "utr": d.get("utr"), "note": note}, request)


@router.post("/deposits/{dep_id}/verify")
async def verify_deposit(dep_id: str, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    if not v.get("perm_deposit"):
        raise HTTPException(403, "No deposit permission")
    d = await my_deposit(v, dep_id)
    await do_verify_deposit(v, d, user, request)
    return {"ok": True}


@router.post("/deposits/{dep_id}/reject")
async def reject_deposit(dep_id: str, body: ReasonIn, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    d = await my_deposit(v, dep_id)
    res = await db.deposits.update_one({"id": dep_id, "status": {"$in": ["pending", "initiated"]}},
                                       {"$set": {"status": "rejected", "reject_reason": body.reason[:200], "rejected_at": iso(),
                                                 "rejected_utr": d.get("utr")}, "$unset": {"utr": ""}})
    if not res.modified_count:
        raise HTTPException(400, "Deposit cannot be rejected")
    await notify(d["user_id"], "Deposit rejected", f"Deposit of ₹{d['amount'] / 100:.2f} rejected: {body.reason[:200]}")
    await audit(user, "deposit.rejected", dep_id, {"reason": body.reason}, request)
    return {"ok": True}


async def my_wd(v, wid):
    if not v.get("perm_withdraw"):
        raise HTTPException(403, "No withdrawal permission")
    w = await db.withdrawals.find_one({"id": wid, "verifier_id": v["id"]}, P)
    if not w:
        raise HTTPException(404, "Withdrawal not found")
    return w


async def transition(wid, frm, to, extra=None):
    res = await db.withdrawals.update_one({"id": wid, "status": frm}, {
        "$set": {"status": to, f"{to}_at": iso(), **(extra or {})},
        "$push": {"history": {"at": iso(), "event": to, **(extra or {})}}})
    if not res.modified_count:
        raise HTTPException(400, f"Withdrawal must be {frm} to mark it {to}")


@router.post("/withdrawals/{wid}/approve")
async def approve_wd(wid: str, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    w = await my_wd(v, wid)
    await transition(wid, "pending", "approved")
    await notify(w["user_id"], "Withdrawal approved", f"Your withdrawal of ₹{w['amount'] / 100:.2f} was approved.")
    await audit(user, "withdrawal.approved", wid, request=request)
    return {"ok": True}


@router.post("/withdrawals/{wid}/processing")
async def processing_wd(wid: str, body: RefIn, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    await my_wd(v, wid)
    ref = body.reference.strip().upper()
    if len(ref) < 6:
        raise HTTPException(400, "Enter the transfer reference")
    await transition(wid, "approved", "processing", {"reference": ref})
    await audit(user, "withdrawal.processing", wid, {"reference": ref}, request)
    return {"ok": True}


async def do_complete_withdrawal(v: dict, w: dict, user: dict, request: Request, frm="processing", extra=None):
    await transition(w["id"], frm, "completed", {"verified_by": user["id"], **(extra or {})})
    ref = (extra or {}).get("reference") or w.get("reference")
    if await reserved_settle(w["user_id"], w["amount"], "withdraw_complete", f"wcomplete:{w['id']}",
                             {"withdrawal_id": w["id"], "reference": ref}):
        await db.payment_accounts.update_one({"id": w["account_id"]},
                                             {"$inc": {"available_funds": -w["amount"], "committed": -w["amount"]}})
        await accrue_commission(v["id"], "withdrawals", w["id"], w["amount"])
        await notify(w["user_id"], "Withdrawal completed", f"₹{w['amount'] / 100:.2f} has been transferred. Ref {ref}")
    await audit(user, "withdrawal.completed", w["id"], {"amount": w["amount"], "reference": ref}, request)


@router.post("/withdrawals/{wid}/complete")
async def complete_wd(wid: str, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    w = await my_wd(v, wid)
    await do_complete_withdrawal(v, w, user, request)
    return {"ok": True}


@router.post("/withdrawals/{wid}/reject")
async def reject_wd(wid: str, body: ReasonIn, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    w = await my_wd(v, wid)
    await transition(wid, w["status"] if w["status"] in ("pending", "approved") else "__", "rejected",
                     {"reject_reason": body.reason[:200]})
    await refund_withdrawal(w)
    await audit(user, "withdrawal.rejected", wid, {"reason": body.reason}, request)
    return {"ok": True}


async def refund_withdrawal(w):
    if await ledger_credit(w["user_id"], w["amount"], "withdraw_refund", f"wrefund:{w['id']}",
                           {"withdrawal_id": w["id"]}, from_reserved=True):
        if w.get("account_id"):
            await db.payment_accounts.update_one({"id": w["account_id"]}, {"$inc": {"committed": -w["amount"]}})
        await notify(w["user_id"], "Withdrawal rejected", f"₹{w['amount'] / 100:.2f} was returned to your wallet.")


@router.post("/withdrawals/{wid}/insufficient")
async def insufficient_wd(wid: str, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    w = await my_wd(v, wid)
    if w["status"] not in ("pending", "approved"):
        raise HTTPException(400, "Only pending or approved withdrawals can be reassigned")
    prev = w["account_id"]
    await db.withdrawals.update_one({"id": wid}, {"$set": {"status": "pending"}})
    w["status"] = "pending"
    await release_withdrawal(w, "insufficient_funds")
    w.update(account_id=None)
    assigned = await assign_withdrawal(w, exclude=[prev])
    await audit(user, "withdrawal.insufficient_funds", wid, {"reassigned": assigned}, request)
    return {"reassigned": assigned}
