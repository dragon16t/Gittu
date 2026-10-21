import asyncio, os, sys, time, uuid, random
import httpx, pyotp
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from core import db, sha, ledger_credit  # noqa: E402

A = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0] + '/api'
T = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
PW = "Admin@8CwWbJV7AhEE"
N = 6
STAKE = 10000
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


async def user_client(i):
    c = httpx.AsyncClient(timeout=20)
    name = f"ptcap{i}"
    r = await c.post(A + "/auth/login", json={"username": name, "password": "Test@1234"})
    if r.status_code != 200:
        email = f"{name}@example.com"
        await db.email_otps.update_one({"email": email}, {"$set": {"code_hash": sha(f"{email}:123456"), "sent_at": "2000-01-01T00:00:00+00:00",
                                                                     "expires_at": "2099-01-01T00:00:00+00:00", "attempts": 0}}, upsert=True)
        r = await c.post(A + "/auth/register", json={"username": name, "password": "Test@1234", "confirm_password": "Test@1234", "accept_terms": True,
                                                     "mobile": f"98{random.randint(10**7, 10**8 - 1)}", "dob": "1990-01-01", "email": email, "email_otp": "123456"})
        assert r.status_code == 200, r.text
    uid = (await c.get(A + "/auth/me")).json()["id"]
    await ledger_credit(uid, 100000, "adjustment", f"ptcap-fund:{uid}:{uuid.uuid4()}", {"note": "pulse parallel test"})
    return c, uid


async def wait_status(c, want):
    while True:
        s = (await c.get(A + "/pulse/state")).json()
        if s["round"] and s["round"]["status"] in want:
            return s
        await asyncio.sleep(0.1)


async def ledger_ok(uid):
    w = await db.wallets.find_one({"user_id": uid})
    tot = (await db.ledger.aggregate([{"$match": {"user_id": uid}}, {"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1))[0]["s"]
    return w["balance"] == tot, w["balance"], tot


async def run_round(clients, label, collect_delays):
    c0 = clients[0][0]
    await wait_status(c0, ("crashed",))
    s = await wait_status(c0, ("betting",))
    rid = s["round"]["id"]
    res = await asyncio.gather(*[c.post(A + "/pulse/bet", json={"slot": slot, "amount": STAKE, "client_key": str(uuid.uuid4())})
                                 for c, _ in clients for slot in (1, 2)])
    check(all(r.status_code == 200 for r in res), f"[{label}] all {len(res)} bets accepted concurrently")
    dup = await asyncio.gather(*[c.post(A + "/pulse/bet", json={"slot": 1, "amount": STAKE, "client_key": str(uuid.uuid4())}) for c, _ in clients])
    check(all(r.status_code == 400 for r in dup), f"[{label}] duplicate slot bets rejected")
    await wait_status(c0, ("running", "crashed"))
    t0 = time.time()

    async def collect(c, slot, delay):
        await asyncio.sleep(max(0, delay - (time.time() - t0)))
        return await c.post(A + "/pulse/collect", json={"round_id": rid, "slot": slot})
    jobs = [collect(c, slot, collect_delays(i, slot)) for i, (c, _) in enumerate(clients) for slot in (1, 2)]
    jobs += [collect(c, 1, collect_delays(i, 1)) for i, (c, _) in enumerate(clients)]
    out = await asyncio.gather(*jobs)
    ok = sum(1 for r in out if r.status_code == 200)
    await wait_status(c0, ("crashed",))
    await asyncio.sleep(0.6)
    rd = await db.pulse_rounds.find_one({"id": rid})
    bets = await db.pulse_bets.find({"round_id": rid}).to_list(100)
    paid_sum = sum(b.get("payout", 0) for b in bets if b["status"] == "collected")
    print(f"   round #{rd['number']}: budget {rd['budget']} rng_end {rd.get('rng_endpoint')} result {rd['result']} paid {rd['paid']} "
          f"collected {sum(b['status'] == 'collected' for b in bets)}/{len(bets)} ok_responses {ok}")
    check(rd["paid"] == paid_sum, f"[{label}] round.paid equals sum of payouts")
    check(rd["paid"] <= rd["budget"], f"[{label}] payouts never exceed the budget")
    check(ok == sum(b["status"] == "collected" for b in bets), f"[{label}] no double collect (success responses == collected bets)")
    check(all(b["status"] in ("collected", "lost") for b in bets), f"[{label}] every bet settled")
    check(all(b["multiplier"] <= rd["result"] + 1e-9 for b in bets if b["status"] == "collected"), f"[{label}] no collect above the final multiplier")
    exp = rd["opening_balance"] + rd["stakes"] - rd["paid"]
    check(rd.get("closing_balance") == exp, f"[{label}] arena closing = opening + stakes − paid ({exp})")
    return rd


async def main():
    adm = httpx.AsyncClient(timeout=20)
    t = (await adm.post(A + "/admin/auth/login", json={"username": "admin", "password": PW})).json()
    await adm.post(A + "/admin/auth/mfa", json={"mfa_token": t["mfa_token"], "code": T.now()})
    before = (await adm.get(A + "/admin/pulse")).json()["wallet"]["balance"]
    await asyncio.sleep(31)
    r = await adm.post(A + "/admin/pulse/topup", json={"amount": 200000, "note": "parallel test", "password": PW, "code": T.now()})
    after = (await adm.get(A + "/admin/pulse")).json()["wallet"]["balance"]
    check(r.status_code == 200 and after >= before + 200000, f"arena top-up ₹2,000 ({before} → {after})")
    clients = [await user_client(i) for i in range(N)]

    # Round A: tight fixed cap (₹1,500 for ₹1,200 live) -> cap point ≈1.25x, staggered + simultaneous collects
    await adm.put(A + "/admin/pulse/config/payout", json={"pct_enabled": True, "wallet_pct": 50, "cap_enabled": True, "fixed_cap": 150000, "carry_forward": False})
    await run_round(clients, "tight cap", lambda i, slot: 0.6 if slot == 1 else 1.2 + 0.1 * i)
    # Round B: cap below live stakes -> must end at 1.00x, nobody paid
    await adm.put(A + "/admin/pulse/config/payout", json={"pct_enabled": True, "wallet_pct": 50, "cap_enabled": True, "fixed_cap": 50000, "carry_forward": False})
    rb = await run_round(clients, "cap below stakes", lambda i, slot: 0.2)
    check(rb["result"] == 1.0 and rb["paid"] == 0 and rb.get("cap_hit"), "[cap below stakes] round ends at 1.00x, nobody paid, cap event")
    # Round C: percentage only (10% of wallet), all collect at the same instant
    await adm.put(A + "/admin/pulse/config/payout", json={"pct_enabled": True, "wallet_pct": 10, "cap_enabled": False, "fixed_cap": 1000000, "carry_forward": True})
    await run_round(clients, "10% wallet", lambda i, slot: 0.8)

    for i, (_, uid) in enumerate(clients):
        ok, w, l = await ledger_ok(uid)
        check(ok, f"user ptcap{i} wallet {w} == ledger {l}")
    a = (await adm.get(A + "/admin/pulse")).json()
    total = (await db.pulse_ledger.aggregate([{"$group": {"_id": None, "s": {"$sum": "$amount"}}}]).to_list(1))[0]["s"]
    check(total == a["wallet"]["balance"], f"arena wallet {a['wallet']['balance']} == arena ledger {total}")
    check(all(c["reconciled"] for c in a["cycles"][:3]), "latest 3-round cycles reconciled")
    await adm.put(A + "/admin/pulse/config/payout", json={"pct_enabled": True, "wallet_pct": 30, "cap_enabled": True, "fixed_cap": 1000000, "carry_forward": True})
    print("restored payout config")
    print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAIL(S): {fails}")

asyncio.run(main())
