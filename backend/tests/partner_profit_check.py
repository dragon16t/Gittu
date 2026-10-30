import asyncio, sys, uuid
import httpx
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")
from core import db, iso  # noqa: E402

A = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0] + '/api'
PID = "test-partner-profit"


async def wait(c, want):
    while True:
        s = (await c.get(A + "/pulse/state")).json()
        if s["round"] and s["round"]["status"] in want:
            return s
        await asyncio.sleep(0.1)


async def main():
    await db.partners.update_one({"id": PID}, {"$set": {"id": PID, "user_id": "x", "partner_code": "PTEST01", "name": "Test Partner", "username": "ptest",
                                                        "status": "active", "earn_mode": "profit", "profit_pct": 5, "created_at": iso()}}, upsert=True)
    await db.partner_wallets.update_one({"partner_id": PID}, {"$set": {"profit_carry": 0}}, upsert=True)
    c = httpx.AsyncClient(timeout=20)
    await c.post(A + "/auth/login", json={"username": "ptcap0", "password": "Test@1234"})
    me = (await c.get(A + "/auth/me")).json()
    await db.users.update_one({"id": me["id"]}, {"$set": {"partner_id": PID}})
    w0 = await db.partner_wallets.find_one({"partner_id": PID})
    for label, collect in (("loss round", False), ("win round", True)):
        await wait(c, ("crashed",))
        s = await wait(c, ("betting",))
        rid = s["round"]["id"]
        print(label, "bet", (await c.post(A + "/pulse/bet", json={"slot": 1, "amount": 10000, "client_key": str(uuid.uuid4())})).status_code)
        await wait(c, ("running",))
        if collect:
            await asyncio.sleep(0.05)
            print("  collect", (await c.post(A + "/pulse/collect", json={"round_id": rid, "slot": 1})).json().get("bet", {}).get("payout"))
        await wait(c, ("crashed",))
        await asyncio.sleep(1.5)
        pr = await db.partner_rounds.find_one({"round_id": rid, "partner_id": PID}, {"_id": 0})
        print("  partner_round:", {k: pr[k] for k in ("net", "carry_in", "commission", "carry_out")} if pr else None)
    w1 = await db.partner_wallets.find_one({"partner_id": PID})
    print("partner available", w0.get("available", 0), "->", w1.get("available", 0), "carry", w1.get("profit_carry"))
    await db.users.update_one({"id": me["id"]}, {"$unset": {"partner_id": 1}})
    await db.partners.delete_one({"id": PID})

asyncio.run(main())
