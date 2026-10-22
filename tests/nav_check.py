"""Clicks every tile on the admin dashboard and confirms it navigates.

This is the check that would have caught the broken dashboard: the page
itself loaded perfectly, it was only *clicking* that did nothing, because
the Content Security Policy blocked the inline onclick handlers. Testing
that a page renders is not the same as testing that it works.
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
        return e.code, {}, None


st, r, ck = api("/api/auth/password", {"email": EMAIL, "password": PASSWORD, "method": "email"})
time.sleep(0.4)
hits = re.findall(r"Login code for " + re.escape(EMAIL) + r".*?Code: (\d{6})",
                  open(LOG, errors="replace").read())
if not hits:
    print("could not log in")
    sys.exit(2)
st, r, ck = api("/api/auth/verify", {"email": EMAIL, "code": hits[-1]}, ck)
if not ck:
    print("login failed")
    sys.exit(2)
name, value = ck.split("=", 1)

problems = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context()
    ctx.add_cookies([{"name": name, "value": value, "domain": "127.0.0.1", "path": "/"}])

    page = ctx.new_page()
    page.goto(BASE + "/admin/dashboard.html", wait_until="networkidle", timeout=45000)
    page.wait_for_timeout(800)

    tiles = page.evaluate("""() => [...document.querySelectorAll('.quick-grid button')]
        .filter(b => b.offsetParent !== null)
        .map(b => (b.querySelector('strong')||{}).textContent || '(unnamed)')""")
    print("found %d visible tiles on the dashboard\n" % len(tiles))
    if not tiles:
        problems.append(("dashboard", "no tiles found at all"))
    page.close()

    for i, label in enumerate(tiles):
        page = ctx.new_page()
        violations = []
        page.on("console", lambda m: violations.append(m.text)
                if ("Refused to" in m.text or "Content Security Policy" in m.text) else None)
        page.goto(BASE + "/admin/dashboard.html", wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(500)
        start_url = page.url
        try:
            page.evaluate("""(i) => {
                const b = [...document.querySelectorAll('.quick-grid button')]
                          .filter(x => x.offsetParent !== null)[i];
                b.click();
            }""", i)
            page.wait_for_timeout(1200)
        except Exception as exc:
            problems.append((label, "click threw: %s" % exc))
            page.close()
            continue

        moved = page.url != start_url
        if not moved:
            problems.append((label, "clicking did nothing — still on the dashboard"))
        for v in violations:
            problems.append((label, "CSP: " + v[:120]))
        dest = page.url.rsplit("/", 1)[-1] if moved else "(nowhere)"
        print("  %-22s -> %s" % (label.strip()[:22], dest))
        page.close()
    browser.close()

print("\n" + "=" * 62)
if problems:
    print("%d PROBLEM(S):\n" % len(problems))
    for where, what in problems:
        print("  %-22s %s" % (where.strip()[:22], what))
else:
    print("Every dashboard tile navigates correctly under the live CSP.")
print("=" * 62)
sys.exit(1 if problems else 0)
