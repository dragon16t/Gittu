import requests, uuid
B="https://odd-even-vault.preview.emergentagent.com/api"; H={"Origin":B[:-4]}
s=requests.Session(); s.headers.update(H)
mob="9"+str(uuid.uuid4().int)[:9]; un="mob"+uuid.uuid4().hex[:5]
r=s.post(B+"/auth/register",json={"username":un,"password":"Mobile@123","confirm_password":"Mobile@123","accept_terms":True,"mobile":mob,"dob":"1995-04-12"}); print(r.status_code, r.json().get("user",{}).get("mobile"))
print(s.post(B+"/auth/register",json={"username":un+"x","password":"Mobile@123","confirm_password":"Mobile@123","accept_terms":True,"mobile":"9"+mob[1:],"dob":"2012-04-12"}).json())
t=requests.Session(); t.headers.update(H)
print(t.post(B+"/auth/login",json={"username":mob,"password":"Mobile@123"}).status_code)
print(t.post(B+"/auth/forgot/verify",json={"username":mob,"dob":"1995-04-11"}).json())
r=t.post(B+"/auth/forgot/verify",json={"username":mob,"dob":"1995-04-12"}).json(); print(list(r))
print(t.post(B+"/auth/forgot/reset",json={"reset_token":r["reset_token"],"password":"Mobile@456","confirm_password":"Mobile@456"}).status_code)
