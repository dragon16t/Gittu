# Iteration 4: end-to-end wallet money math (deposit, coupons, wagering, bets, settlement, admin adjust,
# withdrawals complete/reject, ledger filters, reconcile) + concurrency on bets.
import os
import time
import uuid
import concurrent.futures as cf

import pyotp
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
B = BASE + "/api"
H = {"Origin": BASE}
ADMIN_PW = "Admin@8CwWbJV7AhEE"
TOTP = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
PW = "Audit@1234"
S = {}  # shared state across ordered tests


def sess():
    s = requests.Session()
    s.headers.update(H)
    return s


def W():
    return S["u"].get(B + "/wallet").json()


def bet(side, amount, key=None, tries=40):
    """Place a bet, waiting for an open betting window."""
    key = key or str(uuid.uuid4())
    for _ in range(tries):
        r = S["u"].post(B + "/game/bet", json={"side": side, "amount": amount, "client_key": key})
        if r.status_code == 400 and "closed" in r.text.lower():
            time.sleep(1)
            continue
        return r
    return r


def wait_betting_open(min_left=8):
    from datetime import datetime
    for _ in range(60):
        st = S["u"].get(B + "/game/state").json()
        r = st.get("round")
        if r and r["status"] == "betting":
            left = (datetime.fromisoformat(r["closes_at"]) - datetime.fromisoformat(st["server_time"])).total_seconds()
            if left >= min_left:
                return
        time.sleep(1)


def adjust(action, amount):
    return S["a"].post(B + f"/admin/users/{S['uid']}/adjust", json={
        "amount": amount, "action": action, "reason": "TEST_iter4", "password": ADMIN_PW, "code": TOTP.now()})


@pytest.fixture(scope="module", autouse=True)
def setup():
    a = sess()
    r = a.post(B + "/admin/auth/login", json={"username": "admin", "password": ADMIN_PW}).json()
    a.post(B + "/admin/auth/mfa", json={"mfa_token": r["mfa_token"], "code": TOTP.now()})
    v = sess()
    v.post(B + "/verifier/auth/login", json={"username": "pv1001", "password": "Verifier@123"})
    assert v.post(B + "/verifier/online", json={"online": True}).status_code == 200
    u = sess()
    un = "t4" + uuid.uuid4().hex[:8]
    mob = "9" + str(uuid.uuid4().int)[:9]
    r = u.post(B + "/auth/register", json={"username": un, "password": PW, "confirm_password": PW, "accept_terms": True,
                                           "mobile": mob, "dob": "1990-01-01"})
    assert r.status_code == 200, r.text
    S.update(a=a, v=v, u=u, un=un, deposits=0, bonuses=0, credits=0, debits=0, withdrawn=0)
    S["uid"] = a.get(B + "/admin/users", params={"q": un}).json()[0]["id"]
    yield


class TestMoneyFlow:
    def test_01_deposit_pending_then_verified(self):
        u, v = S["u"], S["v"]
        assert W()["balance"] == 0
        d = u.post(B + "/deposits/assign", json={"amount": 100000})
        assert d.status_code == 200, d.text
        did = d.json()["id"]
        assert u.post(B + f"/deposits/{did}/submit", json={"utr": "T4" + uuid.uuid4().hex[:10].upper()}).status_code == 200
        assert W()["pending_deposits"] == 100000
        r1 = v.post(B + f"/verifier/deposits/{did}/verify")
        assert r1.status_code == 200, r1.text
        r2 = v.post(B + f"/verifier/deposits/{did}/verify")
        assert r2.status_code == 400
        w = W()
        S["deposits"] = 100000
        assert w["balance"] == 100000 and w["pending_deposits"] == 0
        assert w["total_deposits"] == 100000 and w["wager_required"] == 100000 and w["wager_remaining"] == 100000

    def test_02_daily_coupon(self):
        u = S["u"]
        av = [c for c in u.get(B + "/coupons").json() if c["status"] == "available"]
        if not av:
            pytest.skip("no daily coupon issued yet (bonus loop every 5 min)")
        before = W()
        for c in av:
            assert u.post(B + f"/coupons/{c['id']}/claim").status_code == 200
            assert u.post(B + f"/coupons/{c['id']}/claim").status_code == 400
            S["bonuses"] += c["amount"]
        w = W()
        assert w["balance"] == before["balance"] + S["bonuses"]
        exp_wager = sum(c["amount"] * c["wager_multiplier"] for c in av)
        assert w["wager_remaining"] == before["wager_remaining"] + exp_wager
        assert w["wager_done"] == w["wager_required"] - w["wager_remaining"]

    def test_03_withdraw_blocked_while_wagering(self):
        r = S["u"].post(B + "/withdrawals", json={"amount": 30000, "upi_id": "ab@upi", "client_key": str(uuid.uuid4())})
        assert r.status_code == 400 and "wagering" in r.json()["detail"].lower()

    def test_04_same_key_parallel_debits_once(self):
        wait_betting_open()
        b0 = W()["balance"]
        key = str(uuid.uuid4())
        with cf.ThreadPoolExecutor(8) as ex:
            codes = list(ex.map(lambda _: S["u"].post(B + "/game/bet", json={"side": "ODD", "amount": 10000, "client_key": key}).status_code, range(8)))
        assert all(c == 200 for c in codes), codes
        assert W()["balance"] == b0 - 10000
        bets = [b for b in S["u"].get(B + "/game/my-bets").json() if b["client_key"] == key]
        assert len(bets) == 1

    def test_05_many_parallel_bets_never_negative(self):
        wait_betting_open(min_left=10)
        b0 = W()["balance"]
        with cf.ThreadPoolExecutor(25) as ex:
            res = list(ex.map(lambda i: S["u"].post(B + "/game/bet", json={"side": "EVEN" if i % 2 else "ODD", "amount": 5000,
                                                                            "client_key": str(uuid.uuid4())}), range(30)))
        ok = sum(1 for r in res if r.status_code == 200)
        w = W()
        print("parallel ok", ok, {r.json().get("detail") for r in res if r.status_code != 200})
        assert w["balance"] >= 0
        assert w["balance"] == b0 - ok * 5000
        assert ok == min(30, b0 // 5000)

    def test_06_admin_credit_debit(self):
        b0 = W()["balance"]
        r = adjust("credit", 80000)
        assert r.status_code == 200, r.text
        S["credits"] += 80000
        assert W()["balance"] == b0 + 80000
        r = adjust("debit", 999999999)
        assert r.status_code == 400
        assert W()["balance"] == b0 + 80000
        time.sleep(1)
        r = adjust("debit", 1000)
        assert r.status_code == 200, r.text
        S["debits"] += 1000
        assert W()["balance"] == b0 + 79000
        bad = S["a"].post(B + f"/admin/users/{S['uid']}/adjust", json={"amount": 100, "action": "credit", "reason": "TEST_x",
                                                                       "password": ADMIN_PW, "code": "000000"})
        assert bad.status_code == 401

    def test_07_clear_wagering_and_settle(self):
        rem = W()["wager_remaining"]
        if rem > 0:
            r = bet("ODD", max(rem, 1000))
            assert r.status_code == 200, r.text
        assert W()["wager_remaining"] == 0
        # wait for all bets to settle
        for _ in range(60):
            bets = S["u"].get(B + "/game/my-bets").json()
            if all(b["status"] in ("won", "lost") for b in bets):
                break
            time.sleep(2)
        bets = S["u"].get(B + "/game/my-bets").json()
        assert all(b["status"] in ("won", "lost") for b in bets), {b["status"] for b in bets}
        stakes = sum(b["amount"] for b in bets)
        pays = sum(b.get("payout", 0) for b in bets if b["status"] == "won")
        for b in bets:
            if b["status"] == "won":
                assert b["payout"] == b["amount"] * 195 // 100
        exp = S["deposits"] + S["bonuses"] - stakes + pays + S["credits"] - S["debits"]
        w = W()
        assert w["balance"] == exp, (w["balance"], exp)
        assert w["total_winnings"] == pays
        if w["balance"] < 60000:
            assert adjust("credit", 60000 - w["balance"]).status_code == 200
            S["credits"] += 60000 - w["balance"]

    def test_08_bank_save(self):
        u = S["u"]
        r = u.put(B + "/bank", json={"holder_name": "Test User", "upi_id": "t4user@upi", "password": "wrong1234"})
        assert r.status_code == 401
        r = u.put(B + "/bank", json={"holder_name": "Test User", "upi_id": "t4user@upi", "password": PW})
        assert r.status_code == 200, r.text
        assert u.get(B + "/bank").json()["upi_id"] == "t4user@upi"
        r = u.post(B + "/withdrawals", json={"amount": 30000, "upi_id": "other@upi", "client_key": str(uuid.uuid4())})
        assert r.status_code == 400
        r = u.post(B + "/withdrawals", json={"amount": 29900, "upi_id": "t4user@upi", "client_key": str(uuid.uuid4())})
        assert r.status_code == 400

    def _ensure_pv1001(self, wid):
        for _ in range(6):
            dash = S["v"].get(B + "/verifier/dashboard").json()
            if any(x["id"] == wid for x in dash["withdrawals"]):
                return True
            S["a"].post(B + f"/admin/withdrawals/{wid}/reassign")
        return False

    def test_09_withdraw_complete(self):
        u, v = S["u"], S["v"]
        b0 = W()
        r = u.post(B + "/withdrawals", json={"amount": 30000, "upi_id": "t4user@upi", "client_key": str(uuid.uuid4())})
        assert r.status_code == 200, r.text
        wid = r.json()["id"]
        w = W()
        assert w["balance"] == b0["balance"] - 30000
        assert w["reserved"] == b0["reserved"] + 30000
        assert w["pending_withdrawals"] == 30000
        if not self._ensure_pv1001(wid):
            pytest.skip("withdrawal not assignable to pv1001")
        assert v.post(B + f"/verifier/withdrawals/{wid}/approve").status_code == 200
        assert v.post(B + f"/verifier/withdrawals/{wid}/processing", json={"reference": "T4REF" + uuid.uuid4().hex[:6]}).status_code == 200
        assert v.post(B + f"/verifier/withdrawals/{wid}/complete").status_code == 200
        assert v.post(B + f"/verifier/withdrawals/{wid}/complete").status_code == 400
        w = W()
        assert w["reserved"] == 0 and w["pending_withdrawals"] == 0
        assert w["total_withdrawals"] == 30000
        assert w["balance"] == b0["balance"] - 30000
        S["withdrawn"] += 30000
        led = u.get(B + "/wallet/ledger", params={"type": "withdraw_reserve,withdraw_complete,withdraw_refund"}).json()
        types = [x["type"] for x in led]
        assert "withdraw_reserve" in types and "withdraw_complete" in types
        comp = [x for x in led if x["type"] == "withdraw_complete"][0]
        assert comp["amount"] == 0 and comp["reserved_change"] == -30000

    def test_10_withdraw_reject_refunds_once(self):
        u, v = S["u"], S["v"]
        b0 = W()["balance"]
        r = u.post(B + "/withdrawals", json={"amount": 30000, "upi_id": "t4user@upi", "client_key": str(uuid.uuid4())})
        assert r.status_code == 200, r.text
        wid = r.json()["id"]
        assert W()["balance"] == b0 - 30000
        if self._ensure_pv1001(wid):
            assert v.post(B + f"/verifier/withdrawals/{wid}/reject", json={"reason": "TEST reject"}).status_code == 200
            assert v.post(B + f"/verifier/withdrawals/{wid}/reject", json={"reason": "TEST reject"}).status_code == 400
        else:
            assert S["a"].post(B + f"/admin/withdrawals/{wid}/reject").status_code == 200
        S["a"].post(B + f"/admin/withdrawals/{wid}/reject")
        w = W()
        assert w["balance"] == b0 and w["reserved"] == 0
        led = u.get(B + "/wallet/ledger", params={"type": "withdraw_refund"}).json()
        assert len([x for x in led if x["meta"].get("withdrawal_id") == wid]) == 1

    def test_11_adjust_ledger_and_reconcile(self):
        led = S["u"].get(B + "/wallet/ledger", params={"type": "manual_credit,manual_debit"}).json()
        assert {x["type"] for x in led} == {"manual_credit", "manual_debit"}
        full = S["u"].get(B + "/wallet/ledger").json()
        assert all("balance_after" in x for x in full if x["amount"] != 0)
        assert sum(x["amount"] for x in full) == W()["balance"]
        disc = S["a"].get(B + "/admin/reconcile").json()["discrepancies"]
        assert not [d for d in disc if d["user_id"] == S["uid"]]
        print("global discrepancies", disc)
