#!/usr/bin/env python3
"""
Run this directly on the Pi to set the real shared admin password.

    python3 setup_admin.py

Your password is typed right here in the terminal, never sent anywhere,
never stored in chat, never committed to GitHub. Only a scrambled (hashed)
version gets saved to config.json — and config.json is in .gitignore, so
it never leaves this Pi.

Safe to re-run any time you want to change the password or add/replace
the authenticator app setup.
"""
import getpass
import json
import secrets
from pathlib import Path
from werkzeug.security import generate_password_hash

CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config():
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    CONFIG_PATH.chmod(0o600)  # only readable by the Pi's own user, nobody else on the machine


def main():
    print("=" * 60)
    print("St. Andrews Baptist Church — Admin Password Setup")
    print("=" * 60)
    cfg = load_config()

    pw1 = getpass.getpass("New shared admin password: ")
    pw2 = getpass.getpass("Type it again to confirm: ")
    if pw1 != pw2:
        print("\nThose didn't match. Nothing was changed. Run this again to retry.")
        return
    if len(pw1) < 6:
        print("\nThat's a bit short — use at least 6 characters. Nothing was changed.")
        return

    cfg["password_hash"] = generate_password_hash(pw1)

    if "secret_key" not in cfg:
        cfg["secret_key"] = secrets.token_hex(32)

    print("\n--- Email codes for the second login step (optional) ---")
    print("Needs a Gmail account + an 'App Password' (not your normal Gmail password).")
    print("Leave blank to skip — the code will just show on-screen instead.")
    gmail_user = input("Gmail address to send codes from (blank to skip/remove): ").strip()
    if gmail_user:
        gmail_app_pw = getpass.getpass("Gmail App Password (16 characters, from Google Account > Security > App Passwords): ").strip()
        cfg["gmail_user"] = gmail_user
        cfg["gmail_app_password"] = gmail_app_pw
    else:
        cfg.pop("gmail_user", None)
        cfg.pop("gmail_app_password", None)

    save_config(cfg)
    print("\nDone. Saved only to this Pi (config.json, not tracked by git).")
    if gmail_user:
        print(f"Email codes will be sent from {gmail_user}.")
    else:
        print("Email not set up — codes will show directly on the login screen for now, same as before.")
    print("\nNote: authenticator app (QR code) setup is no longer done here — each")
    print("admin sets up their own personal one right on the website now, either")
    print("during login (first time they pick 'authenticator app') or any time")
    print("after logging in via Admin → Settings. Nothing to configure here for that.")


if __name__ == "__main__":
    main()
