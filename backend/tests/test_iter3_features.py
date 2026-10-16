# Iteration 3: wager progress on /wallet, admin workload, live win feed in /game/state, ticket alerts (user + verifier poll).
# Tests run in file order and share state via S.
import os
import time
import uuid
import secrets
import pyotp
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_USER, ADMIN_PW = "admin", "Admin@8CwWbJV7AhEE"
TOTP = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
PV_USER, PV_PW = "pv1001", "Verifier@123"
S = {}


def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    return s


def utr():
    return "TESTUTR" + secrets.token_hex(5).upper()


def register():
    s = sess()
    name = "test_w" + secrets.token_hex(3)
    r = s.post(f"{API}/auth/register", json={"username": name, "password": "Passw0rd!", "confirm_password": "Passw0rd!",
                                             "accept_terms": True})
    assert r.status_code == 200, r.text
    return s, r.json()["user"]["id"], name


def bet_when_open(s, side, amount):
    for _ in range(40):
        st = s.get(f"{API}/game/state").json()
        if st["round"] and st["round"]["status"] == "betting":
            r = s.post(f"{API}/game/bet", json={"side": side, "amount": amount, "client_key": str(uuid.uuid4())})
            if r.status_code == 200:
                return r.json()
        time.sleep(1)
    raise AssertionError("could not place bet")


# ---- setup ----
def test_setup():
    a = sess()
    tok = a.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PW}).json()["mfa_token"]
    assert a.post(f"{API}/admin/auth/mfa", json={"mfa_token": tok, "code": TOTP.now()}).status_code == 200
    S["admin"] = a
    v = sess()
    assert v.post(f"{API}/verifier/auth/login", json={"username": PV_USER, "password": PV_PW}).status_code == 200
    assert v.post(f"{API}/verifier/online", json={"online": True}).status_code == 200
    S["v"] = v
    S["vid"] = v.get(f"{API}/verifier/dashboard").json()["verifier"]["id"]
    v.get(f"{API}/verifier/alerts/poll")  # drain
    S["u"], S["uid"], S["uname"] = register()
    S["u"].get(f"{API}/alerts/poll")


# ---- wallet wager fields ----
def test_wallet_wager_fields_after_deposit():
    u, v = S["u"], S["v"]
    w0 = u.get(f"{API}/wallet").json()
    for k in ("wager_required", "wager_done", "wager_remaining"):
        assert k in w0 and isinstance(w0[k], int), w0
    d = u.post(f"{API}/deposits/assign", json={"amount": 20000}).json()
    assert u.post(f"{API}/deposits/{d['id']}/submit", json={"utr": utr()}).status_code == 200
    assert v.post(f"{API}/verifier/deposits/{d['id']}/verify").status_code == 200
    w1 = u.get(f"{API}/wallet").json()
    assert w1["wager_required"] == w0["wager_required"] + 20000, (w0, w1)
    assert w1["wager_remaining"] == w0["wager_remaining"] + 20000
    assert w1["wager_done"] == w1["wager_required"] - w1["wager_remaining"]
    S["w1"] = w1


def test_wager_done_increases_after_bet():
    u = S["u"]
    bet_when_open(u, "ODD", 5000)
    w = u.get(f"{API}/wallet").json()
    assert w["wager_done"] == S["w1"]["wager_done"] + 5000, (S["w1"], w)
    assert w["wager_required"] == S["w1"]["wager_required"]
    S["w2"] = w


def test_wager_completion_resets():
    u = S["u"]
    rem = S["w2"]["wager_remaining"]
    bet_when_open(u, "EVEN", rem)
    w = u.get(f"{API}/wallet").json()
    assert w["wager_remaining"] == 0 and w["wager_done"] == w["wager_required"], w


# ---- live win feed ----
def test_game_state_winners_masked():
    st = S["u"].get(f"{API}/game/state").json()
    assert "winners" in st and isinstance(st["winners"], list)
    assert len(st["winners"]) <= 12
    for w in st["winners"]:
        assert "username" not in w and "user_id" not in w
        assert "***" in w["name"] and w["payout"] > 0 and w["side"] in ("ODD", "EVEN")


# ---- workload ----
def test_admin_workload():
    r = S["admin"].get(f"{API}/admin/workload")
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d["unassigned_tickets"], int) and isinstance(d["unassigned_withdrawals"], int)
    me = [a for a in d["agents"] if a["id"] == S["vid"]][0]
    assert me["online"] is True and me["username"] == PV_USER
    for k in ("open_tickets", "actioned_tickets", "pending_deposits", "open_withdrawals", "free_funds", "pending_deposit_amount"):
        assert isinstance(me[k], int), k
    S["wl0"] = me
    S["un0"] = d["unassigned_tickets"]
    assert sess().get(f"{API}/admin/workload").status_code == 401
    assert S["u"].get(f"{API}/admin/workload").status_code in (401, 403)


# ---- ticket alerts ----
def test_ticket_created_counts_unassigned():
    u = S["u"]
    t = u.post(f"{API}/tickets", json={"kind": "other", "message": "TEST alert flow ticket"}).json()
    S["t"] = t
    d = S["admin"].get(f"{API}/admin/workload").json()
    assert d["unassigned_tickets"] == S["un0"] + 1


def test_share_notifies_verifier_and_user():
    ad = S["admin"]
    r = ad.post(f"{API}/admin/tickets/{S['t']['id']}/assign", json={"verifier_id": S["vid"]})
    assert r.status_code == 200, r.text
    vp = S["v"].get(f"{API}/verifier/alerts/poll").json()
    assert any("New ticket" in n["title"] and S["t"]["number"] in n["title"] for n in vp), vp
    assert S["v"].get(f"{API}/verifier/alerts/poll").json() == []  # marked read
    up = S["u"].get(f"{API}/alerts/poll").json()
    assert any(S["t"]["number"] in n["title"] for n in up), up
    me = [a for a in ad.get(f"{API}/admin/workload").json()["agents"] if a["id"] == S["vid"]][0]
    assert me["open_tickets"] == S["wl0"]["open_tickets"] + 1


def test_admin_reply_notifies_user_and_agent():
    assert S["admin"].post(f"{API}/admin/tickets/{S['t']['id']}/note", json={"message": "TEST admin reply"}).status_code == 200
    up = S["u"].get(f"{API}/alerts/poll").json()
    assert any("Support update" in n["title"] and n["body"] == "TEST admin reply" for n in up), up
    assert S["u"].get(f"{API}/alerts/poll").json() == []
    vp = S["v"].get(f"{API}/verifier/alerts/poll").json()
    assert any("Admin replied" in n["title"] for n in vp), vp


def test_user_reply_notifies_agent_and_admin_alert():
    assert S["u"].post(f"{API}/tickets/{S['t']['id']}/reply", json={"message": "TEST user reply"}).status_code == 200
    vp = S["v"].get(f"{API}/verifier/alerts/poll").json()
    assert any("User replied" in n["title"] and n["body"] == "TEST user reply" for n in vp), vp
    al = S["admin"].get(f"{API}/admin/dashboard").json()
    rows = al["alerts"]
    assert any(S["t"]["number"] in a.get("message", "") and "replied" in a.get("message", "") for a in rows), str(al)[:300]


def test_resolve_notifies_both():
    assert S["admin"].post(f"{API}/admin/tickets/{S['t']['id']}/status", json={"message": "resolved"}).status_code == 200
    up = S["u"].get(f"{API}/alerts/poll").json()
    vp = S["v"].get(f"{API}/verifier/alerts/poll").json()
    assert any("resolved" in n["title"] for n in up), up
    assert any("resolved" in n["title"] for n in vp), vp
    assert S["u"].get(f"{API}/alerts/poll").json() == [] and S["v"].get(f"{API}/verifier/alerts/poll").json() == []
    S["admin"].post(f"{API}/admin/tickets/{S['t']['id']}/status", json={"message": "closed"})


def test_poll_auth():
    assert sess().get(f"{API}/alerts/poll").status_code == 401
    assert sess().get(f"{API}/verifier/alerts/poll").status_code == 401
    assert S["u"].get(f"{API}/verifier/alerts/poll").status_code in (401, 403)
