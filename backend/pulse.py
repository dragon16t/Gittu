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
FAST_SECONDS = 12
CRASH_HOLD = 3
LOGICS = ("low", "medium", "high", "rare")

DEFAULT = {
    "id": "pulse", "enabled": True, "betting_seconds": 7, "min_bet": 1000, "max_bet": 1000000, "max_multiplier": 100.0,
    "logic": "low",
    "logics": {"low": {"below_pct": 80, "lo": 2.0, "hi": 3.0}, "medium": {"below_pct": 80, "lo": 3.0, "hi": 5.0},
               "high": {"below_pct": 90, "lo": 5.0, "hi": 10.0}, "rare": {"below_pct": 90, "lo": 10.0, "hi": 100.0}},
    "pct_enabled": True, "wallet_pct": 30, "cap_enabled": True, "fixed_cap": 1000000, "carry_forward": True,
    "empty_below_pct": 80, "empty_split": 3.0, "empty_max": 20.0, "no_active_enabled": True, "na_min": 300.0, "na_max": 400.0,
}


async def pcfg() -> dict:
    c = await db.pulse_config.find_one({"id": "pulse"}, P)
    if not c:
        await db.pulse_config.update_one({"id": "pulse"}, {"$setOnInsert": DEFAULT}, upsert=True)
        c = dict(DEFAULT)
    c.pop("_id", None)
    return {**DEFAULT, **c, "logics": {**DEFAULT["logics"], **c.get("logics", {})}}


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


def endpoints(seed: str, cfg: dict) -> dict:
    lg = cfg["logics"][cfg["logic"]]
    cap = cfg["max_multiplier"]
    if _u(seed, "tier") * 100 < lg["below_pct"]:
        main = 1 + _u(seed, "value") * 0.99
    else:
        main = _logu(_u(seed, "value"), min(lg["lo"], cap), min(lg["hi"], cap))
    return {"main": floor2(max(1.0, min(main, cap))),
            "sim": floor2(1 + _u(seed, "sim") * (cfg["empty_split"] - 1) if _u(seed, "sim_tier") * 100 < cfg["empty_below_pct"]
                          else _logu(_u(seed, "sim"), cfg["empty_split"], cfg["empty_max"])),
            "na": floor2(cfg["na_min"] + _u(seed, "na") * (cfg["na_max"] - cfg["na_min"]))}


def mult_at(r: dict, t) -> float:
    m = r["anchor_m"] * math.exp(r["k"] * max(0.0, (t - parse(r["anchor_at"])).total_seconds()))
    return floor2(min(m, r["endpoint"]))


def time_to(r_anchor_m: float, k: float, target: float) -> float:
    return math.log(max(target, r_anchor_m) / r_anchor_m) / k


def effective_end(r: dict):
    """Round ends at the RNG endpoint, or earlier where paid + live stakes x multiplier would exceed the budget."""
    rng = r.get("rng_endpoint", r.get("endpoint"))
    live = r["stakes"] - r.get("collected_stakes", 0)
    if r.get("simulated") or live <= 0:
        return rng, False
    m_cap = max(1.0, floor2((r["budget"] - r["paid"]) / live))
    return (m_cap, True) if m_cap < rng else (rng, False)


def end_fields(r: dict) -> dict:
    end, limited = effective_end(r)
    at = parse(r["anchor_at"]) + timedelta(seconds=time_to(r["anchor_m"], r["k"], end))
    return {"endpoint": end, "cap_limited": limited, "crash_at": iso(at)}


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
    eligible = w["balance"] + res["stakes"]
    limits = [eligible]
    alloc = carry = None
    if cfg["pct_enabled"]:
        alloc = w["balance"] * cfg["wallet_pct"] // 100
        if cfg["carry_forward"]:
            prev = await db.pulse_rounds.find_one({"status": "crashed", "simulated": False}, P, sort=[("number", -1)])
            carry = max(0, (prev or {}).get("unused", 0))
        limits.append(alloc + (carry or 0))
    if cfg["cap_enabled"]:
        limits.append(cfg["fixed_cap"])
    budget = max(0, min(limits))
    endpoint = res["planned"]["sim"] if simulated else res["planned"]["main"]
    t = now()
    doc = {"status": "running", "simulated": simulated, "anchor_m": 1.0, "anchor_at": iso(t), "k": K_NORMAL, "rng_endpoint": endpoint,
           "budget": budget, "stakes": res["stakes"], "paid": 0, "collected_stakes": 0}
    doc.update(end_fields(doc))
    await db.pulse_rounds.update_one({"id": r["id"], "status": "starting"}, {"$set": {
        **doc, "started_at": iso(t),
        "opening_balance": w["balance"], "eligible": eligible, "allocation": alloc, "carry_in": carry,
        "fixed_cap": cfg["fixed_cap"] if cfg["cap_enabled"] else None}})


async def no_active_phase(r: dict, cfg: dict):
    t = now()
    m = mult_at(r, t)
    target = max(r["planned"]["na"], m + 0.01)
    k = math.log(target / m) / FAST_SECONDS
    await db.pulse_rounds.update_one({"id": r["id"], "status": "running", "na_applied": {"$ne": True}}, {"$set": {
        "na_applied": True, "anchor_m": m, "anchor_at": iso(t), "k": k, "endpoint": target, "rng_endpoint": target, "cap_limited": False,
        "crash_at": iso(t + timedelta(seconds=FAST_SECONDS))}})


async def crash(r: dict):
    t = now()
    res = await db.pulse_rounds.find_one_and_update({"id": r["id"], "status": "running"}, {"$set": {
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
        elif (cfg["no_active_enabled"] and not r["simulated"] and not r.get("na_applied")
              and r["bets_count"] > 0 and r["collected"] >= r["bets_count"]):
            await no_active_phase(r, cfg)


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
            "config": {"min_bet": cfg["min_bet"], "max_bet": cfg["max_bet"], "betting_seconds": cfg["betting_seconds"], "enabled": cfg["enabled"]}}
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
    if not r or r["status"] != "running" or t >= parse(r["crash_at"]):
        raise HTTPException(400, "Round ended")
    m = mult_at(r, t)
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
    fresh = await db.pulse_rounds.find_one({"id": r["id"], "status": "running"}, P)
    if fresh and not fresh.get("na_applied"):
        await db.pulse_rounds.update_one({"id": r["id"], "status": "running", "na_applied": {"$ne": True}}, {"$set": end_fields(fresh)})
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
                "logic": cur.get("logic")}
    rounds = await db.pulse_rounds.find({"status": "crashed"}, {"_id": 0, "number": 1, "result": 1, "simulated": 1, "stakes": 1, "paid": 1,
                                                                "budget": 1, "cap_hit": 1, "na_applied": 1, "logic": 1, "bets_count": 1,
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
    "logic": {"logic": str, "logics": dict},
    "payout": {"pct_enabled": bool, "wallet_pct": int, "cap_enabled": bool, "fixed_cap": int, "carry_forward": bool},
    "phases": {"empty_below_pct": int, "empty_split": float, "empty_max": float, "no_active_enabled": bool, "na_min": float, "na_max": float},
}


def validate(section: str, upd: dict, cfg: dict):
    c = {**cfg, **upd}
    if section == "general":
        if not 3 <= c["betting_seconds"] <= 30:
            raise HTTPException(400, "Betting countdown must be 3–30 seconds")
        if not 100 <= c["min_bet"] <= c["max_bet"]:
            raise HTTPException(400, "Minimum bet must be ≥ ₹1 and ≤ maximum bet")
        if not 2 <= c["max_multiplier"] <= 3000:
            raise HTTPException(400, "Maximum multiplier must be 2×–3000×")
    elif section == "logic":
        if c["logic"] not in LOGICS:
            raise HTTPException(400, "Choose one of: low, medium, high, rare")
        for name in LOGICS:
            lg = c["logics"].get(name) or {}
            try:
                lg = {"below_pct": int(lg["below_pct"]), "lo": float(lg["lo"]), "hi": float(lg["hi"])}
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, f"Logic '{name}' needs below %, range from and range to")
            if not (0 <= lg["below_pct"] <= 100 and 2 <= lg["lo"] <= lg["hi"] <= 10000):
                raise HTTPException(400, f"Logic '{name}': below % must be 0–100 and 2× ≤ from ≤ to")
            c["logics"][name] = lg
        upd["logics"] = c["logics"]
    elif section == "payout":
        if c["wallet_pct"] not in (10, 20, 30, 50):
            raise HTTPException(400, "Arena wallet allocation must be 10%, 20%, 30% or 50%")
        if c["fixed_cap"] < 0:
            raise HTTPException(400, "Fixed payout cap cannot be negative")
    elif section == "phases":
        if not 0 <= c["empty_below_pct"] <= 100 or not 1.01 <= c["empty_split"] <= c["empty_max"] <= 3000 or not 1.01 <= c["na_min"] <= c["na_max"] <= 3000:
            raise HTTPException(400, "Ranges must be from ≤ to, between 1.01× and 3000×, percentage 0–100")


@router.put("/admin/pulse/config/{section}")
async def admin_pulse_config(section: str, body: dict, request: Request, admin=Depends(current_admin)):
    spec = SECTIONS.get(section)
    if not spec:
        raise HTTPException(404, "Unknown section")
    upd = {}
    for k, typ in spec.items():
        if k in body:
            try:
                upd[k] = body[k] if typ in (dict, bool) else typ(body[k])
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
