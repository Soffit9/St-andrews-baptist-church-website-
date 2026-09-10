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

    print("\n--- Second login step: how should codes work? ---")
    print("You can set up EITHER or BOTH — whichever's on file gets accepted at login.")

    print("\n1) Email — a code gets emailed to whoever's logging in.")
    print("   Needs a Gmail account + an 'App Password' (not your normal Gmail password).")
    gmail_user = input("Gmail address to send codes from (blank to skip/remove): ").strip()
    if gmail_user:
        gmail_app_pw = getpass.getpass("Gmail App Password (16 characters, from Google Account > Security > App Passwords): ").strip()
        cfg["gmail_user"] = gmail_user
        cfg["gmail_app_password"] = gmail_app_pw
    else:
        cfg.pop("gmail_user", None)
        cfg.pop("gmail_app_password", None)

    print("\n2) Authenticator app (Google Authenticator, Authy, etc.) — works with no internet,")
    print("   no email needed, just a phone with the app installed.")
    setup_totp = input("Set this up now? (y/n): ").strip().lower()
    if setup_totp == "y":
        import pyotp
        secret = pyotp.random_base32()
        cfg["totp_secret"] = secret
        uri = pyotp.totp.TOTP(secret).provisioning_uri(name="admin@standrewsbaptistchurch.ca", issuer_name="St. Andrews Baptist Church")
        print("\nScan this with your authenticator app's camera:\n")
        try:
            import qrcode
            qr = qrcode.QRCode(border=1)
            qr.add_data(uri)
            qr.make()
            qr.print_ascii(invert=True)
        except Exception:
            print("(Couldn't draw a QR code here, but you can still add it manually.)")
        print(f"\nIf scanning doesn't work, add manually with this key: {secret}")
    else:
        remove = input("Remove any existing authenticator app setup? (y/n): ").strip().lower()
        if remove == "y":
            cfg.pop("totp_secret", None)

    save_config(cfg)
    print("\nDone. Saved only to this Pi (config.json, not tracked by git).")
    methods = []
    if cfg.get("gmail_user"): methods.append("email")
    if cfg.get("totp_secret"): methods.append("authenticator app")
    if methods:
        print("Second-step login methods active: " + " and ".join(methods) + ".")
    else:
        print("No second-step method configured yet — the code will just show on-screen for now.")


if __name__ == "__main__":
    main()
