import requests, uuid, pyotp, time, concurrent.futures as cf
B="https://odd-even-royale.preview.emergentagent.com/api"; H={"Origin":B[:-4]}
def S(): s=requests.Session(); s.headers.update(H); return s
a=S(); r=a.post(B+"/admin/auth/login",json={"username":"admin","password":"Admin@8CwWbJV7AhEE"}).json()
a.post(B+"/admin/auth/mfa",json={"mfa_token":r["mfa_token"],"code":pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()})
v=S(); v.post(B+"/verifier/auth/login",json={"username":"pv1001","password":"Verifier@123"}); v.post(B+"/verifier/online",json={"online":True})
u=S(); un="ma"+uuid.uuid4().hex[:6]
u.post(B+"/auth/register",json={"username":un,"password":"Audit@123","confirm_password":"Audit@123","accept_terms":True,"mobile":"7"+str(uuid.uuid4().int)[:9],"dob":"1990-01-01"})
W=lambda: u.get(B+"/wallet").json()
print("start", W()["balance"])
d=u.post(B+"/deposits/assign",json={"amount":100000}).json()
u.post(B+f"/deposits/{d['id']}/submit",json={"utr":"MA"+uuid.uuid4().hex[:10].upper()})
print("pending dep", W()["pending_deposits"])
v.post(B+f"/verifier/deposits/{d['id']}/verify"); v.post(B+f"/verifier/deposits/{d['id']}/verify")
w=W(); print("after deposit bal", w["balance"], "wager", w["wager_remaining"], w["wager_required"], "totdep", w["total_deposits"])
c=[x for x in u.get(B+"/coupons").json() if x["status"]=="available"]
for x in c: u.post(B+f"/coupons/{x['id']}/claim"); u.post(B+f"/coupons/{x['id']}/claim")
w=W(); print("after coupons", w["balance"], "wager", w["wager_remaining"])
key=str(uuid.uuid4())
with cf.ThreadPoolExecutor(8) as ex: res=list(ex.map(lambda _: u.post(B+"/game/bet",json={"side":"ODD","amount":10000,"client_key":key}).status_code, range(8)))
print("same-key concurrent", res, "bal", W()["balance"])
with cf.ThreadPoolExecutor(20) as ex: res=list(ex.map(lambda _: u.post(B+"/game/bet",json={"side":"EVEN","amount":10000,"client_key":str(uuid.uuid4())}).json().get("detail","ok"), range(20)))
print("20 concurrent bets", {k:res.count(k) for k in set(res)}, "bal", W()["balance"])
uid_=a.get(B+"/admin/users",params={"q":un}).json()[0]["id"]
code=pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()
print("credit", a.post(B+f"/admin/users/{uid_}/adjust",json={"amount":5000,"action":"credit","reason":"audit","password":"Admin@8CwWbJV7AhEE","code":code}).json())
print("overdebit", a.post(B+f"/admin/users/{uid_}/adjust",json={"amount":999999999,"action":"debit","reason":"audit","password":"Admin@8CwWbJV7AhEE","code":code}).json())
print("wd blocked", u.post(B+"/withdrawals",json={"amount":30000,"upi_id":"a@upi","client_key":str(uuid.uuid4())}).json())
time.sleep(36)
w=W(); bets=u.get(B+"/game/my-bets").json()
stakes=sum(b["amount"] for b in bets); pay=sum(b.get("payout",0) for b in bets if b["status"]=="won")
print("settled", {b["status"] for b in bets}, "expected bal", 100000+sum(x["amount"] for x in c)-stakes+pay+5000, "actual", w["balance"])
print("reconcile", a.get(B+"/admin/reconcile").json()["discrepancies"])
