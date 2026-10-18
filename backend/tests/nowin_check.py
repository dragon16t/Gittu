import requests,pyotp,time,uuid
A="https://odd-even-royale.preview.emergentagent.com/api"
adm=requests.Session()
t=adm.post(A+"/admin/auth/login",json={"username":"admin","password":"Admin@8CwWbJV7AhEE"}).json()
adm.post(A+"/admin/auth/mfa",json={"mfa_token":t["mfa_token"],"code":pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()})
print(adm.put(A+"/admin/config",json={"mode":"nowin"}).status_code)
def L(u,p):
    s=requests.Session(); s.post(A+"/auth/login",json={"username":u,"password":p}); return s
p1,f1=L("player1","Player@123"),L("friend1","Friend@123")
fid=f1.get(A+"/auth/me").json()["id"]
time.sleep(31)
print("adjust",adm.post(A+f"/admin/users/{fid}/adjust",json={"amount":5000,"action":"credit","reason":"nowin test","password":"Admin@8CwWbJV7AhEE","code":pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()}).status_code)
while True:
    st=p1.get(A+"/game/state").json(); r=st["round"]
    if r and r["status"]=="betting" and r["mode"]=="nowin": break
    time.sleep(2)
num=r["number"]
for s,side in ((p1,"ODD"),(f1,"EVEN")):
    x=s.post(A+"/game/bet",json={"side":side,"amount":1000,"client_key":str(uuid.uuid4())}); print(side,x.status_code,x.text[:120])
while True:
    st=p1.get(A+"/game/state").json()
    if st["last_round"] and st["last_round"]["number"]==num: break
    time.sleep(2)
for n,s in (("player1(ODD)",p1),("friend1(EVEN)",f1)):
    st=s.get(A+"/game/state").json(); h=s.get(A+"/game/history").json()[0]
    print(n,"state:",st["last_round"]["result"],st["last_round"]["dice"],st["recent"][0],[b["status"] for b in st["last_round_bets"]],"history:",h["number"],h["result"],h["dice"])
g=requests.get(A+"/game/public-state").json(); print("guest:",g["last_round"]["result"])
print(adm.put(A+"/admin/config",json={"mode":"random"}).status_code)
