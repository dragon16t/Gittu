# Read-only check: admin fair_upcoming vs user /game/fair hashes, and post-round result consistency (no data created)
import os, time, requests, pyotp

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
H = {"Origin": BASE}


def admin_session():
    s = requests.Session(); s.headers.update(H)
    r = s.post(f"{BASE}/api/admin/auth/login", json={"username": "admin", "password": "Admin@8CwWbJV7AhEE"})
    r.raise_for_status()
    tok = r.json()["mfa_token"]
    for _ in range(3):
        r = s.post(f"{BASE}/api/admin/auth/mfa", json={"mfa_token": tok, "code": pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()})
        if r.status_code == 200:
            return s
        print("mfa retry", r.status_code, r.text); time.sleep(31)
    raise SystemExit("admin mfa failed")


def user_session():
    s = requests.Session(); s.headers.update(H)
    r = s.post(f"{BASE}/api/auth/login", json={"username": "player1", "password": "Player@123", "accept_terms": True, "terms": True})
    print("user login", r.status_code, r.text[:200])
    r.raise_for_status()
    return s


a = admin_session(); u = user_session()
g = a.get(f"{BASE}/api/admin/game").json()
print("mode", g["config"]["mode"], "current", g["current"] and (g["current"]["number"], g["current"]["status"]))
up = g["fair_upcoming"]
print("admin upcoming count", len(up), [(x["number"], x["result"], x["dice"]) for x in up])
f = u.get(f"{BASE}/api/game/fair").json()
print("user upcoming count", len(f["upcoming"]), "keys", list(f["upcoming"][0].keys()) if f["upcoming"] else None)
leak = [x for x in f["upcoming"] if "dice" in x or "salt" in x or "result" in x]
print("USER LEAK of dice/result:", leak)
um = {x["number"]: x["hash"] for x in f["upcoming"]}
mism = [x["number"] for x in up if x["number"] in um and um[x["number"]] != x["hash"]]
common = [x["number"] for x in up if x["number"] in um]
print("common", len(common), "hash mismatches", mism)
print("first admin upcoming == current?", up and g["current"] and up[0]["number"] == g["current"]["number"])
nums = [x["number"] for x in up]
print("consecutive", nums == list(range(nums[0], nums[0] + len(nums))) if nums else None)
expected = {x["number"]: (x["result"], x["dice"], x["hash"]) for x in up[:2]}
# wait for those rounds to finish
target = max(expected)
deadline = time.time() + 80
while time.time() < deadline:
    h = u.get(f"{BASE}/api/game/history").json()
    rows = h if isinstance(h, list) else h.get("rounds") or h.get("items") or h
    done = {r["number"]: r for r in rows if isinstance(r, dict) and r.get("number") in expected and r.get("result")}
    if target in done:
        break
    time.sleep(5)
print("history sample keys", list(rows[0].keys()) if rows else None)
for n, (res, dice, hs) in expected.items():
    r = done.get(n)
    if not r:
        print(n, "NOT FINISHED"); continue
    print(n, "admin", res, dice, "history", r.get("result"), r.get("dice"), "MATCH" if r.get("result") == res and r.get("dice") in (dice, None) else "MISMATCH",
          "hash match" if r.get("result_hash") in (hs, None) else f"hash diff {r.get('result_hash')}")
f2 = u.get(f"{BASE}/api/game/fair").json()
rv = {x["number"]: x for x in f2["revealed"]}
for n, (res, dice, hs) in expected.items():
    x = rv.get(n)
    print("revealed", n, x and (x["result"], x["dice"], x["hash"] == hs, x.get("status")))
import hashlib
bad = [x["number"] for x in f2["revealed"] if x.get("status") == "used" and hashlib.sha256(f'{x["number"]}:{x["dice"]}:{x["salt"]}'.encode()).hexdigest() != x["hash"]]
print("revealed used seeds checked", sum(1 for x in f2["revealed"] if x.get("status") == "used"), "formula mismatches", bad)
