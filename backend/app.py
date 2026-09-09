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
from email.mime.text import MIMEText
from pathlib import Path

from flask import Flask, jsonify, request, session
from werkzeug.security import check_password_hash

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
ADMINS_PATH = BASE_DIR / "admins.json"

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

    @app.post("/api/auth/verify")
    def verify_code():
        data = request.get_json(silent=True) or {}
        email = (data.get("email") or "").strip().lower()
        code = (data.get("code") or "").strip()

        pending = PENDING_CODES.get(email)
        if not pending or time.time() > pending["expires"]:
            return jsonify(ok=False, error="That code has expired — request a new one."), 401
        if code != pending["code"]:
            return jsonify(ok=False, error="That code doesn't match."), 401

        del PENDING_CODES[email]

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
        return jsonify(load_admins())

    @app.post("/api/admins")
    def set_admins():
        if session.get("access") != "Full Admin":
            return jsonify(ok=False, error="Only Full Admin can edit the admin list."), 403
        admins = request.get_json(silent=True) or []
        save_admins(admins)
        return jsonify(ok=True, admins=load_admins())

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
