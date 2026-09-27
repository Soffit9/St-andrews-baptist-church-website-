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
- **`cloudflared`** — the named tunnel connecting `standrewsbaptistchurch.com` to the Pi. systemd service, auto-starts on boot. Config lives in `/etc/cloudflared/config.yml`.

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

## 3. The public address

The site is at **https://standrewsbaptistchurch.com** (and `www.`). The address is permanent — it doesn't change on reboot, power loss, or moving the Pi.

Check the tunnel is healthy:
```bash
sudo systemctl status cloudflared
```
Looking for `active (running)`. If the site is ever unreachable, that's the first thing to check, then `sudo systemctl restart cloudflared`.

## 4. Admin accounts

- **One shared password** for the first login step. Change it in Admin → Settings (Full Admin only), or re-run `python3 backend/setup_admin.py` on the Pi.
- **Second step is per-person**: an emailed code, or each person's own authenticator app. Anyone can set up their own from Admin → Settings, or during login the first time they pick "authenticator app."
- **danteeugenemclaughlin@gmail.com is permanently Full Admin** — can't be removed or downgraded, on purpose, as a lockout safety net.
- **Access levels:** Full Admin sees everything. Can Edit can't see Admin Users or Prayer Requests. View Only is limited to the Church Calendar and Gallery.

## 5. Accounts that run the site

- **Domain + DNS + tunnel:** Cloudflare, under `office.standrewsbaptist@gmail.com`. Domain auto-renews **Sep 22 each year** — the card on file must be valid before then.
- **Login code emails:** sent from the office Gmail via an App Password stored on the Pi.
- **Google Search Console:** verified for `standrewsbaptistchurch.com`, sitemap submitted.
- **Credentials:** written down and stored at the church. Pastor Ladd and one deacon should know where.

The older `standrewsbaptistchurch.ca` belongs to a previous volunteer's Rebel.ca account and isn't used.

## 6. Known limitations

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
