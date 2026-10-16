import asyncio
import secrets
from datetime import timedelta, timezone, datetime

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from core import db, now, iso, uid, current_user, ledger_credit, notify, get_config, log

router = APIRouter()
P = {"_id": 0}
IST = timezone(timedelta(hours=5, minutes=30))
DAILY_AMOUNT, DAILY_WAGER = 1000, 3
REFERRAL_AMOUNT, REFERRAL_WAGER, REFERRAL_MIN_DEPOSIT = 30000, 5, 50000
DEPOSIT_WAGER = 1
MIN_WITHDRAWAL = 30000


def new_referral_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(7))


async def assign_referral_code(user_id: str) -> str:
    for _ in range(5):
        code = new_referral_code()
        try:
            await db.users.update_one({"id": user_id, "referral_code": {"$exists": False}}, {"$set": {"referral_code": code}})
            return code
        except DuplicateKeyError:
            continue
    raise HTTPException(500, "Could not generate referral code")


async def add_wagering(user_id: str, amount: int):
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {"wager_remaining": amount, "wager_required": amount}})


async def consume_wagering(user_id: str, stake: int):
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {"wager_remaining": -stake}})
    await db.wallets.update_one({"user_id": user_id, "wager_remaining": {"$lte": 0}}, {"$set": {"wager_remaining": 0, "wager_required": 0}})


async def issue_coupon(user_id: str, kind: str, amount: int, mult: int, title: str, key: str, ref: str = "", hours=24):
    cfg = await get_config()
    if not cfg["promotions_enabled"] or cfg.get("promo_reserve", 0) < amount:
        return None
    c = {"id": uid(), "user_id": user_id, "kind": kind, "amount": amount, "wager_multiplier": mult, "title": title,
         "status": "available", "key": key, "ref": ref, "created_at": iso(),
         "expires_at": iso(now() + timedelta(hours=hours))}
    try:
        await db.coupons.insert_one(dict(c))
    except DuplicateKeyError:
        return None
    await notify(user_id, "New coupon", f"{title}: ₹{amount / 100:.0f} is waiting. Tap Claim in Messages.")
    return c


async def redeem(coupon: dict, status: str) -> bool:
    res = await db.coupons.update_one({"id": coupon["id"], "status": "available"},
                                      {"$set": {"status": status, "claimed_at": iso()}})
    if not res.modified_count:
        return False
    if await ledger_credit(coupon["user_id"], coupon["amount"], "promotion", f"coupon:{coupon['id']}",
                           {"coupon_id": coupon["id"], "kind": coupon["kind"], "wager_multiplier": coupon["wager_multiplier"]}):
        await add_wagering(coupon["user_id"], coupon["amount"] * coupon["wager_multiplier"])
        await db.config.update_one({"id": "game"}, {"$inc": {"promo_reserve": -coupon["amount"]}})
    return True


async def on_deposit_verified(dep: dict):
    await add_wagering(dep["user_id"], dep["amount"] * DEPOSIT_WAGER)
    if dep["amount"] < REFERRAL_MIN_DEPOSIT:
        return
    u = await db.users.find_one({"id": dep["user_id"]}, P)
    if not u or not u.get("referred_by"):
        return
    c = await issue_coupon(u["referred_by"], "referral", REFERRAL_AMOUNT, REFERRAL_WAGER,
                           f"Referral bonus for inviting {u['username']}", f"referral:{u['id']}", u["id"], hours=72)
    if c:
        await db.users.update_one({"id": u["id"]}, {"$set": {"referral_rewarded": True}})


async def daily_for(user_id: str):
    today = datetime.now(IST).strftime("%Y-%m-%d")
    await issue_coupon(user_id, "daily", DAILY_AMOUNT, DAILY_WAGER, f"Daily bonus {today}", f"daily:{user_id}:{today}")


async def daily_bonus_run():
    async for u in db.users.find({"role": "user", "status": "active"}, {"_id": 0, "id": 1}):
        await daily_for(u["id"])
    async for c in db.coupons.find({"status": "available", "expires_at": {"$lt": iso()}}, P):
        await redeem(c, "auto_credited")


async def bonus_loop():
    while True:
        try:
            await daily_bonus_run()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("bonus loop error")
        await asyncio.sleep(300)


@router.get("/coupons")
async def coupons(user=Depends(current_user)):
    return await db.coupons.find({"user_id": user["id"]}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(100)


@router.post("/coupons/{cid}/claim")
async def claim(cid: str, user=Depends(current_user)):
    c = await db.coupons.find_one({"id": cid, "user_id": user["id"]}, P)
    if not c or not await redeem(c, "auto_credited" if c["expires_at"] < iso() else "claimed"):
        raise HTTPException(400, "Coupon already claimed or unavailable")
    w = await db.wallets.find_one({"user_id": user["id"]}, P)
    return {"ok": True, "balance": w["balance"], "wager_remaining": w.get("wager_remaining", 0)}


@router.get("/referrals")
async def referrals(user=Depends(current_user)):
    u = await db.users.find_one({"id": user["id"]}, P)
    code = u.get("referral_code") or await assign_referral_code(user["id"])
    rows = await db.users.find({"referred_by": user["id"]}, {"_id": 0, "username": 1, "created_at": 1,
                                                             "referral_rewarded": 1}).to_list(500)
    earned = await db.coupons.count_documents({"user_id": user["id"], "kind": "referral", "status": {"$ne": "available"}})
    return {"code": code, "referrals": rows, "rewards_earned": earned * REFERRAL_AMOUNT,
            "rules": {"bonus": REFERRAL_AMOUNT, "min_deposit": REFERRAL_MIN_DEPOSIT, "wager": REFERRAL_WAGER}}
