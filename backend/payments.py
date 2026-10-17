import asyncio
import random
from datetime import datetime, timedelta

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import db, now, iso, uid, alert, notify, get_config, NOID, log

OPEN_DEPOSIT = ["initiated", "pending"]
OPEN_WITHDRAW = ["pending", "approved", "processing"]
OFFLINE_FALLBACK_MIN = 10
DEPOSIT_WINDOW_MIN = 10
UTR_GRACE_MIN = 30


def parse_iso(s: str):
    return datetime.fromisoformat(s)


async def withdrawal_dispatcher():
    """Every 5s: hand untouched requests held by offline verifiers to online ones, then assign unassigned requests."""
    while True:
        try:
            await dispatch_withdrawals()
            await db.deposits.update_many({"status": "initiated", "created_at": {"$lt": iso(now() - timedelta(minutes=DEPOSIT_WINDOW_MIN))}},
                                          {"$set": {"status": "expired", "expired_at": iso()}})
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("withdrawal dispatcher error")
        await asyncio.sleep(5)


async def dispatch_withdrawals():
    online = [v["id"] for v in await db.verifiers.find({"status": "active", "online": True, "perm_withdraw": True},
                                                       {"_id": 0, "id": 1}).to_list(500)]
    if online:
        async for w in db.withdrawals.find({"status": "pending", "account_id": {"$ne": None},
                                            "verifier_id": {"$nin": online}}, NOID):
            await release_withdrawal(w, "reassign_offline")
    async for w in db.withdrawals.find({"status": "pending", "account_id": None}, NOID):
        await assign_withdrawal(w)


async def eligible_deposit_account(amount: int):
    since = iso(now() - timedelta(minutes=DEPOSIT_WINDOW_MIN))
    verifiers = {v["id"]: v for v in await db.verifiers.find(
        {"status": "active", "online": True, "perm_deposit": True}, NOID).to_list(500)}
    if not verifiers:
        return None
    loads = {r["_id"]: r["n"] for r in await db.deposits.aggregate([
        {"$match": {"verifier_id": {"$in": list(verifiers)}, "$or": [
            {"status": "pending"}, {"status": "initiated", "created_at": {"$gte": since}}]}},
        {"$group": {"_id": "$verifier_id", "n": {"$sum": 1}}}]).to_list(500)}
    accs = await db.payment_accounts.find({"verifier_id": {"$in": list(verifiers)}, "status": "active",
                                           "deposit_limit": {"$gte": amount}, "qr_path": {"$nin": [None, ""]}}, NOID).to_list(1000)
    have = set(await db.files.distinct("storage_path", {"storage_path": {"$in": [a["qr_path"] for a in accs]}, "is_deleted": False}))
    accs = [a for a in accs if a["qr_path"] in have]
    by_v = {}
    for a in accs:
        if loads.get(a["verifier_id"], 0) < verifiers[a["verifier_id"]].get("deposit_capacity", 0):
            by_v.setdefault(a["verifier_id"], []).append(a)
    if not by_v:
        return None
    least = min(loads.get(vid, 0) for vid in by_v)
    rng = random.SystemRandom()
    vid = rng.choice([vid for vid in by_v if loads.get(vid, 0) == least])
    return verifiers[vid], rng.choice(by_v[vid])


async def assign_withdrawal(w: dict, exclude: list = None) -> bool:
    """Commit the withdrawal to an ONLINE verifier account with enough free funds (least busy first, random ties).
    Offline verifiers are used only after the request has waited OFFLINE_FALLBACK_MIN minutes."""
    exclude = exclude or []
    verifiers = {v["id"]: v for v in await db.verifiers.find(
        {"status": "active", "perm_withdraw": True, "withdrawal_limit": {"$gte": w["amount"]}}, NOID).to_list(500)}
    accs = await db.payment_accounts.find({"status": "active", "verifier_id": {"$in": list(verifiers)},
                                           "withdrawal_limit": {"$gte": w["amount"]}, "id": {"$nin": exclude},
                                           "$expr": {"$gte": [{"$subtract": ["$available_funds", "$committed"]}, w["amount"]]}},
                                          NOID).to_list(500)
    waited = (now() - parse_iso(w["created_at"])).total_seconds() / 60 if w.get("created_at") else 0
    if waited < OFFLINE_FALLBACK_MIN:
        accs = [a for a in accs if verifiers[a["verifier_id"]].get("online")]
    loads = {r["_id"]: r["n"] for r in await db.withdrawals.aggregate([
        {"$match": {"verifier_id": {"$in": list(verifiers)}, "status": {"$in": OPEN_WITHDRAW}}},
        {"$group": {"_id": "$verifier_id", "n": {"$sum": 1}}}]).to_list(500)}
    rng = random.SystemRandom()
    accs.sort(key=lambda a: (not verifiers[a["verifier_id"]].get("online"), loads.get(a["verifier_id"], 0), rng.random()))
    for a in accs:
        got = await db.payment_accounts.find_one_and_update(
            {"id": a["id"], "$expr": {"$gte": [{"$subtract": ["$available_funds", "$committed"]}, w["amount"]]}},
            {"$inc": {"committed": w["amount"]}}, return_document=ReturnDocument.AFTER)
        if not got:
            continue
        ok = await db.withdrawals.update_one({"id": w["id"], "account_id": None, "status": "pending"}, {"$set": {
            "account_id": a["id"], "verifier_id": a["verifier_id"], "assigned_at": iso()},
            "$push": {"history": {"at": iso(), "event": "assigned", "account_id": a["id"]}}})
        if ok.modified_count:
            return True
        await db.payment_accounts.update_one({"id": a["id"]}, {"$inc": {"committed": -w["amount"]}})
        return False
    if not w.get("unassigned_alerted"):
        await db.withdrawals.update_one({"id": w["id"]}, {"$set": {"unassigned_alerted": True}})
        await alert("withdrawal", f"No payment account has sufficient funds for withdrawal {w['id'][:8]}", w["id"])
    return False


async def release_withdrawal(w: dict, event: str):
    """Release the committed funds of an assigned withdrawal and unassign it."""
    if not w.get("account_id"):
        return
    res = await db.withdrawals.update_one({"id": w["id"], "account_id": w["account_id"]}, {
        "$set": {"account_id": None, "verifier_id": None, "status": "pending"},
        "$push": {"history": {"at": iso(), "event": event, "account_id": w["account_id"]}}})
    if res.modified_count:
        await db.payment_accounts.update_one({"id": w["account_id"]}, {"$inc": {"committed": -w["amount"]}})


async def accrue_commission(verifier_id: str, basis: str, source_id: str, amount: int):
    cfg = await get_config()
    if cfg["commission_basis"] not in (basis, "both"):
        return
    v = await db.verifiers.find_one({"id": verifier_id}, NOID)
    bps = v.get("commission_bps", cfg["commission_bps"])
    try:
        await db.commission_ledger.insert_one({
            "id": uid(), "verifier_id": verifier_id, "type": "accrual", "basis": basis, "source_id": source_id,
            "basis_amount": amount, "rate_bps": bps, "amount": amount * bps // 10000,
            "key": f"accrual:{basis}:{source_id}", "created_at": iso()})
    except DuplicateKeyError:
        pass


async def commission_summary(verifier_id: str) -> dict:
    rows = await db.commission_ledger.aggregate([{"$match": {"verifier_id": verifier_id}},
                                                 {"$group": {"_id": "$type", "s": {"$sum": "$amount"},
                                                             "b": {"$sum": "$basis_amount"}}}]).to_list(10)
    m = {r["_id"]: r for r in rows}
    g = lambda k, f="s": m.get(k, {}).get(f, 0)  # noqa: E731
    dep = await db.deposits.aggregate([{"$match": {"verifier_id": verifier_id, "status": "verified"}},
                                       {"$group": {"_id": None, "s": {"$sum": "$amount"}, "c": {"$sum": 1}}}]).to_list(1)
    wd = await db.withdrawals.aggregate([{"$match": {"verifier_id": verifier_id, "status": "completed"}},
                                         {"$group": {"_id": None, "s": {"$sum": "$amount"}, "c": {"$sum": 1}}}]).to_list(1)
    accrued, paid = g("accrual"), g("release")
    reversals, adjustments = g("reversal"), g("adjustment")
    outstanding = await db.withdrawals.aggregate([{"$match": {"verifier_id": verifier_id, "status": {"$in": OPEN_WITHDRAW}}},
                                                  {"$group": {"_id": None, "s": {"$sum": "$amount"}, "c": {"$sum": 1}}}]).to_list(1)
    return {
        "deposits_total": dep[0]["s"] if dep else 0, "deposits_count": dep[0]["c"] if dep else 0,
        "withdrawals_total": wd[0]["s"] if wd else 0, "withdrawals_count": wd[0]["c"] if wd else 0,
        "commission_basis": g("accrual", "b"), "accrued": accrued, "paid": paid, "reversals": reversals,
        "adjustments": adjustments, "pending": accrued + adjustments - reversals - paid,
        "outstanding_withdrawals": outstanding[0]["s"] if outstanding else 0,
        "outstanding_count": outstanding[0]["c"] if outstanding else 0,
    }


async def credit_deposit_notice(d: dict):
    await notify(d["user_id"], "Deposit verified", f"Your deposit of ₹{d['amount'] / 100:.2f} has been credited.")
