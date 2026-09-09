# St. Andrews Baptist Church — Website Prototype

Prototype site for St. Andrews Baptist Church. Not production-ready yet — built to iterate on, piece by piece.

## Run locally

From this folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## What's new in this round

- **"Plan Your Visit" now goes to the Contact page** (parking, dress code, service times) instead of About — matches what you and Pastor Ladd decided made more sense.
- **Sermons page is ready for YouTube.** There's a new "YouTube Video" field in the Sermons admin edit screen — paste a video ID or full link and it replaces the ▶ placeholder with a real embedded player on the live page.
- **Admin editing now shows a live split-screen preview** — your fields on the left, a preview of exactly what changes (and how) on the right, updating as you type.
- **Photos can now be resized right from the admin panel.** Any photo with a size slider (like the About page church/pastor photo) lets you drag to set its height — no more "massive" photos taking over the page. This also fixes the underlying bug that was causing that in the first place.
- **Sunday Roles Calendar** (previously "IT Schedule") — click any Sunday on a real calendar, and fill in who's doing what: Opening Prayer, Worship/Singing, Offering, Sound, Slides, Greeting — each with a name and a Yes/No confirmation. Keep a running volunteer roster so names are quick to pick from month to month.
- **Who's Who page** — a new public page listing church members/leaders with their photo, role, phone, and email, fully managed from a new admin screen. Shows up in the main navigation.
- **Admin Users list** — a new admin screen to track who's on the admin team and what access they should have (Full Admin / Can Edit / View Only). Heads up: this doesn't control real login access yet — see the open question below.
- **Change Log** — every applied change (any page edit, calendar entry, Who's Who update) is now recorded with a timestamp and before/after values, viewable in a new admin screen, with a **Download Log** button that saves a plain-text copy to your computer.

## What's new in this round

- **Fixed the "nothing saved" bug.** The real cause: uploaded phone photos are often several megabytes, and a browser's local storage tops out around 5–10MB total — a couple of full-size photos could quietly blow past that limit and fail to save, with no visible error. Two fixes: **(1)** every photo now gets automatically shrunk/compressed the moment you upload it, so it takes a fraction of the space, and **(2)** if a save ever does fail for any reason, you'll now get a clear on-screen message instead of it just silently doing nothing.
- **Events page and homepage now actually pull from the admin Events calendar** — they were still showing the old hardcoded example events before, regardless of what you added in admin. Fixed; add/edit events from Admin → Events, and they now show up for real on both the Events page and the homepage's "Upcoming Events."
- **Photo positioning.** Every resizable photo (like the About page photo) now has a second slider — height, and **focus point** (top/center/bottom) — so if a phone photo has the subject near the bottom, or odd bars from its aspect ratio, you can shift which part of the photo shows instead of it always centering.
- **Church Calendar (formerly "Sunday Calendar") now works for any day**, not just Sundays — Tuesday Bible study or any other event day can have roles filled in the same way. Sundays stay visually highlighted since that's the main service.
- **A warning banner** now appears if you open a page directly as a file instead of through a local server, since some browsers handle saved admin data less reliably that way — see "Running this properly" below.

## Running this properly (important for admin testing)

Double-clicking `index.html` works great for just looking at the site. But for testing the **admin side** — saving photos, the calendar, Who's Who, the log — it's more reliable to run it through a local server instead of opening the file directly, because some browsers handle local storage differently for plain double-clicked files. Since there's no Python on that Windows PC:

- Easiest no-install option: **VS Code + the "Live Server" extension** — install VS Code (free), add the Live Server extension, right-click `index.html` → "Open with Live Server."
- If you'd rather not install anything, double-clicking still works for showing people around — just know that if admin changes don't seem to save, that's the likely reason, and the banner at the top of any admin page will say so too.

## What's new in this round

- **Fixed the "tomorrow's verse showing as today" bug.** Same root cause as before but a different spot: the code was converting to UTC time to build the date, which rolls over before midnight for anyone west of Greenwich (that's everyone in Canada/US) — especially noticeable in the evening. Fixed everywhere it was used, including the Events/Calendar "today" cutoffs, which had the same bug quietly hiding today's events from the list some of the time.
- **Added a "jump to a day" date picker** next to the Bible verse, so you're not clicking Previous a bunch of times to find an old one.
- **Every uploaded photo now has the same size/position controls** — including the logo (small, capped range so it fits the header) and Who's Who photos (a focus-point slider, so you can shift a photo up/down without cutting off the subject, while keeping every card in the directory the same neat height).
- **Church Calendar roles are now editable** — add or remove role types (not just the starter six) right on the Calendar page, next to the volunteer roster. Whatever's in that list is what shows up when you click any day.
- **Hover effects are now consistent everywhere** — cards, buttons, nav links, calendar days, log entries — the little lift-and-shadow effect you liked on the admin page is now sitewide.
- **Fixed the squished footer links** ("ContactGivingSermons" running together) — proper spacing now.
- **Added a dark mode toggle** — the moon/sun icon in the header on every page, defaults to light, remembers your choice.
- **Double-checked the Sermons YouTube field** — it's in Admin → Sermons, a plain text box labeled "YouTube Video," same as the title/speaker/passage fields. If it's still not visible or savable after this update, let me know exactly what you're seeing (a screenshot helps) since I couldn't reproduce a problem with it on my end.

### Not built yet, on purpose: drag-and-drop page editing
The "let admins rearrange text boxes and photos on the page" idea is a great one, but it's genuinely a different scale of feature — that's real page-builder territory (like Wix/Squarespace's editor), not a quick add. I'd rather tackle it properly as its own focused round once the current bugs are stable, instead of bolting on a rushed version that creates more bugs than it fixes. Flagging it so it doesn't get lost, not dropped.

## Important fix: pages are now self-contained

Earlier, the pages linked out to `assets/style.css` and `assets/*.js`. On at least one device/browser those relative links weren't loading — the page rendered as plain unstyled text (no colors, no layout, no working buttons). To make sure that can't happen again, **every page now has its CSS and JavaScript built directly into the file.** You can double-click any `.html` file straight out of the folder — no server, no relative paths to break — and it'll look right. The `assets/` folder is still there for reference/future editing, it's just no longer required for the pages to display correctly.

## What's new in this round

- **Working admin editing.** Dashboard → click a page → edit its text/photos in a locked-down form (no formatting to break) → **Apply Changes** → confirm → it's live. The site logo and About page photo can be swapped by uploading a photo, right in the browser. This is stored in the browser's `localStorage`, so it already behaves like a real CMS even though there's no server yet — swapping in a real backend later won't change how it feels to use.
- **Real two-step login.** Password, then a 6-digit code. Since there's no email/SMS server yet, the code is shown right on screen labeled "prototype demo code" so you can see the flow — wiring it to an actual email or an authenticator app on Pastor Ladd's phone is a small follow-up once we pick one (see the open question below).
- **Blue photo placeholders**, more shadow/depth on cards, hover states, and general visual polish across every page — should feel like a real site now instead of a wireframe.
- **Contact page** — same info, just styled as proper cards to match the rest of the site.
- **Daily verse** now pulls from [bible-api.com](https://bible-api.com) — free, no key, and its default translations (KJV etc.) are public domain, so there's no copyright issue reusing the text. We can't legally copy K-LOVE's page itself, but this gets the same result: a new verse each day, and every day it's viewed gets cached in the browser, so the site naturally builds its own year archive over time, just like you described.

## What's in this update (previous round)

- **About page** — real church history, Pastor Ladd Dunfield's info, service times, and partner ministries filled in.
- **Contact page** — real address (115 King Street, St. Andrews), phone, email, and a live embedded Google Map (no API key needed).
- **Sermons page** — archive trimmed back to just 2026 going forward, since Facebook only keeps posts for a month and older sermon videos are gone. Past years will reappear as time passes.
- **Prayer request page** — added a yes/no option for "pray this aloud in the prayer meeting room," and a small starter content filter that flags hateful/discriminatory language (ordinary swearing is allowed through, per your instructions). This is still a prototype form — see "Open questions" below for what's needed to make it real.
- **Admin dashboard** — added an "IT Schedule" section (placeholder for now — let me know what you want it to look like) and softened/cleaned up the wording throughout so it reads like a normal prototype note instead of a warning.
- **Daily verse** — home page now has Previous/Next buttons and a small starter list of 5 days, structured so it can grow into a full year archive over time, similar in spirit to klove.com/faith/votd.
- All contact-form and admin-notification placeholders are currently pointed at **danteeugenemclaughlin@gmail.com** until you tell me otherwise.

## Open questions (need your input before these go live)

1. **Prayer requests:** okay to use a Google Form as the actual submission destination, with a copy emailed to Pastor Ladd? If so, I'll need you (or him) to create that form, or I can build one and hand over the link/ownership.
2. **Admin login security:** email verification code, or an authenticator app on Pastor Ladd's phone — which is easier for him day to day? (The demo shows the flow either way — just need to know which to actually wire up.)
3. **Admin Users / real logins:** right now everyone shares one demo password + code. Once there's a real backend, each admin can get their own login matching the access level set on the new Admin Users page — just flagging that the list today is a plan, not enforced yet.
4. **Giving page:** no info yet — e-transfer address, instructions, and tax receipt details needed whenever you have them.
5. **YouTube channel:** send over the channel/video link whenever the first sermon is ready to embed, or just paste a video ID/link straight into the Sermons admin field yourself.
6. **Content storage:** right now, edits made in `/admin` are saved to that specific browser's `localStorage` — they won't show up on a different device until we connect a real shared backend (this is normal for a prototype at this stage, just flagging it so it's not confusing when testing on your phone vs. laptop). This also means the Change Log, Who's Who list, and calendar are per-browser for now.

## Not production-ready yet

Authentication, real prayer-request delivery, content editing, backups, HTTPS, Cloudflare Tunnel, and the real admin backend still need to be built. Don't put real passwords or sensitive prayer requests into this prototype yet.

## Planned architecture

Internet → Cloudflare → Cloudflare Tunnel → Raspberry Pi → web server → website/admin

The church should retain ownership of its domain. DNS/email records must be checked before any production DNS changes. Everything here is built to be free to run and easy to migrate onto the Raspberry Pi later.
