"""End-to-end tests for the per-person password change.

Run against a live backend. Every test states what it proves.
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:5000"
LOG = sys.argv[1] if len(sys.argv) > 1 else "/tmp/flasktest.log"

passed, failed = [], []


def check(name, condition, detail=""):
    (passed if condition else failed).append(name)
    print(("  PASS  " if condition else "  FAIL  ") + name + (("  -> " + str(detail)) if detail and not condition else ""))


class Session:
    def __init__(self):
        self.cookie = None

    def post(self, path, body=None):
        data = json.dumps(body or {}).encode()
        req = urllib.request.Request(BASE + path, data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(req) as r:
                sc = r.headers.get("Set-Cookie")
                if sc:
                    self.cookie = sc.split(";")[0]
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def get(self, path):
        req = urllib.request.Request(BASE + path)
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")


def code_from_log(email):
    """Email isn't configured in the test, so the server logs the code."""
    time.sleep(0.3)
    text = open(LOG, encoding="utf-8", errors="replace").read()
    hits = re.findall(r"Login code for " + re.escape(email) + r".*?Code: (\d{6})", text)
    return hits[-1] if hits else None


def login(email, password):
    """Full two-step login. Returns (session, final_response)."""
    s = Session()
    st, r = s.post("/api/auth/password", {"email": email, "password": password, "method": "email"})
    if st != 200 or not r.get("ok"):
        return s, (st, r)
    code = code_from_log(email)
    if not code:
        return s, (0, {"error": "no code in log"})
    st2, r2 = s.post("/api/auth/verify", {"email": email, "code": code})
    return s, (st2, r2)


print("\n=== 1. The security hole: is the code ever handed to the browser? ===")
s = Session()
st, r = s.post("/api/auth/password", {"email": "ladd@thebeggardanced.com",
                                      "password": "SharedChurch1", "method": "email"})
check("step one accepts the shared password", st == 200 and r.get("ok"), r)
check("response contains NO demo_code", "demo_code" not in r, r)
check("no 6-digit code anywhere in the response body",
      not re.search(r"\b\d{6}\b", json.dumps(r)), r)
check("tells the user email failed instead of pretending", bool(r.get("error")), r)

print("\n=== 2. Shared password still works for anyone without their own ===")
s_pastor, (st, r) = login("ladd@thebeggardanced.com", "SharedChurch1")
check("pastor logs in with the shared password", st == 200 and r.get("ok"), r)
st, sess = s_pastor.get("/api/auth/session")
check("session reports they used the shared password", sess.get("usedSharedPassword") is True, sess)
check("session reports no personal password yet", sess.get("hasOwnPassword") is False, sess)

print("\n=== 3. Unknown emails are refused (was: became Full Admin) ===")
s2 = Session()
st, r = s2.post("/api/auth/password", {"email": "random@stranger.com",
                                       "password": "SharedChurch1", "method": "email"})
if st == 200 and r.get("ok"):
    c = code_from_log("random@stranger.com")
    st, r = s2.post("/api/auth/verify", {"email": "random@stranger.com", "code": c or "000000"})
check("stranger with the shared password is refused", st == 403, (st, r))
check("stranger does NOT get a session", not r.get("ok"), r)

print("\n=== 4. Setting your own password ===")
st, r = s_pastor.post("/api/auth/set-my-password",
                      {"current": "SharedChurch1", "password": "short"})
check("under 8 characters is refused", st == 400, (st, r))

st, r = s_pastor.post("/api/auth/set-my-password",
                      {"current": "SharedChurch1", "password": "SharedChurch1"})
check("reusing the shared password is refused", st == 400, (st, r))

st, r = s_pastor.post("/api/auth/set-my-password",
                      {"current": "WrongPassword", "password": "PastorOwnPass1"})
check("wrong current password is refused", st == 401, (st, r))

st, r = s_pastor.post("/api/auth/set-my-password",
                      {"current": "SharedChurch1", "password": "PastorOwnPass1"})
check("a good personal password is accepted", st == 200 and r.get("ok"), (st, r))

print("\n=== 5. After setting it, the shared password stops working FOR THAT PERSON ===")
s3 = Session()
st, r = s3.post("/api/auth/password", {"email": "ladd@thebeggardanced.com",
                                       "password": "SharedChurch1", "method": "email"})
check("pastor can no longer use the shared password", st == 401, (st, r))

s_pastor2, (st, r) = login("ladd@thebeggardanced.com", "PastorOwnPass1")
check("pastor logs in with their own password", st == 200 and r.get("ok"), (st, r))
st, sess = s_pastor2.get("/api/auth/session")
check("session now reports a personal password", sess.get("hasOwnPassword") is True, sess)
check("session no longer flags the shared password", sess.get("usedSharedPassword") is False, sess)

print("\n=== 6. Everyone else is unaffected (the migration is per person) ===")
s_worship, (st, r) = login("worship@test.ca", "SharedChurch1")
check("worship leader still uses the shared password", st == 200 and r.get("ok"), (st, r))
check("and keeps their own access level", r.get("access") == "Can Edit", r)

print("\n=== 7. Lockout no longer punishes the whole church ===")
for i in range(9):
    sx = Session()
    sx.post("/api/auth/password", {"email": "worship@test.ca",
                                   "password": "wrong%d" % i, "method": "email"})
sx = Session()
st, r = sx.post("/api/auth/password", {"email": "worship@test.ca",
                                       "password": "SharedChurch1", "method": "email"})
check("the person guessing wrong IS locked out", st == 429, (st, r))
sy = Session()
st, r = sy.post("/api/auth/password", {"email": "viewer@test.ca",
                                       "password": "SharedChurch1", "method": "email"})
check("someone else on the same connection is NOT locked out", st == 200, (st, r))

print("\n=== 8. A Full Admin can rescue someone who forgot their password ===")
s_dante, (st, r) = login("danteeugenemclaughlin@gmail.com", "SharedChurch1")
check("Full Admin logs in", st == 200 and r.get("ok"), (st, r))

st, r = s_worship.post("/api/admins/clear-password", {"email": "ladd@thebeggardanced.com"})
check("a non-Full-Admin CANNOT clear someone's password", st == 403, (st, r))

st, r = s_dante.post("/api/admins/clear-password", {"email": "ladd@thebeggardanced.com"})
check("Full Admin clears the forgotten password", st == 200 and r.get("ok"), (st, r))

s_pastor3, (st, r) = login("ladd@thebeggardanced.com", "SharedChurch1")
check("pastor is back on the shared password and can get in", st == 200 and r.get("ok"), (st, r))

print("\n=== 9. Nothing else got broken ===")
st, r = s_dante.get("/api/version")
check("version endpoint reports the build", bool(r.get("version")), r)

st, admins = s_dante.get("/api/admins")
check("admin list still loads", isinstance(admins, list) and len(admins) >= 4, admins)
check("password hashes are NOT exposed to the browser",
      not any("password_hash" in a for a in admins), "a hash was sent to the frontend")

st, r = s_dante.post("/api/prayer-requests", {"request": "test", "consent": True, "website": ""})
check("prayer request with consent still works", st == 200 and r.get("ok"), (st, r))
st, r = s_dante.post("/api/prayer-requests", {"request": "test", "website": ""})
check("prayer request without consent still refused", st == 400, (st, r))

st, r = s_dante.post("/api/store/sabc_content", {"test_key": "test_value"})
check("content saving still works", st == 200, (st, r))
st, r = s_dante.get("/api/store/sabc_content")
check("content reads back", r.get("test_key") == "test_value", r)

print("\n=== 10. Authenticator app can't be hijacked ===")
s9 = Session()
st, r = s9.post("/api/auth/setup-totp-for-login",
                {"email": "nobody@nowhere.com", "password": "SharedChurch1"})
check("can't create 2FA for an email not on the admin list", st == 403, (st, r))

st, r = s9.post("/api/auth/setup-totp-for-login",
                {"email": "viewer@test.ca", "password": "SharedChurch1"})
check("first-time 2FA setup during login still works", st == 200 and r.get("ok"), (st, r))

st, r = s9.post("/api/auth/setup-totp-for-login",
                {"email": "viewer@test.ca", "password": "SharedChurch1"})
check("CANNOT overwrite an existing authenticator (account takeover)", st == 409, (st, r))

print("\n" + "=" * 58)
print("PASSED: %d    FAILED: %d" % (len(passed), len(failed)))
if failed:
    print("\nFAILURES:")
    for f in failed:
        print("  - " + f)
print("=" * 58)
sys.exit(1 if failed else 0)
