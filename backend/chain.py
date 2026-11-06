import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import db, iso, uid, current_user, current_admin, audit, notify, log, ledger_credit, dec

router = APIRouter()
P = {"_id": 0}
IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT = {"enabled": True, "pct": 10.0, "min_withdraw": 100000, "min_members": 2,
           "milestones": [[10, 10000], [50, 50000], [100, 100000]]}


def mask_name(n: str) -> str:
    n = n or "user"
    return n[:2] + "***" + n[-1] if len(n) > 3 else n[0] + "***"


async def pool_tree(root_id: str):
    """Children map + set of members who ever deposited, for one pool."""
    users = await db.users.find({"chain_root": root_id, "role": "user"},
                                {"_id": 0, "id": 1, "username": 1, "referred_by": 1, "created_at": 1}).to_list(200000)
    ids = [u["id"] for u in users]
    dep = set(await db.deposits.distinct("user_id", {"status": "verified", "user_id": {"$in": ids}}))
    kids = {}
    for u in users:
        if u.get("referred_by"):
            kids.setdefault(u["referred_by"], []).append(u)
    return {u["id"]: u for u in users}, kids, dep


def downline_stats(uid_: str, kids: dict, dep: set) -> dict:
    total = deposited = depth = 0
    stack = [(c, 1) for c in kids.get(uid_, [])]
    while stack:
        u, d = stack.pop()
        total += 1
        deposited += u["id"] in dep
        depth = max(depth, d)
        stack.extend((c, d + 1) for c in kids.get(u["id"], []))
    return {"total": total, "deposited": deposited, "levels": depth}


async def award_milestones(user_id: str, deposited: int, cfg: dict):
    for need, amt in cfg["milestones"]:
        if deposited >= need and await chain_credit(user_id, amt, "milestone", f"milestone:{need}:{user_id}", {"members": need}):
            await notify(user_id, "Milestone unlocked!", f"{need} depositing members in your chain — ₹{amt / 100:,.0f} added to chain earnings.")


async def milestones_for_user_pool(user_id: str):
    try:
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "chain_root": 1})
        if not u or not u.get("chain_root"):
            return
        cfg = await ccfg()
        by_id, kids, dep = await pool_tree(u["chain_root"])
        cur, seen = by_id.get(user_id, {}).get("referred_by"), set()
        while cur and cur in by_id and cur not in seen:
            seen.add(cur)
            await award_milestones(cur, downline_stats(cur, kids, dep)["deposited"], cfg)
            cur = by_id[cur].get("referred_by")
    except Exception as e:
        log.error(f"milestones: {e}")


async def ccfg() -> dict:
    c = await db.config.find_one({"id": "chain"}, P) or {}
    return {**DEFAULT, **{k: v for k, v in c.items() if k in DEFAULT}}


def ist_day_bounds(day: str):
    start = datetime.fromisoformat(day).replace(tzinfo=IST)
    return start.astimezone(timezone.utc).isoformat(), (start + timedelta(days=1)).astimezone(timezone.utc).isoformat()


def today_ist() -> str:
    return datetime.now(IST).date().isoformat()


async def root_of(user_id: str) -> str:
    seen, cur = set(), user_id
    while cur and cur not in seen:
        seen.add(cur)
        u = await db.users.find_one({"id": cur}, {"_id": 0, "referred_by": 1, "chain_root": 1})
        if not u:
            break
        if u.get("chain_root"):
            return u["chain_root"]
        if not u.get("referred_by"):
            return cur
        cur = u["referred_by"]
    return cur


async def assign_chain_root(user: dict):
    root = await root_of(user["referred_by"]) if user.get("referred_by") else user["id"]
    await db.users.update_one({"id": user["id"]}, {"$set": {"chain_root": root}})


async def backfill_roots():
    async for u in db.users.find({"role": "user", "chain_root": {"$exists": False}}, {"_id": 0, "id": 1, "referred_by": 1}):
        await assign_chain_root(u)


async def ensure_chain():
    await db.users.create_index("chain_root")
    await db.chain_wallets.create_index("user_id", unique=True)
    await db.chain_ledger.create_index("key", unique=True)
    await db.chain_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.chain_payouts.create_index([("day", 1), ("root_id", 1)], unique=True)
    await backfill_roots()


async def chain_credit(user_id: str, amount: int, typ: str, key: str, meta: dict = None) -> bool:
    try:
        await db.chain_ledger.insert_one({"id": uid(), "user_id": user_id, "type": typ, "amount": amount, "key": key,
                                          "meta": meta or {}, "created_at": iso()})
    except DuplicateKeyError:
        return False
    inc = {"balance": amount}
    if amount > 0 and typ in ("pool_share", "milestone"):
        inc["total_earned"] = amount
    await db.chain_wallets.update_one({"user_id": user_id}, {"$inc": inc, "$setOnInsert": {"created_at": iso()}}, upsert=True)
    return True


async def chain_debit(user_id: str, amount: int, typ: str, key: str, meta: dict = None):
    if await db.chain_ledger.find_one({"key": key}, {"_id": 1}):
        raise HTTPException(400, "Already processed")
    w = await db.chain_wallets.find_one_and_update({"user_id": user_id, "balance": {"$gte": amount}}, {"$inc": {"balance": -amount}},
                                                   return_document=ReturnDocument.AFTER)
    if not w:
        raise HTTPException(400, "Insufficient chain earnings")
    try:
        await db.chain_ledger.insert_one({"id": uid(), "user_id": user_id, "type": typ, "amount": -amount, "key": key,
                                          "meta": meta or {}, "created_at": iso()})
    except DuplicateKeyError:
        await db.chain_wallets.update_one({"user_id": user_id}, {"$inc": {"balance": amount}})
        raise HTTPException(400, "Already processed")
    return w


async def pool_deposits(day: str) -> dict:
    lo, hi = ist_day_bounds(day)
    rows = await db.deposits.aggregate([
        {"$match": {"status": "verified", "verified_at": {"$gte": lo, "$lt": hi}}},
        {"$lookup": {"from": "users", "localField": "user_id", "foreignField": "id", "as": "u"}},
        {"$unwind": "$u"}, {"$group": {"_id": "$u.chain_root", "total": {"$sum": "$amount"}}},
    ]).to_list(100000)
    return {r["_id"]: r["total"] for r in rows if r["_id"]}


async def eligible_members(root_id: str, until: str) -> list:
    depositors = set(await db.deposits.distinct("user_id", {"status": "verified", "verified_at": {"$lt": until}}))
    ids = await db.users.distinct("id", {"chain_root": root_id, "role": "user", "status": "active"})
    return sorted(i for i in ids if i in depositors)


async def distribute(day: str, by: str = "system") -> dict:
    cfg = await ccfg()
    _, hi = ist_day_bounds(day)
    pools, paid, n_pools = await pool_deposits(day), 0, 0
    for root_id, total in pools.items():
        if await db.chain_payouts.find_one({"day": day, "root_id": root_id}, {"_id": 1}):
            continue
        members = await db.users.count_documents({"chain_root": root_id, "role": "user"})
        elig = await eligible_members(root_id, hi)
        pot = int(total * cfg["pct"] / 100)
        share = pot // len(elig) if elig and members >= cfg["min_members"] else 0
        doc = {"id": uid(), "day": day, "root_id": root_id, "pool_deposits": total, "members": members, "eligible": len(elig),
               "pct": cfg["pct"], "pot": pot, "share": share, "paid": share * len(elig) if share else 0, "by": by, "created_at": iso()}
        try:
            await db.chain_payouts.insert_one(dict(doc))
        except DuplicateKeyError:
            continue
        if share:
            for u in elig:
                await chain_credit(u, share, "pool_share", f"pool:{day}:{u}", {"day": day, "root_id": root_id, "payout_id": doc["id"]})
            await asyncio.gather(*[notify(u, "Chain pool payout", f"You earned ₹{share / 100:,.2f} from your chain pool for {day}.") for u in elig[:2000]])
            paid += doc["paid"]
            n_pools += 1
    log.info(f"chain distribute {day}: pools={n_pools} paid={paid}")
    return {"day": day, "pools_paid": n_pools, "paid": paid}


async def chain_loop():
    while True:
        try:
            cfg = await ccfg()
            yday = (datetime.now(IST).date() - timedelta(days=1)).isoformat()
            st = await db.config.find_one({"id": "chain_state"}, P)
            if not st:
                await db.config.update_one({"id": "chain_state"}, {"$set": {"last_day": yday, "started_at": iso()}}, upsert=True)
                st = {"last_day": yday}
            if cfg["enabled"] and st.get("last_day", "") < yday:
                await distribute(yday)
                await db.config.update_one({"id": "chain_state"}, {"$set": {"last_day": yday, "ran_at": iso()}}, upsert=True)
        except Exception as e:
            log.error(f"chain loop: {e}")
        await asyncio.sleep(60)


async def pool_view(user: dict, cfg: dict) -> dict:
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "chain_root": 1})
    root = full.get("chain_root") or user["id"]
    members = await db.users.count_documents({"chain_root": root, "role": "user"})
    today = today_ist()
    _, hi = ist_day_bounds(today)
    elig = await eligible_members(root, hi)
    today_dep = (await pool_deposits(today)).get(root, 0)
    pot = int(today_dep * cfg["pct"] / 100)
    joined_today = await db.users.count_documents({"chain_root": root, "role": "user", "created_at": {"$gte": ist_day_bounds(today)[0]}})
    return {"members": members, "eligible": len(elig), "today_deposits": today_dep, "today_pot": pot,
            "my_estimate": pot // len(elig) if user["id"] in elig and members >= cfg["min_members"] else 0,
            "i_am_eligible": user["id"] in elig, "joined_today": joined_today,
            "direct": await db.users.count_documents({"referred_by": user["id"]})}


# ---------- user ----------
def week_start_utc() -> str:
    d = datetime.now(IST).date()
    return ist_day_bounds((d - timedelta(days=d.weekday())).isoformat())[0]


@router.get("/chain/tree")
async def chain_tree(of: str = "", user=Depends(current_user)):
    cfg = await ccfg()
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "chain_root": 1})
    by_id, kids, dep = await pool_tree(me.get("chain_root") or user["id"])
    node = of or user["id"]
    cur, ok = node, node == user["id"]
    while not ok and cur in by_id and by_id[cur].get("referred_by"):
        cur = by_id[cur]["referred_by"]
        ok = cur == user["id"]
    if not ok:
        raise HTTPException(404, "Not in your chain")
    mine = downline_stats(user["id"], kids, dep)
    await award_milestones(user["id"], mine["deposited"], cfg)
    got = set(await db.chain_ledger.distinct("meta.members", {"user_id": user["id"], "type": "milestone"}))
    children = sorted(kids.get(node, []), key=lambda c: c.get("created_at", ""), reverse=True)
    return {"me": mine, "node": node, "node_name": by_id.get(node, {}).get("username") if node != user["id"] else None,
            "children": [{"id": c["id"], "name": c["username"] if node == user["id"] else mask_name(c["username"]),
                          "joined": c.get("created_at"), "deposited": c["id"] in dep, **{f"down_{k}": v for k, v in downline_stats(c["id"], kids, dep).items()}}
                         for c in children[:200]],
            "milestones": [{"members": n, "bonus": a, "reached": mine["deposited"] >= n, "paid": n in got} for n, a in cfg["milestones"]]}


@router.get("/chain/leaderboard")
async def chain_leaderboard(user=Depends(current_user)):
    since = week_start_utc()
    inv = await db.users.aggregate([
        {"$match": {"role": "user", "referred_by": {"$ne": None}, "created_at": {"$gte": since}}},
        {"$group": {"_id": "$referred_by", "joined": {"$sum": 1}, "ids": {"$push": "$id"}}},
    ]).to_list(100000)
    deps = set(await db.deposits.distinct("user_id", {"status": "verified", "user_id": {"$in": [i for r in inv for i in r["ids"]]}}))
    rows = sorted([{"id": r["_id"], "joined": r["joined"], "deposited": sum(1 for i in r["ids"] if i in deps)} for r in inv],
                  key=lambda r: (-r["deposited"], -r["joined"]))
    names = {u["id"]: u["username"] for u in await db.users.find({"id": {"$in": [r["id"] for r in rows[:20]] + [user["id"]]}}, {"_id": 0, "id": 1, "username": 1}).to_list(30)}
    my_rank = next((i + 1 for i, r in enumerate(rows) if r["id"] == user["id"]), None)
    lo = since
    pool_dep = await db.deposits.aggregate([
        {"$match": {"status": "verified", "verified_at": {"$gte": lo}}},
        {"$lookup": {"from": "users", "localField": "user_id", "foreignField": "id", "as": "u"}}, {"$unwind": "$u"},
        {"$group": {"_id": "$u.chain_root", "deposits": {"$sum": "$amount"}}}, {"$sort": {"deposits": -1}}, {"$limit": 10},
    ]).to_list(10)
    paid = {p["_id"]: p["paid"] for p in await db.chain_payouts.aggregate([
        {"$match": {"created_at": {"$gte": lo}}}, {"$group": {"_id": "$root_id", "paid": {"$sum": "$paid"}}}]).to_list(100000)}
    roots = {u["id"]: u["username"] for u in await db.users.find({"id": {"$in": [p["_id"] for p in pool_dep]}}, {"_id": 0, "id": 1, "username": 1}).to_list(10)}
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "chain_root": 1})
    pools = []
    for p in pool_dep:
        members = await db.users.count_documents({"chain_root": p["_id"], "role": "user"})
        if members >= 2:
            pools.append({"name": mask_name(roots.get(p["_id"])), "members": members, "week_deposits": p["deposits"],
                          "week_paid": paid.get(p["_id"], 0), "mine": p["_id"] == me.get("chain_root")})
    return {"week_start": since, "inviters": [{"rank": i + 1, "name": mask_name(names.get(r["id"])), "joined": r["joined"], "deposited": r["deposited"],
                                               "me": r["id"] == user["id"]} for i, r in enumerate(rows[:20])],
            "my_rank": my_rank, "pools": pools}


@router.get("/chain")
async def my_chain(user=Depends(current_user)):
    cfg = await ccfg()
    w = await db.chain_wallets.find_one({"user_id": user["id"]}, P) or {}
    led = await db.chain_ledger.find({"user_id": user["id"]}, {"_id": 0, "key": 0}).sort("created_at", -1).to_list(50)
    nxt = datetime.combine(datetime.now(IST).date() + timedelta(days=1), datetime.min.time(), IST)
    return {"balance": w.get("balance", 0), "total_earned": w.get("total_earned", 0), "pct": cfg["pct"], "enabled": cfg["enabled"],
            "min_withdraw": cfg["min_withdraw"], "next_payout_at": nxt.astimezone(timezone.utc).isoformat(),
            "pool": await pool_view(user, cfg), "ledger": led}


class AmountIn(BaseModel):
    amount: int
    client_key: str


@router.post("/chain/transfer")
async def chain_transfer(body: AmountIn, request: Request, user=Depends(current_user)):
    if body.amount < 100:
        raise HTTPException(400, "Minimum transfer is ₹1")
    key = f"chain_xfer:{user['id']}:{body.client_key}"
    await chain_debit(user["id"], body.amount, "to_game_wallet", key)
    await ledger_credit(user["id"], body.amount, "chain_transfer", key)
    await audit(user, "chain.transfer", user["id"], {"amount": body.amount}, request)
    return {"ok": True}


class ChainWithdrawIn(BaseModel):
    amount: int
    account_id: str
    client_key: str


@router.post("/chain/withdraw")
async def chain_withdraw(body: ChainWithdrawIn, request: Request, user=Depends(current_user)):
    from payments import assign_withdrawal
    cfg = await ccfg()
    if body.amount < cfg["min_withdraw"]:
        raise HTTPException(400, f"Minimum chain earnings withdrawal is ₹{cfg['min_withdraw'] / 100:,.0f}")
    if not await db.kyc.find_one({"user_id": user["id"], "status": "verified"}, {"_id": 1}):
        raise HTTPException(400, "Complete Aadhaar KYC verification before withdrawing")
    b = await db.payout_accounts.find_one({"id": body.account_id, "user_id": user["id"], "status": "approved"})
    if not b:
        raise HTTPException(400, "Choose a verified withdrawal account")
    if await db.withdrawals.find_one({"client_key": body.client_key, "user_id": user["id"]}, {"_id": 1}):
        raise HTTPException(400, "Duplicate request")
    wid = uid()
    await chain_debit(user["id"], body.amount, "withdraw_reserve", f"chain_wd:{wid}", {"withdrawal_id": wid})
    await ensure_reserved(user["id"], body.amount, wid)
    doc = {"id": wid, "user_id": user["id"], "username": user["username"], "amount": body.amount, "status": "pending", "source": "chain",
           "client_key": body.client_key, "account_id": None, "verifier_id": None, "reference": None,
           "destination": {"holder_name": b["holder_name"], "account_number_enc": b.get("account_number_enc", ""), "ifsc": b.get("ifsc", ""),
                           "upi_id": b.get("upi_id", ""), "kind": b["kind"], "account_id": b["id"],
                           "label": b.get("upi_id") or f"A/c XXXX{dec(b.get('account_number_enc', ''))[-4:]}"},
           "history": [{"at": iso(), "event": "created"}], "created_at": iso()}
    await db.withdrawals.insert_one(dict(doc))
    await assign_withdrawal(doc)
    await audit(user, "chain.withdraw", wid, {"amount": body.amount}, request)
    return {"ok": True, "id": wid}


async def ensure_reserved(user_id: str, amount: int, wid: str):
    # chain funds move into the game wallet's reserved bucket so the normal payout pipeline settles them
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {"reserved": amount}})
    await db.ledger.insert_one({"id": uid(), "user_id": user_id, "type": "chain_withdraw_reserve", "amount": 0, "key": f"chain_res:{wid}",
                                "meta": {"withdrawal_id": wid, "reserved": amount}, "created_at": iso()})


async def refund_chain_withdrawal(w: dict) -> bool:
    res = await db.wallets.update_one({"user_id": w["user_id"], "reserved": {"$gte": w["amount"]}}, {"$inc": {"reserved": -w["amount"]}})
    if not res.modified_count:
        return False
    return await chain_credit(w["user_id"], w["amount"], "withdraw_refund", f"chain_refund:{w['id']}", {"withdrawal_id": w["id"]})


# ---------- admin ----------
@router.get("/admin/chain")
async def admin_chain(admin=Depends(current_admin)):
    cfg = await ccfg()
    pools = await db.users.aggregate([{"$match": {"role": "user"}}, {"$group": {"_id": "$chain_root", "members": {"$sum": 1}}},
                                      {"$match": {"members": {"$gte": 2}}}, {"$sort": {"members": -1}}, {"$limit": 50}]).to_list(50)
    roots = {u["id"]: u["username"] for u in await db.users.find({"id": {"$in": [p["_id"] for p in pools]}}, {"_id": 0, "id": 1, "username": 1}).to_list(50)}
    today = await pool_deposits(today_ist())
    lifetime = await db.chain_payouts.aggregate([{"$group": {"_id": "$root_id", "paid": {"$sum": "$paid"}}}]).to_list(100000)
    life = {x["_id"]: x["paid"] for x in lifetime}
    wallets = await db.chain_wallets.aggregate([{"$group": {"_id": None, "bal": {"$sum": "$balance"}, "earned": {"$sum": "$total_earned"}}}]).to_list(1)
    payouts = await db.chain_payouts.find({}, P).sort([("day", -1), ("paid", -1)]).to_list(100)
    for p in payouts:
        p["root"] = roots.get(p["root_id"]) or (await db.users.find_one({"id": p["root_id"]}, {"_id": 0, "username": 1}) or {}).get("username")
    st = await db.config.find_one({"id": "chain_state"}, P) or {}
    return {"config": cfg, "state": st, "totals": {"outstanding": (wallets[0]["bal"] if wallets else 0), "earned": (wallets[0]["earned"] if wallets else 0),
                                                   "pools": len(pools), "today_deposits": sum(today.values())},
            "pools": [{"root_id": p["_id"], "root": roots.get(p["_id"]), "members": p["members"], "today_deposits": today.get(p["_id"], 0),
                       "today_pot": int(today.get(p["_id"], 0) * cfg["pct"] / 100), "lifetime_paid": life.get(p["_id"], 0)} for p in pools],
            "payouts": payouts}


class ChainCfgIn(BaseModel):
    enabled: bool
    pct: float
    min_withdraw: int
    min_members: int
    milestones: list


@router.put("/admin/chain/config")
async def admin_chain_cfg(body: ChainCfgIn, request: Request, admin=Depends(current_admin)):
    if not (0 <= body.pct <= 50 and body.min_withdraw >= 10000 and body.min_members >= 2):
        raise HTTPException(400, "Share 0–50%, min withdrawal ≥ ₹100, pool needs ≥ 2 members")
    try:
        ms = sorted({int(m[0]): int(m[1]) for m in body.milestones}.items())
    except (TypeError, ValueError, IndexError):
        raise HTTPException(400, "Milestones need members and bonus")
    if not 1 <= len(ms) <= 10 or any(n < 1 or a < 0 or a > 10000000 for n, a in ms):
        raise HTTPException(400, "1–10 milestones, members ≥ 1, bonus ₹0–₹1,00,000")
    body.milestones = [list(m) for m in ms]
    await db.config.update_one({"id": "chain"}, {"$set": body.model_dump()}, upsert=True)
    await audit(admin, "chain.config", "chain", body.model_dump(), request)
    return await ccfg()


@router.post("/admin/chain/run/{day}")
async def admin_chain_run(day: str, request: Request, admin=Depends(current_admin)):
    try:
        d = datetime.fromisoformat(day).date()
    except ValueError:
        raise HTTPException(400, "Use YYYY-MM-DD")
    if d >= datetime.now(IST).date():
        raise HTTPException(400, "Only completed days (before today, India time) can be distributed")
    res = await distribute(d.isoformat(), by=admin["username"])
    await audit(admin, "chain.run", day, res, request)
    return res
