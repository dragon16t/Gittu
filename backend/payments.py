import random
from datetime import timedelta

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import db, now, iso, uid, alert, notify, get_config, NOID

OPEN_DEPOSIT = ["initiated", "pending"]
OPEN_WITHDRAW = ["pending", "approved", "processing"]


async def eligible_deposit_account(amount: int):
    since = iso(now() - timedelta(minutes=30))
    verifiers = await db.verifiers.find({"status": "active", "online": True, "perm_deposit": True}, NOID).to_list(500)
    candidates = []
    for v in verifiers:
        load = await db.deposits.count_documents({"verifier_id": v["id"], "$or": [
            {"status": "pending"}, {"status": "initiated", "created_at": {"$gte": since}}]})
        if load >= v.get("deposit_capacity", 0):
            continue
        accs = await db.payment_accounts.find({"verifier_id": v["id"], "status": "active",
                                               "deposit_limit": {"$gte": amount}}, NOID).to_list(50)
        candidates += [(v, a) for a in accs]
    return random.SystemRandom().choice(candidates) if candidates else None


async def assign_withdrawal(w: dict, exclude: list = None) -> bool:
    """Atomically commit an eligible account with enough uncommitted funds to this withdrawal."""
    exclude = exclude or []
    verifiers = {v["id"]: v for v in await db.verifiers.find(
        {"status": "active", "perm_withdraw": True, "withdrawal_limit": {"$gte": w["amount"]}}, NOID).to_list(500)}
    accs = await db.payment_accounts.find({"status": "active", "verifier_id": {"$in": list(verifiers)},
                                           "withdrawal_limit": {"$gte": w["amount"]},
                                           "id": {"$nin": exclude}}, NOID).to_list(500)
    accs.sort(key=lambda a: (not verifiers[a["verifier_id"]].get("online"), random.random()))
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
