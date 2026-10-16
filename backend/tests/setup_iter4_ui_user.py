# Seeds a fresh user with deposit, admin credit/debit, completed + rejected withdrawal for UI ledger checks.
import os, uuid, time
import pyotp, requests
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/"); B = BASE + "/api"; H = {"Origin": BASE}
T = pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A"); APW = "Admin@8CwWbJV7AhEE"; PW = "Audit@1234"
def S():
    s = requests.Session(); s.headers.update(H); return s
a = S(); r = a.post(B + "/admin/auth/login", json={"username": "admin", "password": APW}).json()
a.post(B + "/admin/auth/mfa", json={"mfa_token": r["mfa_token"], "code": T.now()})
v = S(); v.post(B + "/verifier/auth/login", json={"username": "pv1001", "password": "Verifier@123"}); v.post(B + "/verifier/online", json={"online": True})
u = S(); un = "t4l" + uuid.uuid4().hex[:7]
u.post(B + "/auth/register", json={"username": un, "password": PW, "confirm_password": PW, "accept_terms": True, "mobile": "7" + str(uuid.uuid4().int)[:9], "dob": "1990-01-01"})
uid = a.get(B + "/admin/users", params={"q": un}).json()[0]["id"]
d = u.post(B + "/deposits/assign", json={"amount": 100000}).json()
u.post(B + f"/deposits/{d['id']}/submit", json={"utr": "UL" + uuid.uuid4().hex[:10].upper()}); v.post(B + f"/verifier/deposits/{d['id']}/verify")
adj = lambda act, amt: a.post(B + f"/admin/users/{uid}/adjust", json={"amount": amt, "action": act, "reason": "TEST_ui", "password": APW, "code": T.now()}).status_code
print("credit", adj("credit", 50000), "debit", adj("debit", 2000))
rem = u.get(B + "/wallet").json()["wager_remaining"]
for _ in range(40):
    rr = u.post(B + "/game/bet", json={"side": "ODD", "amount": rem, "client_key": str(uuid.uuid4())})
    if rr.status_code == 200: break
    time.sleep(1)
print("bet", rr.status_code, rr.text[:80])
u.put(B + "/bank", json={"holder_name": "UI User", "upi_id": "uiuser@upi", "password": PW})
def wd():
    w = u.post(B + "/withdrawals", json={"amount": 30000, "upi_id": "uiuser@upi", "client_key": str(uuid.uuid4())}).json()
    for _ in range(6):
        if any(x["id"] == w["id"] for x in v.get(B + "/verifier/dashboard").json()["withdrawals"]): break
        a.post(B + f"/admin/withdrawals/{w['id']}/reassign")
    return w["id"]
w1 = wd(); v.post(B + f"/verifier/withdrawals/{w1}/approve"); v.post(B + f"/verifier/withdrawals/{w1}/processing", json={"reference": "UIREF12345"})
print("complete", v.post(B + f"/verifier/withdrawals/{w1}/complete").status_code)
print("credit2", adj("credit", 40000)); w2 = wd(); print("reject", v.post(B + f"/verifier/withdrawals/{w2}/reject", json={"reason": "TEST"}).status_code)
print("USER", un, PW, u.get(B + "/wallet").json())
