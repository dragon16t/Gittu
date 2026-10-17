import re
import io
import base64
import secrets
from datetime import timedelta, datetime

import pyotp
import qrcode
from fastapi import APIRouter, Request, Response, Depends, HTTPException
from pydantic import BaseModel

from core import (db, now, iso, uid, sha, hash_pw, verify_pw, validate_password, client_ip, check_rate, hit_rate,
                  clear_rate, create_session, current_user, current_admin, current_verifier, mfa_token,
                  read_mfa_token, audit, notify, alert, ensure_wallet, enc, dec, NOID)
from promotions import new_referral_code, daily_for

router = APIRouter()


class RegisterIn(BaseModel):
    username: str
    password: str
    confirm_password: str
    referral_code: str = ""
    partner_code: str = ""
    accept_terms: bool = False
    mobile: str
    dob: str


class LoginIn(BaseModel):
    username: str
    password: str


class ForgotIn(BaseModel):
    username: str
    recovery_code: str = ""
    dob: str = ""
    bank_last4: str = ""


class ResetIn(BaseModel):
    reset_token: str
    password: str
    confirm_password: str


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str


class MfaIn(BaseModel):
    mfa_token: str
    code: str


class ReauthIn(BaseModel):
    password: str
    code: str


class AdminPwIn(BaseModel):
    current_password: str
    new_password: str
    code: str


class CodeIn(BaseModel):
    code: str


class RevokeIn(BaseModel):
    session_id: str


def public_user(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "username", "mobile", "role", "status", "created_at", "must_change_password")}


def gen_recovery_code() -> str:
    return "-".join(secrets.token_hex(2).upper() for _ in range(4))


def qr_data_url(text: str) -> str:
    buf = io.BytesIO()
    qrcode.make(text).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def password_login(body: LoginIn, request: Request, role: str) -> dict:
    username = body.username.strip().lower()
    key = f"login:{client_ip(request)}:{username}"
    await check_rate(key, 5, 15)
    q = {"mobile": username} if role == "user" and re.fullmatch(r"[6-9]\d{9}", username) else {"username": username}
    user = await db.users.find_one({**q, "role": role})
    ok = bool(user) and verify_pw(body.password, user["password_hash"])
    await db.login_history.insert_one({"id": uid(), "username": username, "role": role, "ip": client_ip(request),
                                       "ua": request.headers.get("user-agent", "")[:200], "success": ok,
                                       "created_at": iso()})
    if not ok:
        await hit_rate(key)
        raise HTTPException(401, "Invalid username or password")
    if user.get("status") != "active":
        raise HTTPException(403, "Account suspended. Contact support.")
    await clear_rate(key)
    return user


# ---------- user / verifier auth ----------
@router.post("/auth/register")
async def register(body: RegisterIn, request: Request, response: Response):
    ipkey = f"register:{client_ip(request)}"
    await check_rate(ipkey, 10, 60)
    await hit_rate(ipkey)
    username = body.username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{3,20}", username):
        raise HTTPException(400, "Username must be 3-20 letters, numbers or underscore")
    mobile = re.sub(r"\D", "", body.mobile)[-10:]
    if not re.fullmatch(r"[6-9]\d{9}", mobile):
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    try:
        born = datetime.strptime(body.dob.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Enter a valid date of birth")
    today = now().date()
    if (today.year - born.year - ((today.month, today.day) < (born.month, born.day))) < 18:
        raise HTTPException(400, "You must be 18 or older to register")
    if await db.users.find_one({"mobile": mobile}):
        raise HTTPException(400, "Mobile number already registered")
    if not body.accept_terms:
        raise HTTPException(400, "You must accept the Terms & Conditions")
    if body.password != body.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    validate_password(body.password)
    if await db.users.find_one({"username": username}):
        raise HTTPException(400, "Username already taken")
    code = gen_recovery_code()
    referrer = None
    if body.referral_code.strip():
        referrer = await db.users.find_one({"referral_code": body.referral_code.strip().upper(), "role": "user"})
        if not referrer:
            raise HTTPException(400, "Invalid referral code")
    user = {"id": uid(), "username": username, "role": "user", "status": "active",
            "password_hash": hash_pw(body.password), "recovery_hash": sha(code), "created_at": iso(),
            "referral_code": new_referral_code(), "terms_accepted_at": iso(), "terms_version": "2026-06", "mobile": mobile, "referred_by": referrer["id"] if referrer else None}
    if body.partner_code.strip():
        partner = await db.partners.find_one({"partner_code": body.partner_code.strip().upper(), "status": "active"}, {"_id": 0, "id": 1, "user_id": 1})
        if partner:
            user.update(partner_id=partner["id"], partner_attributed_at=iso())
    user["dob_hash"] = sha(f"{user['id']}:{born.isoformat()}")
    try:
        await db.users.insert_one(dict(user))
    except Exception:
        raise HTTPException(400, "Username or mobile already registered")
    await ensure_wallet(user["id"])
    await daily_for(user["id"])
    await create_session(response, user, request)
    await audit(user, "user.register", user["id"], request=request)
    return {"user": public_user(user), "recovery_code": code}


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    user = await password_login(body, request, "user")
    await create_session(response, user, request)
    return {"user": public_user(user)}


@router.post("/verifier/auth/login")
async def verifier_login(body: LoginIn, request: Request, response: Response):
    user = await password_login(body, request, "verifier")
    await create_session(response, user, request)
    await audit(user, "verifier.login", user["id"], request=request)
    return {"user": public_user(user)}


async def _logout(role: str, request: Request, response: Response, user: dict):
    await db.sessions.update_one({"id": user["session_id"]}, {"$set": {"revoked": True}})
    response.delete_cookie(f"sess_{role}", path="/", secure=True, samesite="none")
    return {"ok": True}


@router.post("/auth/logout")
async def logout(request: Request, response: Response, user=Depends(current_user)):
    return await _logout("user", request, response, user)


@router.post("/verifier/auth/logout")
async def verifier_logout(request: Request, response: Response, user=Depends(current_verifier)):
    return await _logout("verifier", request, response, user)


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return public_user(user)


@router.get("/verifier/auth/me")
async def verifier_me(user=Depends(current_verifier)):
    return public_user(user)


@router.post("/auth/forgot/verify")
async def forgot_verify(body: ForgotIn, request: Request):
    username = body.username.strip().lower()
    key = f"forgot:{client_ip(request)}:{username}"
    await check_rate(key, 5, 30)
    q = {"mobile": username} if re.fullmatch(r"[6-9]\d{9}", username) else {"username": username}
    user = await db.users.find_one({**q, "role": "user"})
    ok = False
    if user and body.recovery_code.strip():
        ok = secrets.compare_digest(user.get("recovery_hash", ""), sha(body.recovery_code.strip().upper()))
    elif user and body.dob.strip() and user.get("dob_hash"):
        ok = secrets.compare_digest(user["dob_hash"], sha(f"{user['id']}:{body.dob.strip()}"))
    if ok:
        bank = await db.bank_details.find_one({"user_id": user["id"]})
        if bank and bank.get("account_number_enc"):
            ok = dec(bank["account_number_enc"])[-4:] == body.bank_last4.strip()
    if not ok:
        await hit_rate(key)
        raise HTTPException(400, "Verification failed")
    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({"id": uid(), "user_id": user["id"], "token_hash": sha(token), "used": False,
                                         "expires_at": now() + timedelta(minutes=15), "created_at": iso()})
    return {"reset_token": token, "expires_in": 900}


@router.post("/auth/forgot/reset")
async def forgot_reset(body: ResetIn, request: Request):
    if body.password != body.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    validate_password(body.password)
    rec = await db.password_resets.find_one_and_update(
        {"token_hash": sha(body.reset_token), "used": False, "expires_at": {"$gt": now()}},
        {"$set": {"used": True, "used_at": iso()}})
    if not rec:
        raise HTTPException(400, "Reset link invalid or expired")
    code = gen_recovery_code()
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_pw(body.password),
                                                                "recovery_hash": sha(code)}})
    await db.sessions.update_many({"user_id": rec["user_id"]}, {"$set": {"revoked": True}})
    await notify(rec["user_id"], "Password changed", "Your password was reset. All sessions were signed out.")
    await audit({"id": rec["user_id"], "role": "user"}, "user.password_reset", rec["user_id"], request=request)
    return {"ok": True, "recovery_code": code}


async def _change_pw(user: dict, body: ChangePwIn, request: Request):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_pw(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    validate_password(body.new_password)
    if body.new_password == body.current_password:
        raise HTTPException(400, "New password must differ")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(body.new_password),
                                                            "must_change_password": False}})
    await db.sessions.update_many({"user_id": user["id"], "id": {"$ne": user["session_id"]}}, {"$set": {"revoked": True}})
    await notify(user["id"], "Password changed", "Your password was changed successfully.")
    await audit(user, f"{user['role']}.password_change", user["id"], request=request)
    return {"ok": True}


@router.post("/auth/change-password")
async def change_pw(body: ChangePwIn, request: Request, user=Depends(current_user)):
    return await _change_pw(user, body, request)


@router.post("/verifier/auth/change-password")
async def verifier_change_pw(body: ChangePwIn, request: Request, user=Depends(current_verifier)):
    return await _change_pw(user, body, request)


# ---------- admin auth with mandatory TOTP ----------
async def verify_second_factor(user: dict, code: str, allow_backup=True) -> bool:
    code = code.strip().replace(" ", "")
    if user.get("totp_secret") and pyotp.TOTP(dec(user["totp_secret"])).verify(code, valid_window=1):
        return True
    if allow_backup:
        for i, bc in enumerate(user.get("backup_codes", [])):
            if not bc["used"] and secrets.compare_digest(bc["hash"], sha(code.upper())):
                res = await db.users.update_one({"id": user["id"], f"backup_codes.{i}.used": False},
                                                {"$set": {f"backup_codes.{i}.used": True, f"backup_codes.{i}.used_at": iso()}})
                return res.modified_count == 1
    return False


def new_backup_codes():
    codes = [f"{secrets.token_hex(3).upper()}-{secrets.token_hex(3).upper()}" for _ in range(10)]
    return codes, [{"hash": sha(c), "used": False} for c in codes]


async def reauth(admin: dict, password: str, code: str):
    full = await db.users.find_one({"id": admin["id"]})
    code = code.strip().replace(" ", "")
    if not verify_pw(password, full["password_hash"]) or not await verify_second_factor(full, code, allow_backup=False):
        await alert("security", f"Failed re-authentication for admin {admin['username']}")
        raise HTTPException(401, "Re-authentication failed")
    try:
        await db.used_totp.insert_one({"key": f"{admin['id']}:{code}", "at": now()})
    except Exception:
        raise HTTPException(401, "This code was already used. Wait for the next code.")


@router.post("/admin/auth/login")
async def admin_login(body: LoginIn, request: Request):
    user = await password_login(body, request, "admin")
    if user.get("mfa_enabled"):
        return {"mfa_required": True, "mfa_token": mfa_token(user["id"], "login")}
    secret = pyotp.random_base32()
    await db.users.update_one({"id": user["id"]}, {"$set": {"pending_totp": enc(secret)}})
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["username"], issuer_name="OddEven Admin")
    return {"mfa_setup_required": True, "mfa_token": mfa_token(user["id"], "setup"), "secret": secret,
            "qr": qr_data_url(uri)}


@router.post("/admin/auth/mfa")
async def admin_mfa(body: MfaIn, request: Request, response: Response):
    p = read_mfa_token(body.mfa_token)
    key = f"mfa:{p['sub']}"
    await check_rate(key, 5, 15)
    user = await db.users.find_one({"id": p["sub"], "role": "admin"})
    if not user:
        raise HTTPException(401, "Invalid")
    backup = None
    if p["purpose"] == "setup":
        ok = pyotp.TOTP(dec(user.get("pending_totp", ""))).verify(body.code.strip(), valid_window=1) if user.get("pending_totp") else False
        if ok:
            backup, hashes = new_backup_codes()
            await db.users.update_one({"id": user["id"]}, {"$set": {"totp_secret": user["pending_totp"], "mfa_enabled": True,
                                                                    "backup_codes": hashes}, "$unset": {"pending_totp": ""}})
    else:
        ok = await verify_second_factor(user, body.code)
    await db.login_history.insert_one({"id": uid(), "username": user["username"], "role": "admin", "stage": "mfa",
                                       "ip": client_ip(request), "ua": request.headers.get("user-agent", "")[:200],
                                       "success": ok, "created_at": iso()})
    if not ok:
        await hit_rate(key)
        await alert("security", f"Failed MFA attempt for admin {user['username']} from {client_ip(request)}")
        raise HTTPException(401, "Invalid verification code")
    await clear_rate(key)
    known = await db.login_history.count_documents({"username": user["username"], "role": "admin", "stage": "mfa",
                                                    "success": True, "ip": client_ip(request)})
    if known <= 1 and user.get("mfa_enabled"):
        await alert("security", f"Admin {user['username']} signed in from a new IP {client_ip(request)}")
    await create_session(response, user, request)
    await audit(user, "admin.login", user["id"], request=request)
    return {"user": public_user(user), "backup_codes": backup}


@router.get("/admin/auth/me")
async def admin_me(admin=Depends(current_admin)):
    return public_user(admin)


@router.post("/admin/auth/logout")
async def admin_logout(request: Request, response: Response, admin=Depends(current_admin)):
    return await _logout("admin", request, response, admin)


@router.get("/admin/security/overview")
async def security_overview(admin=Depends(current_admin)):
    full = await db.users.find_one({"id": admin["id"]})
    sessions = await db.sessions.find({"user_id": admin["id"], "revoked": False, "expires_at": {"$gt": now()}},
                                      {"_id": 0, "expires_at": 0}).sort("created_at", -1).to_list(50)
    for s in sessions:
        s["current"] = s["id"] == admin["session_id"]
    history = await db.login_history.find({"role": "admin"}, {"_id": 0}).sort("created_at", -1).to_list(50)
    suspicious = [h for h in history if not h["success"]]
    return {"mfa_enabled": full.get("mfa_enabled", False),
            "backup_codes_remaining": sum(1 for b in full.get("backup_codes", []) if not b["used"]),
            "sessions": sessions, "login_history": history, "suspicious": suspicious}


@router.post("/admin/security/backup-codes")
async def regen_backup(body: ReauthIn, request: Request, admin=Depends(current_admin)):
    await reauth(admin, body.password, body.code)
    codes, hashes = new_backup_codes()
    await db.users.update_one({"id": admin["id"]}, {"$set": {"backup_codes": hashes}})
    await audit(admin, "admin.backup_codes_regenerated", admin["id"], request=request)
    return {"backup_codes": codes}


@router.post("/admin/security/change-password")
async def admin_change_pw(body: AdminPwIn, request: Request, admin=Depends(current_admin)):
    await reauth(admin, body.current_password, body.code)
    validate_password(body.new_password)
    if len(body.new_password) < 12:
        raise HTTPException(400, "Admin password must be at least 12 characters")
    await db.users.update_one({"id": admin["id"]}, {"$set": {"password_hash": hash_pw(body.new_password)}})
    await db.sessions.update_many({"user_id": admin["id"], "id": {"$ne": admin["session_id"]}}, {"$set": {"revoked": True}})
    await audit(admin, "admin.password_change", admin["id"], request=request)
    return {"ok": True}


@router.post("/admin/security/mfa/rotate")
async def mfa_rotate(body: ReauthIn, admin=Depends(current_admin)):
    await reauth(admin, body.password, body.code)
    secret = pyotp.random_base32()
    await db.users.update_one({"id": admin["id"]}, {"$set": {"pending_totp": enc(secret)}})
    uri = pyotp.TOTP(secret).provisioning_uri(name=admin["username"], issuer_name="OddEven Admin")
    return {"secret": secret, "qr": qr_data_url(uri)}


@router.post("/admin/security/mfa/confirm")
async def mfa_confirm(body: CodeIn, request: Request, admin=Depends(current_admin)):
    full = await db.users.find_one({"id": admin["id"]})
    if not full.get("pending_totp") or not pyotp.TOTP(dec(full["pending_totp"])).verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Invalid code for new authenticator")
    await db.users.update_one({"id": admin["id"]}, {"$set": {"totp_secret": full["pending_totp"]}, "$unset": {"pending_totp": ""}})
    await audit(admin, "admin.mfa_rotated", admin["id"], request=request)
    return {"ok": True}


@router.post("/admin/security/sessions/revoke")
async def revoke_session(body: RevokeIn, request: Request, admin=Depends(current_admin)):
    await db.sessions.update_one({"id": body.session_id, "user_id": admin["id"]}, {"$set": {"revoked": True}})
    await audit(admin, "admin.session_revoked", body.session_id, request=request)
    return {"ok": True}


@router.post("/admin/security/sessions/revoke-others")
async def revoke_others(request: Request, admin=Depends(current_admin)):
    await db.sessions.update_many({"user_id": admin["id"], "id": {"$ne": admin["session_id"]}}, {"$set": {"revoked": True}})
    await audit(admin, "admin.sessions_revoked", admin["id"], request=request)
    return {"ok": True}
