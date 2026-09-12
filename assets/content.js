/* ---------------------------------------------------------------------
   Prototype CMS "content" layer.
   Everything a user edits in /admin/edit.html is stored in the browser's
   localStorage (key: sabc_content) and re-applied on top of the default
   text/images every time a public page loads. There's no server yet —
   this is here to prove out the editing experience before a real
   Raspberry Pi backend replaces it. Content is scoped by page + field id,
   and only the fields listed below are editable, on purpose, so nobody
   can accidentally break the page layout.
--------------------------------------------------------------------- */

/* ---------- Dark mode (works on every page, admin included; defaults to light) ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const THEME_KEY = "sabc_theme";
  const themeBtn = document.querySelector("#theme-toggle");
  const SUN_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const MOON_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function applyTheme(theme) {
    if (theme === "dark") { document.documentElement.setAttribute("data-theme", "dark"); if (themeBtn) themeBtn.innerHTML = SUN_ICON; }
    else { document.documentElement.removeAttribute("data-theme"); if (themeBtn) themeBtn.innerHTML = MOON_ICON; }
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  // Load the REAL server-side login session before anything on the page
  // tries to check "is someone logged in, and as who" — admin.js and
  // features.js both wait for this event instead of their own
  // DOMContentLoaded, so they never run against stale/empty session data.
  await fetchSession();
  await fetchAllStoredData();
  document.dispatchEvent(new CustomEvent("sabc:session-ready"));

  // On mobile, the on-screen keyboard often covers whatever you just
  // tapped — scroll the focused field into clear view above it, on any
  // admin page. A short delay lets the keyboard actually finish opening
  // first; scrolling too early undercounts how much space the keyboard
  // will take.
  if (document.body.classList.contains("admin-page")) {
    document.addEventListener("focusin", e => {
      if (e.target.matches("input, textarea, select")) {
        setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
      }
    });
  }
});

/* ---------------- Real shared storage — Who's Who, Gallery, Events,
   Calendar, Sermon Archive, and page content all live on the server now,
   not per-browser. This pulls everything down ONCE per page load into an
   in-memory cache (window.__serverStore), so the rest of the existing
   code — all written against a synchronous loadJSON/saveJSON — doesn't
   need to be rewritten to be async everywhere it's used. saveJSON still
   writes to the cache immediately (so the page feels instant) and fires
   the real save to the server in the background. ---------------- */
window.__serverStore = {};
const STORE_KEYS = [
  "sabc_content", "sabc_roster", "sabc_schedule_roles", "sabc_schedule",
  "sabc_events", "sabc_whoswho", "sabc_sermon_archive", "sabc_gallery",
  "sabc_hero_photos", "sabc_audit_log"
];

async function fetchAllStoredData() {
  await Promise.all(STORE_KEYS.map(async key => {
    try {
      const res = await fetch(`/api/store/${key}`, { credentials: "same-origin" });
      window.__serverStore[key] = await res.json();
    } catch {
      window.__serverStore[key] = null; // backend unreachable — code below falls back to defaults
    }
  }));
}

/* ---------------- Admin identity & access level — REAL now, backed by
   the Flask server's session cookie instead of a client-side guess. ---------------- */
window.__adminSession = null; // populated once, at page load, by fetchSession() below

async function fetchSession() {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    window.__adminSession = await res.json();
  } catch {
    // Backend unreachable (e.g. testing a page straight off disk with no
    // server behind it) — treat as logged out rather than crash the page.
    window.__adminSession = { loggedIn: false };
  }
  return window.__adminSession;
}

async function cmsGetAdminUsers() {
  try {
    const res = await fetch("/api/admins", { credentials: "same-origin" });
    return await res.json();
  } catch {
    return [];
  }
}
function cmsGetCurrentAdmin() {
  const s = window.__adminSession;
  if (!s || !s.loggedIn) return null;
  return { name: s.name, email: s.email, access: s.access };
}
function cmsCanEdit() {
  const a = cmsGetCurrentAdmin();
  return !a || a.access !== "View Only"; // no identity picked yet -> don't lock anyone out
}
/* Locks text/select fields (and "add/remove" style buttons) inside a
   container for View Only admins. File inputs and range sliders are left
   alone on purpose — "every admin can at least view and upload photos". */
function cmsApplyViewOnlyLock(container) {
  if (cmsCanEdit()) return;
  container.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach(el => el.readOnly = true);
  container.querySelectorAll('select').forEach(el => el.disabled = true);
  container.querySelectorAll('button').forEach(el => {
    if (el.dataset.allowViewOnly === undefined) el.disabled = true;
  });
  const banner = document.createElement("p");
  banner.className = "notice";
  banner.style.background = "#fdeaea";
  banner.style.borderColor = "#e6a9a9";
  banner.textContent = "👁 You're logged in with View Only access — you can browse everything and upload/reposition photos, but text and list changes are locked. Ask a Full Admin or Can-Edit admin for changes.";
  container.prepend(banner);
}

const CMS_SCHEMA = {
  global: {
    label: "Site-wide",
    fields: [],
    images: [
      { id: "logo", label: "Church Logo", hint: "Shows in the header on every page. Sizes to whatever height you set, keeping its real width/shape — no more squishing into a fixed box.", sizable: true, positionable: false, sizeMin: 32, sizeMax: 90, sizeDefault: 44 }
    ]
  },
  home: {
    label: "Homepage",
    fields: [
      { id: "hero_heading", label: "Welcome Heading", type: "text", default: "Welcome to St. Andrews Baptist Church" },
      { id: "hero_sub", label: "Tagline", type: "text", default: "Everyone Welcome" },
      { id: "service_time", label: "Sunday Service Time", type: "text", default: "10:30 AM in person · Facebook Live 6:30 PM" }
    ],
    images: []
  },
  about: {
    label: "About Page",
    fields: [
      { id: "pastor_note", label: "Pastor Welcome Note", type: "textarea",
        default: "Join Pastor Ladd Dunfield in person on Sunday mornings at 10:30 AM at St. Andrews Baptist Church, on Facebook for weekly Sunday messages at 6:30 PM, and on Tuesdays for Bible study at 7:00 PM." },
      { id: "history_note", label: "Our History — opening paragraph", type: "textarea",
        default: "Second St. Andrews Baptist Church organized on January 4, 1865. The building — built that year in the \"Carpenter Gothic\" style and nicknamed the \"Wedding Cake Church\" — still stands today, carrying the memory of the generations who built and cared for it." },
      { id: "history_note_more", label: "Our History — rest of the story", type: "textarea",
        default: "Over two centuries ago, St. Andrews was larger than what we think of it today. It wound along the shores of the St. Croix River in what is now Bayside, where the first St. Andrews Baptist Church was built — the \"Mother Church\" that later became Bayside United Baptist Church in 1941.\n\nIn 1796, James and Edward Manning preached up and down the shores of the St. Croix, sparking a revival that helped shape the earliest Baptist congregations in the area. Preachers like Thomas Ansley, Isaac Case, and Henry Hall continued that work through the early 1800s, and by 1806 the church membership had grown to forty-two.\n\nThe church we are part of today organized in the 1860s, as members of the original church found the winter trip into town increasingly difficult. Second St. Andrews Baptist Church was formally organized on January 4, 1865. Its handmade woodwork, the 1965 baptistery, and its stained glass windows all carry the memory of the generations who built and cared for this church.\n\nFor a century and a half, this church has been a place to worship, pray, hear God's Word, and share His love in St. Andrews and beyond." },
      { id: "partner1_desc", label: "Canadian Baptists of Atlantic Canada — description", type: "textarea",
        default: "A partnership of more than 450 Baptist churches and 21 associations across Atlantic Canada, resourcing pastors, churches, and shared mission." },
      { id: "partner2_desc", label: "Canadian Baptist Ministries — description", type: "textarea",
        default: "A global mission organization sharing God's love in word and deed, and believing God brings healing to a broken world through local churches." },
      { id: "partner3_desc", label: "Crandall University — description", type: "textarea",
        default: "Atlantic Canada's leading Christian liberal arts university, founded in 1949 in Moncton, New Brunswick." },
      { id: "partner4_desc", label: "Acadia Divinity College — description", type: "textarea",
        default: "The Faculty of Theology at Acadia University, offering the biblical and theological foundation for ministry training." },
      { id: "what_we_believe", label: "What We Believe", type: "textarea", default: "Full statement of faith to be added here." },
      { id: "leadership_note", label: "Leadership", type: "textarea", default: "Church leadership information to be added." },
      { id: "communion_note", label: "Open Communion", type: "textarea", default: "Information about open communion to be added." },
      { id: "sunday_school_note", label: "Sunday School", type: "textarea", default: "Information for children and families to be added." }
    ],
    images: [
      { id: "church_photo", label: "Church Photo", hint: "Shown near the top of the About page.", sizable: true }
    ]
  },
  sermons: {
    label: "Sermons Page",
    fields: [
      { id: "latest_title", label: "Latest Sermon Title", type: "text", default: "Sermon title" },
      { id: "latest_speaker", label: "Speaker", type: "text", default: "Speaker" },
      { id: "latest_passage", label: "Bible Passage", type: "text", default: "Bible passage" },
      { id: "youtube_id", label: "YouTube Video (paste the video ID or the full link)", type: "text", default: "" }
    ],
    images: []
  },
  events: {
    label: "Events Page",
    fields: [
      { id: "events_note", label: "Note above the list", type: "textarea", default: "See what's coming up at St. Andrews Baptist Church." }
    ],
    images: []
  },
  prayer: {
    label: "Prayer Page",
    fields: [
      { id: "prayer_intro", label: "Intro Text", type: "textarea", default: "We would love to pray for you." }
    ],
    images: []
  },
  contact: {
    label: "Contact Page",
    fields: [
      { id: "address", label: "Address", type: "text", default: "115 King Street, St. Andrews, NB" },
      { id: "phone", label: "Phone", type: "text", default: "(506) 529-3022" },
      { id: "email", label: "Email", type: "text", default: "ladd@thebeggardanced.com" }
    ],
    images: []
  },
  giving: {
    label: "Giving Page",
    fields: [
      { id: "etransfer_note", label: "E-Transfer Instructions", type: "textarea", default: "Giving details are still being finalized. Once Pastor Ladd confirms the e-transfer address and any instructions, they'll go here." },
      { id: "tax_note", label: "Tax Receipt Note", type: "textarea", default: "Receipts are issued for donations of $20 or more. Final tax receipt details will be confirmed by the church." }
    ],
    images: []
  }
};

const CMS_KEY = "sabc_content";

function cmsLoadAll() {
  return window.__serverStore[CMS_KEY] || {};
}

/* Fire-and-forget save to the server for any of the shared-storage keys.
   The in-memory cache is already updated by the caller before this runs,
   so the page feels instant even though the network call happens after. */
function serverStoreSave(key, value) {
  return fetch(`/api/store/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(value)
  }).catch(err => console.error("Save to server failed for", key, err));
}

async function cmsSavePage(pageKey, data) {
  const all = cmsLoadAll();
  const before = all[pageKey] || {};
  const changes = [];
  Object.keys(data).forEach(k => {
    if (before[k] !== data[k]) {
      const rawOld = before[k] ?? null, rawNew = data[k] ?? null;
      const isImage = (typeof rawOld === "string" && rawOld.startsWith("data:image")) || (typeof rawNew === "string" && rawNew.startsWith("data:image"));
      const change = { field: k, old: cmsTrim(rawOld), new: cmsTrim(rawNew), revertable: !isImage };
      if (!isImage) { change.rawOld = rawOld; change.rawNew = rawNew; } // needed to actually revert; skipped for photos to keep the log small
      changes.push(change);
    }
  });
  all[pageKey] = { ...before, ...data };
  window.__serverStore[CMS_KEY] = all;
  await serverStoreSave(CMS_KEY, all); // MUST finish before the caller is allowed to navigate away —
  // otherwise the browser cancels this request mid-flight the instant the page changes, and the
  // "save" silently never actually reaches the server. This was the "logo/sermons page doesn't save" bug.
  cmsLogChange(pageKey, changes);
  return { ok: true };
}

/* Reverts every revertable field in a log entry back to its recorded
   "old" value. Photos can't be auto-reverted (their old data isn't kept
   in the log, to avoid bloating storage) — those need a manual re-upload. */
async function cmsRevertLogEntry(entry) {
  const revertData = {};
  let any = false;
  (entry.changes || []).forEach(c => {
    if (c.revertable) { revertData[c.field] = c.rawOld; any = true; }
  });
  if (!any) return { ok: false, reason: "nothing revertable" };
  return await cmsSavePage(entry.page, revertData);
}

/* Same idea as above, but for the non-schema features (Calendar, Who's
   Who, Admin Users) that save a whole list/object straight to localStorage
   instead of going through cmsSavePage. Photo fields are stripped out
   before being kept in the log, same reasoning as above. */
function cmsStripImages(value) {
  if (typeof value === "string") return value.startsWith("data:image") ? "(photo — omitted from log to save space)" : value;
  if (Array.isArray(value)) return value.map(cmsStripImages);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach(k => { out[k] = cmsStripImages(value[k]); });
    return out;
  }
  return value;
}
function cmsLogRawChange(label, revertKey, revertPath, before, after) {
  cmsLogChange(label, [{
    field: label, old: "(previous version)", new: "(updated)", revertable: true, isRaw: true,
    revertKey, revertPath, rawOld: cmsStripImages(before), rawNew: cmsStripImages(after)
  }]);
}
async function cmsRevertRawEntry(entry) {
  const c = (entry.changes || [])[0];
  if (!c || !c.revertable || !c.isRaw) return { ok: false };
  if (c.revertPath) {
    const data = window.__serverStore[c.revertKey] || {};
    data[c.revertPath] = c.rawOld;
    window.__serverStore[c.revertKey] = data;
    await serverStoreSave(c.revertKey, data);
  } else {
    window.__serverStore[c.revertKey] = c.rawOld;
    await serverStoreSave(c.revertKey, c.rawOld);
  }
  return { ok: true };
}

/* Shrinks a photo before it's stored, so a phone photo (often several MB)
   doesn't blow past the browser's ~5-10MB localStorage limit. Without this,
   uploading a couple of full-size photos can silently fail to save. */
function compressImage(file, maxDimension = 1000, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) { height = Math.round(height * (maxDimension / width)); width = maxDimension; }
          else { width = Math.round(width * (maxDimension / height)); height = maxDimension; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Safe wrapper for any other feature (calendar, Who's Who, admins) that
   writes straight to localStorage, so a storage failure shows up instead
   of silently doing nothing. */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.error("Storage write failed for", key, err);
    alert("This didn't save — the browser's local storage is full (usually from too many/too-large photos). Try removing a photo or two, or use smaller photos, then try again.");
    return false;
  }
}

function cmsGetPage(pageKey) {
  const all = cmsLoadAll();
  const schema = CMS_SCHEMA[pageKey];
  const saved = all[pageKey] || {};
  const result = {};
  if (schema) {
    schema.fields.forEach(f => { result[f.id] = saved[f.id] ?? f.default; });
    schema.images.forEach(img => {
      result[img.id] = saved[img.id] || null;
      result[img.id + "_h"] = saved[img.id + "_h"] || 300;
      result[img.id + "_pos"] = saved[img.id + "_pos"] ?? 50;
    });
  }
  return result;
}

/* ---------------- Audit log ---------------- */
const CMS_LOG_KEY = "sabc_audit_log";

function cmsLogChange(page, changes) {
  if (!changes || !changes.length) return;
  const log = window.__serverStore[CMS_LOG_KEY] || [];
  const who = cmsGetCurrentAdmin();
  log.unshift({ ts: new Date().toISOString(), page, changes, by: who ? { name: who.name, email: who.email, access: who.access } : null });
  if (log.length > 500) log.length = 500;
  window.__serverStore[CMS_LOG_KEY] = log;
  serverStoreSave(CMS_LOG_KEY, log);
}

function cmsTrim(v) {
  if (v === null || v === undefined || v === "") return "(empty)";
  const s = String(v);
  if (s.startsWith("data:image")) return "(new photo uploaded)";
  return s.length > 70 ? s.slice(0, 70) + "…" : s;
}

/* Applies saved content to a public page. Call on DOMContentLoaded with
   the page key ("home", "about", etc). Looks for elements marked
   data-field="fieldId" (text) and data-image="imageId" (image slot). */
function cmsApplyToPage(pageKey) {
  const global = cmsGetPage("global");
  if (global.logo) {
    const logoH = global.logo_h || 44;
    document.querySelectorAll("[data-image='logo']").forEach(el => {
      el.style.height = logoH + "px";
      el.style.width = "auto";
      el.style.border = "none";
      el.style.background = "none";
      el.innerHTML = `<img src="${global.logo}" alt="Church logo" style="height:100%;width:auto;display:block;object-fit:contain">`;
    });
  }

  if (!pageKey || !CMS_SCHEMA[pageKey]) return;
  const content = cmsGetPage(pageKey);

  document.querySelectorAll("[data-field]").forEach(el => {
    const id = el.getAttribute("data-field");
    if (content[id] !== undefined && content[id] !== null) {
      el.textContent = content[id];
    }
  });

  document.querySelectorAll("[data-image]").forEach(el => {
    const id = el.getAttribute("data-image");
    if (id === "logo") return; // handled above, global
    if (content[id]) {
      const h = content[id + "_h"] || 300;
      const pos = content[id + "_pos"] ?? 50;
      el.style.height = h + "px";
      el.style.overflow = "hidden";
      el.innerHTML = `<img src="${content[id]}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% ${pos}%;border-radius:inherit">`;
    }
  });

  // Sermons: swap in a YouTube embed if a video has been set
  if (pageKey === "sermons" && content.youtube_id) {
    const slot = document.querySelector("#sermon-video");
    if (slot) {
      const match = String(content.youtube_id).match(/(?:v=|youtu\.be\/|embed\/)?([a-zA-Z0-9_-]{11})(?:[?&]|$)/);
      const vid = match ? match[1] : content.youtube_id;
      slot.innerHTML = `<iframe width="100%" height="100%" style="position:absolute;inset:0;border:0" src="https://www.youtube.com/embed/${vid}" title="Latest sermon" allowfullscreen></iframe>`;
      slot.style.position = "relative";
      slot.style.paddingBottom = "56.25%";
      slot.style.height = "0";
    }
  }

  // Homepage "Latest Sermon" box always mirrors the real Sermons page content,
  // so there's one single place (Admin → Sermons) to edit it, not two.
  const homeVideoSlot = document.querySelector("#home-sermon-video");
  if (homeVideoSlot) {
    const sermonContent = cmsGetPage("sermons");
    const titleEl = document.querySelector("#home-sermon-title");
    if (titleEl && sermonContent.latest_title) titleEl.textContent = sermonContent.latest_title;
    if (sermonContent.youtube_id) {
      const match = String(sermonContent.youtube_id).match(/(?:v=|youtu\.be\/|embed\/)?([a-zA-Z0-9_-]{11})(?:[?&]|$)/);
      const vid = match ? match[1] : sermonContent.youtube_id;
      homeVideoSlot.innerHTML = `<iframe width="100%" height="100%" style="position:absolute;inset:0;border:0" src="https://www.youtube.com/embed/${vid}" title="Latest sermon" allowfullscreen></iframe>`;
      homeVideoSlot.style.position = "relative";
      homeVideoSlot.style.paddingBottom = "56.25%";
      homeVideoSlot.style.height = "0";
      const fallback = document.querySelector("#home-sermon-fallback-text");
      if (fallback) fallback.style.display = "none";
    }
  }
}
