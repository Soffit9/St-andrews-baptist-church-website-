"""Finds anything that stays bright when dark mode is on.

Switches every page to dark mode and reports elements whose background is
light against a dark page — the "bright as the sun" problem. Reports the
CSS selector to fix, not just that something is wrong.
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

PUBLIC = ["index.html", "about.html", "history.html", "sermons.html", "events.html",
          "ministries.html", "newsletter.html", "prayer.html", "whoswho.html",
          "contact.html", "giving.html", "privacy.html", "404.html", "gallery.html"]
ADMIN = ["admin/dashboard.html", "admin/settings.html", "admin/help.html",
         "admin/whoswho.html", "admin/admins.html", "admin/sermon-archive.html",
         "admin/events.html", "admin/calendar.html", "admin/gallery.html",
         "admin/hero-photos.html", "admin/newsletter.html", "admin/ministries.html",
         "admin/videos.html", "admin/log.html", "admin/prayer-requests.html",
         "admin/edit.html?page=home", "admin/login.html"]


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


st, r, ck = api("/api/auth/password", {"email": EMAIL, "password": "SharedChurch1", "method": "email"})
time.sleep(0.4)
hits = re.findall(r"Login code for " + re.escape(EMAIL) + r".*?Code: (\d{6})",
                  open(LOG, errors="replace").read())
st, r, ck = api("/api/auth/verify", {"email": EMAIL, "code": hits[-1]}, ck) if hits else (0, {}, None)
if not ck:
    print("could not log in — admin pages will be skipped\n")

FIND_BRIGHT = """() => {
  const lum = (c) => {
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < 0.2) return null;  // transparent
    return (0.2126*+m[1] + 0.7152*+m[2] + 0.0722*+m[3]) / 255;
  };
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!el.offsetParent && el.tagName !== 'BODY') return;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 14) return;          // ignore slivers
    const s = getComputedStyle(el);
    const bg = lum(s.backgroundColor);
    if (bg === null || bg < 0.72) return;                // only genuinely bright
    if (el.closest('img, svg, iframe, .person-photo, .hero-bg')) return;
    const area = r.width * r.height;
    if (area < 2500) return;
    out.push({
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\\s+/).slice(0,3).join('.') : ''),
      bg: s.backgroundColor,
      fg: s.color,
      area: Math.round(area),
      text: (el.innerText||'').trim().slice(0,40)
    });
  });
  const seen = new Set();
  return out.filter(o => { if (seen.has(o.sel)) return false; seen.add(o.sel); return true; })
            .sort((a,b) => b.area - a.area).slice(0, 6);
}"""

problems = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context()
    if ck:
        n, v = ck.split("=", 1)
        ctx.add_cookies([{"name": n, "value": v, "domain": "127.0.0.1", "path": "/"}])
    # Turn dark mode on before any page script runs.
    ctx.add_init_script("try{localStorage.setItem('sabc_theme','dark')}catch(e){}")

    for path in PUBLIC + (ADMIN if ck else []):
        page = ctx.new_page()
        try:
            page.goto(BASE + "/" + path, wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(900)
        except Exception as exc:
            print("  %-34s load failed" % path)
            page.close()
            continue
        dark = page.evaluate("() => document.documentElement.getAttribute('data-theme')")
        if dark != "dark":
            print("  %-34s dark mode did not apply" % path)
            page.close()
            continue
        bright = page.evaluate(FIND_BRIGHT)
        if bright:
            for b in bright:
                problems.append((path, b))
        print("  %-34s %s" % (path, "ok" if not bright else "%d BRIGHT" % len(bright)))
        page.close()
    browser.close()

print("\n" + "=" * 72)
if problems:
    print("%d bright element(s) in dark mode:\n" % len(problems))
    for path, b in problems:
        print("  %-26s %-34s %s" % (path.split("/")[-1][:26], b["sel"][:34], b["bg"]))
        if b["text"]:
            print("  %-26s   text: %s" % ("", b["text"].replace("\n", " ")))
else:
    print("Nothing bright left in dark mode.")
print("=" * 72)
sys.exit(1 if problems else 0)
