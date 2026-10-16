# Helper (not a test): creates a user with a pending withdrawal + ticket shared with pv1001, for UI testing.
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
from test_tickets_iter2 import API, ADMIN_PW, TOTP, admin_login, register  # noqa

ad = admin_login()
u, uid_, name = register()
assert ad.post(f"{API}/admin/users/{uid_}/adjust", json={"amount": 50000, "action": "credit", "reason": "TEST", "password": ADMIN_PW,
                                                         "code": TOTP.now()}).status_code == 200
assert u.put(f"{API}/bank", json={"holder_name": "TEST W", "upi_id": "testw@okicici", "password": "Passw0rd!"}).status_code == 200
w = u.post(f"{API}/withdrawals", json={"amount": 30000, "upi_id": "testw@okicici", "client_key": str(uuid.uuid4())}).json()
t = u.post(f"{API}/tickets", json={"kind": "withdrawal", "ref_id": w["id"], "message": "TEST UI withdrawal not received"}).json()
r = ad.post(f"{API}/admin/tickets/{t['id']}/assign", json={})
print(name, w["id"], t["number"], r.status_code, r.text)
