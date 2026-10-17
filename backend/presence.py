import asyncio
import re
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel

from core import db, now, client_ip, current_admin, JWT_SECRET, log

router = APIRouter()
LIVE_SECONDS = 45
MAX_SIDS_PER_IP = 5


class PingIn(BaseModel):
    sid: str


async def ping_user_id(request: Request):
    token = request.cookies.get("sess_user")
    if not token:
        return None
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if p.get("role") != "user" or not await db.sessions.find_one({"id": p.get("sid"), "revoked": False}, {"_id": 1}):
        return None
    return p["sub"]


@router.post("/presence/ping")
async def ping(body: PingIn, request: Request):
    if not re.fullmatch(r"[A-Za-z0-9-]{16,64}", body.sid):
        raise HTTPException(400, "Invalid visitor id")
    ip = client_ip(request)
    since = now() - timedelta(seconds=LIVE_SECONDS)
    known = await db.presence.find_one({"sid": body.sid}, {"_id": 0, "ip": 1})
    if not known or known.get("ip") != ip:
        if await db.presence.count_documents({"ip": ip, "at": {"$gte": since}}) >= MAX_SIDS_PER_IP:
            return {"ok": False}
    await db.presence.update_one({"sid": body.sid}, {"$set": {
        "sid": body.sid, "ip": ip, "user_id": await ping_user_id(request), "at": now()}}, upsert=True)
    return {"ok": True}


async def live_counts() -> dict:
    since = now() - timedelta(seconds=LIVE_SECONDS)
    visitors = await db.presence.count_documents({"at": {"$gte": since}})
    players = len(await db.presence.distinct("user_id", {"at": {"$gte": since}, "user_id": {"$ne": None}}))
    return {"visitors": visitors, "players": players}


@router.get("/admin/live")
async def admin_live(admin=Depends(current_admin)):
    return await live_counts()


@router.get("/admin/visitors/history")
async def visitor_history(admin=Depends(current_admin)):
    rows = await db.visitor_stats.find({"at": {"$gte": now() - timedelta(hours=24)}}, {"_id": 0}).sort("at", 1).to_list(400)
    return [{"at": r["at"].isoformat(), "visitors": r["visitors"], "players": r["players"]} for r in rows]


async def snapshot_loop():
    while True:
        try:
            await db.visitor_stats.insert_one({"at": now(), **await live_counts()})
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("visitor snapshot error")
        await asyncio.sleep(300)
