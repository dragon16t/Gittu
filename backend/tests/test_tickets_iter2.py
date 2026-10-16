# Iteration 2 regression: T&C on register, support tickets (deposit approve / withdrawal proof), ticket ACLs,
# and iteration-1 fix regressions. Tests run in file order, sharing state via S.
import os
import io
import uuid
import secrets
import pyotp
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER, ADMIN_PW = "admin", "Admin@8CwWbJV7AhEE"
TOTP = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
PV_USER, PV_PW = "pv1001", "Verifier@123"
S = {}
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    return s


def utr():
    return "TESTUTR" + secrets.token_hex(5).upper()


def admin_login():
    s = sess()
    tok = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PW}).json()["mfa_token"]
    assert s.post(f"{API}/admin/auth/mfa", json={"mfa_token": tok, "code": TOTP.now()}).status_code == 200
    return s


def register(name=None):
    s = sess()
    name = name or "test_t" + secrets.token_hex(3)
    r = s.post(f"{API}/auth/register", json={"username": name, "password": "Passw0rd!", "confirm_password": "Passw0rd!",
                                             "accept_terms": True})
    assert r.status_code == 200, r.text
    return s, r.json()["user"]["id"], name


def tk(s, tid, path="admin/tickets"):
    return [t for t in s.get(f"{API}/{path}").json() if t["id"] == tid][0]


# ---- setup / terms ----
def test_setup_sessions():
    S["admin"] = admin_login()
    v = sess()
    assert v.post(f"{API}/verifier/auth/login", json={"username": PV_USER, "password": PV_PW}).status_code == 200
    assert v.post(f"{API}/verifier/online", json={"online": True}).status_code == 200
    S["v"] = v
    S["vid"] = v.get(f"{API}/verifier/dashboard").json()["verifier"]["id"]


def test_register_requires_terms():
    s = sess()
    r = s.post(f"{API}/auth/register", json={"username": "test_nt" + secrets.token_hex(3), "password": "Passw0rd!",
                                             "confirm_password": "Passw0rd!"})
    assert r.status_code == 400 and "Terms" in r.json()["detail"]
    r = s.post(f"{API}/auth/register", json={"username": "test_nt" + secrets.token_hex(3), "password": "Passw0rd!",
                                             "confirm_password": "Passw0rd!", "accept_terms": False})
    assert r.status_code == 400
    S["u"], S["u_id"], S["u_name"] = register()
    S["o"], S["o_id"], _ = register()


# ---- deposit ticket ----
def test_deposit_ticket_create_and_acl():
    u = S["u"]
    d = u.post(f"{API}/deposits/assign", json={"amount": 20000}).json()
    assert d["status"] == "initiated", d
    S["dep"] = d["id"]
    assert u.post(f"{API}/tickets", json={"kind": "deposit", "ref_id": d["id"], "message": "hi"}).status_code == 400  # short msg
    assert u.post(f"{API}/tickets", json={"kind": "bogus", "ref_id": d["id"], "message": "hello world"}).status_code == 400
    # another user can't ticket this deposit
    assert S["o"].post(f"{API}/tickets", json={"kind": "deposit", "ref_id": d["id"], "message": "not mine at all"}).status_code == 400
    r = u.post(f"{API}/tickets", json={"kind": "deposit", "ref_id": d["id"], "message": "TEST paid but not credited"})
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "open" and t["number"].startswith("TCK-") and t["ref_amount"] == 20000
    assert t["ref_verifier_id"] == S["vid"] and t["events"][0]["type"] == "created"
    S["dt"] = t["id"]
    # duplicate active ticket
    assert u.post(f"{API}/tickets", json={"kind": "deposit", "ref_id": d["id"], "message": "again please"}).status_code == 400
    assert any(x["id"] == t["id"] for x in u.get(f"{API}/tickets").json())


def test_admin_sees_and_assigns_deposit_ticket():
    ad = S["admin"]
    t = tk(ad, S["dt"])
    assert t["status"] == "open" and t["ref"]["id"] == S["dep"] and t["ref_verifier_name"] == "Ravi"
    assert any(x["id"] == S["dt"] for x in ad.get(f"{API}/admin/tickets?status=active").json())
    # verifier can't act before share
    assert S["v"].post(f"{API}/verifier/tickets/{S['dt']}/approve-deposit", json={"utr": utr()}).status_code == 404
    r = ad.post(f"{API}/admin/tickets/{S['dt']}/assign", json={})
    assert r.status_code == 200, r.text
    t = tk(ad, S["dt"])
    assert t["status"] == "assigned" and t["verifier_id"] == S["vid"]
    assert ad.post(f"{API}/admin/tickets/{S['dt']}/assign", json={"verifier_id": "nope"}).status_code == 400


def test_verifier_approves_deposit_once():
    v, u = S["v"], S["u"]
    vt = tk(v, S["dt"], "verifier/tickets")
    assert vt["ref"]["id"] == S["dep"]
    b0 = u.get(f"{API}/wallet").json()["balance"]
    S["dep_utr"] = utr()
    r = v.post(f"{API}/verifier/tickets/{S['dt']}/approve-deposit", json={"utr": S["dep_utr"], "note": "TEST ok"})
    assert r.status_code == 200, r.text
    assert u.get(f"{API}/wallet").json()["balance"] == b0 + 20000
    r = v.post(f"{API}/verifier/tickets/{S['dt']}/approve-deposit", json={"utr": ""})
    assert r.status_code == 400
    assert u.get(f"{API}/wallet").json()["balance"] == b0 + 20000
    dep = [d for d in u.get(f"{API}/deposits").json() if d["id"] == S["dep"]][0]
    assert dep["status"] == "verified"
    assert tk(S["admin"], S["dt"])["status"] == "agent_actioned"


def test_admin_reply_resolve_user_timeline():
    ad, u = S["admin"], S["u"]
    assert ad.post(f"{API}/admin/tickets/{S['dt']}/note", json={"message": "TEST credited, please check"}).status_code == 200
    assert ad.post(f"{API}/admin/tickets/{S['dt']}/status", json={"message": "bogus"}).status_code == 400
    assert ad.post(f"{API}/admin/tickets/{S['dt']}/status", json={"message": "resolved"}).status_code == 200
    t = tk(u, S["dt"], "tickets")
    types = [e["type"] for e in t["events"]]
    assert t["status"] == "resolved"
    assert {"created", "assigned", "deposit_approved", "admin_reply", "resolved"} <= set(types), types
    assert u.post(f"{API}/tickets/{S['dt']}/reply", json={"message": "TEST thanks"}).status_code == 200
    # resolved -> verifier can't act
    assert S["v"].post(f"{API}/verifier/tickets/{S['dt']}/note", json={"message": "x"}).status_code == 400
    # new ticket allowed now that previous is resolved
    r = u.post(f"{API}/tickets", json={"kind": "deposit", "ref_id": S["dep"], "message": "TEST second ticket ok"})
    assert r.status_code == 200
    assert ad.post(f"{API}/admin/tickets/{r.json()['id']}/status", json={"message": "closed"}).status_code == 200
    assert u.post(f"{API}/tickets/{r.json()['id']}/reply", json={"message": "closed reply"}).status_code == 400


def test_rejected_deposit_ticket_approve_with_dup_utr_handled():
    """Approve a rejected deposit via ticket; using a UTR already used elsewhere must give 400 not 500."""
    u, v, ad = S["u"], S["v"], S["admin"]
    d = u.post(f"{API}/deposits/assign", json={"amount": 10000}).json()
    assert u.post(f"{API}/deposits/{d['id']}/submit", json={"utr": utr()}).status_code == 200
    assert v.post(f"{API}/verifier/deposits/{d['id']}/reject", json={"reason": "TEST"}).status_code == 200
    t = u.post(f"{API}/tickets", json={"kind": "deposit", "ref_id": d["id"], "message": "TEST rejected wrongly"}).json()
    assert ad.post(f"{API}/admin/tickets/{t['id']}/assign", json={"verifier_id": S["vid"]}).status_code == 200
    r = v.post(f"{API}/verifier/tickets/{t['id']}/approve-deposit", json={"utr": S["dep_utr"]})
    S["dup_utr_status"] = r.status_code
    assert r.status_code == 400, f"duplicate UTR on ticket approve -> {r.status_code} {r.text[:200]}"


def test_admin_note_unknown_ticket():
    r = S["admin"].post(f"{API}/admin/tickets/does-not-exist/note", json={"message": "hello"})
    assert r.status_code == 404, f"{r.status_code} {r.text[:120]}"


# ---- withdrawal ticket ----
def test_withdrawal_ticket_proof_flow():
    ad, u, v = S["admin"], S["o"], S["v"]
    url = f"{API}/admin/users/{S['o_id']}/adjust"
    r = ad.post(url, json={"amount": 50000, "action": "credit", "reason": "TEST credit", "password": ADMIN_PW, "code": TOTP.now()})
    assert r.status_code == 200, r.text
    # clear daily coupon wager if any
    wal = u.get(f"{API}/wallet").json()
    assert wal["wager_remaining"] == 0, wal
    assert u.put(f"{API}/bank", json={"holder_name": "TEST O", "upi_id": "testo@okicici", "password": "Passw0rd!"}).status_code == 200
    ck = str(uuid.uuid4())
    r = u.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testo@okicici", "client_key": ck})
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    S["wid"] = wid
    # duplicate client_key returns same record, no double reserve
    r2 = u.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testo@okicici", "client_key": ck})
    assert r2.status_code == 200 and r2.json()["id"] == wid
    assert u.get(f"{API}/wallet").json()["reserved"] == 30000
    t = u.post(f"{API}/tickets", json={"kind": "withdrawal", "ref_id": wid, "message": "TEST not received"}).json()
    S["wt"] = t["id"]
    # deposit ticket kind mismatch with withdrawal id
    assert S["u"].post(f"{API}/tickets", json={"kind": "withdrawal", "ref_id": wid, "message": "someone else's"}).status_code == 400
    assert ad.post(f"{API}/admin/tickets/{t['id']}/assign", json={}).status_code == 200
    vt = tk(v, t["id"], "verifier/tickets")
    assert vt["ref"]["destination"]["upi_id"] == "testo@okicici"
    vh = {"Content-Type": None}
    p = f"{API}/verifier/tickets/{t['id']}/process-withdrawal"
    assert v.post(f"{p}", headers=vh, data={"reference": "x"}, files={"file": ("p.png", PNG, "image/png")}).status_code == 400
    assert v.post(p, headers=vh, data={"reference": "TESTREF999"}, files={"file": ("p.txt", b"hi", "text/plain")}).status_code == 400
    assert v.post(f"{API}/verifier/tickets/{t['id']}/approve-deposit", json={}).status_code == 400
    r = v.post(p, headers=vh, data={"reference": "TESTREF999", "note": "TEST paid"}, files={"file": ("p.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    w = [x for x in u.get(f"{API}/withdrawals").json() if x["id"] == wid][0]
    assert w["status"] == "completed" and w["reference"] == "TESTREF999"
    wal = u.get(f"{API}/wallet").json()
    assert wal["reserved"] == 0 and wal["balance"] == 20000, wal
    r = v.post(p, headers=vh, data={"reference": "TESTREF999"}, files={"file": ("p.png", PNG, "image/png")})
    assert r.status_code == 400
    at = tk(ad, t["id"])
    assert at["proof_count"] == 1 and at["status"] == "agent_actioned"
    img = ad.get(f"{API}/admin/tickets/{t['id']}/proof/0")
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"
    assert ad.get(f"{API}/admin/tickets/{t['id']}/proof/5").status_code == 404
    assert S["u"].get(f"{API}/admin/tickets/{t['id']}/proof/0").status_code in (401, 403)
    # user doesn't see raw proofs
    assert "proofs" not in tk(u, t["id"], "tickets")


def test_reopen_ticket():
    ad = S["admin"]
    assert ad.post(f"{API}/admin/tickets/{S['wt']}/status", json={"message": "resolved"}).status_code == 200
    assert ad.post(f"{API}/admin/tickets/{S['wt']}/status", json={"message": "reopened"}).status_code == 200
    assert tk(ad, S["wt"])["status"] == "reopened"
    assert ad.post(f"{API}/admin/tickets/{S['wt']}/status", json={"message": "closed"}).status_code == 200


def test_other_kind_ticket_and_unauth():
    r = S["u"].post(f"{API}/tickets", json={"kind": "other", "message": "TEST general question"})
    assert r.status_code == 200 and r.json()["ref_id"] is None
    assert S["admin"].post(f"{API}/admin/tickets/{r.json()['id']}/assign", json={}).status_code == 400
    S["admin"].post(f"{API}/admin/tickets/{r.json()['id']}/status", json={"message": "closed"})
    assert sess().get(f"{API}/admin/tickets").status_code == 401
    assert sess().get(f"{API}/verifier/tickets").status_code == 401


# ---- iteration-1 regressions ----
def test_deposit_cancel_marks_cancelled():
    u = S["u"]
    d = u.post(f"{API}/deposits/assign", json={"amount": 10000}).json()
    assert u.post(f"{API}/deposits/{d['id']}/cancel").status_code == 200
    assert [x for x in u.get(f"{API}/deposits").json() if x["id"] == d["id"]][0]["status"] == "cancelled"


def test_config_history_only_changed_fields():
    ad = S["admin"]
    cfg = ad.get(f"{API}/admin/game").json()["config"]
    n0 = len(ad.get(f"{API}/admin/config/history").json())
    body = {k: v for k, v in cfg.items() if k not in ("updated_at", "updated_by", "id", "_id")}
    r = ad.put(f"{API}/admin/config", json=body)
    assert r.status_code == 200, r.text
    assert len(ad.get(f"{API}/admin/config/history").json()) == n0  # unchanged save -> no history row


def test_zz_pv1001_online():
    assert S["v"].post(f"{API}/verifier/online", json={"online": True}).status_code == 200
