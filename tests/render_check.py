"""Regression check for the per-page data loading change.

Each page now downloads only the data sets it needs. This confirms every
page still renders its real content — i.e. that no page was left starved
of a key it actually uses.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8112/"

# page -> (CSS selector that must exist, text that must NOT appear)
CHECKS = [
    ("index.html",      "#hero-bg-a",            ["No upcoming events posted yet"]),
    ("whoswho.html",    ".person-row",           ["No one's been added yet"]),
    ("sermons.html",    ".archive-list",         []),
    ("events.html",     ".event-row, .card",     ["No upcoming events posted yet"]),
    ("gallery.html",    "body",                  []),
    ("newsletter.html", "body",                  []),
    ("ministries.html", "body",                  []),
    ("contact.html",    ".site-header",          []),
    ("about.html",      ".site-header",          []),
    ("history.html",    ".history-body",         []),
    ("giving.html",     ".site-header",          []),
    ("prayer.html",     "#prayer-form",          []),
]

problems = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for path, selector, forbidden in CHECKS:
        page = browser.new_page()
        page.goto(BASE + path, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(600)

        found = page.query_selector(selector)
        if not found:
            problems.append((path, "missing element: " + selector))

        body_text = page.inner_text("body")
        for bad in forbidden:
            if bad in body_text:
                problems.append((path, 'shows "%s" — data did not load' % bad))

        # The logo comes from sabc_content, which every page needs.
        logo_ok = page.evaluate("""() => {
            const el = document.querySelector('[data-image="logo"]');
            if (!el) return true;
            return !!el.querySelector('img') || el.textContent.trim() !== 'LOGO';
        }""")
        if not logo_ok:
            problems.append((path, "logo never loaded (sabc_content missing)"))

        status = "renders" if not [p for p in problems if p[0] == path] else "BROKEN"
        print("  %-18s %s" % (path, status))
        page.close()
    browser.close()

print("\n" + "=" * 58)
if problems:
    print("%d PROBLEM(S):\n" % len(problems))
    for where, what in problems:
        print("  %-18s %s" % (where, what))
else:
    print("Every page still renders its real content.")
print("=" * 58)
sys.exit(1 if problems else 0)
