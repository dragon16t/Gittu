# End-to-end regression tests for ODD/EVEN platform (auth, game, practice, deposits, referral, withdrawals,
# verifier portal, admin MFA/config/adjustments/commission/reports/reconcile). Tests run in file order.
import os
import time
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
S = {}  # shared state across ordered tests


def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    return s


def utr():
    return "TESTUTR" + secrets.token_hex(5).upper()


def admin_login():
    s = sess()
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    tok = r.json()["mfa_token"]
    r = s.post(f"{API}/admin/auth/mfa", json={"mfa_token": tok, "code": TOTP.now()})
    assert r.status_code == 200, r.text
    return s


def wait_betting(s, min_left=4):
    for _ in range(50):
        st = s.get(f"{API}/game/state").json()
        rnd = st.get("round")
        if rnd and rnd["status"] == "betting":
            from datetime import datetime
            left = (datetime.fromisoformat(rnd["closes_at"]) - datetime.fromisoformat(st["server_time"])).total_seconds()
            if left > min_left:
                return rnd
        time.sleep(1)
    pytest.fail("No betting round available")


# ---------- health / auth ----------
def test_health():
    assert requests.get(f"{API}/").json() == {"ok": True}


def test_register_users_and_validation():
    a = sess()
    S["a_name"] = "test_a" + secrets.token_hex(3)
    r = a.post(f"{API}/auth/register", json={"username": S["a_name"], "password": "Passw0rd!", "confirm_password": "Passw0rd!", "accept_terms": True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["username"] == S["a_name"] and len(d["recovery_code"]) == 19
    assert "sess_user" in a.cookies
    S["a"], S["a_recovery"], S["a_id"] = a, d["recovery_code"], d["user"]["id"]
    # duplicate + weak
    assert sess().post(f"{API}/auth/register", json={"username": S["a_name"], "password": "Passw0rd!",
                                                       "confirm_password": "Passw0rd!", "accept_terms": True}).status_code == 400
    assert sess().post(f"{API}/auth/register", json={"username": "test_weak" + secrets.token_hex(2), "password": "abc",
                                                       "confirm_password": "abc", "accept_terms": True}).status_code == 400
    assert sess().post(f"{API}/auth/register", json={"username": "test_bad" + secrets.token_hex(2), "password": "Passw0rd!",
                                                       "confirm_password": "Passw0rd!", "accept_terms": True, "referral_code": "ZZZZZZZ"}).status_code == 400
    code = a.get(f"{API}/referrals").json()["code"]
    b = sess()
    S["b_name"] = "test_b" + secrets.token_hex(3)
    r = b.post(f"{API}/auth/register", json={"username": S["b_name"], "password": "Passw0rd!", "confirm_password": "Passw0rd!", "accept_terms": True,
                                             "referral_code": code.lower()})
    assert r.status_code == 200, r.text
    S["b"], S["b_id"], S["b_recovery"] = b, r.json()["user"]["id"], r.json()["recovery_code"]
    refs = a.get(f"{API}/referrals").json()["referrals"]
    assert any(x["username"] == S["b_name"] for x in refs)


def test_login_logout_me():
    s = sess()
    r = s.post(f"{API}/auth/login", json={"username": S["a_name"].upper(), "password": "Passw0rd!"})
    assert r.status_code == 200
    assert s.get(f"{API}/auth/me").json()["username"] == S["a_name"]
    assert s.post(f"{API}/auth/logout").status_code == 200
    assert s.get(f"{API}/auth/me").status_code == 401
    assert sess().post(f"{API}/auth/login", json={"username": S["a_name"], "password": "Wrong123"}).status_code == 401


def test_daily_coupon_on_register_claim_once():
    a = S["a"]
    cps = a.get(f"{API}/coupons").json()
    daily = [c for c in cps if c["kind"] == "daily"]
    assert len(daily) == 1 and daily[0]["amount"] == 1000 and daily[0]["status"] == "available"
    r = a.post(f"{API}/coupons/{daily[0]['id']}/claim")
    assert r.status_code == 200, r.text
    assert r.json()["balance"] == 1000 and r.json()["wager_remaining"] == 3000
    assert a.post(f"{API}/coupons/{daily[0]['id']}/claim").status_code == 400
    assert a.get(f"{API}/wallet").json()["balance"] == 1000


# ---------- admin ----------
def test_admin_mfa_required_and_dashboard():
    s = sess()
    r = s.post(f"{API}/admin/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PW})
    assert r.json().get("mfa_required") is True and "sess_admin" not in s.cookies
    assert s.get(f"{API}/admin/dashboard").status_code == 401
    assert s.post(f"{API}/admin/auth/mfa", json={"mfa_token": r.json()["mfa_token"], "code": "000000"}).status_code == 401
    S["admin"] = admin_login()
    d = S["admin"].get(f"{API}/admin/dashboard")
    assert d.status_code == 200 and "wallet_liabilities" in d.json()
    assert len(d.json()["accounts"]) >= 1  # regression: dashboard accounts query used {"_id":0} as filter


def test_admin_config_history_pause_resume():
    ad = S["admin"]
    cfg = ad.get(f"{API}/admin/game").json()["config"]
    r = ad.put(f"{API}/admin/config", json={"min_stake": cfg["min_stake"], "practice_enabled": True})
    assert r.status_code == 200 and r.json()["min_stake"] == cfg["min_stake"]
    assert ad.put(f"{API}/admin/config", json={"mode": "bogus"}).status_code == 400
    assert ad.put(f"{API}/admin/config", json={"paused": True}).json()["paused"] is True
    hist = ad.get(f"{API}/admin/config/history").json()
    assert hist and hist[0]["changes"] == {"paused": True}  # only changed fields recorded
    assert ad.put(f"{API}/admin/config", json={"paused": False}).json()["paused"] is False


def test_verifier_offline_then_deposit_unavailable():
    pv = sess()
    r = pv.post(f"{API}/verifier/auth/login", json={"username": PV_USER, "password": PV_PW})
    assert r.status_code == 200, r.text
    S["pv"] = pv
    assert pv.post(f"{API}/verifier/online", json={"online": False}).json()["online"] is False
    r = S["a"].post(f"{API}/deposits/assign", json={"amount": 50000})
    assert r.status_code == 503 and "unavailable" in r.json()["detail"].lower()


def test_admin_create_verifier_forced_pw_change():
    ad = S["admin"]
    r = ad.post(f"{API}/admin/verifiers", json={"display_name": "TEST_Ver", "account_name": "TEST_Acc", "upi_id": "testver@okaxis",
                                                 "opening_funds": 100000})
    assert r.status_code == 200, r.text
    c = r.json()["credentials"]
    assert c["username"].startswith("pv") and len(c["temporary_password"]) >= 12
    S["v_id"], S["v_acc"] = r.json()["verifier"]["id"], r.json()["account"]["id"]
    v = sess()
    r = v.post(f"{API}/verifier/auth/login", json={"username": c["username"], "password": c["temporary_password"]})
    assert r.status_code == 200 and r.json()["user"]["must_change_password"] is True
    assert v.post(f"{API}/verifier/online", json={"online": True}).status_code == 400
    assert v.post(f"{API}/verifier/auth/change-password", json={"current_password": c["temporary_password"],
                                                                "new_password": "NewVerif123"}).status_code == 200
    assert v.post(f"{API}/verifier/online", json={"online": True}).json()["online"] is True
    S["v"] = v


# ---------- deposits / referral ----------
def _deposit(user_s, amount):
    r = user_s.post(f"{API}/deposits/assign", json={"amount": amount})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["upi_id"] == "testver@okaxis" and d["status"] == "initiated"
    u = utr()
    r = user_s.post(f"{API}/deposits/{d['id']}/submit", json={"utr": u})
    assert r.status_code == 200 and r.json()["status"] == "pending"
    return d["id"], u


def test_deposit_verify_once_and_dup_utr():
    b = S["b"]
    w0 = b.get(f"{API}/wallet").json()
    dep_id, u = _deposit(b, 50000)
    d2 = b.post(f"{API}/deposits/assign", json={"amount": 10000}).json()
    assert b.post(f"{API}/deposits/{d2['id']}/submit", json={"utr": u}).status_code == 400
    assert S["v"].post(f"{API}/verifier/deposits/{dep_id}/verify").status_code == 200
    assert S["v"].post(f"{API}/verifier/deposits/{dep_id}/verify").status_code == 400
    w1 = b.get(f"{API}/wallet").json()
    assert w1["balance"] - w0["balance"] == 50000
    assert w1["wager_remaining"] - w0["wager_remaining"] == 50000
    assert S["v"].post(f"{API}/verifier/deposits/{d2['id']}/reject", json={"reason": "TEST"}).status_code == 200


def test_referral_coupon_issued_and_claim_once():
    a = S["a"]
    cps = [c for c in a.get(f"{API}/coupons").json() if c["kind"] == "referral"]
    assert len(cps) == 1 and cps[0]["amount"] == 30000 and cps[0]["wager_multiplier"] == 5
    bal = a.get(f"{API}/wallet").json()["balance"]
    assert a.post(f"{API}/coupons/{cps[0]['id']}/claim").status_code == 200
    assert a.post(f"{API}/coupons/{cps[0]['id']}/claim").status_code == 400
    assert a.get(f"{API}/wallet").json()["balance"] == bal + 30000
    assert any(n["title"] == "New coupon" for n in a.get(f"{API}/notifications").json())


# ---------- withdrawals blocked ----------
def test_withdraw_validation_and_wager_block():
    b = S["b"]
    assert b.put(f"{API}/bank", json={"holder_name": "TEST B", "upi_id": "testb@okicici", "password": "wrong"}).status_code == 401
    assert b.put(f"{API}/bank", json={"holder_name": "TEST B", "upi_id": "testb@okicici", "password": "Passw0rd!"}).status_code == 200
    ck = lambda: str(uuid.uuid4())  # noqa: E731
    r = b.post(f"{API}/withdrawals", json={"amount": 20000, "upi_id": "testb@okicici", "client_key": ck()})
    assert r.status_code == 400 and "Minimum" in r.json()["detail"]
    r = b.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testb@okicici", "client_key": ck()})
    assert r.status_code == 400 and "wagering" in r.json()["detail"].lower()


# ---------- game ----------
def test_bet_idempotent_and_settles_195x():
    b = S["b"]
    rnd = wait_betting(b)
    bal0 = b.get(f"{API}/wallet").json()["balance"]
    key = str(uuid.uuid4())
    assert b.post(f"{API}/game/bet", json={"side": "SIDE", "amount": 50000, "client_key": key}).status_code == 400
    assert b.post(f"{API}/game/bet", json={"side": "ODD", "amount": 500, "client_key": key}).status_code == 400
    r = b.post(f"{API}/game/bet", json={"side": "ODD", "amount": 50000, "client_key": key})
    assert r.status_code == 200, r.text
    bet = r.json()["bet"]
    assert bet["round_id"] == rnd["id"] and r.json()["balance"] == bal0 - 50000
    r2 = b.post(f"{API}/game/bet", json={"side": "ODD", "amount": 50000, "client_key": key})
    assert r2.json()["duplicate"] is True and r2.json()["bet"]["id"] == bet["id"]
    assert b.get(f"{API}/wallet").json()["balance"] == bal0 - 50000
    assert b.get(f"{API}/wallet").json()["wager_remaining"] == 0
    for _ in range(45):
        mine = [x for x in b.get(f"{API}/game/my-bets").json() if x["id"] == bet["id"]][0]
        if mine["status"] != "accepted":
            break
        time.sleep(1)
    assert mine["status"] in ("won", "lost")
    bal1 = b.get(f"{API}/wallet").json()["balance"]
    if mine["status"] == "won":
        assert mine["payout"] == 97500 and bal1 == bal0 - 50000 + 97500
    else:
        assert bal1 == bal0 - 50000
    st = b.get(f"{API}/game/state").json()
    assert st["recent"] and st["recent"][0] in ("ODD", "EVEN")


def test_bet_rejected_after_close():
    b = S["b"]
    for _ in range(90):
        st = b.get(f"{API}/game/state").json()
        if st["round"] and st["round"]["status"] in ("closed", "revealing"):
            r = b.post(f"{API}/game/bet", json={"side": "EVEN", "amount": 1000, "client_key": str(uuid.uuid4())})
            assert r.status_code == 400 and "closed" in r.json()["detail"].lower()
            return
        time.sleep(0.5)
    pytest.skip("Could not catch closed window")


def test_practice_generate_no_wallet_change():
    a = S["a"]
    bal = a.get(f"{API}/wallet").json()["balance"]
    r = a.post(f"{API}/practice/generate")
    assert r.status_code == 200
    d = r.json()
    assert d["id"].startswith("PRV-") and len(d["results"]) == 10 and set(d["results"]) <= {"ODD", "EVEN"}
    assert a.get(f"{API}/practice/history").json()[0]["id"] == d["id"]
    assert a.get(f"{API}/wallet").json()["balance"] == bal
    assert any(p["id"] == d["id"] for p in S["admin"].get(f"{API}/admin/practice").json())


# ---------- admin adjustments ----------
def test_admin_adjust_requires_reauth_and_debit_limit():
    ad = S["admin"]
    url = f"{API}/admin/users/{S['b_id']}/adjust"
    assert ad.post(url, json={"amount": 100000, "action": "credit", "reason": "TEST", "password": ADMIN_PW, "code": "000000"}).status_code == 401
    r = ad.post(url, json={"amount": 100000, "action": "credit", "reason": "TEST credit", "password": ADMIN_PW, "code": TOTP.now()})
    assert r.status_code == 200, r.text
    bal = r.json()["balance"]
    r = ad.post(url, json={"amount": bal + 1, "action": "debit", "reason": "TEST debit", "password": ADMIN_PW, "code": TOTP.now()})
    assert r.status_code == 400
    det = ad.get(f"{API}/admin/users/{S['b_id']}").json()
    assert det["adjustments"][0]["amount"] == 100000 and det["wallet"]["balance"] == bal


# ---------- withdrawal lifecycle ----------
def test_withdrawal_full_lifecycle_and_offline_visibility():
    b, v = S["b"], S["v"]
    w0 = b.get(f"{API}/wallet").json()
    r = b.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testb@okicici", "client_key": str(uuid.uuid4())})
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    w1 = b.get(f"{API}/wallet").json()
    assert w1["balance"] == w0["balance"] - 30000 and w1["reserved"] == w0["reserved"] + 30000
    assert v.post(f"{API}/verifier/online", json={"online": False}).status_code == 200
    dash = v.get(f"{API}/verifier/dashboard").json()
    mine = [x for x in dash["withdrawals"] if x["id"] == wid]
    assert mine and mine[0]["destination"]["upi_id"] == "testb@okicici" and mine[0]["amount"] == 30000
    assert b.post(f"{API}/deposits/assign", json={"amount": 10000}).status_code == 503
    assert v.post(f"{API}/verifier/online", json={"online": True}).status_code == 200
    assert v.post(f"{API}/verifier/withdrawals/{wid}/complete").status_code == 400
    assert v.post(f"{API}/verifier/withdrawals/{wid}/approve").status_code == 200
    assert v.post(f"{API}/verifier/withdrawals/{wid}/processing", json={"reference": "x"}).status_code == 400
    assert v.post(f"{API}/verifier/withdrawals/{wid}/processing", json={"reference": "TESTREF123"}).status_code == 200
    assert v.post(f"{API}/verifier/withdrawals/{wid}/complete").status_code == 200
    assert v.post(f"{API}/verifier/withdrawals/{wid}/complete").status_code == 400
    w2 = b.get(f"{API}/wallet").json()
    assert w2["reserved"] == w0["reserved"] and w2["balance"] == w1["balance"]
    st = [x for x in b.get(f"{API}/withdrawals").json() if x["id"] == wid][0]
    assert st["status"] == "completed" and st["reference"] == "TESTREF123"


def test_withdrawal_insufficient_reassign_and_reject_refund():
    b, v = S["b"], S["v"]
    w0 = b.get(f"{API}/wallet").json()
    r = b.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testb@okicici", "client_key": str(uuid.uuid4())})
    wid = r.json()["id"]
    r = v.post(f"{API}/verifier/withdrawals/{wid}/insufficient")
    assert r.status_code == 200, r.text
    S["reassigned"] = r.json()["reassigned"]
    wd = [x for x in S["admin"].get(f"{API}/admin/withdrawals").json() if x["id"] == wid][0]
    assert wd["account_id"] != S["v_acc"]
    r = S["admin"].post(f"{API}/admin/withdrawals/{wid}/reject")
    assert r.status_code == 200
    w1 = b.get(f"{API}/wallet").json()
    assert w1["balance"] == w0["balance"] and w1["reserved"] == w0["reserved"]


def test_user_withdraw_blocked_by_wager_for_coupon_user():
    a = S["a"]
    assert a.put(f"{API}/bank", json={"holder_name": "TEST A", "upi_id": "testa@okicici", "password": "Passw0rd!"}).status_code == 200
    r = a.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testa@okicici", "client_key": str(uuid.uuid4())})
    assert r.status_code == 400 and "wagering" in r.json()["detail"].lower()


# ---------- suspend ----------
def test_suspend_reactivate():
    ad = S["admin"]
    assert ad.post(f"{API}/admin/users/{S['b_id']}/status", json={"status": "suspended"}).status_code == 200
    assert S["b"].get(f"{API}/wallet").status_code == 401
    assert sess().post(f"{API}/auth/login", json={"username": S["b_name"], "password": "Passw0rd!"}).status_code == 403
    assert ad.post(f"{API}/admin/users/{S['b_id']}/status", json={"status": "active"}).status_code == 200
    assert sess().post(f"{API}/auth/login", json={"username": S["b_name"], "password": "Passw0rd!"}).status_code == 200


# ---------- commission / reports / reconcile / audit ----------
def test_commission_release_limited():
    ad = S["admin"]
    summ = [x for x in ad.get(f"{API}/admin/verifiers").json() if x["id"] == S["v_id"]][0]["summary"]
    assert summ["accrued"] == 5000  # 10% of 500 deposit
    r = ad.post(f"{API}/admin/verifiers/{S['v_id']}/commission", json={"amount": summ["pending"] + 1, "type": "release",
                                                                       "account_id": S["v_acc"]})
    assert r.status_code == 400
    r = ad.post(f"{API}/admin/verifiers/{S['v_id']}/commission", json={"amount": 1000, "type": "release", "account_id": S["v_acc"]})
    assert r.status_code == 200 and r.json()["paid"] == 1000


def test_reports_csv_reconcile_audit():
    ad = S["admin"]
    r = ad.get(f"{API}/admin/reports", params={"type": "deposits", "user": S["b_name"], "status": "verified"})
    assert r.status_code == 200 and r.json()["count"] == 1 and r.json()["total_amount"] == 50000
    r = ad.get(f"{API}/admin/reports/export", params={"type": "ledger", "user": S["b_name"]})
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"] and "amount" in r.text.splitlines()[0]
    rec = ad.get(f"{API}/admin/reconcile").json()
    assert rec["discrepancies"] == [], rec
    acts = {x["action"] for x in ad.get(f"{API}/admin/audit").json()}
    assert {"wallet.manual_credit", "verifier.created", "deposit.verified", "withdrawal.completed", "config.updated"} <= acts


# ---------- forgot password ----------
def test_forgot_password_flow():
    a = S["a"]  # A has bank with only UPI (no account number) so last4 not required
    s = sess()
    assert s.post(f"{API}/auth/forgot/verify", json={"username": S["a_name"], "recovery_code": "0000-0000-0000-0000"}).status_code == 400
    r = s.post(f"{API}/auth/forgot/verify", json={"username": S["a_name"], "recovery_code": S["a_recovery"].lower()})
    assert r.status_code == 200, r.text
    tok = r.json()["reset_token"]
    r = s.post(f"{API}/auth/forgot/reset", json={"reset_token": tok, "password": "NewPassw0rd", "confirm_password": "NewPassw0rd"})
    assert r.status_code == 200 and r.json()["recovery_code"]
    assert a.get(f"{API}/auth/me").status_code == 401
    assert s.post(f"{API}/auth/forgot/reset", json={"reset_token": tok, "password": "NewPassw0rd2",
                                                     "confirm_password": "NewPassw0rd2"}).status_code == 400
    assert sess().post(f"{API}/auth/login", json={"username": S["a_name"], "password": "NewPassw0rd"}).status_code == 200


def test_forgot_requires_bank_last4():
    b = sess()
    b.post(f"{API}/auth/login", json={"username": S["b_name"], "password": "Passw0rd!"})
    # B has an open? no - ensure none in progress, then save bank account
    r = b.put(f"{API}/bank", json={"holder_name": "TEST B", "account_number": "123456789012", "ifsc": "SBIN0001234",
                                   "upi_id": "testb@okicici", "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    s = sess()
    assert s.post(f"{API}/auth/forgot/verify", json={"username": S["b_name"], "recovery_code": S["b_recovery"]}).status_code == 400
    assert s.post(f"{API}/auth/forgot/verify", json={"username": S["b_name"], "recovery_code": S["b_recovery"],
                                                      "bank_last4": "9012"}).status_code == 200
    S["b"] = b


# ---------- restore ----------
def test_zz_restore_pv1001_online():
    S["v"].post(f"{API}/verifier/online", json={"online": False})
    assert S["pv"].post(f"{API}/verifier/online", json={"online": True}).json()["online"] is True
