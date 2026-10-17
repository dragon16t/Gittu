import asyncio
import secrets
from datetime import timedelta, timezone, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core import current_admin, audit, invalidate_config, db, now, iso, uid, current_user, ledger_credit, notify, get_config, log

router = APIRouter()
P = {"_id": 0}
IST = timezone(timedelta(hours=5, minutes=30))
DAILY_AMOUNT, DAILY_WAGER = 1000, 3
REFERRAL_WAGER, REFERRAL_MIN_DEPOSIT = 5, 50000
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


async def issue_coupon(user_id: str, kind: str, amount: int, mult: int, title: str, key: str, ref: str = "", hours=24, auto=False):
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
    if auto:
        await redeem(c, "auto_credited")
        await notify(user_id, "Bonus credited", f"{title}: ₹{amount / 100:.0f} has been added to your wallet ({mult}× wagering).")
    else:
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
        invalidate_config()
    return True


async def credit_pending_referral_coupons():
    async for c in db.coupons.find({"kind": {"$in": ["referral", "welcome"]}, "status": "available"}, P):
        if await redeem(c, "auto_credited"):
            await notify(c["user_id"], "Bonus credited", f"{c['title']}: ₹{c['amount'] / 100:.0f} has been added to your wallet.")


async def on_deposit_verified(dep: dict):
    await add_wagering(dep["user_id"], dep["amount"] * DEPOSIT_WAGER)
    u = await db.users.find_one({"id": dep["user_id"]}, P)
    if not u or not u.get("referred_by") or u.get("referral_checked") or u.get("referral_rewarded"):
        return
    earlier = await db.deposits.count_documents({"user_id": u["id"], "status": "verified", "id": {"$ne": dep["id"]}})
    lock = await db.users.update_one({"id": u["id"], "referral_checked": {"$exists": False}},
                                     {"$set": {"referral_checked": True, "referral_first_deposit": dep["amount"]}})
    if not lock.modified_count or earlier or dep["amount"] < REFERRAL_MIN_DEPOSIT:
        return
    cfg = await get_config()
    c = await issue_coupon(u["referred_by"], "referral", cfg["referral_bonus"], REFERRAL_WAGER,
                           f"Referral bonus for inviting {u['username']}", f"referral:{u['id']}", u["id"], hours=72, auto=True)
    if not c:
        return
    await issue_coupon(u["id"], "welcome", cfg["friend_bonus"], REFERRAL_WAGER, "Welcome bonus · referral first deposit",
                       f"welcome:{u['id']}", u["referred_by"], hours=72, auto=True)
    await db.users.update_one({"id": u["id"]}, {"$set": {"referral_rewarded": True}})


async def daily_for(user_id: str):
    today = datetime.now(IST).strftime("%Y-%m-%d")
    cfg = await get_config()
    if cfg.get("daily_bonus", DAILY_AMOUNT) > 0:
        await issue_coupon(user_id, "daily", cfg.get("daily_bonus", DAILY_AMOUNT), DAILY_WAGER, f"Daily bonus {today}", f"daily:{user_id}:{today}")


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
    agg = await db.coupons.aggregate([{"$match": {"user_id": user["id"], "kind": "referral"}},
                                      {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
    cfg = await get_config()
    return {"code": code, "referrals": rows, "rewards_earned": agg[0]["s"] if agg else 0,
            "rules": {"bonus": cfg["referral_bonus"], "friend_bonus": cfg["friend_bonus"],
                      "min_deposit": REFERRAL_MIN_DEPOSIT, "wager": REFERRAL_WAGER, "deposit_wager": DEPOSIT_WAGER,
                      "daily_bonus": cfg.get("daily_bonus", DAILY_AMOUNT), "daily_wager": DAILY_WAGER}}


@router.get("/promo/rules")
async def promo_rules():
    cfg = await get_config()
    return {"bonus": cfg["referral_bonus"], "friend_bonus": cfg["friend_bonus"], "min_deposit": REFERRAL_MIN_DEPOSIT,
            "wager": REFERRAL_WAGER, "deposit_wager": DEPOSIT_WAGER, "daily_bonus": cfg.get("daily_bonus", DAILY_AMOUNT), "daily_wager": DAILY_WAGER}


# ---------- admin bonus management ----------
class BonusCfgIn(BaseModel):
    daily_bonus: int = Field(ge=0, le=1000000)
    referral_bonus: int = Field(ge=0, le=1000000)
    friend_bonus: int = Field(ge=0, le=1000000)


@router.get("/admin/bonus")
async def bonus_cfg(admin=Depends(current_admin)):
    cfg = await get_config()
    hist = await db.coupons.find({"kind": "admin_bonus"}, P).sort("created_at", -1).to_list(100)
    return {"daily_bonus": cfg.get("daily_bonus", DAILY_AMOUNT), "referral_bonus": cfg["referral_bonus"],
            "friend_bonus": cfg["friend_bonus"], "promo_reserve": cfg.get("promo_reserve", 0),
            "promotions_enabled": cfg["promotions_enabled"], "history": hist}


@router.put("/admin/bonus")
async def bonus_cfg_set(body: BonusCfgIn, request: Request, admin=Depends(current_admin)):
    await db.config.update_one({"id": "game"}, {"$set": body.model_dump()}, upsert=True)
    invalidate_config()
    await audit(admin, "bonus.config", "game", body.model_dump(), request)
    return {"ok": True}


class SendBonusIn(BaseModel):
    username: str = ""
    random_count: int = Field(0, ge=0, le=500)
    amount: int = Field(gt=0, le=1000000)
    wager: int = Field(1, ge=0, le=20)
    title: str = Field("Surprise bonus", min_length=2, max_length=60)
    credit_now: bool = True


@router.post("/admin/bonus/send")
async def bonus_send(body: SendBonusIn, request: Request, admin=Depends(current_admin)):
    if body.username.strip():
        u = await db.users.find_one({"username": body.username.strip().lower(), "role": "user", "status": "active"}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(404, "User not found")
        targets = [u["id"]]
    elif body.random_count:
        targets = [u["id"] for u in await db.users.aggregate([{"$match": {"role": "user", "status": "active"}},
                                                              {"$sample": {"size": body.random_count}}, {"$project": {"_id": 0, "id": 1}}]).to_list(500)]
    else:
        raise HTTPException(400, "Enter a username or a number of random users")
    batch, sent = uid()[:8], 0
    for t in targets:
        c = await issue_coupon(t, "admin_bonus", body.amount, body.wager, body.title, f"admin_bonus:{batch}:{t}", admin["id"], hours=72, auto=body.credit_now)
        sent += 1 if c else 0
    await audit(admin, "bonus.send", batch, {"targets": len(targets), "sent": sent, "amount": body.amount}, request)
    if not sent:
        raise HTTPException(400, "No bonus sent. Check that promotions are enabled and the promo reserve is enough")
    return {"sent": sent, "targets": len(targets)}
