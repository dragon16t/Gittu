import asyncio
import secrets
from datetime import datetime, timedelta

from pymongo import ReturnDocument

from core import db, now, iso, uid, sha, get_config, ledger_credit, alert, log, NOID

ROUND_SECONDS = 30
REVEAL_SECONDS = 3
RESULT_HOLD_SECONDS = 2


def payout_for(amount: int, bps: int) -> int:
    return amount * bps // 100


async def liabilities() -> dict:
    agg = await db.wallets.aggregate([{"$group": {"_id": None, "bal": {"$sum": "$balance"},
                                                  "res": {"$sum": "$reserved"}}}]).to_list(1)
    bal = agg[0]["bal"] if agg else 0
    res = agg[0]["res"] if agg else 0
    return {"wallet_balances": bal, "reserved": res, "total": bal + res}


async def round_exposure(rnd: dict, bps: int) -> dict:
    t = rnd.get("totals", {})
    odd, even = t.get("odd_stake", 0), t.get("even_stake", 0)
    total = odd + even
    pay_odd, pay_even = payout_for(odd, bps), payout_for(even, bps)
    return {"odd_stake": odd, "even_stake": even, "odd_count": t.get("odd_count", 0),
            "even_count": t.get("even_count", 0), "potential_payout_odd": pay_odd,
            "potential_payout_even": pay_even, "net_if_odd": total - pay_odd, "net_if_even": total - pay_even,
            "max_exposure": max(pay_odd, pay_even) - total}


async def settle_round(round_id: str):
    rnd = await db.rounds.find_one({"id": round_id}, NOID)
    if not rnd or rnd["status"] not in ("revealing", "closed") or not rnd.get("result"):
        return
    result, bps = rnd["result"], rnd["multiplier_bps"]
    total_stake = total_payout = 0
    async for bet in db.bets.find({"round_id": round_id}, NOID):
        total_stake += bet["amount"]
        if bet["status"] == "won":
            total_payout += bet.get("payout", 0)
        if bet["status"] != "accepted":
            continue
        won = bet["side"] == result
        payout = payout_for(bet["amount"], bps) if won else 0
        txn = f"settle:{bet['id']}"
        upd = await db.bets.find_one_and_update(
            {"id": bet["id"], "status": "accepted"},
            {"$set": {"status": "won" if won else "lost", "payout": payout, "net": payout - bet["amount"],
                      "settled_at": iso(), "settlement_txn": txn}}, return_document=ReturnDocument.AFTER)
        if upd and won:
            await ledger_credit(bet["user_id"], payout, "bet_win", txn,
                                {"round_id": round_id, "bet_id": bet["id"], "stake": bet["amount"]})
        if upd:
            total_payout += payout
    await db.settlements.update_one({"round_id": round_id}, {"$setOnInsert": {
        "id": uid(), "round_id": round_id, "round_number": rnd["number"], "result": result,
        "total_stakes": total_stake, "total_payout": total_payout, "ggr": total_stake - total_payout,
        "settled_at": iso()}}, upsert=True)
    await db.rounds.update_one({"id": round_id, "status": {"$in": ["revealing", "closed"]}}, {"$set": {
        "status": "settled", "settled_at": iso(), "total_stakes": total_stake, "total_payout": total_payout,
        "ggr": total_stake - total_payout}})


def draw_result(mode: str = "random", totals: dict = None):
    t = totals or {}
    odd, even = t.get("odd_stake", 0), t.get("even_stake", 0)
    if mode == "minority" and odd != even:
        result = "ODD" if odd < even else "EVEN"
        dice = secrets.choice([1, 3, 5] if result == "ODD" else [2, 4, 6])
        return dice, result
    dice = secrets.randbelow(6) + 1
    return dice, ("ODD" if dice % 2 else "EVEN")


FAIR_AHEAD = 10


def fair_hash(number: int, dice: int, salt: str) -> str:
    return sha(f"{number}:{dice}:{salt}")


async def ensure_commitments(start: int):
    await db.fair_seeds.update_many({"number": {"$lt": start - 1}, "status": "pending"},
                                    {"$set": {"status": "void", "revealed_at": iso()}})
    for n in range(start, start + FAIR_AHEAD):
        dice, salt = secrets.randbelow(6) + 1, secrets.token_hex(16)
        await db.fair_seeds.update_one({"number": n}, {"$setOnInsert": {
            "number": n, "dice": dice, "salt": salt, "hash": fair_hash(n, dice, salt),
            "status": "pending", "committed_at": iso()}}, upsert=True)


async def record_result(rnd: dict):
    fresh = await db.rounds.find_one({"id": rnd["id"]}, NOID) or rnd
    mode, number = fresh.get("mode", "random"), fresh["number"]
    seed = await db.fair_seeds.find_one({"number": number, "status": "pending"}, NOID)
    if mode == "fair":
        if not seed:
            await ensure_commitments(number)
            seed = await db.fair_seeds.find_one({"number": number}, NOID)
        dice, salt = seed["dice"], seed["salt"]
        result, rhash = ("ODD" if dice % 2 else "EVEN"), seed["hash"]
    else:
        dice, result = draw_result(mode, fresh.get("totals"))
        salt = secrets.token_hex(16)
        rhash = sha(f"{rnd['id']}:{dice}:{salt}")
    res = await db.rounds.update_one({"id": rnd["id"], "status": "closed", "result": None}, {"$set": {
        "status": "revealing", "dice": dice, "result": result, "salt": salt,
        "result_hash": rhash, "result_recorded_at": iso(), "fair": mode == "fair",
        "reveal_ends_at": iso(now() + timedelta(seconds=REVEAL_SECONDS))}})
    if res.modified_count and seed:
        await db.fair_seeds.update_one({"number": number, "status": "pending"},
                                       {"$set": {"status": "used" if mode == "fair" else "void", "revealed_at": iso()}})


async def recover():
    """Finish any rounds interrupted by a restart."""
    async for r in db.rounds.find({"status": {"$in": ["betting", "closed", "revealing"]}}, NOID):
        if r["status"] == "betting":
            await db.rounds.update_one({"id": r["id"], "status": "betting"}, {"$set": {"status": "closed"}})
            r["status"] = "closed"
        if r["status"] == "closed" and not r.get("result"):
            await record_result(r)
        await settle_round(r["id"])


async def risk_gate(cfg: dict) -> bool:
    if cfg["mode"] != "risk":
        return True
    liab = await liabilities()
    pend = await db.withdrawals.aggregate([{"$match": {"status": {"$in": ["pending", "approved", "processing"]}}},
                                           {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
    pending_w = pend[0]["s"] if pend else 0
    if liab["wallet_balances"] + pending_w > cfg["company_reserve"]:
        await db.config.update_one({"id": "game"}, {"$set": {"paused": True}})
        await alert("risk", "Rounds paused: user liabilities and pending withdrawals exceed company reserve")
        return False
    if cfg.get("promotions_enabled") and cfg.get("promo_reserve", 0) <= 0:
        await db.config.update_one({"id": "game"}, {"$set": {"promotions_enabled": False}})
        await alert("risk", "Promotions disabled: promotional reserve is insufficient")
    return True


async def run_round():
    await recover()
    cfg = await get_config()
    if cfg["paused"] or not await risk_gate(cfg):
        await asyncio.sleep(2)
        return
    last = await db.rounds.find_one({}, sort=[("number", -1)])
    if cfg["mode"] == "fair":
        await ensure_commitments((last["number"] if last else 0) + 1)
    opens = now()
    closes = opens + timedelta(seconds=ROUND_SECONDS)
    rnd = {"id": uid(), "number": (last["number"] if last else 0) + 1, "status": "betting", "mode": cfg["mode"],
           "multiplier_bps": cfg["multiplier_bps"], "opens_at": iso(opens), "closes_at": iso(closes),
           "result": None, "dice": None,
           "totals": {"odd_stake": 0, "even_stake": 0, "odd_count": 0, "even_count": 0}}
    await db.rounds.insert_one(dict(rnd))
    await asyncio.sleep(max(0.0, (closes - now()).total_seconds()))
    await db.rounds.update_one({"id": rnd["id"], "status": "betting"}, {"$set": {"status": "closed", "closed_at": iso()}})
    await record_result(rnd)
    await asyncio.sleep(REVEAL_SECONDS)
    await settle_round(rnd["id"])
    await asyncio.sleep(RESULT_HOLD_SECONDS)
    await retry_unassigned_withdrawals()


async def retry_unassigned_withdrawals():
    from payments import assign_withdrawal
    async for w in db.withdrawals.find({"status": "pending", "account_id": None}, NOID):
        await assign_withdrawal(w)


async def engine_loop():
    while True:
        try:
            await run_round()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("game engine error")
            await asyncio.sleep(2)


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)
