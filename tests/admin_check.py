"""Loads every ADMIN page while actually logged in, and reports any
JavaScript error or CSP violation.

This is the check that was missing: admin pages bounce to the login screen
when you're not authenticated, so testing them logged-out just tests the
login page over and over. This logs in through the real API first, carries
the session cookie into the browser, and then loads each page.
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8112"
LOG = sys.argv[1] if len(sys.argv) > 1 else "/tmp/f.log"
EMAIL = "danteeugenemclaughlin@gmail.com"
PASSWORD = "SharedChurch1"

PAGES = [
    "admin/dashboard.html", "admin/whoswho.html", "admin/events.html",
    "admin/calendar.html", "admin/gallery.html", "admin/hero-photos.html",
    "admin/newsletter.html", "admin/ministries.html", "admin/videos.html",
    "admin/sermon-archive.html", "admin/prayer-requests.html",
    "admin/admins.html", "admin/log.html", "admin/settings.html",
    "admin/help.html", "admin/edit.html?page=home",
]


def api(path, body=None, cookie=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json"})
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req) as r:
            sc = r.headers.get("Set-Cookie")
            return r.status, json.loads(r.read() or b"{}"), (sc.split(";")[0] if sc else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), None


# --- log in for real -------------------------------------------------
st, r, ck = api("/api/auth/password", {"email": EMAIL, "password": PASSWORD, "method": "email"})
if st != 200:
    print("could not start login:", st, r)
    sys.exit(2)
time.sleep(0.4)
hits = re.findall(r"Login code for " + re.escape(EMAIL) + r".*?Code: (\d{6})",
                  open(LOG, errors="replace").read())
if not hits:
    print("no login code found in", LOG)
    sys.exit(2)
st, r, ck = api("/api/auth/verify", {"email": EMAIL, "code": hits[-1]}, ck)
if st != 200 or not ck:
    print("login failed:", st, r)
    sys.exit(2)
print("logged in as %s (%s)\n" % (r.get("name"), r.get("access")))

name, value = ck.split("=", 1)
problems = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context()
    ctx.add_cookies([{"name": name, "value": value,
                      "domain": "127.0.0.1", "path": "/"}])
    for path in PAGES:
        page = ctx.new_page()
        msgs = []
        page.on("console", lambda m: msgs.append((m.type, m.text)))
        page.on("pageerror", lambda e: msgs.append(("pageerror", str(e))))
        try:
            page.goto(BASE + "/" + path, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(1200)
        except Exception as exc:
            problems.append((path, "LOAD FAILED: %s" % exc))
            page.close()
            continue

        if "login.html" in page.url:
            problems.append((path, "bounced to login — not actually tested"))
            page.close()
            continue

        errs = [t for k, t in msgs if k in ("error", "pageerror")
                and "Failed to load resource" not in t and "net::" not in t]
        # Did the page actually put anything on screen?
        body_len = len(page.inner_text("body").strip())
        empty = body_len < 120

        for t in errs:
            problems.append((path, "JS: " + t[:170]))
        if empty:
            problems.append((path, "page rendered almost nothing (%d chars)" % body_len))

        print("  %-34s %s" % (path, "ok" if not errs and not empty else "BROKEN"))
        page.close()
    browser.close()

print("\n" + "=" * 64)
if problems:
    print("%d PROBLEM(S):\n" % len(problems))
    for where, what in problems:
        print("  %-30s %s" % (where, what))
else:
    print("All %d admin pages load and render while logged in." % len(PAGES))
print("=" * 64)
sys.exit(1 if problems else 0)
