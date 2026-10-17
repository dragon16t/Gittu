from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import os  # noqa: E402
import asyncio  # noqa: E402
import logging  # noqa: E402
from fastapi import FastAPI, APIRouter, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from core import db, client, init_storage, log  # noqa: E402
from game import engine_loop  # noqa: E402
import routes_auth  # noqa: E402
import routes_user  # noqa: E402
import routes_verifier  # noqa: E402
import routes_admin  # noqa: E402
import promotions  # noqa: E402
import tickets  # noqa: E402
import presence  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
ORIGINS = [o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()]

app = FastAPI(title="ODD/EVEN Platform")
api = APIRouter(prefix="/api")


@api.get("/")
async def health():
    return {"ok": True}


api.include_router(routes_auth.router)
api.include_router(routes_user.router)
api.include_router(routes_verifier.router)
api.include_router(routes_admin.router)
api.include_router(promotions.router)
api.include_router(tickets.router)
api.include_router(presence.router)
app.include_router(api)


@app.middleware("http")
async def security_mw(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp


app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


async def create_indexes():
    await db.users.create_index("username", unique=True)
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("id", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.rate_events.create_index("at", expireAfterSeconds=86400)
    await db.rate_events.create_index("key")
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    await db.wallets.create_index("user_id", unique=True)
    await db.ledger.create_index("key", unique=True)
    await db.fair_seeds.create_index("number", unique=True)
    await db.presence.create_index("sid", unique=True)
    await db.presence.create_index([("ip", 1), ("at", -1)])
    await db.presence.create_index("at", expireAfterSeconds=600)
    await db.visitor_stats.create_index("at", expireAfterSeconds=172800)
    await db.ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.rounds.create_index("number", unique=True)
    await db.rounds.create_index("id", unique=True)
    await db.bets.create_index([("user_id", 1), ("client_key", 1)], unique=True)
    await db.bets.create_index("round_id")
    await db.bets.create_index([("status", 1), ("settled_at", -1)])
    await db.wallets.update_many({"wager_required": {"$exists": False}}, [{"$set": {"wager_required": {"$ifNull": ["$wager_remaining", 0]}}}])
    await db.settlements.create_index("round_id", unique=True)
    await db.deposits.create_index("id", unique=True)
    await db.deposits.create_index("utr", unique=True, partialFilterExpression={"utr": {"$type": "string"}})
    await db.withdrawals.create_index("id", unique=True)
    await db.withdrawals.create_index([("user_id", 1), ("client_key", 1)], unique=True)
    await db.commission_ledger.create_index("key", unique=True)
    await db.verifiers.create_index("id", unique=True)
    await db.payment_accounts.create_index("id", unique=True)
    await db.practice_previews.create_index("id", unique=True)
    await db.audit_logs.create_index("created_at")
    await db.coupons.create_index("key", unique=True)
    await db.used_totp.create_index("key", unique=True)
    await db.used_totp.create_index("at", expireAfterSeconds=180)
    await db.tickets.create_index("id", unique=True)
    await db.tickets.create_index("number", unique=True)
    await db.coupons.create_index([("user_id", 1), ("created_at", -1)])
    await db.users.create_index("mobile", unique=True, partialFilterExpression={"mobile": {"$type": "string"}})
    await db.users.create_index("referral_code", unique=True, partialFilterExpression={"referral_code": {"$type": "string"}})
    async for u in db.users.find({"role": "user", "referral_code": {"$exists": False}}, {"_id": 0, "id": 1}):
        await promotions.assign_referral_code(u["id"])


@app.on_event("startup")
async def startup():
    await create_indexes()
    await routes_admin.seed_admin()
    try:
        await asyncio.to_thread(init_storage)
    except Exception as e:
        log.error(f"Storage init failed: {e}")
    app.state.engine = asyncio.create_task(engine_loop())
    app.state.bonus = asyncio.create_task(promotions.bonus_loop())
    app.state.visitors = asyncio.create_task(presence.snapshot_loop())


@app.on_event("shutdown")
async def shutdown():
    app.state.engine.cancel()
    app.state.bonus.cancel()
    client.close()
