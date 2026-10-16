# Creates a user with a verified ₹200 deposit (pending wagering) for UI testing of the wager-progress bar.
import os
import secrets
import requests

API = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
H = {"Origin": os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")}
u, v = requests.Session(), requests.Session()
u.headers.update(H); v.headers.update(H)
name = "test_wg" + secrets.token_hex(3)
assert u.post(f"{API}/auth/register", json={"username": name, "password": "Passw0rd!", "confirm_password": "Passw0rd!",
                                            "accept_terms": True}).status_code == 200
assert v.post(f"{API}/verifier/auth/login", json={"username": "pv1001", "password": "Verifier@123"}).status_code == 200
v.post(f"{API}/verifier/online", json={"online": True})
d = u.post(f"{API}/deposits/assign", json={"amount": 20000}).json()
u.post(f"{API}/deposits/{d['id']}/submit", json={"utr": "TESTUTR" + secrets.token_hex(5).upper()})
assert v.post(f"{API}/verifier/deposits/{d['id']}/verify").status_code == 200
print(name, u.get(f"{API}/wallet").json())
