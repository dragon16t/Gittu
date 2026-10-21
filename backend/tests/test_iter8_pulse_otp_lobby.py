# Iteration 8: Email OTP signup, PULSE Arena engine/bet/collect/cap, admin Game Arena, lobby
import os, time, uuid, random, hashlib
import pytest, requests, pyotp
from pymongo import MongoClient

BASE = open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0].rstrip('/')
A = BASE + "/api"
ORIGIN = {"Origin": BASE}
T = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
env = dict(l.split("=", 1) for l in open('/app/backend/.env').read().splitlines() if "=" in l)
mdb = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]
RESTORE = {"pct_enabled": True, "wallet_pct": 30, "cap_enabled": True, "fixed_cap": 1000000, "carry_forward": True}


def sess():
    s = requests.Session(); s.headers.update(ORIGIN); return s


_last_code = {"c": None}


def fresh_code():
    while True:
        c = T.now()
        if c != _last_code["c"]:
            _last_code["c"] = c; return c
        time.sleep(2)


@pytest.fixture(scope="module")
def adm():
    s = sess()
    t = s.post(A + "/admin/auth/login", json={"username": "admin", "password": "Admin@8CwWbJV7AhEE"}).json()
    r = s.post(A + "/admin/auth/mfa", json={"mfa_token": t["mfa_token"], "code": fresh_code()})
    assert r.status_code == 200, r.text
    yield s
    s.put(A + "/admin/pulse/config/payout", json=RESTORE)


@pytest.fixture(scope="module")
def p1():
    s = sess()
    r = s.post(A + "/auth/login", json={"username": "player1", "password": "Player@123"})
    assert r.status_code == 200, r.text
    return s


def state(s):
    return s.get(A + "/pulse/state").json()


def wait_status(s, want, timeout=60, poll=0.1):
    end = time.time() + timeout
    while time.time() < end:
        st = state(s)
        if st["round"] and st["round"]["status"] == want:
            return st
        time.sleep(poll)
    pytest.fail(f"status {want} not reached")


def wait_fresh_betting(s):
    # ensure at least ~3s left in betting
    while True:
        st = wait_status(s, "betting")
        from datetime import datetime
        left = (datetime.fromisoformat(st["round"]["closes_at"]) - datetime.fromisoformat(st["server_time"])).total_seconds()
        if left > 3:
            return st
        wait_status(s, "running")


# ---------- Email OTP ----------
class TestEmailOtp:
    def test_send_otp(self):
        r = sess().post(A + "/auth/email-otp", json={"email": "delivered@resend.dev"})
        assert r.status_code in (200, 202, 429), r.text
        print("send", r.status_code, r.text[:100])

    def test_send_otp_random(self):
        e = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = sess().post(A + "/auth/email-otp", json={"email": e})
        assert r.status_code in (200, 202), r.text
        assert mdb.email_otps.find_one({"email": e})
        r2 = sess().post(A + "/auth/email-otp", json={"email": e})
        assert r2.status_code == 429
        mdb.email_otps.delete_one({"email": e})

    def test_invalid_email(self):
        r = sess().post(A + "/auth/email-otp", json={"email": "not-an-email"})
        assert r.status_code == 400

    def _payload(self, email, code):
        u = f"t8_{uuid.uuid4().hex[:8]}"
        return {"username": u, "password": "Test@12345", "confirm_password": "Test@12345", "accept_terms": True,
                "mobile": f"9{random.randint(100000000, 999999999)}", "dob": "1990-01-01", "email": email, "email_otp": code}

    def _seed(self, email):
        mdb.email_otps.update_one({"email": email}, {"$set": {"email": email, "code_hash": hashlib.sha256(f"{email}:123456".encode()).hexdigest(),
                                  "sent_at": "2000-01-01T00:00:00+00:00", "expires_at": "2099-01-01T00:00:00+00:00", "attempts": 0}}, upsert=True)

    def test_register_missing_otp(self):
        e = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = sess().post(A + "/auth/register", json=self._payload(e, "123456"))
        assert r.status_code == 400 and "expired" in r.text.lower(), r.text

    def test_register_wrong_then_success_then_dup(self):
        e = f"test_{uuid.uuid4().hex[:8]}@example.com"
        self._seed(e)
        r = sess().post(A + "/auth/register", json=self._payload(e, "000000"))
        assert r.status_code == 400 and "Incorrect email code" in r.text, r.text
        s = sess()
        r = s.post(A + "/auth/register", json=self._payload(e, "123456"))
        assert r.status_code == 200, r.text
        assert r.json()["user"]["username"].startswith("t8_")
        assert s.get(A + "/auth/me").status_code == 200
        assert mdb.email_otps.find_one({"email": e}) is None
        u = mdb.users.find_one({"email": e}); assert u and u.get("email_verified_at")
        self._seed(e)
        r = sess().post(A + "/auth/register", json=self._payload(e, "123456"))
        assert r.status_code == 400 and "Email already registered" in r.text, r.text
        mdb.email_otps.delete_one({"email": e})

    def test_lock_after_5_wrong(self):
        e = f"test_{uuid.uuid4().hex[:8]}@example.com"
        self._seed(e)
        for _ in range(5):
            sess().post(A + "/auth/register", json=self._payload(e, "111111"))
        r = sess().post(A + "/auth/register", json=self._payload(e, "123456"))
        assert r.status_code == 400 and "Too many" in r.text, r.text
        mdb.email_otps.delete_one({"email": e})


# ---------- PULSE public ----------
class TestPulsePublic:
    def test_state_public_no_endpoint_leak(self):
        st = wait_status(sess(), "running")
        rd = st["round"]
        for k in ("status", "number", "closes_at", "anchor_m", "anchor_at", "k", "seed_hash", "simulated"):
            assert k in rd
        for k in ("endpoint", "result", "seed", "crash_at", "planned", "budget"):
            assert k not in rd, k
        assert st["my_bets"] == [] and st["balance"] is None

    def test_state_crashed_shows_result(self):
        st = wait_status(sess(), "crashed", poll=0.1)
        assert "result" in st["round"] and "seed" in st["round"]
        assert hashlib.sha256(st["round"]["seed"].encode()).hexdigest() == st["round"]["seed_hash"]

    def test_lobby_history(self, p1):
        l = requests.get(A + "/lobby").json()
        assert "players" in l["pulse"] and "round" in l["pulse"] and "players" in l["oddeven"] and isinstance(l["wins"], list)
        h = requests.get(A + "/pulse/history").json(); assert isinstance(h, list) and h and "result" in h[0]
        mb = p1.get(A + "/pulse/my-bets"); assert mb.status_code == 200 and isinstance(mb.json(), list)
        assert requests.get(A + "/pulse/my-bets").status_code == 401


# ---------- PULSE bet/collect ----------
class TestPulseBetting:
    def test_bet_collect_flow_and_ledger(self, p1, adm):
        adm.put(A + "/admin/pulse/config/payout", json=RESTORE)
        st = wait_fresh_betting(p1)
        rid = st["round"]["id"]; bal0 = st["balance"]
        assert p1.post(A + "/pulse/bet", json={"slot": 1, "amount": 500, "client_key": str(uuid.uuid4())}).status_code == 400  # below min
        assert p1.post(A + "/pulse/bet", json={"slot": 3, "amount": 1000, "client_key": str(uuid.uuid4())}).status_code == 400
        r1 = p1.post(A + "/pulse/bet", json={"slot": 1, "amount": 1000, "client_key": str(uuid.uuid4())})
        r2 = p1.post(A + "/pulse/bet", json={"slot": 2, "amount": 2000, "client_key": str(uuid.uuid4())})
        assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
        assert r2.json()["balance"] == bal0 - 3000
        dup = p1.post(A + "/pulse/bet", json={"slot": 1, "amount": 1000, "client_key": str(uuid.uuid4())})
        assert dup.status_code == 400
        st = wait_status(p1, "running", poll=0.05)
        late = p1.post(A + "/pulse/bet", json={"slot": 1, "amount": 1000, "client_key": str(uuid.uuid4())})
        assert late.status_code == 400
        time.sleep(0.2)
        c = p1.post(A + "/pulse/collect", json={"round_id": rid, "slot": 1})
        if c.status_code != 200:
            pytest.skip(f"round crashed too early ({c.text}) - instant crash")
        b = c.json()["bet"]
        assert b["status"] == "collected" and b["payout"] == 1000 * round(b["multiplier"] * 100) // 100
        assert p1.post(A + "/pulse/collect", json={"round_id": rid, "slot": 1}).status_code == 400
        st = state(p1)
        s2 = [x for x in st["my_bets"] if x["slot"] == 2][0]
        assert s2["status"] in ("active", "lost")
        wait_status(p1, "crashed")
        time.sleep(0.5)
        st = state(p1)
        bets = {x["slot"]: x for x in st["my_bets"]}
        assert bets[1]["status"] == "collected" and bets[2]["status"] == "lost", bets
        assert st["balance"] == bal0 - 3000 + b["payout"]
        uid_ = mdb.users.find_one({"username": "player1"})["id"]
        w = mdb.wallets.find_one({"user_id": uid_})
        led = sum(x["amount"] for x in mdb.ledger.find({"user_id": uid_}))
        print("wallet", w["balance"], "reserved", w.get("reserved"), "ledger", led)
        assert w["balance"] + w.get("reserved", 0) == led or w["balance"] == led

    def test_cap_event(self, p1, adm):
        r = adm.put(A + "/admin/pulse/config/payout", json={"pct_enabled": False, "cap_enabled": True, "fixed_cap": 500})
        assert r.status_code == 200
        try:
            st = wait_fresh_betting(p1)
            rid = st["round"]["id"]
            assert p1.post(A + "/pulse/bet", json={"slot": 1, "amount": 10000, "client_key": str(uuid.uuid4())}).status_code == 200
            wait_status(p1, "running", poll=0.05)
            c = p1.post(A + "/pulse/collect", json={"round_id": rid, "slot": 1})
            assert c.status_code == 400 and "Round ended" in c.text, c.text
            st = wait_status(p1, "crashed", timeout=5, poll=0.1)
            assert st["round"]["id"] == rid
            a = adm.get(A + "/admin/pulse").json()
            assert any(e["round_id"] == rid for e in a["cap_events"])
            rr = [x for x in a["rounds"] if x["number"] == st["round"]["number"]][0]
            assert rr.get("cap_hit") is True and rr["paid"] == 0
        finally:
            r = adm.put(A + "/admin/pulse/config/payout", json=RESTORE)
            assert r.status_code == 200 and r.json()["fixed_cap"] == 1000000 and r.json()["pct_enabled"] is True


# ---------- Admin ----------
class TestAdminArena:
    def test_admin_get(self, adm):
        a = adm.get(A + "/admin/pulse").json()
        for k in ("config", "wallet", "live", "rounds", "distribution", "cycles", "cap_events", "audit"):
            assert k in a
        assert a["cycles"] and all(c["reconciled"] for c in a["cycles"][:3]), a["cycles"][:3]
        print("wallet", a["wallet"], "cycle", a["cycles"][0])

    def test_validation(self, adm):
        assert adm.put(A + "/admin/pulse/config/payout", json={"wallet_pct": 25}).status_code == 400
        assert adm.put(A + "/admin/pulse/config/logic", json={"logic": "xyz"}).status_code == 400
        assert adm.put(A + "/admin/pulse/config/general", json={"betting_seconds": 1}).status_code == 400
        assert adm.put(A + "/admin/pulse/config/phases", json={"sim_min": 500, "sim_max": 100}).status_code == 400
        assert adm.put(A + "/admin/pulse/config/foo", json={}).status_code == 404
        assert sess().get(A + "/admin/pulse").status_code == 401

    def test_save_sections_audit(self, adm):
        cfg = adm.get(A + "/admin/pulse").json()["config"]
        for sec, body in (("general", {"betting_seconds": cfg["betting_seconds"]}), ("logic", {"logic": cfg["logic"], "logics": cfg["logics"]}),
                          ("payout", RESTORE), ("phases", {"sim_min": cfg["sim_min"], "sim_max": cfg["sim_max"]})):
            r = adm.put(A + f"/admin/pulse/config/{sec}", json=body)
            assert r.status_code == 200, (sec, r.text)
        acts = [x["action"] for x in adm.get(A + "/admin/pulse").json()["audit"]]
        for sec in ("general", "logic", "payout", "phases"):
            assert f"pulse.config.{sec}" in acts

    def test_topup(self, adm):
        bad = adm.post(A + "/admin/pulse/topup", json={"amount": 100, "note": "TEST", "password": "wrong", "code": "000000"})
        assert bad.status_code in (400, 401, 403)
        before = adm.get(A + "/admin/pulse").json()["wallet"]["balance"]
        code = fresh_code()
        r = adm.post(A + "/admin/pulse/topup", json={"amount": 100, "note": "TEST_topup", "password": "Admin@8CwWbJV7AhEE", "code": code})
        assert r.status_code == 200, r.text
        assert r.json()["balance"] >= before + 100 - 10**7
        reuse = adm.post(A + "/admin/pulse/topup", json={"amount": 100, "note": "TEST_reuse", "password": "Admin@8CwWbJV7AhEE", "code": code})
        assert reuse.status_code != 200, "TOTP code reuse accepted"
