"""Loads every page in a real browser under the live CSP and reports any
CSP violation or JavaScript error. A broken policy here would break the
site for the whole congregation, so this runs before it ships."""
import sys
from playwright.sync_api import sync_playwright

PAGES = [
    "index.html", "about.html", "history.html", "sermons.html", "events.html",
    "ministries.html", "newsletter.html", "prayer.html", "whoswho.html",
    "contact.html", "giving.html", "privacy.html", "404.html",
    "admin/login.html", "admin/dashboard.html", "admin/settings.html",
    "admin/admins.html", "admin/sermon-archive.html", "admin/whoswho.html",
    "admin/events.html", "admin/calendar.html", "admin/gallery.html",
    "admin/hero-photos.html", "admin/newsletter.html", "admin/ministries.html",
    "admin/prayer-requests.html", "admin/videos.html", "admin/log.html",
    "admin/edit.html", "admin/help.html",
]

BASE = "http://127.0.0.1:8111/"
problems = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for page_path in PAGES:
        page = browser.new_page()
        msgs = []
        page.on("console", lambda m: msgs.append((m.type, m.text)))
        page.on("pageerror", lambda e: msgs.append(("pageerror", str(e))))
        try:
            page.goto(BASE + page_path, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(1200)
        except Exception as exc:
            problems.append((page_path, "LOAD FAILED: %s" % exc))
            page.close()
            continue

        csp_hits = [t for k, t in msgs
                    if "Content Security Policy" in t or "Refused to" in t]
        # Network failures to the outside world are expected in this sandbox
        # and are not CSP problems; filter them out so real issues stand out.
        errors = [t for k, t in msgs
                  if k in ("error", "pageerror")
                  and "Failed to load resource" not in t
                  and "ERR_" not in t
                  and "net::" not in t]
        for t in csp_hits:
            problems.append((page_path, "CSP: " + t[:160]))
        for t in errors:
            problems.append((page_path, "JS:  " + t[:160]))
        status = "clean" if not csp_hits and not errors else "ISSUES"
        print("  %-34s %s" % (page_path, status))
        page.close()
    browser.close()

print("\n" + "=" * 60)
if problems:
    print("%d PROBLEM(S) FOUND:\n" % len(problems))
    for where, what in problems:
        print("  %-28s %s" % (where, what))
else:
    print("All %d pages load clean under the live CSP." % len(PAGES))
print("=" * 60)
sys.exit(1 if problems else 0)
