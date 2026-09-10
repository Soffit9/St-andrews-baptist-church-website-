document.addEventListener("DOMContentLoaded", () => {
  const menu = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".nav");
  if (menu && nav) menu.addEventListener("click", () => nav.classList.toggle("open"));

  /* ---------- Prayer request form ---------- */
  const prayerForm = document.querySelector("#prayer-form");
  if (prayerForm) {
    const requestBox = prayerForm.querySelector("textarea[name='request']");
    const warning = document.querySelector("#filter-warning");

    // Very small starter word list to catch hateful/discriminatory language.
    // Ordinary swearing is allowed through on purpose, per the church's request.
    // This is a placeholder demo filter, not a finished moderation system.
    const flaggedWords = ["nigger", "faggot", "retard", "kike", "spic", "chink"];

    function checkText() {
      if (!requestBox || !warning) return true;
      const text = requestBox.value.toLowerCase();
      const hit = flaggedWords.some(w => text.includes(w));
      warning.style.display = hit ? "block" : "none";
      return !hit;
    }
    if (requestBox) requestBox.addEventListener("input", checkText);

    prayerForm.addEventListener("submit", async e => {
      e.preventDefault();
      if (!checkText()) {
        document.querySelector("#form-message").textContent =
          "This request may contain language our filter flags for review. Please rephrase, or a staff member can help if you're not sure why.";
        document.querySelector("#form-message").className = "error";
        return;
      }
      const formData = new FormData(prayerForm);
      const payload = {
        name: formData.get("name") || "",
        email: formData.get("email") || "",
        request: formData.get("request") || "",
        pray_aloud: formData.get("pray_aloud") === "yes"
      };
      const msgEl = document.querySelector("#form-message");
      try {
        const res = await fetch("/api/prayer-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          msgEl.className = "error";
          msgEl.textContent = data.error || "Couldn't submit that — please try again.";
          return;
        }
        msgEl.className = "success";
        msgEl.textContent = "Thank you — your prayer request has been received.";
        prayerForm.reset();
        if (warning) warning.style.display = "none";
      } catch {
        msgEl.className = "error";
        msgEl.textContent = "Couldn't reach the server right now — please try again in a moment.";
      }
    });
  }

  /* ---------- Admin login (prototype) ---------- */
  const loginForm = document.querySelector("#login-form");
  if (loginForm) loginForm.addEventListener("submit", e => {
    e.preventDefault();
    document.querySelector("#login-message").className = "success";
    document.querySelector("#login-message").textContent =
      "Prototype login — real password checking and the email/app verification code will be added before this goes live.";
  });

  const apply = document.querySelector("#apply-demo");
  if (apply) apply.addEventListener("click", () => {
    alert("Prototype: this button will back up the current site, save your changes, and publish them once the admin system is built.");
  });

  /* ---------- Daily Bible verse ----------
     Pulled from bible-api.com — free, no key required, and its default
     translations (KJV / WEB / etc.) are public domain, so there's no
     copyright issue reusing the text. We can't legally copy K-LOVE's
     verse-of-the-day page itself, but this gets the same effect.
     Each day's verse is cached in localStorage the first time someone
     visits, so the site slowly builds its own year-by-year archive —
     exactly like klove.com/faith/votd, just grown locally over time. */
  const VERSE_REFERENCES = [
    "psalm+119:105","proverbs+3:5-6","philippians+4:13","psalm+23:1","deuteronomy+31:6",
    "joshua+1:9","romans+8:28","john+3:16","psalm+46:1","isaiah+41:10",
    "jeremiah+29:11","matthew+6:33","psalm+27:1","2corinthians+5:17","galatians+5:22-23",
    "psalm+121:1-2","proverbs+16:3","romans+12:2","1peter+5:7","psalm+34:18",
    "hebrews+11:1","philippians+4:6-7","matthew+11:28","psalm+91:1-2","isaiah+40:31",
    "james+1:5","psalm+37:4","john+14:27","romans+15:13","psalm+9:1"
  ];

  const verseEl = document.querySelector("#daily-verse");
  const refEl = document.querySelector("#verse-ref");
  const dateEl = document.querySelector("#verse-date");
  const prevBtn = document.querySelector("#verse-prev");
  const nextBtn = document.querySelector("#verse-next");
  const jumpInput = document.querySelector("#verse-jump");
  const jumpBtn = document.querySelector("#verse-jump-go");

  if (verseEl) {
    const VERSE_KEY = "sabc_verse_archive";
    const archive = JSON.parse(localStorage.getItem(VERSE_KEY) || "{}");

    function dayOfYear(d) {
      const start = new Date(d.getFullYear(), 0, 0);
      return Math.floor((d - start) / 86400000);
    }
    // Local calendar date (not UTC) — using toISOString() here was the bug:
    // it converts to UTC first, so anyone west of Greenwich could see "today's"
    // verse show what was actually tomorrow's, especially in the evening.
    function isoDate(d) {
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    function referenceFor(d) {
      return VERSE_REFERENCES[((dayOfYear(d) % VERSE_REFERENCES.length) + VERSE_REFERENCES.length) % VERSE_REFERENCES.length];
    }

    async function verseFor(d) {
      const key = isoDate(d);
      if (archive[key]) return archive[key];
      try {
        const res = await fetch("https://bible-api.com/" + referenceFor(d));
        const data = await res.json();
        const verse = { text: data.text.trim(), ref: data.reference };
        archive[key] = verse;
        localStorage.setItem(VERSE_KEY, JSON.stringify(archive));
        return verse;
      } catch {
        return { text: "Your word is a lamp for my feet, a light on my path.", ref: "Psalm 119:105 (offline fallback)" };
      }
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    let current = new Date(today);

    async function renderVerse() {
      const v = await verseFor(current);
      verseEl.textContent = "\u201C" + v.text + "\u201D";
      refEl.textContent = v.ref;
      const isToday = isoDate(current) === isoDate(today);
      if (dateEl) dateEl.textContent = isToday ? "Today" : current.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      if (nextBtn) nextBtn.disabled = isToday;
      if (jumpInput) jumpInput.value = isoDate(current);
    }
    renderVerse();
    if (prevBtn) prevBtn.addEventListener("click", () => { current.setDate(current.getDate() - 1); renderVerse(); });
    if (nextBtn) nextBtn.addEventListener("click", () => { if (current < today) { current.setDate(current.getDate() + 1); renderVerse(); } });
    if (jumpInput) jumpInput.max = isoDate(today);
    if (jumpBtn) jumpBtn.addEventListener("click", () => {
      if (!jumpInput.value) return;
      const picked = new Date(jumpInput.value + "T00:00:00");
      if (picked > today) return;
      current = picked;
      renderVerse();
    });
  }
});

/* Apply any admin-saved text/photos for this page — waits for the real
   shared data to actually finish loading from the server first (see
   content.js), otherwise this would run too early and show the default
   placeholder text instead of what's really been saved. */
document.addEventListener("sabc:session-ready", () => {
  const pageKey = document.body.dataset.page;
  if (typeof cmsApplyToPage === "function") cmsApplyToPage(pageKey);
});
