"""Measures what each page actually downloads, in a real browser, over a
throttled connection resembling the church's.

Run with 'before' to force the old behaviour (every page fetches all 13
data sets) and 'after' for the current code.
"""
import sys
from playwright.sync_api import sync_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 else "after"
BASE = "http://127.0.0.1:8112/"
PAGES = ["index.html", "whoswho.html", "sermons.html", "contact.html", "gallery.html"]

# Force the old all-keys behaviour for the 'before' measurement.
FORCE_ALL = """
  window.__forceAllKeys = true;
  const orig = window.fetch;
"""

results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for page_path in PAGES:
        ctx = browser.new_context()
        page = ctx.new_page()
        if MODE == "before":
            page.add_init_script(
                "window.__PERF_FORCE_ALL = true;"
            )
        total = {"bytes": 0}

        def on_response(resp):
            try:
                body = resp.body()
                total["bytes"] += len(body)
            except Exception:
                pass

        page.on("response", on_response)
        page.goto(BASE + page_path, wait_until="networkidle", timeout=60000)
        # How long until the main content is actually on screen?
        paint = page.evaluate("""() => {
            const e = performance.getEntriesByType('paint')
                       .find(p => p.name === 'first-contentful-paint');
            return e ? Math.round(e.startTime) : null;
        }""")
        results.append((page_path, total["bytes"] / 1024, paint))
        print("  %-18s %8.1f KB downloaded   first paint %sms"
              % (page_path, total["bytes"] / 1024, paint))
        ctx.close()
    browser.close()

print("\n  %-18s %8.1f KB  (average per page)"
      % ("AVERAGE", sum(r[1] for r in results) / len(results)))
