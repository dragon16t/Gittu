import os
import re
import uuid
import secrets
import hashlib
import logging
import asyncio
from datetime import datetime, timezone, timedelta

import bcrypt
import cloudinary
import cloudinary.uploader
import cloudinary.utils
import jwt
import requests
from fastapi import Request, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from cryptography.fernet import Fernet

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
fernet = Fernet(os.environ["DATA_ENC_KEY"].encode())
log = logging.getLogger("oddeven")
NOID = {"_id": 0}
SESSION_HOURS = 12


def now():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).isoformat()


def uid():
    return str(uuid.uuid4())


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def enc(s: str) -> str:
    return fernet.encrypt(s.encode()).decode() if s else ""


def dec(s: str) -> str:
    return fernet.decrypt(s.encode()).decode() if s else ""


def mask(s: str) -> str:
    return ("XXXX" + s[-4:]) if s else ""


def validate_password(p: str):
    if len(p) < 8 or not re.search(r"[A-Za-z]", p) or not re.search(r"\d", p):
        raise HTTPException(400, "Password must be at least 8 characters with letters and numbers")


def gen_password(n=14) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    while True:
        p = "".join(secrets.choice(alphabet) for _ in range(n))
        if re.search(r"\d", p) and re.search(r"[A-Za-z]", p):
            return p


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


# ---------- rate limiting ----------
async def check_rate(key: str, limit: int, minutes: int):
    since = now() - timedelta(minutes=minutes)
    if await db.rate_events.count_documents({"key": key, "at": {"$gte": since}}) >= limit:
        raise HTTPException(429, "Too many attempts. Please try again later.")


async def hit_rate(key: str):
    await db.rate_events.insert_one({"key": key, "at": now()})


async def clear_rate(key: str):
    await db.rate_events.delete_many({"key": key})


# ---------- sessions ----------
async def create_session(response, user: dict, request: Request):
    sid = secrets.token_urlsafe(24)
    role = user["role"]
    await db.sessions.insert_one({
        "id": sid, "user_id": user["id"], "role": role, "ip": client_ip(request),
        "ua": request.headers.get("user-agent", "")[:200], "created_at": iso(),
        "expires_at": now() + timedelta(hours=SESSION_HOURS), "revoked": False,
    })
    token = jwt.encode({"sub": user["id"], "sid": sid, "role": role, "type": "access",
                        "exp": now() + timedelta(hours=SESSION_HOURS)}, JWT_SECRET, algorithm="HS256")
    response.set_cookie(f"sess_{role}", token, httponly=True, secure=True, samesite="none",
                        max_age=SESSION_HOURS * 3600, path="/")
    return sid


_AUTH_CACHE: dict = {}


def principal(role: str):
    async def dep(request: Request) -> dict:
        token = request.cookies.get(f"sess_{role}")
        auth = request.headers.get("Authorization", "")
        if not token and auth.startswith("Bearer "):
            token = auth[7:]
        if not token:
            raise HTTPException(401, "Not authenticated")
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        except jwt.PyJWTError:
            raise HTTPException(401, "Invalid or expired session")
        if payload.get("type") != "access" or payload.get("role") != role:
            raise HTTPException(401, "Invalid session")
        t = asyncio.get_running_loop().time()
        hit = _AUTH_CACHE.get(payload["sid"]) if role == "user" else None
        if hit and t - hit[0] < 3 and hit[1]["id"] == payload["sub"]:
            return dict(hit[1])
        sess = await db.sessions.find_one({"id": payload["sid"], "revoked": False}, {"_id": 1})
        if not sess:
            raise HTTPException(401, "Session revoked")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0, "recovery_hash": 0,
                                                               "totp_secret": 0, "pending_totp": 0, "backup_codes": 0, "dob_hash": 0})
        if not user or user.get("status") != "active":
            raise HTTPException(403, "Account suspended or not found")
        user["session_id"] = payload["sid"]
        if role == "user":
            if len(_AUTH_CACHE) > 200000:
                _AUTH_CACHE.clear()
            _AUTH_CACHE[payload["sid"]] = (t, user)
        return dict(user)
    return dep


current_user = principal("user")
current_admin = principal("admin")
current_verifier = principal("verifier")


def mfa_token(user_id: str, purpose: str) -> str:
    return jwt.encode({"sub": user_id, "type": "mfa", "purpose": purpose,
                       "exp": now() + timedelta(minutes=5)}, JWT_SECRET, algorithm="HS256")


def read_mfa_token(token: str) -> dict:
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "MFA session expired, login again")
    if p.get("type") != "mfa":
        raise HTTPException(401, "Invalid MFA token")
    return p


# ---------- audit / notify / alerts ----------
async def audit(actor: dict, action: str, target: str = "", details: dict = None, request: Request = None):
    await db.audit_logs.insert_one({
        "id": uid(), "actor_id": actor.get("id"), "actor": actor.get("username"), "role": actor.get("role"),
        "action": action, "target": target, "details": details or {},
        "ip": client_ip(request) if request else "", "created_at": iso(),
    })


async def notify(user_id: str, title: str, body: str):
    await db.notifications.insert_one({"id": uid(), "user_id": user_id, "title": title, "body": body,
                                       "read": False, "created_at": iso()})


async def alert(kind: str, message: str, ref: str = ""):
    await db.admin_alerts.insert_one({"id": uid(), "kind": kind, "message": message, "ref": ref,
                                      "resolved": False, "created_at": iso()})


# ---------- config ----------
DEFAULT_CONFIG = {
    "id": "game", "platform_name": "BLACKBA", "mode": "random", "multiplier_bps": 195, "min_stake": 1000, "max_stake": 1000000,
    "paused": False, "practice_enabled": True, "max_round_exposure": 5000000, "company_reserve": 100000000,
    "commission_bps": 1000, "commission_basis": "deposits", "promotions_enabled": True,
    "promo_reserve": 10000000, "music_path": "", "referral_bonus": 30000, "friend_bonus": 15000,
}


_CFG = {"at": 0.0, "val": None}


def invalidate_config():
    _CFG["at"] = 0.0


async def get_config() -> dict:
    t = asyncio.get_running_loop().time()
    if _CFG["val"] is None or t - _CFG["at"] > 2:
        cfg = await db.config.find_one({"id": "game"}, NOID)
        _CFG["val"], _CFG["at"] = {**DEFAULT_CONFIG, **(cfg or {})}, t
    return dict(_CFG["val"])


# ---------- wallet ledger (amounts in paise) ----------
async def ensure_wallet(user_id: str):
    await db.wallets.update_one({"user_id": user_id},
                                {"$setOnInsert": {"user_id": user_id, "balance": 0, "reserved": 0, "created_at": iso()}},
                                upsert=True)


async def ledger_credit(user_id: str, amount: int, typ: str, key: str, meta: dict = None, from_reserved=False) -> bool:
    """Idempotent credit: unique key guarantees a single application."""
    entry = {"id": uid(), "user_id": user_id, "type": typ, "amount": amount, "key": key,
             "meta": meta or {}, "created_at": iso()}
    try:
        await db.ledger.insert_one(entry)
    except DuplicateKeyError:
        return False
    inc = {"balance": amount}
    if from_reserved:
        inc["reserved"] = -amount
    w = await db.wallets.find_one_and_update({"user_id": user_id}, {"$inc": inc}, return_document=ReturnDocument.AFTER)
    await db.ledger.update_one({"id": entry["id"]}, {"$set": {"balance_after": w["balance"]}})
    return True


async def ledger_debit(user_id: str, amount: int, typ: str, key: str, meta: dict = None, to_reserved=False):
    """Atomic conditional debit; returns None when key already applied."""
    if await db.ledger.find_one({"key": key}):
        return None
    inc = {"balance": -amount}
    if to_reserved:
        inc["reserved"] = amount
    w = await db.wallets.find_one_and_update({"user_id": user_id, "balance": {"$gte": amount}}, {"$inc": inc},
                                             return_document=ReturnDocument.AFTER)
    if not w:
        raise HTTPException(400, "Insufficient balance")
    try:
        await db.ledger.insert_one({"id": uid(), "user_id": user_id, "type": typ, "amount": -amount, "key": key,
                                    "meta": meta or {}, "balance_after": w["balance"], "created_at": iso()})
    except DuplicateKeyError:
        await db.wallets.update_one({"user_id": user_id}, {"$inc": {k: -v for k, v in inc.items()}})
        return None
    return w


async def reserved_settle(user_id: str, amount: int, typ: str, key: str, meta: dict = None) -> bool:
    """Consume reserved funds exactly once (withdrawal completion)."""
    try:
        await db.ledger.insert_one({"id": uid(), "user_id": user_id, "type": typ, "amount": 0, "reserved_change": -amount,
                                    "key": key, "meta": meta or {}, "created_at": iso()})
    except DuplicateKeyError:
        return False
    res = await db.wallets.update_one({"user_id": user_id, "reserved": {"$gte": amount}}, {"$inc": {"reserved": -amount}})
    if not res.modified_count:
        await alert("reconciliation", f"Reserved funds short for user {user_id} on {key}", key)
    return True


# ---------- object storage ----------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = os.environ["APP_NAME"]
cloudinary.config(cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"], api_key=os.environ["CLOUDINARY_API_KEY"],
                  api_secret=os.environ["CLOUDINARY_API_SECRET"], secure=True)


def _cld_put(path: str, data: bytes) -> dict:
    r = cloudinary.uploader.upload(data, public_id=path.rsplit(".", 1)[0], type="authenticated",
                                   resource_type="auto", overwrite=False)
    return {"cld_public_id": r["public_id"], "cld_resource_type": r["resource_type"], "cld_format": r.get("format")}


def _cld_get(rec: dict):
    url, _ = cloudinary.utils.cloudinary_url(rec["cld_public_id"], resource_type=rec["cld_resource_type"],
                                             type="authenticated", sign_url=True, format=rec.get("cld_format"))
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content
_storage_key = None


def init_storage(force=False):
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": os.environ["EMERGENT_LLM_KEY"]}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put(path, data, ctype):
    r = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage(), "Content-Type": ctype},
                     data=data, timeout=120)
    r.raise_for_status()
    return r.json()


def _get(path):
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def put_file(folder: str, filename: str, data: bytes, ctype: str, owner: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    path, size, cld = f"{APP_NAME}/{folder}/{uid()}.{ext}", len(data), {}
    try:
        res = await asyncio.to_thread(_put, path, data, ctype)
        path, size = res["path"], res.get("size", size)
    except Exception:
        log.exception("primary storage upload failed")
        path = None
    try:
        cld = await asyncio.to_thread(_cld_put, path or f"{APP_NAME}/{folder}/{uid()}.{ext}", data)
    except Exception:
        log.exception("cloudinary upload failed")
    if not path and not cld:
        raise HTTPException(503, "Upload failed, please try again")
    path = path or f"cld:{cld['cld_public_id']}"
    _cache_put(path, (data, ctype))
    await db.files.insert_one({"id": uid(), "storage_path": path, "original_filename": filename,
                               "content_type": ctype, "size": size, "owner": owner, **cld,
                               "is_deleted": False, "created_at": iso()})
    return path


_FILE_CACHE: dict = {}


def _cache_put(path: str, item):
    if len(_FILE_CACHE) >= 300:
        _FILE_CACHE.pop(next(iter(_FILE_CACHE)))
    _FILE_CACHE[path] = item


async def get_file(path: str):
    if path in _FILE_CACHE:
        return _FILE_CACHE[path]
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File not found")
    ct = rec.get("content_type") or "application/octet-stream"
    data = None
    if not path.startswith("cld:"):
        try:
            data, sct = await asyncio.to_thread(_get, path)
            ct = rec.get("content_type") or sct
        except Exception:
            log.warning("primary storage read failed for %s", path)
    if data is None and rec.get("cld_public_id"):
        data = await asyncio.to_thread(_cld_get, rec)
    if data is None:
        raise HTTPException(404, "File not available")
    item = (data, ct)
    _cache_put(path, item)
    return item


async def backup_files_to_cloudinary():
    async for rec in db.files.find({"cld_public_id": {"$exists": False}, "is_deleted": False}, {"_id": 0}):
        try:
            data, _ = await asyncio.to_thread(_get, rec["storage_path"])
            cld = await asyncio.to_thread(_cld_put, rec["storage_path"], data)
            await db.files.update_one({"id": rec["id"]}, {"$set": cld})
        except Exception:
            log.warning("cloudinary backup skipped for %s", rec["storage_path"])
