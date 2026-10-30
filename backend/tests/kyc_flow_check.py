import io
import os
import sys
import random
import requests
import pyotp
from PIL import Image

_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
      [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
      [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
      [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
      [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
      [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]

API = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0] + "/api"


def aadhaar():
    base = str(random.randint(2, 9)) + "".join(str(random.randint(0, 9)) for _ in range(10))
    c = 0
    for i, ch in enumerate(reversed(base)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return base + str(_INV[c])


def img():
    b = io.BytesIO()
    Image.new("RGB", (60, 40), (random.randint(0, 255), 80, 80)).save(b, "PNG")
    return b.getvalue()


def login_user(u, p):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"identifier": u, "username": u, "password": p})
    assert r.ok, r.text
    return s


def login_admin():
    s = requests.Session()
    r = s.post(f"{API}/admin/auth/login", json={"username": "admin", "password": "Admin@8CwWbJV7AhEE"}).json()
    s.post(f"{API}/admin/auth/mfa", json={"mfa_token": r["mfa_token"], "code": pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()}).raise_for_status()
    return s


def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)


u = login_user("player1", "Player@123")
f = login_user("friend1", "Friend@123")
adm = login_admin()
k = u.get(f"{API}/kyc").json()
print("player1 kyc", k["status"])
num = aadhaar()
files = lambda: {"aadhaar_front": ("f.png", img(), "image/png"), "aadhaar_back": ("b.png", img(), "image/png")}
r = u.post(f"{API}/kyc", data={"aadhaar_name": "Rahul Kumar", "aadhaar_number": "123456789012"}, files=files())
ok(r.status_code == 400, f"invalid aadhaar rejected {r.text}")
if k["status"] in ("none", "rejected"):
    r = u.post(f"{API}/kyc", data={"aadhaar_name": "Rahul Kumar Sharma", "aadhaar_number": num}, files=files())
    ok(r.ok and r.json()["status"] == "pending", f"kyc submit {r.status_code} {r.text[:120]}")
    if f.get(f"{API}/kyc").json()["status"] in ("none", "rejected"):
        r = f.post(f"{API}/kyc", data={"aadhaar_name": "Other", "aadhaar_number": num}, files=files())
        ok(r.status_code == 400 and "another" in r.text, f"duplicate aadhaar blocked {r.text[:100]}")
r = u.post(f"{API}/payout-accounts", json={"kind": "upi", "holder_name": "Amit Verma", "upi_id": "amit@okaxis", "password": "Player@123"})
ok(r.status_code == 400 and "match" in r.text, f"name mismatch blocked {r.text[:100]}")
acct = str(random.randint(10**11, 10**12))
r = u.post(f"{API}/payout-accounts", json={"kind": "bank", "holder_name": "RAHUL K SHARMA", "account_number": acct, "ifsc": "SBIN0001234", "password": "Player@123"})
ok(r.ok, f"bank add {r.text[:120]}")
aid = r.json().get("id")
r = f.post(f"{API}/payout-accounts", json={"kind": "bank", "holder_name": "x", "account_number": acct, "ifsc": "SBIN0001234", "password": "Friend@123"})
ok(r.status_code == 400, f"friend cannot reuse account {r.text[:100]}")
r = u.post(f"{API}/withdrawals", json={"amount": 30000, "account_id": aid, "client_key": "k" + acct})
ok(r.status_code == 400, f"withdraw blocked before kyc verify {r.text[:100]}")
lst = adm.get(f"{API}/admin/kyc", params={"status": "pending"}).json()
me = [x for x in lst if x["username"] == "player1"]
ok(bool(me) and len(me[0]["aadhaar_number"]) == 12, "admin sees full aadhaar")
img_r = adm.get(f"{API}/admin/kyc/{me[0]['user_id']}/file/aadhaar_front")
ok(img_r.ok and img_r.headers["content-type"].startswith("image"), "admin views document")
ok(u.get(f"{API}/admin/kyc").status_code == 401, "user cannot access admin kyc")
r = adm.post(f"{API}/admin/payout-accounts/{aid}/decision", json={"approve": True})
ok(r.status_code == 400, "account approve blocked before kyc verified")
if me[0]["status"] == "pending":
    ok(adm.post(f"{API}/admin/kyc/{me[0]['user_id']}/decision", json={"approve": True}).ok, "admin verify kyc")
ok(adm.post(f"{API}/admin/payout-accounts/{aid}/decision", json={"approve": True}).ok, "admin approve account")
k = u.get(f"{API}/kyc").json()
ok(k["status"] == "verified" and any(a["id"] == aid and a["status"] == "approved" for a in k["accounts"]), "user sees verified + approved")
r = u.post(f"{API}/withdrawals", json={"amount": 30000, "account_id": aid, "client_key": "k2" + acct})
print("withdraw attempt after kyc:", r.status_code, r.text[:150])
