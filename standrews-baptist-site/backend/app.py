#!/usr/bin/env python3
"""
St. Andrews Baptist Church — real backend, Phase 1: authentication.

Everything the old client-side login faked (password check, 2FA code,
"who's logged in") now happens here, on the server, where a visitor's
browser can't just read the source and see the password. Caddy proxies
/api/* requests here; everything else it keeps serving as static files,
same as before.

Phase 2 (next round) moves the actual site content — Who's Who, Gallery,
Events, the change log — from each browser's local storage into this
same backend, so it's finally shared across every device instead of
locked to whichever browser typed it in.
"""
import base64
import io
import json
import random
import secrets
import smtplib
import time
import uuid
from datetime import timedelta
from email.mime.text import MIMEText
from pathlib import Path

import pyotp
import qrcode
from flask import Flask, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
ADMINS_PATH = BASE_DIR / "admins.json"
PRAYER_REQUESTS_PATH = BASE_DIR / "prayer_requests.json"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)


def write_private_json(path, value):
    """Write a JSON file that only this Pi's own user can read.

    Defence in depth. The Caddyfile already refuses to serve anything under
    /backend/, but these files (prayer requests, the admin roster with its
    authenticator secrets, the change log) are sensitive enough that they
    shouldn't be readable even if that rule were ever removed or mistyped.
    Caddy runs as its own separate user, so 0600 means it physically can't
    read them regardless of any config."""
    path.write_text(json.dumps(value, indent=2))
    try:
        path.chmod(0o600)
    except OSError:
        pass  # non-fatal: the Caddy rule is still doing the real work

# Every kind of content the site actually saves, now living here instead
# of scattered across whichever browser last touched it. Locked to this
# specific list on purpose — the API won't read/write anything not named
# here, so a stray request can't create arbitrary files on the Pi.
ALLOWED_STORE_KEYS = {
    "sabc_content",        # Home/About/Sermons/Events/Prayer/Contact/Giving/logo text+photos
    "sabc_roster",         # Sunday Calendar volunteer names
    "sabc_schedule_roles", # Sunday Calendar role catalog
    "sabc_schedule",       # Sunday Calendar day-by-day assignments
    "sabc_events",         # Events calendar entries
    "sabc_whoswho",        # Who's Who directory
    "sabc_sermon_archive", # Sermon Archive entries
    "sabc_gallery",        # Gallery photos
    "sabc_hero_photos",    # Homepage rotating background photos
    "sabc_videos",         # Stashed video links (YouTube/Facebook), ready for whenever they're needed
    "sabc_ministries",     # Ministry / group pages (Young Adults, Men's Night, etc.)
    "sabc_newsletters",    # Newsletter issues (pastor's message + articles + photos)
    "sabc_audit_log",      # Change Log
}

# This email is always Full Admin, no matter what anyone edits on the
# Admin Users page later — a permanent safety net so nobody (including
# an honest mistake) can ever lock this account out or downgrade it.
PERMANENT_FULL_ADMIN_EMAIL = "danteeugenemclaughlin@gmail.com"

# Pending 2FA codes: { email: {"code": "123456", "expires": <unix time>} }
# In-memory on purpose — restarting the server just means anyone mid-login
# has to start over, which is a fine trade for not needing a database yet.
PENDING_CODES = {}
CODE_LIFETIME_SECONDS = 10 * 60

# ---- Brute-force protection on the shared password ----
# The first login step is one shared password, and it's deliberately a
# simple memorable word so the whole church team can use it. That's a
# reasonable trade-off ONLY if guessing is slow: without a limit, someone
# could try thousands of passwords a minute until they hit it.
# { ip: [list of recent failed attempt timestamps] }
FAILED_ATTEMPTS = {}
MAX_FAILURES = 8            # allowed failures within the window
FAILURE_WINDOW_SECONDS = 15 * 60
LOCKOUT_SECONDS = 15 * 60


def client_ip():
    """The visitor's real IP.

    Every request arrives from the Cloudflare tunnel, so remote_addr is
    always 127.0.0.1 — using it would rate-limit the entire church as one
    person, letting one attacker lock everybody out. Cloudflare passes the
    true client IP in CF-Connecting-IP, so prefer that."""
    return request.headers.get("CF-Connecting-IP") or request.remote_addr or "unknown"


def is_locked_out(ip):
    now = time.time()
    recent = [t for t in FAILED_ATTEMPTS.get(ip, []) if now - t < FAILURE_WINDOW_SECONDS]
    FAILED_ATTEMPTS[ip] = recent
    return len(recent) >= MAX_FAILURES


def record_failure(ip):
    FAILED_ATTEMPTS.setdefault(ip, []).append(time.time())


def clear_failures(ip):
    FAILED_ATTEMPTS.pop(ip, None)


def load_config():
    if not CONFIG_PATH.exists():
        raise RuntimeError(
            "No config.json found. Run 'python3 setup_admin.py' on the Pi first "
            "to set the admin password before starting the server."
        )
    return json.loads(CONFIG_PATH.read_text())


def load_admins():
    admins = json.loads(ADMINS_PATH.read_text()) if ADMINS_PATH.exists() else []
    if not any(a.get("email", "").lower() == PERMANENT_FULL_ADMIN_EMAIL for a in admins):
        admins.insert(0, {
            "id": "dante-permanent",
            "name": "Dante McLaughlin",
            "email": PERMANENT_FULL_ADMIN_EMAIL,
            "access": "Full Admin",
        })
    return admins


def save_admins(admins):
    # Enforce the permanent rule no matter what was submitted.
    found = False
    for a in admins:
        if a.get("email", "").lower() == PERMANENT_FULL_ADMIN_EMAIL:
            a["access"] = "Full Admin"
            found = True
    if not found:
        admins.insert(0, {
            "id": "dante-permanent",
            "name": "Dante McLaughlin",
            "email": PERMANENT_FULL_ADMIN_EMAIL,
            "access": "Full Admin",
        })
    write_private_json(ADMINS_PATH, admins)


def find_admin_by_email(email):
    email = (email or "").strip().lower()
    for a in load_admins():
        if a.get("email", "").lower() == email:
            return a
    return None


def set_admin_totp_secret(email, secret):
    """Give one specific admin their own authenticator secret — nobody
    else's login is affected, unlike the old single-shared-secret design."""
    email_l = (email or "").strip().lower()
    admins = load_admins()
    admin = next((a for a in admins if a.get("email", "").lower() == email_l), None)
    if admin:
        if secret is None:
            admin.pop("totp_secret", None)
        else:
            admin["totp_secret"] = secret
    else:
        # Not on the roster yet — create a minimal entry so their own
        # authenticator setup has somewhere to live.
        guess = email_l.split("@")[0]
        new_admin = {"id": str(uuid.uuid4())[:8], "name": guess, "email": email_l, "access": "Can Edit"}
        if secret is not None:
            new_admin["totp_secret"] = secret
        admins.append(new_admin)
    save_admins(admins)


def send_code_email(to_email, code, cfg):
    gmail_user = cfg.get("gmail_user")
    gmail_pw = cfg.get("gmail_app_password")
    if not gmail_user or not gmail_pw:
        return False  # not configured — caller falls back to showing the code on-screen
    msg = MIMEText(f"Your St. Andrews Baptist Church admin login code is: {code}\n\nExpires in 10 minutes.")
    msg["Subject"] = "Your admin login code"
    msg["From"] = gmail_user
    msg["To"] = to_email
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(gmail_user, gmail_pw)
        server.send_message(msg)
    return True


def create_app():
    app = Flask(__name__)
    cfg = load_config()
    app.secret_key = cfg["secret_key"]

    # ---- Session + request hardening ----
    # HTTPONLY: JavaScript can't read the login cookie, so even if some
    #   injected script did run, it couldn't simply steal the session.
    # SAMESITE Lax: another site can't silently make your browser perform
    #   admin actions using your logged-in session (CSRF protection).
    # SECURE: only send the cookie over HTTPS. Cloudflare terminates HTTPS
    #   in front of us, so real visitors are always on HTTPS.
    # LIFETIME: a forgotten logged-in tab doesn't stay valid forever.
    # MAX_CONTENT_LENGTH: refuse absurdly large uploads outright, so nobody
    #   can fill the Pi's SD card or exhaust its memory with one request.
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Real visitors always arrive over HTTPS via Cloudflare, so this is
        # correct by default. If you ever need to log in by hitting the Pi
        # directly over plain http:// on the local network, add
        # "cookie_secure": false to backend/config.json — the browser
        # refuses to store a Secure cookie over http, so login would
        # otherwise appear to silently fail.
        SESSION_COOKIE_SECURE=cfg.get("cookie_secure", True),
        PERMANENT_SESSION_LIFETIME=timedelta(days=14),
        MAX_CONTENT_LENGTH=25 * 1024 * 1024,  # 25MB
    )

    @app.post("/api/auth/password")
    def check_password():
        ip = client_ip()
        if is_locked_out(ip):
            return jsonify(ok=False, error="Too many incorrect attempts. Please wait about 15 minutes and try again."), 429
        data = request.get_json(silent=True) or {}
        password = data.get("password", "")
        cfg = load_config()
        if not check_password_hash(cfg["password_hash"], password):
            record_failure(ip)
            return jsonify(ok=False, error="Incorrect password."), 401
        clear_failures(ip)

        email = (data.get("email") or "").strip().lower()
        if not email:
            return jsonify(ok=False, error="Email is required."), 400

        method = (data.get("method") or "email").strip().lower()
        admin = find_admin_by_email(email)
        has_own_totp = bool(admin and admin.get("totp_secret"))

        if method == "totp":
            if has_own_totp:
                # Don't bother sending an email code too — they don't need
                # it, and it was confusing to get an unrelated email after
                # picking "use my app".
                return jsonify(ok=True, emailed=False, usingTotp=True)
            # They picked "authenticator app" but haven't set one up for
            # THIS email yet — let the frontend offer to set it up right
            # now, using the password they just correctly typed as proof
            # they're allowed to do this for this specific account.
            return jsonify(ok=True, needsTotpSetup=True)

        code = str(random.randint(100000, 999999))
        PENDING_CODES[email] = {"code": code, "expires": time.time() + CODE_LIFETIME_SECONDS}

        emailed = False
        try:
            emailed = send_code_email(email, code, cfg)
        except Exception:
            emailed = False

        resp = {"ok": True, "emailed": emailed}
        if not emailed:
            # Email isn't set up yet — same graceful fallback as the old
            # prototype: show the code directly so testing still works.
            resp["demo_code"] = code
        return jsonify(resp)

    @app.post("/api/auth/setup-totp-for-login")
    def setup_totp_for_login():
        # Lets someone set up THEIR OWN authenticator code, right in the
        # middle of logging in, the first time they pick that option. The
        # password check here is the actual security gate — knowing it is
        # what proves they're allowed to do this for the email they typed,
        # same proof the rest of login relies on.
        ip = client_ip()
        if is_locked_out(ip):
            return jsonify(ok=False, error="Too many incorrect attempts. Please wait about 15 minutes and try again."), 429
        data = request.get_json(silent=True) or {}
        password = data.get("password", "")
        cfg = load_config()
        if not check_password_hash(cfg["password_hash"], password):
            record_failure(ip)
            return jsonify(ok=False, error="Incorrect password."), 401
        clear_failures(ip)
        email = (data.get("email") or "").strip().lower()
        if not email:
            return jsonify(ok=False, error="Email is required."), 400

        secret = pyotp.random_base32()
        set_admin_totp_secret(email, secret)
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name="St. Andrews Baptist Church")
        img = qrcode.make(uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_base64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return jsonify(ok=True, secret=secret, qrCodePng=f"data:image/png;base64,{qr_base64}")

    @app.post("/api/auth/verify")
    def verify_code():
        # A 6-digit code is only 1,000,000 possibilities — trivially
        # brute-forceable if guesses are unlimited, which would defeat the
        # whole second step. Same limiter as the password.
        ip = client_ip()
        if is_locked_out(ip):
            return jsonify(ok=False, error="Too many incorrect attempts. Please wait about 15 minutes and try again."), 429
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        code = (data.get("code") or "").strip()

        admin = find_admin_by_email(email)
        own_secret = admin.get("totp_secret") if admin else None

        # Accept EITHER a valid emailed/on-screen code OR a valid code from
        # THIS PERSON'S OWN authenticator app — whichever they actually used.
        valid = False
        pending = PENDING_CODES.get(email)
        if pending and time.time() <= pending["expires"] and code == pending["code"]:
            valid = True
            del PENDING_CODES[email]
        elif own_secret and pyotp.TOTP(own_secret).verify(code, valid_window=1):
            valid = True

        if not valid:
            record_failure(ip)
            return jsonify(ok=False, error="That code doesn't match or has expired."), 401
        clear_failures(ip)

        if admin:
            name, access = admin["name"], admin["access"]
        else:
            # Not on the roster yet — let them in (matches the old prototype's
            # forgiving behaviour), best-effort name from the email itself.
            guess = email.split("@")[0]
            name, access = guess[:1].upper() + guess[1:], "Full Admin"

        if email == PERMANENT_FULL_ADMIN_EMAIL:
            access = "Full Admin"

        session["email"] = email
        session["name"] = name
        session["access"] = access
        session.permanent = True
        return jsonify(ok=True, name=name, email=email, access=access)

    @app.get("/api/auth/session")
    def get_session():
        if "email" not in session:
            return jsonify(loggedIn=False)
        return jsonify(loggedIn=True, name=session["name"], email=session["email"], access=session["access"])

    @app.post("/api/auth/logout")
    def logout():
        session.clear()
        return jsonify(ok=True)

    # ---- Self-service authenticator app setup, once already logged in
    # (Settings page) — everyone manages their OWN, nobody else's. ----
    @app.post("/api/auth/setup-totp")
    def setup_totp():
        if "email" not in session:
            return jsonify(ok=False, error="Login required."), 401
        secret = pyotp.random_base32()
        set_admin_totp_secret(session["email"], secret)
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name=session["email"], issuer_name="St. Andrews Baptist Church")
        img = qrcode.make(uri)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_base64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return jsonify(ok=True, secret=secret, qrCodePng=f"data:image/png;base64,{qr_base64}")

    @app.post("/api/auth/remove-totp")
    def remove_totp():
        if "email" not in session:
            return jsonify(ok=False, error="Login required."), 401
        set_admin_totp_secret(session["email"], None)
        return jsonify(ok=True)

    @app.get("/api/auth/totp-status")
    def totp_status():
        if "email" not in session:
            return jsonify(ok=False, error="Login required."), 401
        cfg = load_config()
        admin = find_admin_by_email(session["email"])
        return jsonify(ok=True, hasTotp=bool(admin and admin.get("totp_secret")), hasEmail=bool(cfg.get("gmail_user")))

    @app.post("/api/auth/change-password")
    def change_password():
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Full Admin access required."), 403
        data = request.get_json(silent=True) or {}
        new_password = (data.get("password") or "").strip()
        if len(new_password) < 6:
            return jsonify(ok=False, error="Use at least 6 characters."), 400
        cfg = load_config()
        cfg["password_hash"] = generate_password_hash(new_password)
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
        CONFIG_PATH.chmod(0o600)
        return jsonify(ok=True)

    # ---- Admin roster (needed by the login screen + the Admin Users page) ----
    @app.get("/api/admins")
    def get_admins():
        if session.get("access") != "Full Admin":
            return jsonify(error="Full Admin access required."), 403
        return jsonify(load_admins())

    @app.post("/api/admins")
    def set_admins():
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Only Full Admin can edit the admin list."), 403
        submitted = request.get_json(silent=True) or []
        # The Admin Users page only knows about name/email/access — it has
        # no idea totp_secret exists. Without this merge, saving ANY change
        # here (even fixing a typo) would silently overwrite the whole file
        # and wipe out everyone's authenticator app setup in the process.
        existing_by_id = {a["id"]: a for a in load_admins() if "id" in a}
        merged = []
        for a in submitted:
            prior = existing_by_id.get(a.get("id"), {})
            merged.append({**prior, **a})
        save_admins(merged)
        return jsonify(ok=True, admins=load_admins())

    # ---- Prayer requests: real, shared, server-side storage ----
    # A short list of words the filter blocks outright — ordinary swearing is
    # allowed through on purpose (matches the original ask), this only
    # catches hateful/discriminatory language. Deliberately not exhaustive;
    # a real moderation system is a bigger project than this prototype.
    BLOCKED_WORDS = ["nigger", "faggot", "retard", "kike", "spic", "chink"]

    # ---- Category guessing (fallback only) ----
    # If someone picked a category on the form, that's what we use — their
    # own answer is always more reliable than anything we could infer.
    # This keyword pass only runs when they left it blank, and whatever it
    # produces is flagged as a guess so the pastor knows not to trust it.
    #
    # Deliberately kept simple: real language is ambiguous ("pray for my
    # mother" could be health or family), so a fancier approach would look
    # smarter while still being wrong. Better to guess plainly, label it a
    # guess, and let a person correct it in one click.
    CATEGORY_KEYWORDS = [
        ("Surgery & Medical Procedures", ["surgery", "operation", "operating", "procedure", "transplant", "biopsy", "chemo", "radiation"]),
        ("Health & Healing", ["health", "healing", "heal", "sick", "illness", "ill ", "hospital", "cancer", "pain", "diagnosis", "recovery", "doctor", "treatment", "disease", "injury", "injured"]),
        ("Mental Health", ["anxiety", "anxious", "depression", "depressed", "mental health", "panic", "stress", "overwhelmed", "burnout", "lonely", "loneliness"]),
        ("Grief & Loss", ["grief", "grieving", "passed away", "passing", "funeral", "died", "death", "loss of", "mourning", "bereave"]),
        ("Addiction & Recovery", ["addiction", "addicted", "alcohol", "drinking", "drugs", "sober", "sobriety", "gambling", "relapse"]),
        ("Marriage & Relationships", ["marriage", "married", "spouse", "husband", "wife", "divorce", "separation", "relationship", "engaged", "wedding"]),
        ("Pregnancy & New Babies", ["pregnan", "expecting", "baby", "newborn", "birth", "miscarriage", "adoption"]),
        ("Children & Youth", ["child", "children", "kids", "son", "daughter", "teenager", "teen", "youth", "grandchild"]),
        ("Family", ["family", "mother", "father", "mom", "dad", "parent", "sister", "brother", "grandmother", "grandfather", "aunt", "uncle", "cousin"]),
        ("Work & Employment", ["job", "work", "employment", "unemployed", "laid off", "interview", "career", "boss", "workplace", "retire"]),
        ("Finances", ["money", "financial", "finances", "bills", "debt", "rent", "afford", "income", "poverty"]),
        ("Housing", ["housing", "house", "home", "apartment", "moving", "evict", "homeless", "landlord"]),
        ("School & Studies", ["school", "exam", "exams", "test", "studying", "student", "university", "college", "graduation", "grades"]),
        ("Guidance & Big Decisions", ["decision", "guidance", "direction", "discern", "wisdom", "choice", "what to do", "next step"]),
        ("Salvation & Loved Ones", ["salvation", "saved", "unsaved", "come to faith", "come to christ", "believe", "conversion"]),
        ("Faith & Spiritual Growth", ["faith", "spiritual", "growth", "closer to god", "bible", "prayer life", "doubt", "devotion"]),
        ("Church & Ministry", ["church", "ministry", "congregation", "deacon", "pastor", "worship team", "volunteer", "sunday school"]),
        ("Missions & Outreach", ["mission", "missionary", "outreach", "evangelism"]),
        ("Travel & Safety", ["travel", "trip", "flight", "flying", "driving", "journey", "vacation", "safe travels"]),
        ("Military & First Responders", ["military", "army", "navy", "deployed", "deployment", "veteran", "police", "firefighter", "paramedic"]),
        ("Community & Neighbours", ["community", "neighbour", "neighbor", "town", "village"]),
        ("Country & World", ["country", "world", "nation", "war", "government", "election", "disaster", "famine", "refugee"]),
        ("Thanksgiving & Praise", ["thank you", "thankful", "grateful", "gratitude", "praise", "answered prayer", "celebrate", "rejoice"]),
    ]

    def guess_category(text):
        """Best-effort category from the wording. Returns None if nothing
        matches, rather than forcing a wrong label."""
        lowered = (text or "").lower()
        for label, words in CATEGORY_KEYWORDS:
            if any(w in lowered for w in words):
                return label
        return None

    def load_prayer_requests():
        if not PRAYER_REQUESTS_PATH.exists():
            return []
        return json.loads(PRAYER_REQUESTS_PATH.read_text())

    def save_prayer_requests(items):
        write_private_json(PRAYER_REQUESTS_PATH, items)

    @app.post("/api/prayer-requests")
    def submit_prayer_request():
        data = request.get_json(silent=True) or {}

        # Honeypot: a hidden field real visitors never see or fill in — bots
        # that blindly auto-fill every field on a page usually fill it,
        # giving away that the submission isn't from a real person. Silently
        # pretend success so the bot doesn't learn to avoid this field.
        if (data.get("website") or "").strip():
            return jsonify(ok=True)

        text = (data.get("request") or "").strip()
        if not text:
            return jsonify(ok=False, error="A prayer request is required."), 400
        lowered = text.lower()
        if any(w in lowered for w in BLOCKED_WORDS):
            return jsonify(ok=False, error="This may contain language flagged for review — please rephrase."), 400

        # Their own choice wins; only guess when they left it blank.
        chosen = (data.get("category") or "").strip()
        if chosen:
            category, was_guessed = chosen, False
        else:
            guessed = guess_category(text)
            category, was_guessed = (guessed or "Uncategorized"), bool(guessed)

        items = load_prayer_requests()
        items.insert(0, {
            "id": str(uuid.uuid4())[:8],
            "category": category,
            "category_guessed": was_guessed,
            "name": (data.get("name") or "").strip(),
            "email": (data.get("email") or "").strip(),
            "request": text,
            "pray_aloud": bool(data.get("pray_aloud")),
            "status": "unread",
            "submitted": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        save_prayer_requests(items)
        return jsonify(ok=True)

    @app.get("/api/prayer-requests")
    def get_prayer_requests():
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Full Admin access required."), 403
        return jsonify(load_prayer_requests())

    @app.post("/api/prayer-requests/<req_id>")
    def update_prayer_request(req_id):
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Full Admin access required."), 403
        data = request.get_json(silent=True) or {}
        items = load_prayer_requests()
        for item in items:
            if item["id"] == req_id:
                item["status"] = data.get("status", item["status"])
                # Correcting a wrong guess also clears the "guessed" flag,
                # since a person has now confirmed it.
                if "category" in data:
                    item["category"] = data["category"]
                    item["category_guessed"] = False
        save_prayer_requests(items)
        return jsonify(ok=True)

    @app.delete("/api/prayer-requests/<req_id>")
    def delete_prayer_request(req_id):
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Full Admin access required."), 403
        items = [i for i in load_prayer_requests() if i["id"] != req_id]
        save_prayer_requests(items)
        return jsonify(ok=True)

    # ---- Generic shared storage: everything Who's Who / Gallery / Events /
    # Calendar / Sermon Archive / page content used to keep in each
    # browser's local storage now lives here instead, so it's the same
    # for every admin, on every device. ----
    # The audit log is the one shared-storage key that isn't meant to be
    # publicly readable — everything else here (Who's Who, Events, etc.)
    # needs to be, since public pages display it without anyone logging in.
    PRIVATE_READ_KEYS = {"sabc_audit_log"}

    @app.get("/api/store/<key>")
    def get_store(key):
        if key not in ALLOWED_STORE_KEYS:
            return jsonify(error="Unknown key."), 404
        if key in PRIVATE_READ_KEYS and session.get("access") not in ("Full Admin", "Can Edit"):
            return jsonify(error="Login required."), 401
        path = DATA_DIR / f"{key}.json"
        if not path.exists():
            return jsonify(None)
        return jsonify(json.loads(path.read_text()))

    @app.post("/api/store/<key>")
    def set_store(key):
        if key not in ALLOWED_STORE_KEYS:
            return jsonify(ok=False, error="Unknown key."), 404
        if "email" not in session:
            return jsonify(ok=False, error="Login required."), 401
        if session.get("access") not in ("Full Admin", "Can Edit"):
            return jsonify(ok=False, error="View Only accounts can't save changes."), 403
        value = request.get_json(silent=True)
        path = DATA_DIR / f"{key}.json"
        write_private_json(path, value)
        return jsonify(ok=True)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
