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
import json
import random
import secrets
import smtplib
import time
import uuid
from email.mime.text import MIMEText
from pathlib import Path

import pyotp
from flask import Flask, jsonify, request, session
from werkzeug.security import check_password_hash

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
ADMINS_PATH = BASE_DIR / "admins.json"
PRAYER_REQUESTS_PATH = BASE_DIR / "prayer_requests.json"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

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
    ADMINS_PATH.write_text(json.dumps(admins, indent=2))


def find_admin_by_email(email):
    email = (email or "").strip().lower()
    for a in load_admins():
        if a.get("email", "").lower() == email:
            return a
    return None


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

    @app.post("/api/auth/password")
    def check_password():
        data = request.get_json(silent=True) or {}
        password = data.get("password", "")
        cfg = load_config()
        if not check_password_hash(cfg["password_hash"], password):
            return jsonify(ok=False, error="Incorrect password."), 401

        email = (data.get("email") or "").strip().lower()
        if not email:
            return jsonify(ok=False, error="Email is required."), 400

        method = (data.get("method") or "email").strip().lower()

        # If they chose the authenticator app and one's actually set up, don't
        # bother sending an email code at all — they don't need it, and it
        # was confusing to get an unrelated email after picking "use my app".
        if method == "totp" and cfg.get("totp_secret"):
            return jsonify(ok=True, emailed=False, totpAvailable=True, usingTotp=True)

        code = str(random.randint(100000, 999999))
        PENDING_CODES[email] = {"code": code, "expires": time.time() + CODE_LIFETIME_SECONDS}

        emailed = False
        try:
            emailed = send_code_email(email, code, cfg)
        except Exception:
            emailed = False

        resp = {"ok": True, "emailed": emailed, "totpAvailable": bool(cfg.get("totp_secret"))}
        if not emailed:
            # Email isn't set up yet — same graceful fallback as the old
            # prototype: show the code directly so testing still works.
            resp["demo_code"] = code
        return jsonify(resp)

    @app.post("/api/auth/verify")
    def verify_code():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        code = (data.get("code") or "").strip()
        cfg = load_config()

        # Accept EITHER a valid emailed/on-screen code OR a valid
        # authenticator-app code — whichever the person actually has handy.
        valid = False
        pending = PENDING_CODES.get(email)
        if pending and time.time() <= pending["expires"] and code == pending["code"]:
            valid = True
            del PENDING_CODES[email]
        elif cfg.get("totp_secret") and pyotp.TOTP(cfg["totp_secret"]).verify(code, valid_window=1):
            valid = True

        if not valid:
            return jsonify(ok=False, error="That code doesn't match or has expired."), 401

        admin = find_admin_by_email(email)
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
        admins = request.get_json(silent=True) or []
        save_admins(admins)
        return jsonify(ok=True, admins=load_admins())

    # ---- Prayer requests: real, shared, server-side storage ----
    # A short list of words the filter blocks outright — ordinary swearing is
    # allowed through on purpose (matches the original ask), this only
    # catches hateful/discriminatory language. Deliberately not exhaustive;
    # a real moderation system is a bigger project than this prototype.
    BLOCKED_WORDS = ["nigger", "faggot", "retard", "kike", "spic", "chink"]

    def load_prayer_requests():
        if not PRAYER_REQUESTS_PATH.exists():
            return []
        return json.loads(PRAYER_REQUESTS_PATH.read_text())

    def save_prayer_requests(items):
        PRAYER_REQUESTS_PATH.write_text(json.dumps(items, indent=2))

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

        items = load_prayer_requests()
        items.insert(0, {
            "id": str(uuid.uuid4())[:8],
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
        path.write_text(json.dumps(value, indent=2))
        return jsonify(ok=True)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
