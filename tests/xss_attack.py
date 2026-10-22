"""Attack simulation.

Pretends a "Can Edit" volunteer has poisoned the stored content with every
injection trick that matters, then loads the real public pages in a real
browser and checks nothing executes. The page content is served by the
actual site files; only the /api/ responses are faked, so the rendering
code under test is exactly what ships.
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8111/"

# Every one of these would run script on a vulnerable page.
PAYLOADS = {
    "img_onerror": '"><img src=x onerror=window.__pwned=1>',
    "script_tag": '<script>window.__pwned=1</script>',
    "js_url": 'javascript:window.__pwned=1',
    "fb_js_url": 'javascript:window.__pwned=1//facebook.com',
    "attr_breakout": '" onmouseover="window.__pwned=1" x="',
    "style_breakout": '50%;"><img src=x onerror=window.__pwned=1><b style="',
    "svg_payload": 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9IndpbmRvdy5fX3B3bmVkPTEiPjwvc3ZnPg==',
}

ROSTER = [{
    "id": "evil1",
    "name": PAYLOADS["img_onerror"],
    "role": PAYLOADS["script_tag"],
    "group": "Deacons",
    "phone": PAYLOADS["attr_breakout"],
    "email": PAYLOADS["script_tag"],
    "photo": PAYLOADS["svg_payload"],
    "photo_pos": PAYLOADS["style_breakout"],
    "photo_pos_x": PAYLOADS["style_breakout"],
}]

SERMONS = [{
    "id": "evil2",
    "date": "2026-10-18",
    "title": PAYLOADS["img_onerror"],
    "speaker": PAYLOADS["script_tag"],
    "passage": PAYLOADS["attr_breakout"],
    "youtube_id": PAYLOADS["fb_js_url"],
}]

CONTENT = {
    "global": {"logo": PAYLOADS["js_url"], "logo_h": PAYLOADS["style_breakout"]},
    "sermons": {
        "latest_title": PAYLOADS["img_onerror"],
        "latest_speaker": PAYLOADS["script_tag"],
        "youtube_id": PAYLOADS["fb_js_url"],
    },
    "home": {"welcome_title": PAYLOADS["img_onerror"],
             "welcome_body": PAYLOADS["script_tag"]},
    "about": {"history": PAYLOADS["script_tag"], "photo": PAYLOADS["js_url"]},
}

FAKE = {
    "sabc_whoswho": ROSTER,
    "sabc_sermon_archive": SERMONS,
    "sabc_content": CONTENT,
    "sabc_gallery": [{"id": "g1", "photo": PAYLOADS["svg_payload"],
                      "caption": PAYLOADS["img_onerror"]}],
    "sabc_hero_photos": [{"id": "h1", "photo": PAYLOADS["js_url"],
                          "pos": PAYLOADS["style_breakout"]}],
}

PAGES = ["index.html", "whoswho.html", "sermons.html", "about.html", "gallery.html"]
problems = []


def handle_route(route):
    url = route.request.url
    if "/api/store/" in url:
        key = url.rsplit("/", 1)[-1].split("?")[0]
        return route.fulfill(status=200, content_type="application/json",
                             body=json.dumps(FAKE.get(key)))
    if "/api/auth/session" in url:
        return route.fulfill(status=200, content_type="application/json",
                             body=json.dumps({"loggedIn": True, "name": "Test",
                                              "email": "t@t.ca", "access": "Full Admin",
                                              "hasOwnPassword": True}))
    if "/api/" in url:
        return route.fulfill(status=200, content_type="application/json", body="{}")
    return route.continue_()


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for page_path in PAGES:
        page = browser.new_page()
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        page.route("**/api/**", handle_route)
        try:
            page.goto(BASE + page_path, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(1500)
        except Exception as exc:
            problems.append((page_path, "LOAD FAILED: %s" % exc))
            page.close()
            continue

        pwned = page.evaluate("() => !!window.__pwned")
        # Did any payload survive as *live markup* rather than visible text?
        live = page.evaluate("""() => {
            const bad = [];
            if (document.querySelector('img[onerror]')) bad.push('img[onerror] element exists');
            if (document.querySelector('[onmouseover]')) bad.push('onmouseover attribute exists');
            document.querySelectorAll('a[href]').forEach(a => {
              const h = (a.getAttribute('href')||'').toLowerCase().replace(/[\\u0000-\\u001f]/g,'');
              if (h.startsWith('javascript:')) bad.push('javascript: link: ' + h.slice(0,40));
            });
            document.querySelectorAll('img[src]').forEach(i => {
              const s = (i.getAttribute('src')||'').toLowerCase();
              if (s.startsWith('javascript:') || s.startsWith('data:image/svg')) bad.push('dangerous img src: ' + s.slice(0,40));
            });
            return bad;
        }""")

        if pwned:
            problems.append((page_path, "EXECUTED: window.__pwned was set"))
        for d in dialogs:
            problems.append((page_path, "DIALOG: " + d))
        for b in live:
            problems.append((page_path, b))

        status = "safe" if not (pwned or dialogs or live) else "VULNERABLE"
        print("  %-18s %s" % (page_path, status))
        page.close()
    browser.close()

print("\n" + "=" * 60)
if problems:
    print("%d PROBLEM(S):\n" % len(problems))
    for where, what in problems:
        print("  %-16s %s" % (where, what))
else:
    print("Every payload rendered as harmless text. Nothing executed.")
print("=" * 60)
sys.exit(1 if problems else 0)
