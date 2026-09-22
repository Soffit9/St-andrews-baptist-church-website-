# St. Andrews Baptist Church — Website

Runs on the church's Raspberry Pi. This file covers what's running, how to update it, and what's still outstanding.

---

## ⚠️ Update this round — important security fix

A real vulnerability was found and fixed: **the whole project folder was being served as the website**, which meant anyone on the internet could read sensitive files directly by guessing the URL — the admin password hash, the Gmail app password, the admin roster (including authenticator secrets), and private prayer requests.

The fix is in `backend/Caddyfile.example`, so **this update only takes effect once you copy that file into place** (see the commands below). Verified by running a real Caddy server and confirming every one of those URLs now returns "Not found" while the site itself works normally.

A second layer was added too: the backend now writes those files so only the Pi's own user can read them, meaning they'd stay protected even if the Caddy rule were ever removed by mistake.

**Apply it:**
```bash
cd ~/st-andrews-baptist-church-website-
git pull
sudo cp backend/Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl restart sabc-backend
```

Confirm it worked:
```bash
curl -I http://localhost/backend/config.json    # should say 404
curl -I http://localhost/                        # should say 200
```

---

## 0. Performance note (this round)

Pages used to carry their own private copy of all the CSS and JavaScript — 3.35 MB of HTML across the site for only ~177 KB of actual unique code, re-sent on every single page view. They now share one cached copy instead.

Measured, gzipped, through real Caddy:

| | Before | After |
|---|---|---|
| All site HTML | 3.35 MB | 48 KB |
| Visiting 5 pages | 172 KB | 48 KB |
| Each page after the first | 34.4 KB | 1.8 KB |

Repeat visits get a `304 Not Modified` (0 bytes) for the shared files rather than re-downloading them.

**One thing this changes for editing:** `assets/*.css` and `assets/*.js` are now the real files the site uses — edit those directly, and the change applies everywhere at once. There's no longer a copy baked into each page.

## 1. What's running

- **Caddy** — serves the website. systemd service, auto-starts on boot.
- **`sabc-backend`** — the Flask backend (login, prayer requests, all saved content). systemd service, auto-starts on boot.
- **`cloudflared-quick`** — the public tunnel. systemd service, auto-starts on boot.

All three come back automatically after a power outage. No commands needed.

## 2. Routine update (whenever new files are uploaded to GitHub)

```bash
cd ~/st-andrews-baptist-church-website-
git pull
sudo systemctl restart caddy
sudo systemctl restart sabc-backend
```

If `backend/requirements.txt` changed, also run:
```bash
source backend/venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart sabc-backend
```

## 3. Getting the current public link

The quick tunnel makes a **new random address every restart**:
```bash
sudo journalctl -u cloudflared-quick --no-pager | grep -A 3 "trycloudflare.com"
```
If that comes back empty, restart it to force a fresh one (this changes the link):
```bash
sudo systemctl restart cloudflared-quick && sleep 6
sudo journalctl -u cloudflared-quick --no-pager | grep -A 3 "trycloudflare.com"
```

This goes away once the real domain is set up — see Section 5.

## 4. Admin accounts

- **One shared password** for the first login step. Change it in Admin → Settings (Full Admin only), or re-run `python3 backend/setup_admin.py` on the Pi.
- **Second step is per-person**: an emailed code, or each person's own authenticator app. Anyone can set up their own from Admin → Settings, or during login the first time they pick "authenticator app."
- **danteeugenemclaughlin@gmail.com is permanently Full Admin** — can't be removed or downgraded, on purpose, as a lockout safety net.
- **Access levels:** Full Admin sees everything. Can Edit can't see Admin Users or Prayer Requests. View Only is limited to the Church Calendar and Gallery.

## 5. The domain (outstanding)

The church owns `standrewsbaptistchurch.ca` through Rebel.ca, paid through June 2027. Cindy Kohler holds the account access and has been asked to point the nameservers at Cloudflare (`mary.ns.cloudflare.com` / `patrick.ns.cloudflare.com`).

Two separate steps, only the first needs her:
1. **She updates the nameservers** → Cloudflare becomes the domain's DNS authority (takes 1–2 days to propagate)
2. **Then we set up a named tunnel** on the Pi → this is what actually connects the domain to the Pi, and it also permanently fixes the changing-link problem

Backup plan if she doesn't respond: register a cheap domain the church controls directly and do the same thing with it.

## 6. Known limitations

- **Tunnel link changes on every restart** — fixed by the named tunnel in Section 5.
- **Simultaneous admin saves** — if two admins save the same page in the same second, one could overwrite the other. Very unlikely with a small team; no file locking yet.
- **Facebook video embeds are unreliable** — Facebook often blocks embedding regardless of settings. Every Facebook video shows a "Watch on Facebook" button as a fallback so there's always a working path. YouTube embeds work normally.
- **Gallery/Homepage photos are stored as data in the database**, not as image files. Fine at current scale; would want revisiting with hundreds of photos.

## 7. Local testing

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`. Note: login won't work without the backend also running.

Load testing (`ab -n 500 -c 50 http://localhost/`) confirmed the Pi handles 50 concurrent visitors with zero failures.

## 8. Reporting a bug

Most useful: **which page**, **what you did**, **what you expected vs. what happened**, and a screenshot if it's visual.
