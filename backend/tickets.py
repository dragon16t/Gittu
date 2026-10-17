import re
import secrets

from fastapi import APIRouter, Request, Depends, HTTPException, UploadFile, File, Form, Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from core import invalidate_config, db, get_config, iso, uid, current_user, current_admin, current_verifier, audit, notify, alert, put_file, get_file
from routes_verifier import vprofile, do_verify_deposit, do_complete_withdrawal

router = APIRouter()
P = {"_id": 0}
OPEN = ["open", "assigned", "agent_actioned", "reopened"]


class TicketIn(BaseModel):
    kind: str
    ref_id: str = ""
    message: str


class NoteIn(BaseModel):
    message: str


class AssignIn(BaseModel):
    verifier_id: str = ""


class ApproveIn(BaseModel):
    note: str = ""
    utr: str = ""


def event(by: dict, typ: str, note: str = "", **extra) -> dict:
    return {"id": uid(), "at": iso(), "by": by.get("username"), "role": by.get("role"), "type": typ, "note": note, **extra}


async def push(tid: str, ev: dict, status: str = None, **fields):
    upd = {"$push": {"events": ev}, "$set": {"updated_at": iso(), **fields}}
    if status:
        upd["$set"]["status"] = status
    await db.tickets.update_one({"id": tid}, upd)


async def notify_agent(t: dict, title: str, body: str):
    if t.get("verifier_id"):
        v = await db.verifiers.find_one({"id": t["verifier_id"]}, {"_id": 0, "user_id": 1})
        if v:
            await notify(v["user_id"], title, body)


async def ref_doc(kind: str, ref_id: str):
    coll = {"deposit": "deposits", "withdrawal": "withdrawals"}.get(kind)
    return await db[coll].find_one({"id": ref_id}, {"_id": 0, "destination": 0}) if coll and ref_id else None


def public(t: dict, role: str) -> dict:
    out = dict(t)
    out["proof_count"] = len(t.get("proofs", []))
    out.pop("proofs", None)
    if role == "user":
        out["events"] = [e for e in t.get("events", []) if not e.get("internal")]
    return out


class BrandIn(BaseModel):
    name: str


@router.get("/branding")
async def branding():
    return {"name": (await get_config()).get("platform_name", "BLACKBA")}


@router.put("/admin/branding")
async def set_branding(body: BrandIn, request: Request, admin=Depends(current_admin)):
    name = re.sub(r"\s+", " ", body.name).strip()
    if not 2 <= len(name) <= 24 or not re.fullmatch(r"[\w .&'-]+", name):
        raise HTTPException(400, "Name must be 2-24 letters, numbers, spaces or . & ' -")
    before = (await get_config()).get("platform_name")
    await db.config.update_one({"id": "game"}, {"$set": {"platform_name": name}}, upsert=True)
    invalidate_config()
    await audit(admin, "config.platform_name", "game", {"from": before, "to": name}, request)
    return {"name": name}


# ---------- user ----------
@router.post("/tickets")
async def create_ticket(body: TicketIn, request: Request, user=Depends(current_user)):
    if body.kind not in ("deposit", "withdrawal", "other"):
        raise HTTPException(400, "Invalid ticket type")
    if len(body.message.strip()) < 5:
        raise HTTPException(400, "Describe the issue (min 5 characters)")
    ref = None
    if body.kind != "other":
        ref = await ref_doc(body.kind, body.ref_id)
        if not ref or ref["user_id"] != user["id"]:
            raise HTTPException(400, f"Select a valid {body.kind}")
        if await db.tickets.find_one({"ref_id": body.ref_id, "status": {"$in": OPEN}}):
            raise HTTPException(400, "A ticket for this transaction is already open")
    t = {"id": uid(), "number": f"TCK-{secrets.token_hex(3).upper()}", "user_id": user["id"], "username": user["username"],
         "kind": body.kind, "ref_id": body.ref_id or None, "ref_amount": ref["amount"] if ref else None,
         "ref_status": ref["status"] if ref else None, "ref_verifier_id": ref.get("verifier_id") if ref else None,
         "message": body.message.strip()[:1000], "status": "open", "verifier_id": None, "proofs": [],
         "events": [event(user, "created", body.message.strip()[:1000])], "created_at": iso(), "updated_at": iso()}
    try:
        await db.tickets.insert_one(dict(t))
    except DuplicateKeyError:
        raise HTTPException(400, "Please retry")
    await alert("ticket", f"New {body.kind} ticket {t['number']} from {user['username']}", t["id"])
    await audit(user, "ticket.created", t["id"], {"kind": body.kind, "ref_id": body.ref_id}, request)
    return public(t, "user")


@router.get("/tickets")
async def my_tickets(user=Depends(current_user)):
    rows = await db.tickets.find({"user_id": user["id"]}, P).sort("created_at", -1).to_list(100)
    return [public(t, "user") for t in rows]


@router.post("/tickets/{tid}/reply")
async def user_reply(tid: str, body: NoteIn, user=Depends(current_user)):
    t = await db.tickets.find_one({"id": tid, "user_id": user["id"]}, P)
    if not t or t["status"] == "closed":
        raise HTTPException(400, "Ticket not found or closed")
    await push(tid, event(user, "user_reply", body.message.strip()[:1000]))
    await notify_agent(t, f"User replied on {t['number']}", body.message.strip()[:200])
    await alert("ticket", f"{user['username']} replied on ticket {t['number']}", tid)
    return {"ok": True}


# ---------- admin ----------
@router.get("/admin/tickets")
async def admin_tickets(status: str = "", admin=Depends(current_admin)):
    q = {"status": {"$in": OPEN}} if status == "active" else ({"status": status} if status else {})
    rows = await db.tickets.find(q, P).sort("updated_at", -1).to_list(300)
    names = {v["id"]: v["display_name"] for v in await db.verifiers.find({}, {"_id": 0, "id": 1, "display_name": 1}).to_list(500)}
    out = []
    for t in rows:
        x = public(t, "admin")
        x["verifier_name"] = names.get(t.get("verifier_id"))
        x["ref_verifier_name"] = names.get(t.get("ref_verifier_id"))
        x["ref"] = await ref_doc(t["kind"], t.get("ref_id"))
        out.append(x)
    return out


@router.post("/admin/tickets/{tid}/assign")
async def admin_assign(tid: str, body: AssignIn, request: Request, admin=Depends(current_admin)):
    t = await db.tickets.find_one({"id": tid}, P)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["status"] in ("resolved", "closed"):
        raise HTTPException(400, "Reopen the ticket before sharing it")
    ref = await ref_doc(t["kind"], t.get("ref_id"))
    vid = body.verifier_id or (ref or {}).get("verifier_id")
    v = await db.verifiers.find_one({"id": vid, "status": "active"}, P) if vid else None
    if not v:
        raise HTTPException(400, "Select an agent to share this ticket with")
    await push(tid, event(admin, "assigned", f"Shared with {v['display_name']}", verifier_id=vid), "assigned", verifier_id=vid)
    await notify(v["user_id"], f"New ticket {t['number']}", f"{t['kind'].title()} ticket from {t['username']} was shared with you.")
    await notify(t["user_id"], f"Ticket {t['number']} update", "Your ticket was shared with the payment agent.")
    await audit(admin, "ticket.assigned", tid, {"verifier_id": vid}, request)
    return {"ok": True}


@router.post("/admin/tickets/{tid}/note")
async def admin_note(tid: str, body: NoteIn, admin=Depends(current_admin)):
    t = await db.tickets.find_one({"id": tid}, P)
    if not t or t["status"] == "closed":
        raise HTTPException(404, "Ticket not found or closed")
    await push(tid, event(admin, "admin_reply", body.message.strip()[:1000]))
    await notify_agent(t, f"Admin replied on {t['number']}", body.message.strip()[:200])
    await notify(t["user_id"], f"Support update {t['number']}", body.message.strip()[:200])
    return {"ok": True}


@router.post("/admin/tickets/{tid}/status")
async def admin_status(tid: str, body: NoteIn, request: Request, admin=Depends(current_admin)):
    action = body.message
    if action not in ("resolved", "reopened", "closed"):
        raise HTTPException(400, "Invalid action")
    t = await db.tickets.find_one({"id": tid}, P)
    if not t:
        raise HTTPException(404, "Ticket not found")
    await push(tid, event(admin, action, f"Ticket {action} by admin"), action,
               **({"resolved_at": iso()} if action == "resolved" else {}))
    await notify(t["user_id"], f"Ticket {t['number']} {action}", f"Your support ticket was {action}.")
    await notify_agent(t, f"Ticket {t['number']} {action}", f"Admin marked the ticket {action}.")
    await audit(admin, f"ticket.{action}", tid, request=request)
    return {"ok": True}


@router.get("/admin/workload")
async def workload(admin=Depends(current_admin)):
    out = []
    async for v in db.verifiers.find({}, P):
        vid = v["id"]
        dep = await db.deposits.aggregate([{"$match": {"verifier_id": vid, "status": "pending"}},
                                           {"$group": {"_id": None, "c": {"$sum": 1}, "s": {"$sum": "$amount"}}}]).to_list(1)
        wd = await db.withdrawals.aggregate([{"$match": {"verifier_id": vid, "status": {"$in": ["pending", "approved", "processing"]}}},
                                             {"$group": {"_id": None, "c": {"$sum": 1}, "s": {"$sum": "$amount"}}}]).to_list(1)
        accs = await db.payment_accounts.find({"verifier_id": vid}, {"_id": 0, "available_funds": 1, "committed": 1}).to_list(50)
        out.append({"id": vid, "display_name": v["display_name"], "username": v["username"], "online": v.get("online", False),
                    "status": v["status"], "deposit_capacity": v.get("deposit_capacity", 0),
                    "open_tickets": await db.tickets.count_documents({"verifier_id": vid, "status": {"$in": ["assigned", "reopened"]}}),
                    "actioned_tickets": await db.tickets.count_documents({"verifier_id": vid, "status": "agent_actioned"}),
                    "pending_deposits": dep[0]["c"] if dep else 0, "pending_deposit_amount": dep[0]["s"] if dep else 0,
                    "open_withdrawals": wd[0]["c"] if wd else 0, "open_withdrawal_amount": wd[0]["s"] if wd else 0,
                    "free_funds": sum(a["available_funds"] - a["committed"] for a in accs)})
    unassigned = await db.tickets.count_documents({"status": {"$in": ["open", "reopened"]}, "verifier_id": None})
    return {"agents": out, "unassigned_tickets": unassigned,
            "unassigned_withdrawals": await db.withdrawals.count_documents({"status": "pending", "account_id": None})}


@router.get("/admin/tickets/{tid}/proof/{idx}")
async def admin_proof(tid: str, idx: int, admin=Depends(current_admin)):
    t = await db.tickets.find_one({"id": tid}, P)
    if not t or idx >= len(t.get("proofs", [])):
        raise HTTPException(404, "Proof not found")
    data, ct = await get_file(t["proofs"][idx]["path"])
    return Response(content=data, media_type=ct)


# ---------- verifier ----------
async def my_ticket(tid: str, v: dict) -> dict:
    t = await db.tickets.find_one({"id": tid, "verifier_id": v["id"]}, P)
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["status"] in ("resolved", "closed"):
        raise HTTPException(400, "Ticket already resolved")
    return t


async def owned_ref(t: dict, v: dict) -> dict:
    ref = await db[{"deposit": "deposits", "withdrawal": "withdrawals"}[t["kind"]]].find_one({"id": t["ref_id"]}, P)
    if not ref or ref.get("verifier_id") != v["id"]:
        raise HTTPException(400, "This transaction is routed to another agent. Ask admin to reassign it first.")
    return ref


@router.get("/verifier/tickets")
async def verifier_tickets(user=Depends(current_verifier)):
    v = await vprofile(user)
    rows = await db.tickets.find({"verifier_id": v["id"]}, P).sort("updated_at", -1).to_list(200)
    out = []
    for t in rows:
        x = public(t, "verifier")
        x["ref"] = await ref_doc(t["kind"], t.get("ref_id"))
        if t["kind"] == "withdrawal" and x["ref"]:
            w = await db.withdrawals.find_one({"id": t["ref_id"]}, {"_id": 0, "destination.upi_id": 1, "destination.holder_name": 1})
            x["ref"]["destination"] = (w or {}).get("destination")
        out.append(x)
    return out


@router.post("/verifier/tickets/{tid}/note")
async def verifier_note(tid: str, body: NoteIn, user=Depends(current_verifier)):
    v = await vprofile(user)
    await my_ticket(tid, v)
    t = await db.tickets.find_one({"id": tid}, P)
    await push(tid, event(user, "agent_note", body.message.strip()[:1000]))
    await alert("ticket", f"Agent {user['username']} added a note on {t['number']}", tid)
    return {"ok": True}


@router.post("/verifier/tickets/{tid}/approve-deposit")
async def ticket_approve_deposit(tid: str, body: ApproveIn, request: Request, user=Depends(current_verifier)):
    v = await vprofile(user)
    t = await my_ticket(tid, v)
    if t["kind"] != "deposit":
        raise HTTPException(400, "Not a deposit ticket")
    if not v.get("perm_deposit"):
        raise HTTPException(403, "No deposit permission")
    d = await owned_ref(t, v)
    if not d.get("utr"):
        utr = body.utr.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{6,30}", utr):
            raise HTTPException(400, "Enter the UTR from your bank statement")
        if await db.deposits.find_one({"utr": utr}):
            raise HTTPException(400, "This UTR has already been submitted")
        try:
            await db.deposits.update_one({"id": d["id"]}, {"$set": {"utr": utr}})
        except DuplicateKeyError:
            raise HTTPException(400, "This UTR has already been submitted")
        d["utr"] = utr
    await do_verify_deposit(v, d, user, request, allowed=("initiated", "pending", "rejected"), note=f"ticket {t['number']}")
    await push(tid, event(user, "deposit_approved", body.note or "Payment confirmed and wallet credited"), "agent_actioned")
    await notify(t["user_id"], f"Ticket {t['number']} update", "Your deposit was approved and credited.")
    await alert("ticket", f"Agent approved deposit on {t['number']} — review and resolve", tid)
    return {"ok": True}


@router.post("/verifier/tickets/{tid}/process-withdrawal")
async def ticket_process_withdrawal(tid: str, request: Request, reference: str = Form(...), note: str = Form(""),
                                    file: UploadFile = File(...), user=Depends(current_verifier)):
    v = await vprofile(user)
    t = await my_ticket(tid, v)
    if t["kind"] != "withdrawal":
        raise HTTPException(400, "Not a withdrawal ticket")
    if not v.get("perm_withdraw"):
        raise HTTPException(403, "No withdrawal permission")
    w = await owned_ref(t, v)
    if w["status"] not in ("pending", "approved", "processing"):
        raise HTTPException(400, f"Withdrawal is already {w['status']}")
    ref = reference.strip().upper()
    if len(ref) < 6:
        raise HTTPException(400, "Enter the transfer reference / UTR")
    if file.content_type not in ("image/png", "image/jpeg", "image/webp", "application/pdf"):
        raise HTTPException(400, "Upload a PNG, JPG, WEBP or PDF")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 5MB)")
    path = await put_file("proofs", file.filename or "proof.png", data, file.content_type, user["id"])
    proof = {"path": path, "name": file.filename, "content_type": file.content_type, "by": user["username"], "at": iso()}
    await do_complete_withdrawal(v, w, user, request, frm=w["status"], extra={"reference": ref})
    await db.tickets.update_one({"id": tid}, {"$push": {"proofs": proof}})
    await db.withdrawals.update_one({"id": w["id"]}, {"$push": {"proofs": proof}})
    await push(tid, event(user, "withdrawal_processed", note or f"Transferred, reference {ref}", reference=ref), "agent_actioned")
    await notify(t["user_id"], f"Ticket {t['number']} update", f"Your withdrawal was processed. Reference {ref}.")
    await alert("ticket", f"Agent processed withdrawal on {t['number']} — proof uploaded", tid)
    return {"ok": True}
