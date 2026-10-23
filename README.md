# St. Andrews Baptist Church — Website

Live at **https://standrewsbaptistchurch.com** · self-hosted on a Raspberry Pi 4 in the church at 115 King Street, St. Andrews, NB.

This file is the handover document. If you're picking this up cold — a new volunteer, or an AI assistant in a fresh conversation — read it top to bottom before changing anything.

---

## Build 2026-10-22g

This build changes how logins work and **moves everyone's password and
authenticator secret out of `backend/admins.json`**. That file is tracked in
git, so anything stored in it was one `git pull` away from being wiped. They
now live in `backend/credentials.json`, which is gitignored.

The move happens automatically the first time the backend starts. But the
pull itself can overwrite `admins.json` *before* the backend gets a chance to
read the old secrets out of it — so take a copy first:

```bash
cd ~/st-andrews-baptist-church-website-

# 1. Safety copy of the current roster (this holds everyone's 2FA secrets)
cp backend/admins.json ~/admins-backup.json

# 2. Park any local edits so the pull can't fail halfway
git stash

# 3. Get the new code
git pull

# 4. Put the real roster back if the pull reset it
cp ~/admins-backup.json backend/admins.json

# 5. Restart — this is when the secrets get moved to safety
sudo systemctl restart sabc-backend
sudo systemctl restart caddy

# 6. Confirm it worked
ls -l backend/credentials.json          # should exist, -rw-------
grep -c totp_secret backend/admins.json # should print 0
curl -s localhost/api/version           # should say 2026-10-22g
```

If step 6 looks right, everyone's authenticator apps still work and nothing
was lost. Keep `~/admins-backup.json` for a week, then delete it.

### What changed about logging in

- **Everyone can set their own password** — Settings → Your Own Password.
  Until someone does, the shared church password still works *for them*, so
  the switch happens person by person and nobody gets locked out mid-way.
- **Once you set your own, the shared password stops working for you.**
- **Forgot yours?** A Full Admin hits *Reset their password* on the Admin
  Users page. That drops you back to the shared password so you can get in
  and pick a new one. Nobody can read anyone's password, ever.
- **Unknown emails are now refused.** Previously, any email address not on
  the admin list was let in *as Full Admin* if you knew the shared password.
  You must now actually be on the Admin Users list.
  (`danteeugenemclaughlin@gmail.com` is always on it, so the church can never
  be locked out of its own site.)
- **The login code is never shown on screen any more.** When email sending
  failed, the old build printed the 6-digit code straight onto the login
  page, which quietly made the second step meaningless. If email can't send,
  the code goes to the Pi's log instead:
  `sudo journalctl -u sabc-backend | grep "Login code"`
- **A bad password no longer locks out the whole church.** Failures are
  counted per person now, not per internet connection.
- Minimum password length is 8 characters.

### Dark mode fixes in 2026-10-22g

Six elements stayed bright when the rest of the page went dark. Same root
cause in different clothing — a light background set somewhere the dark-mode
rules couldn't reach:

- **The "set your own password" panel on Settings** used an inline `style`
  attribute. Inline styles beat every stylesheet rule, including dark mode,
  so it stayed white on a dark page. Now a class (`.role-panel.needs-doing`)
  that dark mode can override.
- **Bare `<button>` elements** — the verse "Previous day" arrows and the
  calendar month arrows — had no background set, so they fell back to the
  browser's default white.
- **Event date badges** were a pale blue tile: fine on white, a beacon on
  dark.

`tests/dark_check.py` now switches every page to dark mode and reports any
element with a light background against a dark page, naming the selector to
fix. Run it after any styling change.

**Rule of thumb: never set a colour in an inline `style` attribute.** It
cannot be overridden by dark mode. Put it in `style.css` with a
`[data-theme="dark"]` counterpart.

### Small fixes in 2026-10-22f

- Visitor stats showed twice on the dashboard — a compact row and a large
  stacked block. The large one was marked `hidden`, but a class rule setting
  `display` beats the `hidden` attribute, so it showed anyway. Removed
  outright rather than hidden, and "this month" moved into the compact row.
- Two yellow bars stacked on the dashboard read as two warnings. The
  "set your own password" one is information, not a warning, so it is now
  blue and much shorter. The selector uses `.notice.notice-action` so it
  can't lose to the plain `.notice` rule.
- Removed the "About this history" box from the history page.
- **Assets no longer cache for 10 minutes.** `Cache-Control` for
  `/assets/*` is now `no-cache`, which means "check with the server first",
  not "don't store". Caddy still answers with a 304 and no body when
  nothing changed, so it stays fast — but a browser can no longer serve a
  stale copy of the admin JavaScript after an update. The old 10-minute
  cache saved almost nothing on a site this size and cost real confusion:
  after every update there was a window where things looked broken when it
  was only an old file being held.

### Fixed in 2026-10-22e: dashboard tiles stopped working

The Content Security Policy added in `d` blocked fourteen dashboard tiles.
They navigated using inline `onclick="window.location.href=..."` attributes,
and `script-src 'self'` blocks inline script — which is the whole point of
the policy, since the browser cannot tell our inline script from an
attacker's. The tiles that kept working used event listeners already.

All fourteen now use a `data-goto` attribute wired up in `admin.js`. The
policy stays strict.

**The testing lesson, because it matters more than the bug.** Two mistakes
let this through:

1. The browser tests loaded admin pages **logged out**, so every one of them
   bounced to the login screen. Fifteen "passing" admin pages were really the
   login page fifteen times. `tests/admin_check.py` now logs in through the
   real API first and fails loudly if a page redirects.
2. The tests served pages **without the CSP header**, so the policy under
   test was not the policy in production. `tests/perf_server.py` now reads
   the header straight out of `Caddyfile.example`.

And the deeper one: the dashboard *rendered* perfectly while broken — only
clicking did nothing. Checking that a page loads is not checking that it
works. `tests/nav_check.py` clicks every tile and asserts it navigates.

**When adding anything to the admin area: no inline `onclick`, no inline
`<script>`.** Put it in `assets/*.js` and attach it with `addEventListener`.
Run `tests/nav_check.py` afterwards.

### Speed — why pages used to pause, and what changed

Every page was downloading **all thirteen** stored data sets before showing
anything. Opening the homepage also pulled down the entire photo gallery,
every newsletter and every ministry page — none of which the homepage
displays. Photos are stored inline as base64 text, so that was megabytes
standing between a visitor and the first thing they see.

Measured in a real browser against a realistic amount of content
(3 hero photos, 12 gallery photos, 10 people with photos, 2 newsletters,
3 ministries):

| Page | Before | After | Less |
|---|---|---|---|
| Homepage | 19.2 MB | 2.2 MB | 89% |
| Who's Who | 19.2 MB | 2.0 MB | 90% |
| Sermons | 19.2 MB | 0.2 MB | 99% |
| Contact | 19.1 MB | 0.1 MB | 99% |

Three changes did it:

1. **Each page loads only the data it shows** (`PAGE_KEYS` in `content.js`).
   Admin pages still load everything — the editing screens are interlinked,
   and a handful of admins matter less than every visitor.
2. **The store API now sends an ETag.** A returning visitor's browser asks
   "has this changed?" and gets a 304 with no body — a 1.9 MB hero photo
   set becomes 0 bytes on repeat visits. It still updates the instant an
   admin saves, because the tag is built from the file's modification time.
3. **Images are lazy-loaded**, so a phone only decodes the photos actually
   scrolled into view.

**The Gallery is still heavy (~27 MB)** and this is the honest limit of the
current design: gallery photos genuinely are the page, and they all live in
one JSON file, so they all arrive at once. The real fix is storing uploaded
photos as actual image files rather than base64 inside JSON — then Caddy
serves them individually, with compression and caching, and lazy loading
means a visitor downloads only what they scroll to. That is the next
worthwhile piece of work. The Gallery is login-gated, so it affects church
members rather than the public.

**If you add a new page**, add its key list to `PAGE_KEYS` in `content.js`.
A page that isn't listed falls back to loading everything — slower, but it
can never come up blank because a key was missed.

### Security review — what was found and fixed (Oct 2026)

A full pass over the code before opening it up to more people. Six real
issues, all now closed and covered by tests.

| What was wrong | Why it mattered |
|---|---|
| The 6-digit login code was printed on the login page whenever email failed | Anyone past step one read their own second factor. Two-factor login was doing nothing. |
| Any email not on the admin list was let in **as Full Admin** | Shared password + a made-up address = complete control of the site. |
| Passwords and 2FA secrets were stored in a git-tracked file | A routine `git pull` could wipe everyone's login. |
| `/api/admins` sent password hashes to the browser | Hashes have no business leaving the Pi. |
| The sermon link, event flyer name and photo fields went into the page unescaped | Someone with only "Can Edit" could plant a `javascript:` link or `"` breakout and take a Full Admin's session when they clicked it. |
| Anyone who knew a working password could overwrite another person's authenticator app | Account takeover, and it locked the real owner out. |

Also added, as defence in depth rather than fixes:

- **A Content Security Policy.** Every script on this site is an external
  file in `/assets/` — there is no inline JavaScript anywhere — so the
  browser is told to run scripts only from this site's own files. If markup
  ever did get injected, it would not execute. Verified by loading all 30
  pages in a real browser and confirming zero violations.
- **`safeUrl()` in `content.js`.** Every URL that ends up in an `href` or
  `src` is scheme-checked. `javascript:`, `vbscript:`, `data:text/html` and
  `data:image/svg+xml` are all refused. Escaping alone does not stop these —
  `javascript:alert(1)` contains no HTML special characters.
- **`num()` in `content.js`.** Stored numbers (photo focus points, heights)
  are forced to real numbers before going into a `style="..."` attribute,
  so a poisoned value can't break out of the attribute.

**If you add code, keep these two rules:** any URL rendered into a page goes
through `safeUrl()`, and any stored value rendered into a `style` attribute
goes through `num()`. Plain text still goes through `esc()`, as before.

#### Running the tests

```bash
# Backend: 35 checks on login, permissions and password handling
cd backend && python3 app.py &
python3 test_auth.py            # (test files are in the repo under tests/)
```

The XSS test is worth understanding: it poisons stored content with real
attack payloads, loads the public pages in a real browser, and fails if
anything executes. It was itself verified by deliberately re-introducing the
old vulnerable code and confirming the test caught all nine holes.

### Going live with the team — the order that works

1. **Update the Pi** using the steps at the top of this file.
2. **Check the build tag** on the admin dashboard says `2026-10-22d`.
3. **Set your own password** — Settings → Your Own Password.
4. **Set up your authenticator app** — Settings → Your Authenticator App.
5. **Log out and back in** with your new password to prove it works
   *before* anyone else is depending on it.
6. **Add the team** — Admin Users. Use each person's **personal** email,
   not a shared one, and give the lowest access level that lets them do
   their job.
7. **Tell each person** to log in with the shared church password, then set
   their own in Settings. Point them at Dashboard → How Do I…?
8. **Once everyone has their own**, change the shared password (Settings →
   Change Shared Password). From then on it is only a fallback for new
   people and for password resets.

Do not skip step 5. It is the step that catches a mistake while it is still
only your problem.

### Church email addresses (Cloudflare Email Routing)

Free, and the domain is already there. Addresses like
`worship@standrewsbaptistchurch.com` forward to whoever's personal inbox.

1. Cloudflare dashboard → the `standrewsbaptistchurch.com` domain
2. **Email** → **Email Routing** → **Get started** (it adds the MX records
   itself — don't add them by hand)
3. **Destination addresses** → add each person's personal email. Each one
   gets a verification link they must click; nothing works until they do.
4. **Routing rules** → **Create rule**: custom address `worship@…` →
   send to that person's verified address. Repeat per role.
5. Optional **catch-all** → send anything else to the main church inbox, so
   a typo'd address doesn't bounce.

**It is receive-only.** Mail forwards in; nobody can *send* as
`worship@standrewsbaptistchurch.com`. Sending — including this site's login
codes — still goes through the real church mailbox. Keep role addresses for
the public contact page, and use personal addresses for admin logins so a
login code reaches one person rather than a shared inbox.

### Checking which build is actually live

The admin dashboard's top strip now shows `build <version>`, read from the
`VERSION` file. If it doesn't match what you just pushed, the Pi didn't get
it — the usual cause is a GitHub pull request that was never merged into
`main`. Choose **"Commit directly to the main branch"** when uploading.

---

## 1. What this is and why

A small church needed a website they could **edit themselves**, without paying monthly for Wix or Squarespace and without depending on one technical person forever. So: a static site with a small admin panel, running on hardware the church owns.

The guiding constraints, in priority order:

1. **Non-technical people must be able to run it.** Every piece of content is editable through a browser by someone who has never seen a terminal.
2. **The church owns everything.** Domain, hosting, accounts. No vendor can hold it hostage, and no individual volunteer becomes a single point of failure. (This is a lesson learned the hard way — see §8.)
3. **Free or near-free to run.** Current total cost: ~$10.46/year for the domain. Nothing else.
4. **It has to survive neglect.** Power cuts, reboots, months without anyone touching it.

---

## 2. How it fits together

```
Visitor → Cloudflare (DNS + HTTPS) → Cloudflare Tunnel → Raspberry Pi
                                                            ├── Caddy  (serves files, port 80)
                                                            └── Flask  (the /api/* backend, port 5000)
```

- **Cloudflare Tunnel** means no port forwarding and nothing exposed on the church's network. The Pi makes an outbound connection; nothing reaches in.
- **Caddy** serves the HTML/CSS/JS and proxies `/api/*` to Flask.
- **Flask** handles login, content storage, prayer requests, and visitor counts.

Three systemd services, all auto-start on boot: `caddy`, `sabc-backend`, `cloudflared`.

---

## 3. Every file, and what it does

### Public pages (site root)
| File | Purpose |
|---|---|
| `index.html` | Homepage: hero with rotating photos, daily Bible verse, pastor's welcome, "who to contact" buttons, upcoming events, latest sermon |
| `about.html` | Pastor bio, church history, beliefs, partner ministries |
| `sermons.html` | Latest sermon video + archive grouped by year |
| `events.html` | Upcoming events, grouped by month |
| `ministries.html` | Ministry/group pages. `?p=slug` shows one; no parameter shows the index |
| `newsletter.html` | Newsletter issues in a newspaper layout |
| `prayer.html` | Public prayer request form |
| `whoswho.html` | Searchable, filterable, collapsible people directory |
| `contact.html` | Address, phone, service times, embedded map |
| `giving.html` | E-transfer and tax receipt info |
| `gallery.html` | Photo downloads — **login required**, not in the public nav |
| `404.html` | Custom not-found page (uses absolute paths — it renders at any URL depth) |
| `robots.txt` | Blocks `/admin/` and `/gallery.html` from search engines |
| `sitemap.xml` | Submitted to Google Search Console |

### Admin pages (`/admin/`, all login-gated)
`login.html` · `dashboard.html` (tiles + visitor stats) · `edit.html` (generic page editor driven by `CMS_SCHEMA`) · `whoswho.html` · `events.html` · `calendar.html` (volunteer roles per day) · `sermon-archive.html` · `videos.html` (stashed video links) · `gallery.html` · `hero-photos.html` · `newsletter.html` · `ministries.html` · `prayer-requests.html` · `admins.html` · `log.html` (change log) · `settings.html` (password + authenticator)

### Shared assets (`/assets/`) — **edit these, not the HTML**
| File | Contains |
|---|---|
| `content.js` | `esc()` HTML escaping · `CMS_SCHEMA` (defines every editable field) · server-store load/save · `cmsApplyToPage()` · `videoEmbedHtml()` · `compressImage()` · dark mode |
| `app.js` | Public page behaviour: nav, prayer form, Bible verse, visit beacon |
| `admin.js` | Login flow, edit page + live preview, dashboard, access-level gating |
| `features.js` | The big one: Who's Who, events, calendar, sermon archive, gallery, newsletter, ministries, prayer inbox, settings, videos |
| `style.css` | All styling, including dark mode |

**Pages load these as shared files.** Editing `assets/features.js` updates the whole site at once. (They used to be inlined into every page — 3.35 MB of HTML. Now 48 KB total.)

### Backend (`/backend/`)
| File | Purpose |
|---|---|
| `app.py` | The Flask application — everything server-side |
| `setup_admin.py` | **Run on the Pi** to set the shared password and email credentials |
| `admins.json` | Admin roster. Tracked in git (seed data); gains `totp_secret` fields at runtime |
| `requirements.txt` | flask, gunicorn, pyotp, qrcode, **Pillow** (Pillow is easy to miss — qrcode silently needs it) |
| `Caddyfile.example` | Copy to `/etc/caddy/Caddyfile` |
| `sabc-backend.service.example` | Copy to `/etc/systemd/system/` |

**Never committed** (see `.gitignore`): `config.json` (password hash + Gmail credentials), `prayer_requests.json`, `visits.json`, `data/`.

---

## 4. How content storage works

All editable content lives in `backend/data/<key>.json`, written by the server, readable through `/api/store/<key>`.

`sabc_content` (all page text/photos) · `sabc_whoswho` · `sabc_events` · `sabc_schedule` + `sabc_schedule_roles` + `sabc_roster` (volunteer calendar) · `sabc_sermon_archive` · `sabc_gallery` · `sabc_hero_photos` · `sabc_videos` · `sabc_ministries` · `sabc_newsletters` · `sabc_audit_log`

**Keys are whitelisted in `app.py`.** Adding a new content type means adding the key in *two* places: `ALLOWED_STORE_KEYS` (backend) and `STORE_KEYS` (content.js). Miss either and saves fail silently.

**How the frontend uses it:** everything is fetched once on page load into `window.__serverStore`, then `loadJSON()` / `saveJSON()` read and write that cache synchronously while saving to the server in the background. This exists so the large body of existing code didn't need rewriting to be async.

**Critical gotcha:** `saveJSON()` returns a promise. If the code navigates away immediately after saving, **you must `await` it** — otherwise the browser cancels the request mid-flight and the save silently vanishes. This caused a long-running "nothing saves" bug.

---

## 5. Security — what's been done and why

This site takes submissions from the public and stores private prayer requests, so this section matters.

- **Passwords** are hashed server-side. Nothing resembling a password exists in any browser-readable file.
- **Two-step login:** shared password, then either an emailed code or a **per-person** authenticator app. Each person's authenticator secret is their own — setting one up never affects anyone else.
- **`danteeugenemclaughlin@gmail.com` is permanently Full Admin**, enforced in `app.py`. Deliberate lockout protection; it can't be removed through the UI.
- **Access levels:** Full Admin (everything) · Can Edit (no Admin Users, no Prayer Requests) · View Only (Church Calendar + Gallery). **Enforced server-side**, not just hidden buttons.
- **Brute-force protection:** 8 failed attempts → 15-minute lockout, keyed on the real client IP from `CF-Connecting-IP` (using `remote_addr` would lock out the entire church, since everything arrives from the tunnel).
- **XSS:** every piece of user-entered text passes through `esc()` before display. The prayer form takes input from anyone on the internet and admins view it logged-in — unescaped, that was a privilege-escalation path.
- **`/backend/*` is blocked in Caddy**, and sensitive files are written `0600`. Without this, `config.json` and prayer requests were publicly downloadable.
- **Session cookies:** HttpOnly, SameSite=Lax, Secure, 14-day expiry.
- **Uploads capped at 25 MB.** Prayer form has a honeypot spam trap.

**If you add a feature that displays user input, use `esc()`.** That is the single easiest way to reintroduce a real vulnerability here.

---

## 6. Running it

### Routine update
```bash
cd ~/st-andrews-baptist-church-website-
git pull
sudo systemctl restart caddy
sudo systemctl restart sabc-backend
```
If `requirements.txt` changed:
```bash
source backend/venv/bin/activate && pip install -r backend/requirements.txt
```

**Uploading to GitHub:** choose **"Commit directly to the main branch."** Creating a pull request instead means `git pull` fetches nothing.

### First-time setup on a fresh Pi
```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
python3 backend/setup_admin.py          # sets password + email
sudo cp backend/sabc-backend.service.example /etc/systemd/system/sabc-backend.service
sudo cp backend/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now sabc-backend caddy
chmod o+rx /home/church && chmod -R o+rX ~/st-andrews-baptist-church-website-
```
Caddy runs as its own user — without those `chmod`s it returns 403 on everything.

### Health check
```bash
systemctl status caddy sabc-backend cloudflared
curl -I http://localhost/                      # 200
curl -I http://localhost/backend/config.json   # 404 — security working
curl http://localhost/api/auth/session         # {"loggedIn":false}
```

---

## 7. Known quirks and hard-won lessons

- **IPv6 on the church network is advertised but doesn't route.** IPv6 is disabled on the Pi in `/etc/sysctl.d/99-disable-ipv6.conf`. Without it, the Pi can't reach Cloudflare at all. If the site dies after a network change, check this first.
- **Facebook video embeds are unreliable** regardless of our code — Facebook often blocks embedding. Every Facebook video therefore also gets a "Watch on Facebook" button. YouTube embeds work normally.
- **Photos are stored as base64 data URLs** inside the JSON, not as image files. Fine at current scale; would need rethinking at hundreds of photos.
- **No file locking.** Two admins saving the same page in the same second could overwrite each other. Unlikely with a small team, but real.
- **`object-fit: cover` only crops one axis** — whichever direction the photo overflows. That's why Who's Who photos have *both* horizontal and vertical focus sliders; a vertical-only slider does nothing for a wide photo.
- **Load tested:** 50 concurrent users, 0 failures, ~2,300 req/s for static pages.

---

## 8. Accounts — read this before anything else

| What | Owned by |
|---|---|
| Domain, DNS, tunnel (Cloudflare) | `office.standrewsbaptist@gmail.com` |
| Google Search Console | same |
| Login-code emails | same, via Gmail App Password stored on the Pi |

**The domain auto-renews ~22 September each year at about $10.46.** A prepaid card was used initially — **it must be replaced with a real card before renewal** or the domain lapses and will likely be taken by a squatter.

**Why everything is under a church-owned address:** the church's original domain, `standrewsbaptistchurch.ca`, was registered years ago by a well-meaning volunteer under her personal account. She became unreachable, and the church simply could not use its own domain. That domain is still hers and isn't used. **Do not repeat this.** Anything new gets registered to the church account, and the credentials live on paper at the church where more than one person can find them.

---

## 9. Outstanding work

**Needs someone else to act**
- **Google Business Profile is claimed by an unknown account** (masked as `j...@gmail.com`). It's the most prominent thing in search results and nobody at the church controls it. Ask members first — if someone set it up, they can add the church account as manager in two minutes. Otherwise Google's "Request Access" flow can transfer it after ~a week.
- **Website link on the Facebook page.** Facebook has years of authority and is what Google currently trusts. A link from it is probably the highest-value SEO action available.
- Real e-transfer address for the Giving page (Facebook lists `Standrewsbaptistfunds@outlook.com` — needs confirming before publishing).
- Deacon profiles and photos for Who's Who.
- Young Adults content: description, photos from past Friday meetings.

**Worth building**
- **Backups.** Everything lives on one SD card with no copy. A nightly rsync to a USB stick is ~10 minutes of work and the single biggest remaining risk.
- Branded HTML login email (currently plain text).
- Church email addresses via Cloudflare Email Routing (free, receive-only) or Google Workspace for Nonprofits (needs the church's CRA charity number).
- `deacons@` group address — needs a small Cloudflare Worker; routing maps one address to one destination.
- Automatic security updates on the Pi.

**Deliberately not built**
- **A general page builder.** Ministries are a *repeatable page type* instead: fixed layout, unlimited instances. Arbitrary page building produces broken, off-brand pages and is a genuinely different scale of project.
- Per-person passwords. One shared password plus per-person second factor was judged the right trade-off for this group.

---

## 10. If you're an AI assistant picking this up

- **Edit `assets/*.js` and `assets/*.css` directly.** Pages reference them as shared files. Don't inline.
- **`esc()` on all user input that gets displayed.** Non-negotiable.
- **`await` saves before navigating away.**
- **New content type = add the key in both `ALLOWED_STORE_KEYS` and `STORE_KEYS`.**
- **Test against a real running backend** before claiming something works — `python3 backend/app.py` with a throwaway `config.json`.
- **Clean test data out of `admins.json`** before packaging; it's tracked in git and test runs write to it.
- The user handles all Pi-side commands himself. Give exact commands, and say whether a backend restart is needed.
