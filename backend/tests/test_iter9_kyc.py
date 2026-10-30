# Iteration 9: Withdrawal KYC (Aadhaar/PAN), payout accounts, admin review, verifier KYC gating, withdrawal regression.
import io
import os
import hashlib
from pymongo import MongoClient
import random
import string
import pytest
import pyotp
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TOTP = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A")
S = {}

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def aadhaar():
    base = str(random.randint(2, 9)) + "".join(str(random.randint(0, 9)) for _ in range(10))
    c = 0
    for i, ch in enumerate(reversed(base)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return base + str(_INV[c])


def pan():
    return "".join(random.choices(string.ascii_uppercase, k=5)) + "".join(random.choices(string.digits, k=4)) + "Z"


def img():
    b = io.BytesIO()
    Image.new("RGB", (60, 40), (random.randint(0, 255), 80, 80)).save(b, "PNG")
    return b.getvalue()


def files(with_pan=False):
    f = {"aadhaar_front": ("f.png", img(), "image/png"), "aadhaar_back": ("b.png", img(), "image/png")}
    if with_pan:
        f["pan"] = ("p.png", img(), "image/png")
    return f


env = dict(l.split("=", 1) for l in open('/app/backend/.env').read().splitlines() if "=" in l)
mdb = MongoClient(env["MONGO_URL"].strip('"'))[env["DB_NAME"].strip('"')]


def register():
    s = requests.Session()
    s.headers.update({"Origin": BASE_URL})
    name = "test_k" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    email = f"{name}@example.com"
    mdb.email_otps.update_one({"email": email}, {"$set": {"email": email, "code_hash": hashlib.sha256(f"{email}:123456".encode()).hexdigest(),
                              "sent_at": "2000-01-01T00:00:00+00:00", "expires_at": "2099-01-01T00:00:00+00:00", "attempts": 0}}, upsert=True)
    r = s.post(f"{API}/auth/register", json={"username": name, "password": "Test@1234", "confirm_password": "Test@1234",
                                             "accept_terms": True, "dob": "1994-04-04", "email": email, "email_otp": "123456",
                                             "mobile": random.choice("6789") + "".join(random.choices(string.digits, k=9))})
    assert r.status_code == 200, r.text
    return s, r.json()["user"]["id"], name


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Admin@8CwWbJV7AhEE"}).json()
    r2 = s.post(f"{API}/admin/auth/mfa", json={"mfa_token": r["mfa_token"], "code": TOTP.now()})
    assert r2.status_code == 200, r2.text
    return s


@pytest.fixture(scope="module")
def verifier():
    s = requests.Session()
    r = s.post(f"{API}/verifier/auth/login", json={"username": "pv1001", "password": "Verifier@123"})
    assert r.status_code == 200, r.text
    return s


# ---- user KYC submit + validation ----
class TestKycSubmit:
    def test_01_new_user_kyc_none(self):
        s, uid, name = register()
        S.update(u=s, uid=uid, name=name)
        k = s.get(f"{API}/kyc").json()
        assert k["status"] == "none" and k["accounts"] == [] and k["max_accounts"] == 5

    def test_02_invalid_aadhaar_rejected(self):
        for bad in ("123456789012", "12345", "023456789012"):
            r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": bad}, files=files())
            assert r.status_code == 400 and "Aadhaar" in r.json()["detail"], r.text

    def test_03_non_image_rejected(self):
        r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": aadhaar()},
                        files={"aadhaar_front": ("f.txt", b"hello", "text/plain"), "aadhaar_back": ("b.png", img(), "image/png")})
        assert r.status_code == 400 and "JPG" in r.text

    def test_04_pan_name_mismatch(self):
        r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": aadhaar(),
                                            "pan_name": "Totally Other", "pan_number": pan()}, files=files(True))
        assert r.status_code == 400 and "PAN" in r.text

    def test_05_pan_without_photo(self):
        r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": aadhaar(),
                                            "pan_name": "Test Kumar Singh", "pan_number": pan()}, files=files())
        assert r.status_code == 400 and "PAN" in r.text

    def test_06_submit_valid_with_pan(self):
        S["aadhaar"], S["pan"] = aadhaar(), pan()
        r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": S["aadhaar"],
                                            "pan_name": "TEST K SINGH", "pan_number": S["pan"]}, files=files(True))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending" and d["aadhaar_masked"] == "XXXX-XXXX-" + S["aadhaar"][-4:]
        assert d["has_pan"] is True and d["pan_masked"].endswith(S["pan"][-4:])
        k = S["u"].get(f"{API}/kyc").json()
        assert k["status"] == "pending" and S["aadhaar"] not in str(k)

    def test_07_resubmit_while_pending_blocked(self):
        r = S["u"].post(f"{API}/kyc", data={"aadhaar_name": "Test Kumar Singh", "aadhaar_number": aadhaar()}, files=files())
        assert r.status_code == 400 and "under review" in r.text

    def test_08_duplicate_aadhaar_and_pan_other_user(self):
        s2, uid2, _ = register()
        S.update(u2=s2, uid2=uid2)
        r = s2.post(f"{API}/kyc", data={"aadhaar_name": "Other Person", "aadhaar_number": S["aadhaar"]}, files=files())
        assert r.status_code == 400 and "another account" in r.text
        r = s2.post(f"{API}/kyc", data={"aadhaar_name": "Other Person", "aadhaar_number": aadhaar(),
                                        "pan_name": "Other Person", "pan_number": S["pan"]}, files=files(True))
        assert r.status_code == 400 and "another account" in r.text

    def test_09_own_file_access(self):
        r = S["u"].get(f"{API}/kyc/file/aadhaar_front")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image")
        assert S["u"].get(f"{API}/kyc/file/bogus").status_code == 404


# ---- payout accounts ----
class TestPayoutAccounts:
    def test_10_add_blocked_without_kyc(self):
        r = S["u2"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Other Person", "upi_id": "o@okaxis", "password": "Test@1234"})
        assert r.status_code == 400 and "KYC" in r.text

    def test_11_wrong_password(self):
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Test Kumar Singh", "upi_id": "t@okaxis", "password": "bad"})
        assert r.status_code == 401

    def test_12_name_mismatch(self):
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Amit Verma", "upi_id": "amitv@okaxis", "password": "Test@1234"})
        assert r.status_code == 400 and "match" in r.text

    def test_13_invalid_bank_ifsc(self):
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "bank", "holder_name": "Test Kumar Singh", "account_number": "12",
                                                        "ifsc": "BAD", "password": "Test@1234"})
        assert r.status_code == 400

    def test_14_add_bank_and_upi(self):
        S["acct"] = str(random.randint(10**11, 10**12))
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "bank", "holder_name": "Mr Test K Singh", "account_number": S["acct"],
                                                        "ifsc": "hdfc0001234", "password": "Test@1234"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "pending" and d["account_number"] == "XXXX" + S["acct"][-4:] and d["ifsc"] == "HDFC0001234"
        S["bank_id"] = d["id"]
        S["upi"] = "tks" + "".join(random.choices(string.digits, k=6)) + "@okicici"
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "TEST KUMAR SINGH", "upi_id": S["upi"], "password": "Test@1234"})
        assert r.status_code == 200, r.text
        S["upi_id"] = r.json()["id"]
        k = S["u"].get(f"{API}/kyc").json()
        assert {a["id"] for a in k["accounts"]} == {S["bank_id"], S["upi_id"]}

    def test_15_duplicate_same_user_and_cross_user(self):
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Test Kumar Singh", "upi_id": S["upi"], "password": "Test@1234"})
        assert r.status_code == 400 and "already" in r.text
        # second user gets KYC then tries same account
        r = S["u2"].post(f"{API}/kyc", data={"aadhaar_name": "Other Person", "aadhaar_number": aadhaar()}, files=files())
        assert r.status_code == 200, r.text
        r = S["u2"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Other Person", "upi_id": S["upi"].upper(), "password": "Test@1234"})
        assert r.status_code == 400 and "another user" in r.text

    def test_16_max_five_accounts(self):
        for i in range(3):
            r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Test Singh", "upi_id": f"tk{random.randint(10**6, 10**7)}@ybl", "password": "Test@1234"})
            assert r.status_code == 200, r.text
        r = S["u"].post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Test Singh", "upi_id": f"tk{random.randint(10**6, 10**7)}@ybl", "password": "Test@1234"})
        assert r.status_code == 400 and "up to 5" in r.text

    def test_17_remove_soft_delete(self):
        k = S["u"].get(f"{API}/kyc").json()
        extra = [a["id"] for a in k["accounts"] if a["id"] not in (S["bank_id"], S["upi_id"])]
        r = S["u"].delete(f"{API}/payout-accounts/{extra[0]}")
        assert r.status_code == 200
        assert extra[0] not in [a["id"] for a in S["u"].get(f"{API}/kyc").json()["accounts"]]
        assert S["u"].delete(f"{API}/payout-accounts/{extra[0]}").status_code == 404


# ---- withdrawals gating ----
class TestWithdrawGating:
    def test_18_withdraw_blocked_kyc_pending(self):
        r = S["u"].post(f"{API}/withdrawals", json={"amount": 30000, "account_id": S["bank_id"], "client_key": "k" + S["acct"]})
        assert r.status_code == 400 and "KYC" in r.json()["detail"]

    def test_19_old_body_upi_rejected(self):
        r = S["u"].post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "x@okaxis", "client_key": "kk" + S["acct"]})
        assert r.status_code in (400, 422)


# ---- admin review ----
class TestAdminKyc:
    def test_20_user_cannot_access_admin(self):
        assert S["u"].get(f"{API}/admin/kyc").status_code in (401, 403)

    def test_21_admin_list_full_aadhaar_and_docs(self, admin):
        rows = admin.get(f"{API}/admin/kyc", params={"status": "pending", "q": S["name"]}).json()
        me = [x for x in rows if x["user_id"] == S["uid"]]
        assert me and me[0]["aadhaar_number"] == S["aadhaar"] and me[0]["pan_number"] == S["pan"]
        assert any(a["account_number"] == S["acct"] for a in me[0]["accounts"])
        for kind in ("aadhaar_front", "aadhaar_back", "pan"):
            r = admin.get(f"{API}/admin/kyc/{S['uid']}/file/{kind}")
            assert r.status_code == 200 and r.headers["content-type"].startswith("image")

    def test_22_admin_filters(self, admin):
        for st in ("verified", "rejected", ""):
            r = admin.get(f"{API}/admin/kyc", params={"status": st})
            assert r.status_code == 200 and isinstance(r.json(), list)
            if st:
                assert all(x["status"] == st for x in r.json())
        pend = admin.get(f"{API}/admin/payout-accounts").json()
        assert any(a["id"] == S["bank_id"] and a["kyc_status"] == "pending" for a in pend)

    def test_23_account_approve_blocked_before_kyc(self, admin):
        r = admin.post(f"{API}/admin/payout-accounts/{S['bank_id']}/decision", json={"approve": True})
        assert r.status_code == 400 and "KYC" in r.text

    def test_24_reject_requires_reason(self, admin):
        r = admin.post(f"{API}/admin/kyc/{S['uid']}/decision", json={"approve": False, "reason": ""})
        assert r.status_code == 400

    def test_25_verify_kyc_and_accounts(self, admin):
        assert admin.post(f"{API}/admin/kyc/{S['uid']}/decision", json={"approve": True}).json()["status"] == "verified"
        assert admin.post(f"{API}/admin/payout-accounts/{S['bank_id']}/decision", json={"approve": True}).status_code == 200
        r = admin.post(f"{API}/admin/payout-accounts/{S['upi_id']}/decision", json={"approve": False, "reason": "TEST bad"})
        assert r.status_code == 200
        k = S["u"].get(f"{API}/kyc").json()
        st = {a["id"]: a["status"] for a in k["accounts"]}
        assert k["status"] == "verified" and st[S["bank_id"]] == "approved" and st[S["upi_id"]] == "rejected"

    def test_26_withdraw_unapproved_account_blocked(self):
        r = S["u"].post(f"{API}/withdrawals", json={"amount": 30000, "account_id": S["upi_id"], "client_key": "u" + S["acct"]})
        assert r.status_code == 400 and "verified withdrawal account" in r.text

    def test_27_withdraw_first_deposit_rule(self, admin):
        r = S["u"].post(f"{API}/withdrawals", json={"amount": 30000, "account_id": S["bank_id"], "client_key": "f" + S["acct"]})
        assert r.status_code == 400 and "first deposit" in r.text

    def test_28_reject_then_resubmit_archives(self, admin):
        # u2 pending -> reject -> resubmit allowed
        assert admin.post(f"{API}/admin/kyc/{S['uid2']}/decision", json={"approve": False, "reason": "TEST blurry"}).status_code == 200
        k = S["u2"].get(f"{API}/kyc").json()
        assert k["status"] == "rejected" and k["reject_reason"] == "TEST blurry"
        r = S["u2"].post(f"{API}/kyc", data={"aadhaar_name": "Other Person", "aadhaar_number": aadhaar()}, files=files())
        assert r.status_code == 200 and r.json()["status"] == "pending"


# ---- verifier KYC badge / gating ----
class TestVerifier:
    def test_29_dashboard_badges_and_gate(self, verifier):
        d = verifier.get(f"{API}/verifier/dashboard").json()
        wds = d["withdrawals"]
        assert all("kyc" in w and "status" in w["kyc"] for w in wds)
        for w in wds:
            if w["kyc"]["status"] == "verified":
                assert w["kyc"]["aadhaar_masked"].startswith("XXXX-XXXX-") and len(w["kyc"]["aadhaar_masked"]) == 14
        unverified = [w for w in wds if w["status"] == "pending" and w["kyc"]["status"] != "verified"]
        if not unverified:
            pytest.skip("no pending unverified withdrawal for pv1001")
        r = verifier.post(f"{API}/verifier/withdrawals/{unverified[0]['id']}/approve")
        assert r.status_code == 400 and "Aadhaar" in r.text
