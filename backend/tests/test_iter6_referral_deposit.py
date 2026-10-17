# Iteration 6: referral end-to-end (auto-credited referral/welcome coupons), deposits/active, no double bonus.
import os
import random
import string
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
SUF = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
STATE = {}


def rnd_mobile():
    return random.choice("6789") + "".join(random.choices(string.digits, k=9))


def register(name, code=""):
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"username": name, "password": "Test@1234", "confirm_password": "Test@1234",
                                             "accept_terms": True, "mobile": rnd_mobile(), "dob": "1995-05-05",
                                             "referral_code": code})
    assert r.status_code == 200, r.text
    return s


def bal(s):
    r = s.get(f"{API}/game/state")
    assert r.status_code == 200, r.text
    return r.json()["balance"]


@pytest.fixture(scope="module")
def verifier():
    s = requests.Session()
    r = s.post(f"{API}/verifier/auth/login", json={"username": "pv1001", "password": "Verifier@123"})
    assert r.status_code == 200, r.text
    return s


def deposit(s, v, amount):
    r = s.post(f"{API}/deposits/assign", json={"amount": amount})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["amount"] == amount and d["status"] == "initiated"
    act = s.get(f"{API}/deposits/active").json()
    assert act and act["id"] == d["id"] and act["upi_id"]
    utr = "UTR" + "".join(random.choices(string.digits, k=10))
    r = s.post(f"{API}/deposits/{d['id']}/submit", json={"utr": utr})
    assert r.status_code == 200, r.text
    assert s.get(f"{API}/deposits/active").json() is None
    r = v.post(f"{API}/verifier/deposits/{d['id']}/verify")
    assert r.status_code == 200, r.text
    return d["id"]


class TestReferral:
    def test_01_register_pair(self):
        a = register(f"TEST_refA{SUF}")
        code = a.get(f"{API}/referrals").json()["code"]
        assert isinstance(code, str) and len(code) == 7
        b = register(f"TEST_refB{SUF}", code)
        STATE.update(a=a, b=b, code=code)
        ref = a.get(f"{API}/referrals").json()
        assert ref["rewards_earned"] == 0
        assert ref["referrals"][0]["username"] == f"TEST_refB{SUF}".lower()
        assert ref["rules"]["bonus"] == 30000 and ref["rules"]["friend_bonus"] == 15000

    def test_02_cancel_flow(self):
        b = STATE["b"]
        d = b.post(f"{API}/deposits/assign", json={"amount": 20000}).json()
        assert b.get(f"{API}/deposits/active").json()["id"] == d["id"]
        assert b.post(f"{API}/deposits/{d['id']}/cancel").status_code == 200
        assert b.get(f"{API}/deposits/active").json() is None

    def test_03_first_deposit_rewards(self, verifier):
        a, b = STATE["a"], STATE["b"]
        a0, b0 = bal(a), bal(b)
        deposit(b, verifier, 50000)
        assert bal(b) - b0 == 65000, f"friend delta {bal(b) - b0}"
        assert bal(a) - a0 == 30000, f"referrer delta {bal(a) - a0}"
        ca = [c for c in a.get(f"{API}/coupons").json() if c["kind"] == "referral"]
        cb = [c for c in b.get(f"{API}/coupons").json() if c["kind"] == "welcome"]
        assert len(ca) == 1 and ca[0]["amount"] == 30000 and ca[0]["status"] == "auto_credited"
        assert len(cb) == 1 and cb[0]["amount"] == 15000 and cb[0]["status"] == "auto_credited"
        ref = a.get(f"{API}/referrals").json()
        assert ref["rewards_earned"] == 30000
        assert ref["referrals"][0]["referral_rewarded"] is True

    def test_04_second_deposit_no_bonus(self, verifier):
        a, b = STATE["a"], STATE["b"]
        a0, b0 = bal(a), bal(b)
        deposit(b, verifier, 50000)
        assert bal(b) - b0 == 50000
        assert bal(a) - a0 == 0
        assert len([c for c in a.get(f"{API}/coupons").json() if c["kind"] == "referral"]) == 1
        assert len([c for c in b.get(f"{API}/coupons").json() if c["kind"] == "welcome"]) == 1
        assert a.get(f"{API}/referrals").json()["rewards_earned"] == 30000
