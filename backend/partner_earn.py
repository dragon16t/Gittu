import asyncio
from core import db, iso, log
from partners import post_entry, move, wallet

_LOCK = asyncio.Lock()
DEFAULT_PCT = 5
DEFAULT_REFERRAL = 5000


def mode_of(p: dict) -> str:
    return p.get("earn_mode") or "profit"


async def _partners_for(user_ids: list) -> dict:
    users = {u["id"]: u["partner_id"] async for u in db.users.find({"id": {"$in": user_ids}, "partner_id": {"$type": "string"}},
                                                                   {"_id": 0, "id": 1, "partner_id": 1})}
    if not users:
        return {}, {}
    parts = {p["id"]: p async for p in db.partners.find({"id": {"$in": list(set(users.values()))}, "status": "active"},
                                                       {"_id": 0, "id": 1, "earn_mode": 1, "profit_pct": 1})}
    return users, parts


async def round_commission(game: str, round_id: str, round_number: int, rows: list):
    """rows: [(user_id, stake, payout)] for one settled round. Profit-mode partners earn pct of platform net, losses carried forward."""
    try:
        users, parts = await _partners_for(list({r[0] for r in rows}))
        net = {}
        for user_id, stake, payout in rows:
            pid = users.get(user_id)
            if pid in parts and mode_of(parts[pid]) == "profit":
                net[pid] = net.get(pid, 0) + stake - payout
        async with _LOCK:
            for pid, n in net.items():
                key = f"profit:{game}:{round_id}:{pid}"
                if await db.partner_ledger.find_one({"key": key}, {"_id": 1}) or await db.partner_rounds.find_one({"key": key}, {"_id": 1}):
                    continue
                pct = parts[pid].get("profit_pct", DEFAULT_PCT)
                w = await wallet(pid)
                bal = w.get("profit_carry", 0) + n
                pay = bal * pct // 100 if bal > 0 else 0
                carry = bal - (pay * 100 // pct if pct else 0) if bal > 0 else bal
                await db.partner_rounds.insert_one({"key": key, "partner_id": pid, "game": game, "round_id": round_id,
                                                    "round_number": round_number, "net": n, "carry_in": w.get("profit_carry", 0),
                                                    "commission": pay, "carry_out": carry, "pct": pct, "created_at": iso()})
                await db.partner_wallets.update_one({"partner_id": pid}, {"$set": {"profit_carry": carry}})
                if pay > 0 and await post_entry(pid, "commission", pay, key, round_id,
                                                f"{pct}% of platform net · {game} #{round_number}"):
                    await move(pid, {}, {"available": pay, "total_earned": pay})
    except Exception:
        log.exception("partner commission failed for %s %s", game, round_id)


async def first_deposit_reward(user_id: str):
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "partner_id": 1, "username": 1})
        if not u or not u.get("partner_id"):
            return
        p = await db.partners.find_one({"id": u["partner_id"], "status": "active"}, {"_id": 0, "id": 1, "earn_mode": 1, "referral_amount": 1})
        if not p or mode_of(p) != "referral":
            return
        amt = p.get("referral_amount", DEFAULT_REFERRAL)
        if amt > 0 and await post_entry(p["id"], "referral_reward", amt, f"refreward:{user_id}", user_id,
                                        f"First deposit by {u['username'][:2]}***"):
            await move(p["id"], {}, {"available": amt, "total_earned": amt})
    except Exception:
        log.exception("partner referral reward failed for %s", user_id)
