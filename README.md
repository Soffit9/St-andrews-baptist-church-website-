# St. Andrews Baptist Church — Website

Live on the church's Raspberry Pi. This file tells you what's working, what to do next, and how to run the backend setup. Old round-by-round change notes have been folded into the sections below instead of stacking up forever.

---

## 1. What's actually running right now

- **The website** — Caddy serves it permanently on the Pi (systemd service, auto-starts on boot).
- **The tunnel** — `cloudflared-quick` systemd service, giving you a public `trycloudflare.com` link. This link **changes every time the Pi restarts** — that's normal for now, see Section 3.
- **Real login** — password + email/authenticator code, checked on a real Flask backend, not just in the browser. Your account (danteeugenemclaughlin@gmail.com) is permanently Full Admin no matter what.
- **Real prayer requests** — submissions from the public Prayer page are now stored on the server and readable from Admin → Prayer Requests, on any device. Mark read, archive, or delete.
- **Two second-step login options, either works** — an emailed code, or an authenticator app (Google Authenticator, Authy, etc.). Set up one or both by running `setup_admin.py` (see Section 2) — whichever's configured gets accepted, no need to pick a mode at login.

- **Login flow redesigned** — password first, then a clear choice: "Email me a code" or "I have an authenticator app," then the matching field. Cleaner than the old combined email+password screen.
- **Phase 2 done — everything's real shared storage now.** Who's Who, Gallery, Events, the Church Calendar, the Sermon Archive, and all page content (Home/About/Sermons/etc. text and photos) are no longer stuck in whichever browser typed them in. Anyone who logs in, on any device, sees and edits the same real data on the server. This was the big one — the site is now genuinely usable by more than one person on more than one device.

## One thing to expect with this update
Public pages (Who's Who, Events, Gallery, Sermon Archive, the homepage) now take a brief moment to fetch real content from the server before it appears — previously this was instant since it was just reading the same browser's local storage. Should still feel fast, just not literally zero-delay anymore. Worth knowing so it's not mistaken for something broken.

## One important clarification, since it came up
**Caddy and the backend are two separate things.** Caddy only hands out the website's files — it has no memory of its own. The Flask backend (in `backend/`) is what actually stores anything (prayer requests, admin accounts, logins). If something needs to be "read later" or "shared across devices," it has to go through the backend, not Caddy.


## 2. Do this now — finish the backend setup

If you haven't already run these on the Pi, do it in this exact order:

```bash
cd ~/st-andrews-baptist-church-website-
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
python3 backend/setup_admin.py
```
That last command asks you to type a real password right there in the terminal — that's the only place it ever lives. Skip the Gmail question for now (just hit enter / leave blank) unless you're ready to set up real email codes.

Then make it permanent:
```bash
sudo cp backend/sabc-backend.service.example /etc/systemd/system/sabc-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now sabc-backend
sudo cp backend/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

Confirm it worked:
```bash
curl -X POST http://localhost/api/auth/session
```
Should print `{"loggedIn":false}`. If it does, log into the actual site in a browser and you're done with this step.

## 3. Known limitations right now (not bugs — just what's not built yet)

- **The tunnel link changes on every restart/move of the Pi.** Fix (once the domain's ready): a *named* tunnel, which gives a permanent link instead. Waiting on Cindy for the domain — see Section 4.
- **If you re-run `setup_admin.py`** to add the authenticator app option, it'll print a QR code directly in the terminal — point your phone's authenticator app camera at the terminal window to scan it.

## 4. The domain situation

- The church owns `standrewsbaptistchurch.ca`, registered through Rebel.ca, paid through June 2027 — not lost, not expiring soon.
- Cindy Kohler has the account access. She's been emailed asking to either update the nameservers herself, or hand over access.
- Once she updates the nameservers to Cloudflare's, the domain will start working with the tunnel automatically — no rush, no downtime risk either way.

## 5. Run it locally (for you, testing on your own machine)

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`. Note: without the backend running too, login won't work — you'll just see the public pages.

## 6. Reporting a bug

The fastest fix happens when I get: **which page**, **what you did**, **what you expected vs. what happened**, and a screenshot if it's visual. "Doesn't work" alone usually means a round-trip of questions before I can actually look.
