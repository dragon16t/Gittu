import asyncio
import hashlib
import hmac
import math
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import db, now, iso, uid, ledger_debit, ledger_credit, current_user, current_admin, audit, log, NOID
from game import _LEAD, parse
from promotions import consume_wagering
from routes_auth import reauth

router = APIRouter()
P = NOID
K_NORMAL = 0.1
CRASH_HOLD = 3
LOGICS = ("low", "medium", "high", "rare")

DEFAULT = {
    "id": "pulse", "enabled": True, "betting_seconds": 7, "min_bet": 1000, "max_bet": 1000000, "max_multiplier": 3000.0,
    "active_logic": "rng", "logic": "low",
    "logics": {
        "low": {"bands": [[1.0, 1.0, 5], [1.01, 1.3, 20], [1.3, 1.7, 20], [1.7, 2.5, 25], [2.5, 5.0, 18], [5.0, 20.0, 9], [20.0, 100.0, 3]]},
        "medium": {"bands": [[1.0, 1.0, 4], [1.01, 1.5, 18], [1.5, 2.0, 20], [2.0, 3.0, 22], [3.0, 6.0, 20], [6.0, 25.0, 12], [25.0, 200.0, 4]]},
        "high": {"bands": [[1.0, 1.0, 4], [1.01, 1.5, 14], [1.5, 2.5, 20], [2.5, 5.0, 24], [5.0, 10.0, 20], [10.0, 50.0, 14], [50.0, 500.0, 4]]},
        "rare": {"bands": [[1.0, 1.0, 3], [1.01, 1.5, 12], [1.5, 3.0, 20], [3.0, 10.0, 25], [10.0, 50.0, 22], [50.0, 500.0, 13], [500.0, 3000.0, 5]]},
    },
    "pct_enabled": True, "wallet_pct": 30, "cap_enabled": True, "fixed_cap": 1000000, "carry_forward": True,
    "empty_bands": [[1.0, 1.0, 5], [1.01, 1.5, 18], [1.5, 2.0, 20], [2.0, 3.0, 22], [3.0, 6.0, 18], [6.0, 20.0, 12], [20.0, 100.0, 5]],
}


async def pcfg() -> dict:
    c = await db.pulse_config.find_one({"id": "pulse"}, P)
    if not c:
        await db.pulse_config.update_one({"id": "pulse"}, {"$setOnInsert": DEFAULT}, upsert=True)
        c = dict(DEFAULT)
    c.pop("_id", None)
    stored = c.get("logics", {})
    return {**DEFAULT, **c, "logics": {n: {**DEFAULT["logics"][n], **{k: v for k, v in stored.get(n, {}).items() if k == "bands"}}
                                       for n in LOGICS}}


async def arena_wallet() -> dict:
    w = await db.pulse_wallet.find_one_and_update({"id": "arena"}, {"$setOnInsert": {"id": "arena", "balance": 0, "created_at": iso()}},
                                                  upsert=True, return_document=ReturnDocument.AFTER, projection=P)
    return {"id": "arena", "balance": w["balance"], "created_at": w.get("created_at")}


# ---------- RNG (commit: sha256(seed) published before the round) ----------
def _u(seed: str, label: str) -> float:
    return int(hmac.new(seed.encode(), label.encode(), hashlib.sha256).hexdigest()[:13], 16) / 16 ** 13


def _logu(u: float, lo: float, hi: float) -> float:
    return math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo))) if hi > lo else lo


def floor2(m: float) -> float:
    return math.floor(m * 100 + 1e-9) / 100


def pick_band(bands: list, tier: float, v: float, cap: float) -> float:
    """Weighted band pick (shares total 100%), then a log-uniform value inside the band."""
    acc = 0.0
    lo, hi = bands[-1][0], bands[-1][1]
    for b_lo, b_hi, pct in bands:
        acc += pct
        if tier < acc:
            lo, hi = b_lo, b_hi
            break
    return floor2(max(1.0, min(_logu(v, min(lo, cap), min(hi, cap)), cap)))


def endpoints(seed: str, cfg: dict) -> dict:
    cap = cfg["max_multiplier"]
    bands = cfg["logics"][cfg["logic"]]["bands"]
    return {"main": pick_band(bands, _u(seed, "tier") * 100, _u(seed, "value"), cap),
            "sim": pick_band(cfg["empty_bands"], _u(seed, "sim_tier") * 100, _u(seed, "sim"), cap)}


def mult_at(r: dict, t) -> float:
    m = r["anchor_m"] * math.exp(r["k"] * max(0.0, (t - parse(r["anchor_at"])).total_seconds()))
    return floor2(min(m, r["endpoint"]))


def time_to(r_anchor_m: float, k: float, target: float) -> float:
    return math.log(max(target, r_anchor_m) / r_anchor_m) / k


def effective_end(r: dict, m_now: float = 1.0):
    """Round ends at the RNG endpoint, or earlier where paid + live stakes x multiplier would exceed the budget."""
    rng = r.get("rng_endpoint", r.get("endpoint"))
    live = r["stakes"] - r.get("collected_stakes", 0)
    if r.get("simulated"):
        return rng, False
    if live <= 0:
        return (max(m_now, r["planned"]["sim"]), False) if r.get("mode") == "cap" else (max(m_now, rng), False)
    m_cap = max(1.0, floor2((r["budget"] - r["paid"]) / live))
    return (m_cap, True) if m_cap < rng else (rng, False)


def end_fields(r: dict, m_now: float = 1.0) -> dict:
    end, limited = effective_end(r, m_now)
    at = parse(r["anchor_at"]) + timedelta(seconds=time_to(r["anchor_m"], r["k"], end))
    return {"endpoint": end, "cap_limited": limited, "crash_at": iso(at)}


async def refresh_end(round_id: str):
    for _ in range(8):
        fresh = await db.pulse_rounds.find_one({"id": round_id, "status": "running"}, P)
        if not fresh:
            return
        res = await db.pulse_rounds.update_one({"id": round_id, "status": "running", "paid": fresh["paid"],
                                                "collected_stakes": fresh.get("collected_stakes", 0)},
                                               {"$set": end_fields(fresh, mult_at(fresh, now()))})
        if res.matched_count:
            return


# ---------- engine ----------
async def new_round(cfg: dict, last: dict):
    seed = secrets.token_hex(32)
    t = now()
    doc = {"id": uid(), "number": (last["number"] + 1) if last else 1, "status": "betting",
           "opens_at": iso(t), "closes_at": iso(t + timedelta(seconds=cfg["betting_seconds"])),
           "seed": seed, "seed_hash": hashlib.sha256(seed.encode()).hexdigest(), "planned": endpoints(seed, cfg),
           "logic": cfg["logic"], "logic_params": cfg["logics"][cfg["logic"]],
           "stakes": 0, "bets_count": 0, "collected": 0, "paid": 0, "created_at": iso(t)}
    try:
        await db.pulse_rounds.insert_one(dict(doc))
    except DuplicateKeyError:
        pass


async def start_round(r: dict, cfg: dict):
    res = await db.pulse_rounds.find_one_and_update({"id": r["id"], "status": "betting"}, {"$set": {"status": "starting"}},
                                                    return_document=ReturnDocument.AFTER, projection=P)
    if not res:
        return
    w = await arena_wallet()
    simulated = res["bets_count"] == 0
    mode = "cap" if cfg["active_logic"] == "cap" else "rng"
    eligible = w["balance"] + res["stakes"]
    limits = [eligible]
    alloc = carry = None
    if mode == "cap" and cfg["pct_enabled"]:
        alloc = w["balance"] * cfg["wallet_pct"] // 100
        if cfg["carry_forward"]:
            prev = await db.pulse_rounds.find_one({"status": "crashed", "simulated": False}, P, sort=[("number", -1)])
            carry = max(0, min((prev or {}).get("unused", 0), (prev or {}).get("allocation") or 0))
        limits.append(alloc + (carry or 0))
    if mode == "cap" and cfg["cap_enabled"]:
        limits.append(cfg["fixed_cap"])
    budget = max(0, min(limits))
    endpoint = res["planned"]["sim"] if simulated else res["planned"]["main"] if mode == "rng" else float(cfg["max_multiplier"])
    t = now()
    closes = parse(res["closes_at"])
    if (t - closes).total_seconds() < 0.5:
        t = closes
    doc = {"status": "running", "simulated": simulated, "mode": mode, "planned": res["planned"], "anchor_m": 1.0, "anchor_at": iso(t), "k": K_NORMAL, "rng_endpoint": endpoint,
           "budget": budget, "stakes": res["stakes"], "paid": 0, "collected_stakes": 0}
    doc.update(end_fields(doc))
    await db.pulse_rounds.update_one({"id": r["id"], "status": "starting"}, {"$set": {
        **doc, "started_at": iso(t),
        "opening_balance": w["balance"], "eligible": eligible, "allocation": alloc, "carry_in": carry,
        "fixed_cap": cfg["fixed_cap"] if mode == "cap" and cfg["cap_enabled"] else None}})


async def crash(r: dict):
    t = now()
    res = await db.pulse_rounds.find_one_and_update({"id": r["id"], "status": "running", "crash_at": r["crash_at"], "endpoint": r["endpoint"]}, {"$set": {
        "status": "crashed", "result": r["endpoint"], "crashed_at": iso(t)}}, return_document=ReturnDocument.AFTER, projection=P)
    if not res:
        return
    if res.get("cap_limited"):
        await db.pulse_rounds.update_one({"id": r["id"]}, {"$set": {"cap_hit": True}})
        await db.pulse_cap_events.insert_one({"id": uid(), "round_id": r["id"], "round_number": res["number"], "multiplier": res["endpoint"],
                                              "rng_endpoint": res["rng_endpoint"], "live_stakes": res["stakes"] - res.get("collected_stakes", 0),
                                              "budget": res["budget"], "paid": res["paid"], "at": iso(t)})
    await db.pulse_bets.update_many({"round_id": r["id"], "status": "active"},
                                    {"$set": {"status": "lost", "payout": 0, "settled_at": iso(t)}})
    net = res["stakes"] - res["paid"]
    unused = max(0, res["budget"] - res["paid"]) if not res["simulated"] else 0
    try:
        await db.pulse_ledger.insert_one({"id": uid(), "key": f"round:{r['id']}", "type": "round", "round_number": res["number"],
                                          "round_id": r["id"], "stakes": res["stakes"], "payouts": res["paid"], "amount": net,
                                          "created_at": iso(t)})
    except DuplicateKeyError:
        return
    w = await db.pulse_wallet.find_one_and_update({"id": "arena"}, {"$inc": {"balance": net}}, return_document=ReturnDocument.AFTER)
    await db.pulse_rounds.update_one({"id": r["id"]}, {"$set": {"closing_balance": w["balance"], "unused": unused, "settled_at": iso()}})
    if res["number"] % 3 == 0:
        await reconcile(res["number"], w["balance"])
    if not res["simulated"]:
        from partner_earn import round_commission
        rows = [(b["user_id"], b["stake"], b.get("payout", 0)) async for b in db.pulse_bets.find(
            {"round_id": r["id"]}, {"_id": 0, "user_id": 1, "stake": 1, "payout": 1})]
        asyncio.create_task(round_commission("pulse", r["id"], res["number"], rows))


async def reconcile(number: int, balance: int):
    rounds = await db.pulse_rounds.find({"number": {"$gt": number - 3, "$lte": number}}, P).to_list(3)
    total = (await db.pulse_ledger.aggregate([{"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1) or [{"s": 0}])[0]["s"]
    await db.pulse_cycles.update_one({"cycle": number // 3}, {"$setOnInsert": {
        "id": uid(), "cycle": number // 3, "rounds": [x["number"] for x in rounds],
        "opening_balance": min(rounds, key=lambda x: x["number"]).get("opening_balance", 0) if rounds else 0,
        "closing_balance": balance, "stakes": sum(x.get("stakes", 0) for x in rounds),
        "payouts": sum(x.get("paid", 0) for x in rounds), "carry_forward": rounds[-1].get("unused", 0) if rounds else 0,
        "ledger_total": total, "reconciled": total == balance, "created_at": iso()}}, upsert=True)
    if total != balance:
        log.warning("pulse wallet mismatch: ledger %s vs wallet %s", total, balance)


async def step():
    cfg = await pcfg()
    r = await db.pulse_rounds.find_one({}, P, sort=[("number", -1)])
    t = now()
    if not r or (r["status"] == "crashed" and t >= parse(r["crashed_at"]) + timedelta(seconds=CRASH_HOLD)):
        if cfg["enabled"]:
            await new_round(cfg, r)
    elif r["status"] == "betting" and t >= parse(r["closes_at"]):
        await start_round(r, cfg)
    elif r["status"] == "starting" and t >= parse(r["closes_at"]) + timedelta(seconds=5):
        await db.pulse_rounds.update_one({"id": r["id"], "status": "starting"}, {"$set": {"status": "betting"}})
    elif r["status"] == "running":
        if t >= parse(r["crash_at"]):
            await crash(r)


async def pulse_loop():
    while True:
        try:
            if _LEAD["on"]:
                await step()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("pulse engine error")
            await asyncio.sleep(1)
        await asyncio.sleep(0.1)


# ---------- player API ----------
def mask_name(u: str) -> str:
    return (u[:2] + "***" + u[-1]) if len(u) > 3 else u[:1] + "***"


def public_pulse(r: dict) -> dict:
    if not r:
        return None
    out = {k: r.get(k) for k in ("id", "number", "status", "opens_at", "closes_at", "seed_hash",
                                 "anchor_m", "anchor_at", "k", "started_at", "crashed_at")}
    if r["status"] == "crashed":
        out.update(result=r["result"], seed=r["seed"])
    return out


_CACHE = {"at": None, "body": None}


async def shared_pulse():
    t = now()
    if _CACHE["at"] and (t - _CACHE["at"]).total_seconds() < 0.1:
        return _CACHE["body"]
    cur = await db.pulse_rounds.find_one({}, P, sort=[("number", -1)])
    recent = await db.pulse_rounds.find({"status": "crashed"}, {"_id": 0, "number": 1, "result": 1}).sort("number", -1).to_list(20)
    wins = await db.pulse_bets.find({"status": "collected"}, {"_id": 0, "username": 1, "payout": 1, "multiplier": 1, "collected_at": 1}).sort("collected_at", -1).to_list(12)
    cfg = await pcfg()
    from presence import page_counts
    body = {"round": public_pulse(cur), "recent": recent, "players": (await page_counts())["pulse"],
            "winners": [{"name": mask_name(w["username"]), "payout": w["payout"], "multiplier": w["multiplier"]} for w in wins],
            "config": {"min_bet": cfg["min_bet"], "max_bet": cfg["max_bet"], "betting_seconds": cfg["betting_seconds"], "enabled": cfg["enabled"],
                       "k": K_NORMAL, "max_multiplier": cfg["max_multiplier"]}}
    _CACHE.update(at=t, body=body)
    return body


async def optional_user(request: Request):
    try:
        return await current_user(request)
    except HTTPException:
        return None


@router.get("/pulse/state")
async def pulse_state(request: Request):
    sh = await shared_pulse()
    out = {"server_time": iso(), **sh, "my_bets": [], "balance": None}
    user = await optional_user(request)
    if user:
        rid = (sh["round"] or {}).get("id")
        out["my_bets"] = await db.pulse_bets.find({"user_id": user["id"], "round_id": rid}, P).to_list(2) if rid else []
        out["balance"] = (await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0, "balance": 1}) or {}).get("balance", 0)
    return out


class PulseBetIn(BaseModel):
    slot: int
    amount: int
    client_key: str


class CollectIn(BaseModel):
    round_id: str
    slot: int
    m: float | None = None


@router.post("/pulse/bet")
async def pulse_bet(body: PulseBetIn, user=Depends(current_user)):
    if body.slot not in (1, 2):
        raise HTTPException(400, "Invalid bet slot")
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", body.client_key):
        raise HTTPException(400, "Invalid request key")
    cfg = await pcfg()
    if not cfg["enabled"]:
        raise HTTPException(400, "PULSE Arena is paused")
    if not (cfg["min_bet"] <= body.amount <= cfg["max_bet"]):
        raise HTTPException(400, f"Stake must be between ₹{cfg['min_bet'] / 100:.0f} and ₹{cfg['max_bet'] / 100:.0f}")
    r = await db.pulse_rounds.find_one({"status": "betting"}, P, sort=[("number", -1)])
    if not r or now() >= parse(r["closes_at"]):
        raise HTTPException(400, "Betting is closed for this round")
    if await db.pulse_bets.find_one({"round_id": r["id"], "user_id": user["id"], "slot": body.slot}, {"_id": 1}):
        raise HTTPException(400, f"Bet {body.slot} already placed this round")
    bet = {"id": uid(), "round_id": r["id"], "round_number": r["number"], "user_id": user["id"], "username": user["username"],
           "slot": body.slot, "stake": body.amount, "status": "active", "client_key": body.client_key, "created_at": iso()}
    key = f"pulse_bet:{r['id']}:{user['id']}:{body.slot}"
    w = await ledger_debit(user["id"], body.amount, "pulse_stake", key, {"round_id": r["id"], "bet_id": bet["id"], "slot": body.slot})
    if w is None:
        raise HTTPException(400, f"Bet {body.slot} already placed this round")
    try:
        await db.pulse_bets.insert_one(dict(bet))
    except DuplicateKeyError:
        await ledger_credit(user["id"], body.amount, "pulse_refund", f"refund:{key}", {"bet_id": bet["id"]})
        raise HTTPException(400, f"Bet {body.slot} already placed this round")
    upd = await db.pulse_rounds.update_one({"id": r["id"], "status": "betting"}, {"$inc": {"stakes": body.amount, "bets_count": 1}})
    if not upd.modified_count:
        await db.pulse_bets.delete_one({"id": bet["id"]})
        await ledger_credit(user["id"], body.amount, "pulse_refund", f"refund:{key}", {"bet_id": bet["id"]})
        raise HTTPException(400, "Betting is closed for this round")
    await consume_wagering(user["id"], body.amount)
    bet.pop("_id", None)
    return {"bet": bet, "balance": w["balance"]}


@router.post("/pulse/collect")
async def pulse_collect(body: CollectIn, user=Depends(current_user)):
    t = now()
    bet = await db.pulse_bets.find_one({"round_id": body.round_id, "user_id": user["id"], "slot": body.slot}, P)
    if not bet or bet["status"] != "active":
        raise HTTPException(400, "No active bet to collect")
    r = await db.pulse_rounds.find_one({"id": body.round_id}, P)
    for _ in range(10):
        if not r or r["status"] not in ("betting", "starting") or t < parse(r["closes_at"]):
            break
        await asyncio.sleep(0.05)
        r = await db.pulse_rounds.find_one({"id": body.round_id}, P)
        t = now()
    if not r or r["status"] != "running" or t >= parse(r["crash_at"]):
        raise HTTPException(400, "Round ended")
    m = mult_at(r, t)
    if body.m is not None and 1.0 <= body.m < m:
        m = floor2(body.m)
    gross = bet["stake"] * round(m * 100) // 100
    await db.pulse_collects.insert_one({"id": uid(), "round_id": r["id"], "bet_id": bet["id"], "user_id": user["id"],
                                        "multiplier": m, "gross": gross, "at": iso(t)})
    ok = await db.pulse_rounds.update_one({"id": r["id"], "status": "running", "crash_at": {"$gt": iso(t)},
                                           "paid": {"$lte": r["budget"] - gross}}, {"$inc": {"paid": gross, "collected": 1, "collected_stakes": bet["stake"]}})
    if not ok.modified_count:
        await db.pulse_rounds.update_one({"id": r["id"], "status": "running", "crash_at": {"$gt": iso(t)}}, {"$set": {
            "crash_at": iso(t), "endpoint": m, "cap_limited": True}})
        raise HTTPException(400, "Round ended")
    upd = await db.pulse_bets.find_one_and_update({"id": bet["id"], "status": "active"}, {"$set": {
        "status": "collected", "multiplier": m, "payout": gross, "collected_at": iso(t)}}, return_document=ReturnDocument.AFTER, projection=P)
    if not upd:
        await db.pulse_rounds.update_one({"id": r["id"]}, {"$inc": {"paid": -gross, "collected": -1, "collected_stakes": -bet["stake"]}})
        raise HTTPException(400, "Round ended")
    await refresh_end(r["id"])
    await ledger_credit(user["id"], gross, "pulse_win", f"pulse_win:{bet['id']}", {"round_id": r["id"], "bet_id": bet["id"], "multiplier": m})
    w = await db.wallets.find_one({"user_id": user["id"]}, {"_id": 0, "balance": 1})
    upd.pop("_id", None)
    return {"bet": {k: upd.get(k) for k in ("id", "slot", "stake", "status", "multiplier", "payout", "round_id")}, "balance": w["balance"]}


@router.get("/pulse/history")
async def pulse_history():
    return await db.pulse_rounds.find({"status": "crashed"}, {"_id": 0, "number": 1, "result": 1, "seed": 1,
                                                              "seed_hash": 1, "crashed_at": 1}).sort("number", -1).to_list(100)


@router.get("/pulse/my-bets")
async def pulse_my_bets(user=Depends(current_user)):
    return await db.pulse_bets.find({"user_id": user["id"]}, {"_id": 0, "client_key": 0}).sort("created_at", -1).to_list(100)


# ---------- admin: Game Arena ----------
@router.get("/admin/pulse")
async def admin_pulse(admin=Depends(current_admin)):
    cfg = await pcfg()
    w = await arena_wallet()
    cur = await db.pulse_rounds.find_one({}, P, sort=[("number", -1)])
    live = None
    if cur:
        active = await db.pulse_bets.count_documents({"round_id": cur["id"], "status": "active"})
        players = len(await db.pulse_bets.distinct("user_id", {"round_id": cur["id"]}))
        reqs = await db.pulse_collects.count_documents({"round_id": cur["id"]})
        budget = cur.get("budget")
        live = {**public_pulse(cur), "stakes": cur["stakes"], "bets_count": cur["bets_count"], "players": players,
                "active_bets": active, "collected": cur["collected"], "collect_requests": reqs, "budget": budget,
                "paid": cur["paid"], "remaining": (budget - cur["paid"]) if budget is not None else None,
                "allocation": cur.get("allocation"), "carry_in": cur.get("carry_in"), "fixed_cap": cur.get("fixed_cap"),
                "eligible": cur.get("eligible"), "cap_hit": cur.get("cap_hit", False), "na_applied": cur.get("na_applied", False),
                "live_stakes": cur["stakes"] - cur.get("collected_stakes", 0), "cap_limited": cur.get("cap_limited", False),
                "cap_point": cur.get("endpoint") if cur.get("cap_limited") and cur["status"] == "running" else None,
                "logic": cur.get("logic"), "mode": cur.get("mode")}
    rounds = await db.pulse_rounds.find({"status": "crashed"}, {"_id": 0, "number": 1, "result": 1, "simulated": 1, "stakes": 1, "paid": 1,
                                                                "budget": 1, "cap_hit": 1, "mode": 1, "logic": 1, "bets_count": 1,
                                                                "opening_balance": 1, "closing_balance": 1, "crashed_at": 1, "seed": 1,
                                                                "seed_hash": 1}).sort("number", -1).to_list(30)
    last100 = await db.pulse_rounds.find({"status": "crashed", "simulated": False}, {"_id": 0, "result": 1}).sort("number", -1).to_list(100)
    below2 = sum(1 for x in last100 if x["result"] < 2)
    return {"config": cfg, "wallet": w, "live": live, "rounds": rounds,
            "distribution": {"rounds": len(last100), "below_2x": below2},
            "cycles": await db.pulse_cycles.find({}, P).sort("cycle", -1).to_list(10),
            "cap_events": await db.pulse_cap_events.find({}, P).sort("at", -1).to_list(20),
            "topups": await db.pulse_ledger.find({"type": "topup"}, P).sort("created_at", -1).to_list(20),
            "audit": await db.audit_logs.find({"action": {"$regex": "^pulse\\."}}, P).sort("created_at", -1).to_list(30)}


SECTIONS = {
    "general": {"enabled": bool, "betting_seconds": int, "min_bet": int, "max_bet": int, "max_multiplier": float},
    "mode": {"active_logic": str},
    "logic": {"logic": str, "logics": dict},
    "payout": {"pct_enabled": bool, "wallet_pct": int, "cap_enabled": bool, "fixed_cap": int, "carry_forward": bool},
    "phases": {"empty_bands": list},
}


def clean_bands(raw, label: str) -> list:
    if not isinstance(raw, list) or not 1 <= len(raw) <= 15:
        raise HTTPException(400, f"{label}: add between 1 and 15 ranges")
    out = []
    for b in raw:
        try:
            lo, hi, pct = (float(b["from"]), float(b["to"]), float(b["pct"])) if isinstance(b, dict) else map(float, b)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, f"{label}: every range needs from ×, to × and %")
        if not (1.0 <= lo <= hi <= 3000 and 0 <= pct <= 100):
            raise HTTPException(400, f"{label}: ranges must be 1× ≤ from ≤ to ≤ 3000× and % between 0 and 100")
        out.append([round(lo, 2), round(hi, 2), round(pct, 2)])
    total = sum(b[2] for b in out)
    if abs(total - 100) > 0.01:
        raise HTTPException(400, f"{label}: range percentages must add up to exactly 100% (now {total:g}%)")
    return sorted(out, key=lambda b: (b[0], b[1]))


def validate(section: str, upd: dict, cfg: dict):
    c = {**cfg, **upd}
    if section == "general":
        if not 3 <= c["betting_seconds"] <= 30:
            raise HTTPException(400, "Betting countdown must be 3–30 seconds")
        if not 100 <= c["min_bet"] <= c["max_bet"]:
            raise HTTPException(400, "Minimum bet must be ≥ ₹1 and ≤ maximum bet")
        if not 2 <= c["max_multiplier"] <= 3000:
            raise HTTPException(400, "Maximum multiplier must be 2×–3000×")
    elif section == "mode":
        if c["active_logic"] not in ("rng", "cap"):
            raise HTTPException(400, "Choose Logic 1 (rng) or Logic 2 (cap)")
    elif section == "logic":
        if c["logic"] not in LOGICS:
            raise HTTPException(400, "Choose one of: low, medium, high, rare")
        upd["logics"] = {name: {"bands": clean_bands((c["logics"].get(name) or {}).get("bands"), f"Logic '{name}'")}
                         for name in LOGICS}
    elif section == "payout":
        if c["wallet_pct"] not in (10, 20, 30, 50):
            raise HTTPException(400, "Arena wallet allocation must be 10%, 20%, 30% or 50%")
        if c["fixed_cap"] < 0:
            raise HTTPException(400, "Fixed payout cap cannot be negative")
    elif section == "phases":
        upd["empty_bands"] = clean_bands(c["empty_bands"], "Empty rounds")


@router.put("/admin/pulse/config/{section}")
async def admin_pulse_config(section: str, body: dict, request: Request, admin=Depends(current_admin)):
    spec = SECTIONS.get(section)
    if not spec:
        raise HTTPException(404, "Unknown section")
    upd = {}
    for k, typ in spec.items():
        if k in body:
            try:
                upd[k] = body[k] if typ in (dict, bool, list) else typ(body[k])
            except (TypeError, ValueError):
                raise HTTPException(400, f"Invalid value for {k}")
            if typ is bool and not isinstance(upd[k], bool):
                raise HTTPException(400, f"Invalid value for {k}")
    cfg = await pcfg()
    validate(section, upd, cfg)
    before = {k: cfg.get(k) for k in upd}
    await db.pulse_config.update_one({"id": "pulse"}, {"$set": upd}, upsert=True)
    await audit(admin, f"pulse.config.{section}", "pulse", {"before": before, "after": upd}, request)
    return await pcfg()


class TopupIn(BaseModel):
    amount: int
    note: str = ""
    password: str
    code: str


@router.post("/admin/pulse/topup")
async def admin_pulse_topup(body: TopupIn, request: Request, admin=Depends(current_admin)):
    await reauth(admin, body.password, body.code)
    if not 0 < body.amount <= 100_000_000:
        raise HTTPException(400, "Enter an amount between ₹0.01 and ₹10,00,000")
    await arena_wallet()
    tid = uid()
    await db.pulse_ledger.insert_one({"id": tid, "key": f"topup:{tid}", "type": "topup", "amount": body.amount,
                                      "note": body.note[:120], "by": admin["username"], "created_at": iso()})
    w = await db.pulse_wallet.find_one_and_update({"id": "arena"}, {"$inc": {"balance": body.amount}}, return_document=ReturnDocument.AFTER, projection=P)
    await audit(admin, "pulse.wallet.topup", "arena", {"amount": body.amount, "note": body.note[:120]}, request)
    return {"ok": True, "balance": w["balance"]}


@router.get("/lobby")
async def lobby():
    from presence import page_counts
    counts = await page_counts()
    pr = await db.pulse_rounds.find_one({}, {"_id": 0, "number": 1}, sort=[("number", -1)])
    orr = await db.rounds.find_one({}, {"_id": 0, "number": 1}, sort=[("number", -1)])
    pw = await db.pulse_bets.find({"status": "collected"}, {"_id": 0, "username": 1, "payout": 1, "multiplier": 1, "collected_at": 1}).sort("collected_at", -1).to_list(10)
    ow = await db.bets.find({"status": "won"}, {"_id": 0, "username": 1, "payout": 1, "settled_at": 1}).sort("settled_at", -1).to_list(10)
    wins = [{"name": mask_name(w["username"]), "amount": w["payout"], "game": "PULSE", "multiplier": w["multiplier"], "at": w["collected_at"]} for w in pw]
    wins += [{"name": mask_name(w["username"]), "amount": w["payout"], "game": "ODDY NACHO", "multiplier": 1.95, "at": w["settled_at"]} for w in ow]
    wins.sort(key=lambda x: x["at"], reverse=True)
    return {"server_time": iso(), "pulse": {"players": counts["pulse"], "round": (pr or {}).get("number")},
            "oddeven": {"players": counts["oddeven"], "round": (orr or {}).get("number")}, "wins": wins[:12]}


# ---------- live push (per-instance watcher -> websockets) ----------
import json  # noqa: E402
from fastapi import WebSocket, WebSocketDisconnect  # noqa: E402

_SOCKS: set = set()


async def _broadcast(msg: str):
    dead = []
    for ws in list(_SOCKS):
        try:
            await asyncio.wait_for(ws.send_text(msg), 1)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _SOCKS.discard(ws)


async def pulse_watch():
    last_key, last_full, last_tick = None, 0.0, 0.0
    loop = asyncio.get_event_loop()
    while True:
        try:
            if _SOCKS:
                r = public_pulse(await db.pulse_rounds.find_one({}, P, sort=[("number", -1)])) or {}
                key = (r.get("id"), r.get("status"), r.get("anchor_at"))
                t = loop.time()
                changed = key != last_key
                full = changed or t - last_full >= 1.0
                if changed or full or (r.get("status") == "running" and t - last_tick >= 0.1):
                    body = {"type": "state", "server_time": iso(), "round": r}
                    if full:
                        sh = await shared_pulse()
                        body.update(recent=sh["recent"], winners=sh["winners"], config=sh["config"])
                        last_full = t
                    await _broadcast(json.dumps(body))
                    last_key, last_tick = key, t
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("pulse watch error")
            await asyncio.sleep(1)
        await asyncio.sleep(0.04)


@router.websocket("/pulse/ws")
async def pulse_ws(ws: WebSocket):
    await ws.accept()
    sh = await shared_pulse()
    await ws.send_text(json.dumps({"type": "state", "server_time": iso(), "round": sh["round"], "recent": sh["recent"],
                                   "winners": sh["winners"], "config": sh["config"]}))
    _SOCKS.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _SOCKS.discard(ws)
