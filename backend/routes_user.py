import re
import secrets

from fastapi import APIRouter, Request, Depends, HTTPException, Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from core import (db, now, iso, uid, current_user, get_config, ledger_debit, ledger_credit, audit, notify, verify_pw, enc, dec, mask,
                  get_file, check_rate, hit_rate)
from game import round_exposure, parse, ROUND_SECONDS, REVEAL_SECONDS
from payments import eligible_deposit_account, assign_withdrawal, OPEN_WITHDRAW
from promotions import consume_wagering, MIN_WITHDRAWAL

router = APIRouter()
P = {"_id": 0}


class BetIn(BaseModel):
    side: str
    amount: int
    client_key: str


class DepositIn(BaseModel):
    amount: int


class UtrIn(BaseModel):
    utr: str


class BankIn(BaseModel):
    holder_name: str
    account_number: str = ""
    ifsc: str = ""
    upi_id: str = ""
    password: str


class WithdrawIn(BaseModel):
    amount: int
    upi_id: str
    client_key: str


def public_round(r: dict) -> dict:
    if not r:
        return None
    out = {k: r.get(k) for k in ("id", "number", "status", "mode", "opens_at", "closes_at", "multiplier_bps",
                                 "reveal_ends_at", "settled_at")}
    if r["status"] in ("revealing", "settled"):
        out.update(result=r.get("result"), dice=r.get("dice"), result_hash=r.get("result_hash"))
    if r["status"] == "settled":
        out["salt"] = r.get("salt")
    return out


# ---------- game ----------
@router.get("/game/state")
async def game_state(user=Depends(current_user)):
    cfg = await get_config()
    cur = await db.rounds.find_one({"status": {"$in": ["betting", "closed", "revealing"]}}, P, sort=[("number", -1)])
    last = await db.rounds.find_one({"status": "settled"}, P, sort=[("number", -1)])
    recent = await db.rounds.find({"status": "settled"}, {"_id": 0, "result": 1, "number": 1}).sort("number", -1).to_list(10)
    my = []
    if cur:
        my = await db.bets.find({"round_id": cur["id"], "user_id": user["id"]}, P).to_list(50)
    last_bets = []
    if last:
        last_bets = await db.bets.find({"round_id": last["id"], "user_id": user["id"]}, P).to_list(50)
    w = await db.wallets.find_one({"user_id": user["id"]}, P)
    return {"server_time": iso(), "round": public_round(cur), "last_round": public_round(last),
            "recent": [r["result"] for r in recent], "my_bets": my, "last_round_bets": last_bets,
            "balance": w["balance"] if w else 0, "paused": cfg["paused"],
            "config": {"min_stake": cfg["min_stake"], "max_stake": cfg["max_stake"], "multiplier_bps": cfg["multiplier_bps"],
                       "mode": cfg["mode"], "round_seconds": ROUND_SECONDS, "reveal_seconds": REVEAL_SECONDS,
                       "practice_enabled": cfg["practice_enabled"]}}


@router.post("/game/bet")
async def place_bet(body: BetIn, request: Request, user=Depends(current_user)):
    side = body.side.upper()
    if side not in ("ODD", "EVEN"):
        raise HTTPException(400, "Select ODD or EVEN")
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", body.client_key):
        raise HTTPException(400, "Invalid request key")
    cfg = await get_config()
    if not (cfg["min_stake"] <= body.amount <= cfg["max_stake"]):
        raise HTTPException(400, f"Stake must be between ₹{cfg['min_stake'] / 100:.0f} and ₹{cfg['max_stake'] / 100:.0f}")
    dup = await db.bets.find_one({"user_id": user["id"], "client_key": body.client_key}, P)
    if dup:
        return {"bet": dup, "duplicate": True}
    rnd = await db.rounds.find_one({"status": "betting"}, P, sort=[("number", -1)])
    if not rnd or now() >= parse(rnd["closes_at"]):
        raise HTTPException(400, "Betting is closed for this round")
    if cfg["mode"] == "risk":
        rnd["totals"][f"{side.lower()}_stake"] += body.amount
        exp = await round_exposure(rnd, rnd["multiplier_bps"])
        if exp["max_exposure"] > cfg["max_round_exposure"]:
            raise HTTPException(400, "Round exposure limit reached. Try a smaller stake or the next round.")
    bet = {"id": uid(), "round_id": rnd["id"], "round_number": rnd["number"], "user_id": user["id"],
           "username": user["username"], "side": side, "amount": body.amount, "status": "accepted",
           "client_key": body.client_key, "created_at": iso()}
    w = await ledger_debit(user["id"], body.amount, "bet_stake", f"bet:{user['id']}:{body.client_key}",
                           {"round_id": rnd["id"], "bet_id": bet["id"], "side": side})
    if w is None:
        return {"bet": await db.bets.find_one({"user_id": user["id"], "client_key": body.client_key}, P), "duplicate": True}
    try:
        await db.bets.insert_one(dict(bet))
    except DuplicateKeyError:
        return {"bet": await db.bets.find_one({"user_id": user["id"], "client_key": body.client_key}, P), "duplicate": True}
    await db.rounds.update_one({"id": rnd["id"]}, {"$inc": {f"totals.{side.lower()}_stake": body.amount,
                                                           f"totals.{side.lower()}_count": 1}})
    await consume_wagering(user["id"], body.amount)
    return {"bet": bet, "balance": w["balance"]}


@router.get("/game/my-bets")
async def my_bets(user=Depends(current_user)):
    return await db.bets.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(200)


@router.get("/game/history")
async def round_history(user=Depends(current_user)):
    rows = await db.rounds.find({"status": "settled"}, {"_id": 0, "number": 1, "result": 1, "settled_at": 1, "id": 1,
                                                        "result_hash": 1, "salt": 1, "dice": 1}).sort("number", -1).to_list(100)
    return rows


# ---------- practice ----------
@router.post("/practice/generate")
async def practice_generate(user=Depends(current_user)):
    cfg = await get_config()
    if not cfg["practice_enabled"]:
        raise HTTPException(400, "Practice mode is currently disabled")
    await check_rate(f"practice:{user['id']}", 30, 60)
    await hit_rate(f"practice:{user['id']}")
    results = ["ODD" if (secrets.randbelow(6) + 1) % 2 else "EVEN" for _ in range(10)]
    doc = {"id": f"PRV-{secrets.token_hex(4).upper()}", "user_id": user["id"], "username": user["username"],
           "results": results, "status": "generated", "practice": True, "created_at": iso()}
    await db.practice_previews.insert_one(dict(doc))
    return doc


@router.get("/practice/history")
async def practice_history(user=Depends(current_user)):
    return await db.practice_previews.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(50)


# ---------- wallet ----------
async def sum_of(coll, match):
    r = await db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1)
    return r[0]["s"] if r else 0


@router.get("/wallet")
async def wallet(user=Depends(current_user)):
    w = await db.wallets.find_one({"user_id": user["id"]}, P)
    uidq = user["id"]
    return {"balance": w["balance"], "reserved": w["reserved"], "wager_remaining": w.get("wager_remaining", 0),
            "min_withdrawal": MIN_WITHDRAWAL,
            "pending_deposits": await sum_of("deposits", {"user_id": uidq, "status": "pending"}),
            "pending_withdrawals": await sum_of("withdrawals", {"user_id": uidq, "status": {"$in": OPEN_WITHDRAW}}),
            "total_deposits": await sum_of("deposits", {"user_id": uidq, "status": "verified"}),
            "total_withdrawals": await sum_of("withdrawals", {"user_id": uidq, "status": "completed"}),
            "total_winnings": await sum_of("ledger", {"user_id": uidq, "type": "bet_win"})}


@router.get("/wallet/ledger")
async def wallet_ledger(type: str = "", user=Depends(current_user)):
    q = {"user_id": user["id"]}
    if type:
        q["type"] = type
    return await db.ledger.find(q, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(300)


@router.get("/notifications")
async def notifications(user=Depends(current_user)):
    return await db.notifications.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(50)


# ---------- deposits ----------
def public_deposit(d: dict, acc: dict = None) -> dict:
    out = {k: d.get(k) for k in ("id", "amount", "status", "utr", "created_at", "submitted_at", "verified_at",
                                 "reject_reason", "account_id")}
    if acc:
        out.update(upi_id=acc["upi_id"], account_name=acc["name"], has_qr=bool(acc.get("qr_path")))
    return out


@router.post("/deposits/assign")
async def deposit_assign(body: DepositIn, user=Depends(current_user)):
    if body.amount < 10000 or body.amount > 10000000:
        raise HTTPException(400, "Deposit must be between ₹100 and ₹1,00,000")
    await check_rate(f"deposit:{user['id']}", 10, 60)
    pick = await eligible_deposit_account(body.amount)
    if not pick:
        raise HTTPException(503, "Deposits are temporarily unavailable. No payment verifier is online, please try again shortly.")
    await hit_rate(f"deposit:{user['id']}")
    v, acc = pick
    d = {"id": uid(), "user_id": user["id"], "username": user["username"], "amount": body.amount, "status": "initiated",
         "account_id": acc["id"], "verifier_id": v["id"], "utr": None, "created_at": iso()}
    await db.deposits.insert_one(dict(d))
    return public_deposit(d, acc)


@router.get("/deposits/{dep_id}/qr")
async def deposit_qr(dep_id: str, user=Depends(current_user)):
    d = await db.deposits.find_one({"id": dep_id, "user_id": user["id"]}, P)
    acc = await db.payment_accounts.find_one({"id": d["account_id"]}, P) if d else None
    if not acc or not acc.get("qr_path"):
        raise HTTPException(404, "QR not available")
    data, ct = await get_file(acc["qr_path"])
    return Response(content=data, media_type=ct)


@router.post("/deposits/{dep_id}/submit")
async def deposit_submit(dep_id: str, body: UtrIn, request: Request, user=Depends(current_user)):
    utr = body.utr.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{6,30}", utr):
        raise HTTPException(400, "Enter a valid UTR / reference number")
    if await db.deposits.find_one({"utr": utr, "status": {"$ne": "rejected"}}):
        raise HTTPException(400, "This UTR has already been submitted")
    try:
        res = await db.deposits.update_one({"id": dep_id, "user_id": user["id"], "status": "initiated"},
                                           {"$set": {"utr": utr, "status": "pending", "submitted_at": iso()}})
    except DuplicateKeyError:
        raise HTTPException(400, "This UTR has already been submitted")
    if not res.modified_count:
        raise HTTPException(400, "Deposit request cannot be submitted")
    await audit(user, "deposit.submitted", dep_id, {"utr": utr}, request)
    return {"ok": True, "status": "pending"}


@router.post("/deposits/{dep_id}/cancel")
async def deposit_cancel(dep_id: str, user=Depends(current_user)):
    await db.deposits.update_one({"id": dep_id, "user_id": user["id"], "status": "initiated"},
                                 {"$set": {"status": "cancelled", "cancelled_at": iso()}})
    return {"ok": True}


@router.get("/deposits")
async def my_deposits(user=Depends(current_user)):
    rows = await db.deposits.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(100)
    return [public_deposit(d) for d in rows]


# ---------- bank / withdrawals ----------
@router.get("/bank")
async def get_bank(user=Depends(current_user)):
    b = await db.bank_details.find_one({"user_id": user["id"]}, P)
    if not b:
        return None
    return {"holder_name": b["holder_name"], "account_number": mask(dec(b.get("account_number_enc", ""))),
            "ifsc": b.get("ifsc", ""), "upi_id": b.get("upi_id", ""), "updated_at": b.get("updated_at")}


@router.put("/bank")
async def put_bank(body: BankIn, request: Request, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_pw(body.password, full["password_hash"]):
        raise HTTPException(401, "Password confirmation failed")
    acct = re.sub(r"\s", "", body.account_number)
    upi = body.upi_id.strip()
    if not acct and not upi:
        raise HTTPException(400, "Add a bank account or a UPI ID")
    if acct and (not re.fullmatch(r"\d{9,18}", acct) or not re.fullmatch(r"[A-Za-z]{4}0[A-Za-z0-9]{6}", body.ifsc.strip())):
        raise HTTPException(400, "Enter a valid account number and IFSC")
    if upi and not re.fullmatch(r"[\w.\-]{2,256}@[a-zA-Z]{2,64}", upi):
        raise HTTPException(400, "Enter a valid UPI ID")
    if await db.withdrawals.find_one({"user_id": user["id"], "status": {"$in": OPEN_WITHDRAW}}):
        raise HTTPException(400, "Destination cannot change while a withdrawal is in progress")
    await db.bank_details.update_one({"user_id": user["id"]}, {"$set": {
        "user_id": user["id"], "holder_name": body.holder_name.strip(), "account_number_enc": enc(acct),
        "ifsc": body.ifsc.strip().upper(), "upi_id": upi, "updated_at": iso()}}, upsert=True)
    await notify(user["id"], "Withdrawal details updated", "Your bank/UPI withdrawal destination was changed.")
    await audit(user, "user.bank_updated", user["id"], request=request)
    return {"ok": True}


@router.post("/withdrawals")
async def create_withdrawal(body: WithdrawIn, request: Request, user=Depends(current_user)):
    if body.amount < MIN_WITHDRAWAL:
        raise HTTPException(400, f"Minimum withdrawal is ₹{MIN_WITHDRAWAL // 100}")
    upi = body.upi_id.strip()
    if not re.fullmatch(r"[\w.\-]{2,256}@[a-zA-Z]{2,64}", upi):
        raise HTTPException(400, "Enter a valid UPI ID")
    wal = await db.wallets.find_one({"user_id": user["id"]}, P)
    if wal.get("wager_remaining", 0) > 0:
        raise HTTPException(400, f"Complete your wagering requirement first: ₹{wal['wager_remaining'] / 100:.2f} more in bets")
    b = await db.bank_details.find_one({"user_id": user["id"]})
    if not b or b.get("upi_id") != upi:
        raise HTTPException(400, "Save this UPI ID in Bank / UPI details (password confirmed) before withdrawing")
    dup = await db.withdrawals.find_one({"user_id": user["id"], "client_key": body.client_key}, P)
    if dup:
        return dup
    wid = uid()
    w = await ledger_debit(user["id"], body.amount, "withdraw_reserve", f"wreserve:{wid}", {"withdrawal_id": wid},
                           to_reserved=True)
    doc = {"id": wid, "user_id": user["id"], "username": user["username"], "amount": body.amount, "status": "pending",
           "client_key": body.client_key, "account_id": None, "verifier_id": None, "reference": None,
           "destination": {"holder_name": b["holder_name"], "account_number_enc": b.get("account_number_enc", ""),
                           "ifsc": b.get("ifsc", ""), "upi_id": b.get("upi_id", "")},
           "history": [{"at": iso(), "event": "created"}], "created_at": iso()}
    try:
        await db.withdrawals.insert_one(dict(doc))
    except DuplicateKeyError:
        await ledger_credit(user["id"], body.amount, "withdraw_refund", f"wrefund:{wid}", {"withdrawal_id": wid}, from_reserved=True)
        return await db.withdrawals.find_one({"user_id": user["id"], "client_key": body.client_key}, {"_id": 0, "destination": 0})
    await assign_withdrawal(doc)
    await audit(user, "withdrawal.requested", wid, {"amount": body.amount}, request)
    return {"id": wid, "status": "pending", "amount": body.amount, "balance": w["balance"]}


@router.get("/withdrawals")
async def my_withdrawals(user=Depends(current_user)):
    rows = await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0, "destination.account_number_enc": 0, "client_key": 0,
                                                               "history": 0}).sort("created_at", -1).to_list(100)
    return rows
