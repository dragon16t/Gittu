# Iteration 7: Auto mode cycle, Mode 4 No-Win, Bonus send-to-all, config validation (creates bets + bonus coupons)
import os, time, uuid, requests, pyotp, pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
H = {"Origin": BASE}
RESTORE = {"mode": "random", "auto_mode": False, "auto_standard": 3, "auto_minority": 6, "paused": False}


def _admin():
    s = requests.Session(); s.headers.update(H)
    r = s.post(f"{BASE}/api/admin/auth/login", json={"username": "admin", "password": "Admin@8CwWbJV7AhEE"})
    r.raise_for_status()
    tok = r.json()["mfa_token"]
    for _ in range(3):
        r = s.post(f"{BASE}/api/admin/auth/mfa", json={"mfa_token": tok, "code": pyotp.TOTP("JBSWY3DPEHPK3PXPODDEVENADMIN234A").now()})
        if r.status_code == 200:
            return s
        time.sleep(31)
    pytest.fail("admin mfa failed")


def _user(u, p):
    s = requests.Session(); s.headers.update(H)
    r = s.post(f"{BASE}/api/auth/login", json={"username": u, "password": p, "accept_terms": True, "terms": True})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin():
    s = _admin()
    yield s
    r = s.put(f"{BASE}/api/admin/config", json=RESTORE)
    print("RESTORE", r.status_code, {k: r.json().get(k) for k in RESTORE} if r.ok else r.text)


@pytest.fixture(scope="module")
def p1():
    return _user("player1", "Player@123")


@pytest.fixture(scope="module")
def f1():
    return _user("friend1", "Friend@123")


def wait_betting(s, min_left=12, timeout=60):
    """Wait for a fresh betting round with at least min_left seconds left; returns round."""
    end = time.time() + timeout
    while time.time() < end:
        st = s.get(f"{BASE}/api/game/public-state").json()
        r = st.get("round")
        if r and r["status"] == "betting":
            from datetime import datetime
            left = (datetime.fromisoformat(r["closes_at"].replace("Z", "+00:00")) - datetime.fromisoformat(st["server_time"].replace("Z", "+00:00"))).total_seconds()
            if left >= min_left:
                return r
        time.sleep(1.5)
    pytest.fail("no betting round")


def admin_round(admin, number, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        g = admin.get(f"{BASE}/api/admin/game").json()
        for r in g["rounds"] + ([g["current"]] if g.get("current") else []):
            if r and r["number"] == number and r.get("status") == "settled":
                return r
        time.sleep(3)
    pytest.fail(f"round {number} not settled")


# --- config validation
class TestConfigValidation:
    @pytest.mark.parametrize("payload", [{"auto_standard": 101}, {"auto_minority": -1}, {"auto_standard": 0, "auto_minority": 0}])
    def test_invalid_counts(self, admin, payload):
        r = admin.put(f"{BASE}/api/admin/config", json=payload)
        assert r.status_code == 400, r.text

    def test_nowin_accepted_and_bad_mode(self, admin):
        r = admin.put(f"{BASE}/api/admin/config", json={"mode": "bogus"})
        assert r.status_code == 400
        r = admin.put(f"{BASE}/api/admin/config", json={"mode": "nowin", "auto_mode": False})
        assert r.status_code == 200 and r.json()["mode"] == "nowin"
        r = admin.put(f"{BASE}/api/admin/config", json={"mode": "random"})
        assert r.json()["mode"] == "random"


# --- auto mode cycle
class TestAutoMode:
    def test_auto_cycle_and_hidden(self, admin, p1):
        r = admin.put(f"{BASE}/api/admin/config", json={"auto_standard": 1, "auto_minority": 1, "auto_mode": True})
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["auto_mode"] is True and c["auto_pos"] == 0
        # hidden from players
        pub = requests.get(f"{BASE}/api/game/public-state").json()
        assert pub["config"]["mode"] is None
        st = p1.get(f"{BASE}/api/game/state").json()
        assert st["config"]["mode"] is None
        fair = p1.get(f"{BASE}/api/game/fair").json()
        assert fair["active"] is False and fair["upcoming"] == []
        # observe next 3 rounds created after toggle
        cur = admin.get(f"{BASE}/api/admin/game").json()["current"]
        start = (cur["number"] + 1) if cur else None
        seen = {}
        end = time.time() + 140
        while time.time() < end and len(seen) < 3:
            g = admin.get(f"{BASE}/api/admin/game").json()
            for rr in g["rounds"] + ([g["current"]] if g.get("current") else []):
                if rr and rr["number"] >= start:
                    seen[rr["number"]] = (rr.get("mode"), rr.get("auto"))
                    pr = requests.get(f"{BASE}/api/game/public-state").json().get("round")
                    if pr and pr["number"] == rr["number"]:
                        assert pr["mode"] is None, pr
            time.sleep(4)
        print("AUTO ROUNDS", seen)
        nums = sorted(seen)[:3]
        assert len(nums) == 3
        modes = [seen[n][0] for n in nums]
        assert all(seen[n][1] is True for n in nums)
        assert modes == ["random", "minority", "random"], modes
        # turn off -> public mode visible again
        r = admin.put(f"{BASE}/api/admin/config", json={"auto_mode": False})
        assert r.json()["auto_mode"] is False
        time.sleep(1)
        assert requests.get(f"{BASE}/api/game/public-state").json()["config"]["mode"] == "random"


# --- mode 4 nowin
def _bal(s):
    return s.get(f"{BASE}/api/game/state").json()["balance"]


def _bet(s, side, amt=1000):
    r = s.post(f"{BASE}/api/game/bet", json={"side": side, "amount": amt, "client_key": "t7-" + uuid.uuid4().hex[:16]})
    assert r.status_code == 200, r.text
    return r.json()["bet"]


class TestNoWin:
    def test_one_side_then_both(self, admin, p1, f1):
        r = admin.put(f"{BASE}/api/admin/config", json={"mode": "nowin", "auto_mode": False})
        assert r.json()["mode"] == "nowin"
        # ensure the round we bet on was created in nowin mode
        rnd = wait_betting(p1, min_left=8, timeout=70)
        g = admin.get(f"{BASE}/api/admin/game").json()
        if g["current"]["mode"] != "nowin":
            time.sleep(max(0, 1)); rnd = None
            end = time.time() + 70
            while time.time() < end:
                g = admin.get(f"{BASE}/api/admin/game").json()
                if g["current"] and g["current"]["mode"] == "nowin" and g["current"]["status"] == "betting":
                    rnd = g["current"]; break
                time.sleep(2)
            assert rnd
        b0 = _bal(p1)
        bet = _bet(p1, "ODD")
        n = bet["round_number"]
        done = admin_round(admin, n, timeout=70)
        print("NOWIN single", n, done.get("result"), done.get("dice"), done.get("all_lose"))
        assert done["result"] == "EVEN" and done["mode"] == "nowin"
        mb = p1.get(f"{BASE}/api/game/my-bets").json()
        rows = mb if isinstance(mb, list) else mb.get("items") or mb.get("bets") or []
        mine = [x for x in rows if x["id"] == bet["id"]][0]
        assert mine["status"] == "lost" and mine.get("payout", 0) == 0
        assert _bal(p1) == b0 - 1000

        # both sides
        rnd = wait_betting(p1, min_left=10, timeout=70)
        pb0, fb0 = _bal(p1), _bal(f1)
        bo = _bet(p1, "ODD"); be = _bet(f1, "EVEN")
        assert bo["round_number"] == be["round_number"]
        done = admin_round(admin, bo["round_number"], timeout=70)
        print("NOWIN both", done["number"], done.get("result"), done.get("dice"), done.get("all_lose"), done.get("total_payout"))
        assert done.get("all_lose") is True
        assert done.get("total_payout", 0) == 0
        assert _bal(p1) == pb0 - 1000 and _bal(f1) == fb0 - 1000
        admin.put(f"{BASE}/api/admin/config", json={"mode": "random"})


# --- bonus to all users
class TestBonusAll:
    def test_send_all(self, admin):
        cfg = admin.get(f"{BASE}/api/admin/game").json()["config"]
        print("promo", cfg.get("promotions_enabled"), cfg.get("promo_reserve"))
        r = admin.post(f"{BASE}/api/admin/bonus/send", json={"all_users": True, "amount": 100, "wager": 1, "title": "Test all", "credit_now": True})
        print("BONUS", r.status_code, r.text[:300])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["sent"] == d["targets"] and d["targets"] >= 2
