import re
import hmac
import hashlib
from difflib import SequenceMatcher
from typing import Optional

from fastapi import APIRouter, Request, Depends, HTTPException, UploadFile, File, Form, Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from core import (db, iso, uid, current_user, current_admin, audit, notify, alert, enc, dec, verify_pw, put_file, get_file,
                  JWT_SECRET)
from payments import OPEN_WITHDRAW
from routes_auth import issue_email_otp, consume_email_otp, mask_email

router = APIRouter()
P = {"_id": 0}
MAX_ACCOUNTS = 5
MAX_FILE = 5 * 1024 * 1024
IMG_TYPES = {"image/jpeg", "image/png", "image/webp"}
FILE_KINDS = ("aadhaar_front", "aadhaar_back", "pan")
TITLES = {"mr", "mrs", "ms", "miss", "shri", "smt", "kumari", "kum", "dr", "md", "mohd"}

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]


def verhoeff_ok(num: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def phash(kind: str, value: str) -> str:
    return hmac.new(JWT_SECRET.encode(), f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()


def tokens(name: str) -> list:
    return [t for t in re.sub(r"[^a-z ]", " ", (name or "").lower()).split() if t not in TITLES]


def names_match(a: str, b: str) -> bool:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    hit = sum(1 for t in small if any(t == x or (len(t) == 1 and x.startswith(t)) or (len(x) == 1 and t.startswith(x)) for x in big))
    if hit == len(small) and (len(small) >= 2 or len(big) == 1):
        return True
    return SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio() >= 0.88


def mask_aadhaar(last4: str) -> str:
    return f"XXXX-XXXX-{last4}" if last4 else ""


def kyc_public(k: dict) -> dict:
    if not k:
        return {"status": "none"}
    return {"status": k["status"], "aadhaar_name": k["aadhaar_name"], "pan_name": k.get("pan_name", ""),
            "aadhaar_masked": mask_aadhaar(k["aadhaar_last4"]), "pan_masked": ("XXXXXX" + k["pan_last4"]) if k.get("pan_last4") else "",
            "has_pan": bool(k.get("pan_path")), "reject_reason": k.get("reject_reason"), "submitted_at": k.get("submitted_at"),
            "reviewed_at": k.get("reviewed_at")}


def acct_public(a: dict, full=False) -> dict:
    num = dec(a.get("account_number_enc", ""))
    return {"id": a["id"], "kind": a["kind"], "holder_name": a["holder_name"], "ifsc": a.get("ifsc", ""),
            "upi_id": a.get("upi_id", ""), "account_number": num if full else (("XXXX" + num[-4:]) if num else ""),
            "status": a["status"], "name_match": a.get("name_match"), "reject_reason": a.get("reject_reason"),
            "created_at": a["created_at"]}


async def ensure_kyc_indexes():
    await db.kyc.create_index("user_id", unique=True)
    await db.kyc.create_index("aadhaar_hash", unique=True)
    await db.kyc.create_index("pan_hash", unique=True, partialFilterExpression={"pan_hash": {"$type": "string"}})
    await db.payout_accounts.create_index("user_id")
    await db.payout_accounts.create_index("dest_hash", unique=True)


async def kyc_verified(user_id: str) -> bool:
    return bool(await db.kyc.find_one({"user_id": user_id, "status": "verified"}, {"_id": 1}))


async def read_img(f: UploadFile, label: str) -> bytes:
    if (f.content_type or "") not in IMG_TYPES:
        raise HTTPException(400, f"{label}: upload a JPG, PNG or WEBP photo")
    data = await f.read()
    if not data or len(data) > MAX_FILE:
        raise HTTPException(400, f"{label}: photo must be under 5 MB")
    return data


# ---------- user ----------
@router.get("/kyc")
async def my_kyc(user=Depends(current_user)):
    k = await db.kyc.find_one({"user_id": user["id"]}, P)
    accts = await db.payout_accounts.find({"user_id": user["id"], "status": {"$ne": "removed"}}, P).sort("created_at", 1).to_list(20)
    return {**kyc_public(k), "accounts": [acct_public(a) for a in accts], "max_accounts": MAX_ACCOUNTS}


@router.post("/kyc")
async def submit_kyc(request: Request, aadhaar_name: str = Form(...), aadhaar_number: str = Form(...),
                     pan_name: str = Form(""), pan_number: str = Form(""), aadhaar_front: UploadFile = File(...),
                     aadhaar_back: UploadFile = File(...), pan: Optional[UploadFile] = File(None), user=Depends(current_user)):
    cur = await db.kyc.find_one({"user_id": user["id"]}, P)
    if cur and cur["status"] in ("pending", "verified"):
        raise HTTPException(400, "Your KYC is already " + ("under review" if cur["status"] == "pending" else "verified"))
    a_num = re.sub(r"\D", "", aadhaar_number)
    if not re.fullmatch(r"[2-9]\d{11}", a_num) or not verhoeff_ok(a_num):
        raise HTTPException(400, "Enter a valid 12-digit Aadhaar number")
    a_name = " ".join(aadhaar_name.split())
    if len(tokens(a_name)) < 1 or len(a_name) > 100:
        raise HTTPException(400, "Enter your full name exactly as printed on Aadhaar")
    p_num = pan_number.strip().upper()
    p_name = " ".join(pan_name.split())
    if p_num:
        if not re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", p_num):
            raise HTTPException(400, "Enter a valid PAN number (e.g. ABCDE1234F)")
        if not pan or not pan.filename:
            raise HTTPException(400, "Upload a photo of your PAN card")
        if not p_name:
            raise HTTPException(400, "Enter the name printed on your PAN card")
        if not names_match(a_name, p_name):
            raise HTTPException(400, "Name on PAN does not match the name on Aadhaar")
    a_hash, p_hash = phash("aadhaar", a_num), (phash("pan", p_num) if p_num else None)
    if await db.kyc.find_one({"aadhaar_hash": a_hash, "user_id": {"$ne": user["id"]}}, {"_id": 1}):
        await alert("fraud", f"Duplicate Aadhaar attempted by {user['username']}", user["id"])
        raise HTTPException(400, "This Aadhaar is already registered with another account")
    if p_hash and await db.kyc.find_one({"pan_hash": p_hash, "user_id": {"$ne": user["id"]}}, {"_id": 1}):
        await alert("fraud", f"Duplicate PAN attempted by {user['username']}", user["id"])
        raise HTTPException(400, "This PAN is already registered with another account")
    front = await read_img(aadhaar_front, "Aadhaar front")
    back = await read_img(aadhaar_back, "Aadhaar back")
    pan_data = await read_img(pan, "PAN card") if p_num else None
    folder = f"kyc/{user['id']}"
    paths = {"aadhaar_front_path": await put_file(folder, aadhaar_front.filename, front, aadhaar_front.content_type, user["id"]),
             "aadhaar_back_path": await put_file(folder, aadhaar_back.filename, back, aadhaar_back.content_type, user["id"]),
             "pan_path": await put_file(folder, pan.filename, pan_data, pan.content_type, user["id"]) if p_num else None}
    if cur:
        await db.kyc_archive.insert_one({**cur, "archive_id": uid(), "archived_at": iso()})
    doc = {"user_id": user["id"], "username": user["username"], "aadhaar_name": a_name, "aadhaar_enc": enc(a_num),
           "aadhaar_hash": a_hash, "aadhaar_last4": a_num[-4:], "pan_name": p_name if p_num else "",
           "pan_enc": enc(p_num), "pan_hash": p_hash, "pan_last4": p_num[-4:] if p_num else "", **paths,
           "status": "pending", "reject_reason": None, "submitted_at": iso(), "reviewed_at": None, "reviewed_by": None,
           "ip": request.headers.get("x-forwarded-for", "").split(",")[0].strip()}
    upd = {"$set": doc, "$setOnInsert": {"id": uid(), "created_at": iso()}}
    if not p_hash:
        doc.pop("pan_hash")
        upd["$unset"] = {"pan_hash": ""}
    try:
        await db.kyc.update_one({"user_id": user["id"]}, upd, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(400, "This Aadhaar / PAN is already registered with another account")
    await notify(user["id"], "KYC submitted", "Your Aadhaar details were submitted and are under review.")
    await audit(user, "kyc.submitted", user["id"], {"aadhaar_last4": a_num[-4:], "pan": bool(p_num)}, request)
    return kyc_public(await db.kyc.find_one({"user_id": user["id"]}, P))


@router.get("/kyc/file/{kind}")
async def my_kyc_file(kind: str, user=Depends(current_user)):
    return await kyc_file(user["id"], kind)


async def kyc_file(user_id: str, kind: str):
    if kind not in FILE_KINDS:
        raise HTTPException(404, "Not found")
    k = await db.kyc.find_one({"user_id": user_id}, P)
    if not k or not k.get(f"{kind}_path"):
        raise HTTPException(404, "Not found")
    data, ct = await get_file(k[f"{kind}_path"])
    return Response(content=data, media_type=ct, headers={"Cache-Control": "private, no-store"})


class AccountIn(BaseModel):
    kind: str
    holder_name: str
    account_number: str = ""
    ifsc: str = ""
    upi_id: str = ""
    password: str
    email_otp: str


@router.post("/payout-accounts/otp")
async def account_otp(request: Request, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, P)
    if not full.get("email"):
        raise HTTPException(400, "No email on your account. Contact support to add one.")
    await issue_email_otp(f"acct:{full['email']}", full["email"], request)
    return {"ok": True, "email": mask_email(full["email"])}


@router.post("/payout-accounts")
async def add_account(body: AccountIn, request: Request, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_pw(body.password, full["password_hash"]):
        raise HTTPException(401, "Password confirmation failed")
    if not full.get("email"):
        raise HTTPException(400, "No email on your account. Contact support to add one.")
    otp_key = f"acct:{full['email']}"
    await consume_email_otp(otp_key, body.email_otp)
    k = await db.kyc.find_one({"user_id": user["id"]}, P)
    if not k or k["status"] not in ("pending", "verified"):
        raise HTTPException(400, "Submit your Aadhaar KYC before adding withdrawal accounts")
    if await db.payout_accounts.count_documents({"user_id": user["id"], "status": {"$in": ["pending", "approved"]}}) >= MAX_ACCOUNTS:
        raise HTTPException(400, f"You can add up to {MAX_ACCOUNTS} withdrawal accounts")
    name = " ".join(body.holder_name.split())
    if not (names_match(name, k["aadhaar_name"]) or (k.get("pan_name") and names_match(name, k["pan_name"]))):
        raise HTTPException(400, "Account holder name must match the name on your Aadhaar or PAN card")
    if body.kind == "bank":
        acct, ifsc = re.sub(r"\s", "", body.account_number), body.ifsc.strip().upper()
        if not re.fullmatch(r"\d{9,18}", acct) or not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", ifsc):
            raise HTTPException(400, "Enter a valid account number and IFSC")
        dest, extra = phash("bank", acct), {"account_number_enc": enc(acct), "ifsc": ifsc, "upi_id": ""}
    elif body.kind == "upi":
        upi = body.upi_id.strip().lower()
        if not re.fullmatch(r"[\w.\-]{2,256}@[a-z]{2,64}", upi):
            raise HTTPException(400, "Enter a valid UPI ID")
        dest, extra = phash("upi", upi), {"account_number_enc": "", "ifsc": "", "upi_id": upi}
    else:
        raise HTTPException(400, "Choose bank account or UPI")
    ex = await db.payout_accounts.find_one({"dest_hash": dest}, P)
    if ex and ex["user_id"] != user["id"]:
        await alert("fraud", f"Duplicate payout account attempted by {user['username']}", user["id"])
        raise HTTPException(400, "This account is already linked to another user and cannot be added")
    if ex and ex["status"] != "removed":
        raise HTTPException(400, "This account is already added")
    doc = {"user_id": user["id"], "username": user["username"], "kind": body.kind, "holder_name": name, **extra,
           "dest_hash": dest, "name_match": True, "status": "pending", "reject_reason": None, "created_at": iso()}
    if ex:
        await db.payout_accounts.update_one({"id": ex["id"]}, {"$set": doc, "$push": {"history": {"at": iso(), "event": "re-added"}}})
        doc["id"] = ex["id"]
    else:
        doc["id"] = uid()
        try:
            await db.payout_accounts.insert_one(dict(doc, history=[{"at": iso(), "event": "added"}]))
        except DuplicateKeyError:
            raise HTTPException(400, "This account is already linked")
    await db.email_otps.delete_one({"email": otp_key})
    await notify(user["id"], "Withdrawal account added", "Your account was added and is awaiting admin verification.")
    await audit(user, "payout_account.added", doc["id"], {"kind": body.kind}, request)
    return acct_public(doc)


@router.delete("/payout-accounts/{acc_id}")
async def remove_account(acc_id: str, request: Request, user=Depends(current_user)):
    if await db.withdrawals.find_one({"user_id": user["id"], "destination.account_id": acc_id, "status": {"$in": OPEN_WITHDRAW}}):
        raise HTTPException(400, "This account has a withdrawal in progress")
    res = await db.payout_accounts.update_one({"id": acc_id, "user_id": user["id"], "status": {"$ne": "removed"}},
                                              {"$set": {"status": "removed"}, "$push": {"history": {"at": iso(), "event": "removed"}}})
    if not res.modified_count:
        raise HTTPException(404, "Account not found")
    await audit(user, "payout_account.removed", acc_id, request=request)
    return {"ok": True}


# ---------- admin ----------
class DecisionIn(BaseModel):
    approve: bool
    reason: str = ""


def kyc_admin_view(k: dict) -> dict:
    return {**kyc_public(k), "user_id": k["user_id"], "username": k.get("username"), "aadhaar_number": dec(k.get("aadhaar_enc", "")),
            "pan_number": dec(k.get("pan_enc", "")), "reviewed_by": k.get("reviewed_by"), "ip": k.get("ip")}


@router.get("/admin/kyc")
async def admin_kyc_list(status: str = "pending", q: str = "", admin=Depends(current_admin)):
    f = {"status": status} if status else {}
    if status == "pending":
        f = {"$or": [{"status": "pending"}, {"user_id": {"$in": await db.payout_accounts.distinct("user_id", {"status": "pending"})}}]}
    if q:
        f["username"] = {"$regex": re.escape(q), "$options": "i"}
    rows = await db.kyc.find(f, P).sort("submitted_at", -1).to_list(200)
    ids = [r["user_id"] for r in rows]
    accts = await db.payout_accounts.find({"user_id": {"$in": ids}, "status": {"$ne": "removed"}}, P).to_list(2000)
    by = {}
    for a in accts:
        by.setdefault(a["user_id"], []).append(acct_public(a, full=True))
    return [{**kyc_admin_view(r), "accounts": by.get(r["user_id"], [])} for r in rows]


@router.get("/admin/payout-accounts")
async def admin_pending_accounts(admin=Depends(current_admin)):
    rows = await db.payout_accounts.find({"status": "pending"}, P).sort("created_at", 1).to_list(500)
    kyc = {k["user_id"]: k for k in await db.kyc.find({"user_id": {"$in": [r["user_id"] for r in rows]}}, P).to_list(500)}
    return [{**acct_public(r, full=True), "user_id": r["user_id"], "username": r.get("username"),
             "kyc_status": kyc.get(r["user_id"], {}).get("status", "none"),
             "aadhaar_name": kyc.get(r["user_id"], {}).get("aadhaar_name"), "pan_name": kyc.get(r["user_id"], {}).get("pan_name")} for r in rows]


@router.get("/admin/kyc/{user_id}/file/{kind}")
async def admin_kyc_file(user_id: str, kind: str, admin=Depends(current_admin)):
    return await kyc_file(user_id, kind)


@router.post("/admin/kyc/{user_id}/decision")
async def admin_kyc_decision(user_id: str, body: DecisionIn, request: Request, admin=Depends(current_admin)):
    if not body.approve and not body.reason.strip():
        raise HTTPException(400, "Give a reason for rejection")
    status = "verified" if body.approve else "rejected"
    res = await db.kyc.update_one({"user_id": user_id, "status": {"$in": ["pending", "verified"]}}, {"$set": {
        "status": status, "reject_reason": None if body.approve else body.reason.strip()[:200], "reviewed_at": iso(),
        "reviewed_by": admin["username"]}})
    if not res.modified_count:
        raise HTTPException(400, "KYC is not awaiting review")
    k = await db.kyc.find_one({"user_id": user_id}, P)
    if body.approve:
        await db.users.update_one({"id": user_id}, {"$set": {"legal_name": k["aadhaar_name"], "kyc_verified": True}})
        await notify(user_id, "KYC verified", "Your Aadhaar is verified. You can now withdraw to your approved accounts.")
    else:
        await db.users.update_one({"id": user_id}, {"$set": {"kyc_verified": False}})
        await notify(user_id, "KYC rejected", f"Your KYC was rejected: {body.reason.strip()[:200]}. Please resubmit.")
    await audit(admin, f"kyc.{status}", user_id, {"reason": body.reason}, request)
    return {"ok": True, "status": status}


@router.post("/admin/payout-accounts/{acc_id}/decision")
async def admin_account_decision(acc_id: str, body: DecisionIn, request: Request, admin=Depends(current_admin)):
    if not body.approve and not body.reason.strip():
        raise HTTPException(400, "Give a reason for rejection")
    a = await db.payout_accounts.find_one({"id": acc_id, "status": {"$in": ["pending", "approved"]}}, P)
    if not a:
        raise HTTPException(400, "Account is not awaiting review")
    if body.approve and not await kyc_verified(a["user_id"]):
        raise HTTPException(400, "Verify the user's Aadhaar KYC first")
    status = "approved" if body.approve else "rejected"
    await db.payout_accounts.update_one({"id": acc_id}, {"$set": {"status": status, "reject_reason": None if body.approve else body.reason.strip()[:200],
                                                                  "reviewed_by": admin["username"], "reviewed_at": iso()},
                                                         "$push": {"history": {"at": iso(), "event": status, "by": admin["username"]}}})
    await notify(a["user_id"], f"Withdrawal account {status}",
                 f"Your {a['kind'].upper()} account ending {(a.get('upi_id') or dec(a.get('account_number_enc', '')))[-4:]} was {status}.")
    await audit(admin, f"payout_account.{status}", acc_id, {"reason": body.reason}, request)
    return {"ok": True, "status": status}


async def kyc_badges(user_ids: list) -> dict:
    rows = await db.kyc.find({"user_id": {"$in": list(set(user_ids))}}, P).to_list(1000)
    return {k["user_id"]: {"status": k["status"], "name": k["aadhaar_name"], "aadhaar_masked": mask_aadhaar(k["aadhaar_last4"]),
                           "pan": bool(k.get("pan_path"))} for k in rows}
