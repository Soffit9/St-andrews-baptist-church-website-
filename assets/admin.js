/* ---------------------------------------------------------------------
   Admin-only behaviour: login flow (prototype 2-step), the "which page
   do you want to edit" picker, and the edit form itself.
--------------------------------------------------------------------- */

// Password checking now happens server-side (backend/app.py) — nothing
// resembling a password lives in this file anymore, on purpose. That was
// the entire point of building the real backend: a visitor viewing this
// page's source can no longer just read the password.

function requireLogin() {
  if (!window.__adminSession || !window.__adminSession.loggedIn) {
    window.location.href = "login.html";
  }
}

/* Shows a small "logged in as X (access level)" indicator on every admin
   page, so if something seems locked/won't save, it's obvious at a glance
   whether you're on a View Only account instead of a mystery bug. */
function showWhoAmI() {
  if (document.querySelector("#login-step-1")) return; // not logged in yet on this page
  const me = cmsGetCurrentAdmin();
  if (!me) return;
  const topbar = document.querySelector(".admin-topbar") || document.querySelector(".admin-top");
  if (!topbar) return;
  const tag = document.createElement("span");
  tag.style.cssText = "font-size:12px;color:var(--muted);margin-left:auto;margin-right:12px;align-self:center";
  tag.textContent = `Logged in as ${me.name || me.email} (${me.access || "Full Admin"})`;
  topbar.appendChild(tag);
}
document.addEventListener("sabc:session-ready", showWhoAmI);

/* Small mockups of each page's editable region, used as the live preview
   pane in edit.html. Kept intentionally simple (not the full page chrome)
   so it's fast and can't drift out of sync with the real header/nav. */
function previewTemplate(pageKey, c) {
  const imgBox = (id, label) => c[id]
    ? `<div data-preview-image="${id}" style="height:${c[id+'_h']||300}px;border-radius:10px;overflow:hidden"><img src="${c[id]}" style="width:100%;height:100%;object-fit:cover;object-position:50% ${c[id+'_pos']??50}%"></div>`
    : `<div class="image-placeholder" data-preview-image="${id}" style="height:${c[id+'_h']||300}px;border-radius:10px">${label}</div>`;

  switch (pageKey) {
    case "global":
      return `<div style="display:flex;align-items:center;gap:10px">
        <div class="logo-placeholder" data-preview-image="logo" style="${c.logo ? `height:${c.logo_h||44}px;width:auto` : ""}">${c.logo ? `<img src="${c.logo}" style="height:100%;width:auto;display:block;object-fit:contain">` : "LOGO"}</div>
        <strong>St. Andrews Baptist Church</strong></div>
        <p class="field-hint" style="margin-top:14px">The logo appears at this height in the header — width follows the photo's real shape, so nothing gets squished.</p>`;
    case "home":
      return `<p class="eyebrow">ST. ANDREWS BAPTIST CHURCH</p>
        <h1 data-preview="hero_heading">${c.hero_heading}</h1>
        <p class="lead" data-preview="hero_sub">${c.hero_sub}</p>
        <div class="service-card"><strong>Sunday Worship</strong><span data-preview="service_time">${c.service_time}</span></div>`;
    case "about":
      return `${imgBox("church_photo", "CHURCH PHOTO")}
        <h2 style="margin-top:16px">Meet Our Pastor</h2>
        <p data-preview="pastor_note">${c.pastor_note}</p>
        <h2>Our History</h2>
        <p data-preview="history_note">${c.history_note}</p>
        <p data-preview="history_note_more" style="white-space:pre-line">${c.history_note_more}</p>
        <h2>Partner Ministries</h2>
        <p><b>Canadian Baptists of Atlantic Canada</b><br><span data-preview="partner1_desc">${c.partner1_desc}</span></p>
        <p><b>Canadian Baptist Ministries</b><br><span data-preview="partner2_desc">${c.partner2_desc}</span></p>
        <p><b>Crandall University</b><br><span data-preview="partner3_desc">${c.partner3_desc}</span></p>
        <p><b>Acadia Divinity College</b><br><span data-preview="partner4_desc">${c.partner4_desc}</span></p>
        <h2>What We Believe</h2>
        <p data-preview="what_we_believe">${c.what_we_believe}</p>
        <h2>Leadership</h2><p data-preview="leadership_note">${c.leadership_note}</p>
        <h2>Open Communion</h2><p data-preview="communion_note">${c.communion_note}</p>
        <h2>Sunday School</h2><p data-preview="sunday_school_note">${c.sunday_school_note}</p>`;
    case "sermons":
      return `<div class="video-placeholder featured" style="min-height:160px">▶</div>
        <div class="sermon-meta" style="margin-top:10px">
          <h2 data-preview="latest_title">${c.latest_title}</h2>
          <p><span data-preview="latest_speaker">${c.latest_speaker}</span> · <span data-preview="latest_passage">${c.latest_passage}</span></p>
        </div>
        <p class="field-hint">${c.youtube_id ? "A YouTube video is set — it'll replace the ▶ box above on the real page." : "No YouTube video set yet."}</p>`;
    case "events":
      return `<h1>Upcoming Events</h1><p data-preview="events_note">${c.events_note}</p>`;
    case "prayer":
      return `<h1>Prayer Request</h1><p data-preview="prayer_intro">${c.prayer_intro}</p>`;
    case "contact":
      return `<h2>Contact Us</h2>
        <p>📍 <span data-preview="address">${c.address}</span></p>
        <p>☎ <span data-preview="phone">${c.phone}</span></p>
        <p>✉ <span data-preview="email">${c.email}</span></p>`;
    case "giving":
      return `<h2>E-Transfer</h2><p data-preview="etransfer_note">${c.etransfer_note}</p>
        <h2 style="margin-top:16px">Tax Receipts</h2><p data-preview="tax_note">${c.tax_note}</p>`;
    default:
      return "<p>No preview available.</p>";
  }
}

document.addEventListener("sabc:session-ready", () => {

  if (window.location.protocol === "file:") {
    const banner = document.createElement("div");
    banner.className = "file-warning";
    banner.innerHTML = "⚠ You're opening this page directly as a file. Some browsers won't reliably save admin changes this way (photos, calendar entries, the log) — see README.md, \"Running this properly,\" for the easiest fix.";
    document.body.prepend(banner);
  }

  if (typeof cmsApplyToPage === "function") cmsApplyToPage(null); // just applies the global logo, if set

  /* ---------- Login page (2-step prototype) ---------- */
  const step1 = document.querySelector("#login-step-1");
  const stepMethod = document.querySelector("#login-step-method");
  const stepEmail = document.querySelector("#login-step-email");
  const step2 = document.querySelector("#login-step-2");
  if (step1 && stepMethod && stepEmail && step2) {
    let currentPassword = "";
    let chosenMethod = "email"; // "email" or "totp" — just changes the messaging, both call the same endpoints

    function showOnly(el) {
      [step1, stepMethod, stepEmail, step2].forEach(s => s.classList.add("hidden-step"));
      el.classList.remove("hidden-step");
    }

    // Restore progress if the phone reloaded this tab while you were off
    // checking your email — skips straight to "enter your code" instead of
    // making you type your password again. Expires after 9 minutes to stay
    // just under the server's 10-minute code lifetime.
    (function restoreProgress() {
      try {
        const saved = JSON.parse(sessionStorage.getItem("sabc_login_progress") || "null");
        if (!saved || Date.now() - saved.ts > 9 * 60 * 1000) { sessionStorage.removeItem("sabc_login_progress"); return; }
        chosenMethod = saved.chosenMethod;
        document.querySelector("#who-email").value = saved.email;
        const codeBox = document.querySelector("#code-box");
        const resendWrap = document.querySelector("#resend-wrap");
        codeBox.innerHTML = chosenMethod === "totp"
          ? "Enter the current code from your authenticator app."
          : `A code was sent to <b>${saved.email}</b> a moment ago — enter it below, or request a new one if it's expired.`;
        resendWrap.style.display = chosenMethod === "totp" ? "none" : "";
        showOnly(step2);
        document.querySelector("#code-input").focus();
      } catch { sessionStorage.removeItem("sabc_login_progress"); }
    })();

    step1.addEventListener("submit", e => {
      e.preventDefault();
      currentPassword = document.querySelector("#password").value;
      document.querySelector("#password-message").textContent = "";
      showOnly(stepMethod);
    });

    document.querySelector("#back-to-password").addEventListener("click", () => { sessionStorage.removeItem("sabc_login_progress"); showOnly(step1); });

    document.querySelector("#method-email").addEventListener("click", () => {
      chosenMethod = "email";
      showOnly(stepEmail);
      document.querySelector("#who-email").focus();
    });
    document.querySelector("#method-totp").addEventListener("click", () => {
      chosenMethod = "totp";
      showOnly(stepEmail);
      document.querySelector("#who-email").focus();
    });

    let requestInFlight = false;
    async function requestCode() {
      if (requestInFlight) return false; // already sending one — ignore a second trigger instead of sending two
      requestInFlight = true;
      const email = document.querySelector("#who-email").value.trim();
      const emailMsg = document.querySelector("#email-message");
      emailMsg.textContent = "";
      const stepEmailBtn = stepEmail.querySelector("button[type=submit]");
      const resendBtn = document.querySelector("#resend-code");
      if (stepEmailBtn) stepEmailBtn.disabled = true;
      if (resendBtn) resendBtn.disabled = true;
      try {
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ password: currentPassword, email, method: chosenMethod })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          emailMsg.className = "error";
          emailMsg.textContent = data.error || "Something went wrong — check your password and try again.";
          if ((data.error || "").toLowerCase().includes("password")) showOnly(step1);
          return false;
        }
        const codeBox = document.querySelector("#code-box");
        const resendWrap = document.querySelector("#resend-wrap");
        if (chosenMethod === "totp") {
          codeBox.innerHTML = "Enter the current code from your authenticator app.";
          resendWrap.style.display = "none";
        } else if (data.emailed) {
          codeBox.innerHTML = `A code was just emailed to <b>${email}</b>. (Requesting a new one invalidates this one — only the newest code works.)`;
          resendWrap.style.display = "";
        } else {
          codeBox.innerHTML = `Email isn't set up yet, so here's the code directly: <strong>${data.demo_code}</strong>`;
          resendWrap.style.display = "";
        }
        // Remember where we are — if the phone's browser reloads this tab
        // while you're off checking email (very common on mobile), coming
        // back should land on "enter your code," not force you to start
        // over. The code itself stays valid server-side either way.
        sessionStorage.setItem("sabc_login_progress", JSON.stringify({ email, chosenMethod, ts: Date.now() }));
        return true;
      } catch {
        emailMsg.className = "error";
        emailMsg.textContent = "Couldn't reach the server — is the backend running?";
        return false;
      } finally {
        requestInFlight = false;
        if (stepEmailBtn) stepEmailBtn.disabled = false;
        if (resendBtn) resendBtn.disabled = false;
      }
    }

    stepEmail.addEventListener("submit", async e => {
      e.preventDefault();
      if (await requestCode()) {
        showOnly(step2);
        document.querySelector("#code-input").focus();
      }
    });

    const resend = document.querySelector("#resend-code");
    if (resend) resend.addEventListener("click", requestCode);

    step2.addEventListener("submit", async e => {
      e.preventDefault();
      const entered = document.querySelector("#code-input").value.trim();
      const email = document.querySelector("#who-email").value.trim();
      const msg = document.querySelector("#login-message");
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ email, code: entered })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          msg.className = "error";
          msg.textContent = data.error || "That code doesn't match. Double check and try again.";
          return;
        }
        sessionStorage.removeItem("sabc_login_progress");
        window.__adminSession = { loggedIn: true, name: data.name, email: data.email, access: data.access };
        const returnTo = localStorage.getItem("sabc_return_to");
        if (returnTo) { localStorage.removeItem("sabc_return_to"); window.location.href = returnTo; }
        else window.location.href = "dashboard.html";
      } catch (err) {
        msg.className = "error";
        msg.textContent = "Couldn't reach the server — is the backend running?";
      }
    });
  }

  /* ---------- Dashboard page picker ---------- */
  const pageButtons = document.querySelectorAll("[data-goto-page]");
  if (pageButtons.length) {
    requireLogin();
    const welcomeEl = document.querySelector("#welcome-heading");
    if (welcomeEl) {
      const me = cmsGetCurrentAdmin();
      welcomeEl.textContent = (() => {
        const rawName = me ? (me.name || me.email || "Admin") : "Admin";
        const firstWord = rawName.trim().split(/\s+/)[0];
        const firstName = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
        return `${greeting}, ${firstName}`;
      })();
    }
    pageButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        window.location.href = "edit.html?page=" + btn.getAttribute("data-goto-page");
      });
    });

    // Hide dashboard tiles the current admin shouldn't have access to.
    // Full Admin sees everything. Can Edit sees everything except Admin
    // Users and Prayer Requests (so an editor can't grant themselves
    // Full Admin). View Only sees only Church Calendar and Gallery
    // (those two tiles are simply left with no data-min-access at all).
    const RANK = { "View Only": 0, "Can Edit": 1, "Full Admin": 2 };
    const myRank = RANK[(me && me.access) || "Full Admin"] ?? 2;
    document.querySelectorAll(".quick-grid button[data-min-access]").forEach(btn => {
      const required = RANK[btn.dataset.minAccess] ?? 0;
      if (myRank < required) btn.style.display = "none";
    });
  }
  const logoutBtn = document.querySelector("#logout");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    window.location.href = "login.html";
  });

  /* ---------- Edit page ---------- */
  const editRoot = document.querySelector("#edit-root");
  if (editRoot) {
    requireLogin();
    const params = new URLSearchParams(window.location.search);
    const pageKey = params.get("page");
    const schema = CMS_SCHEMA[pageKey];
    const titleEl = document.querySelector("#edit-title");

    if (!schema) {
      editRoot.innerHTML = "<p>Unknown page. <a href='dashboard.html'>Go back</a>.</p>";
    } else {
      if (titleEl) titleEl.textContent = "Edit: " + schema.label;
      const current = cmsGetPage(pageKey);

      let formHtml = "<form id='edit-form'>";

      schema.images.forEach(img => {
        const preview = current[img.id]
          ? `<img src="${current[img.id]}" alt="">`
          : `<span>Click to add photo</span>`;
        formHtml += `
          <div class="edit-field">
            <label>${img.label}</label>
            <p class="field-hint">${img.hint || ""}</p>
            <label class="image-upload-slot" for="img_${img.id}">${preview}</label>
            <input type="file" accept="image/*" id="img_${img.id}" data-image-id="${img.id}" style="display:none">
            ${current[img.id] ? `<button type="button" class="text-btn" data-clear-image="${img.id}" data-allow-view-only style="font-size:13px;margin-top:6px">Remove this photo</button>` : ""}`;
        if (img.sizable) {
          const minH = img.sizeMin ?? 150, maxH = img.sizeMax ?? 500, defH = current[img.id + "_h"] || img.sizeDefault || 300;
          formHtml += `
            <div class="size-field">
              <label for="size_${img.id}">Photo height <span class="size-readout" id="size_readout_${img.id}">${defH}px</span></label>
              <input type="range" min="${minH}" max="${maxH}" step="2" id="size_${img.id}" data-size-id="${img.id}" value="${defH}">
            </div>`;
          if (img.positionable !== false) {
            formHtml += `
            <div class="size-field">
              <label for="pos_${img.id}">Focus point <span class="size-readout" id="pos_readout_${img.id}">${current[img.id + "_pos"] < 34 ? "top" : current[img.id + "_pos"] > 66 ? "bottom" : "center"}</span></label>
              <p class="field-hint">Drag left to show more of the top of the photo, right to show more of the bottom.</p>
              <input type="range" min="0" max="100" step="1" id="pos_${img.id}" data-pos-id="${img.id}" value="${current[img.id + "_pos"]}">
            </div>`;
          }
        }
        formHtml += `</div>`;
      });

      schema.fields.forEach(f => {
        const val = (current[f.id] || "").toString();
        formHtml += `<div class="edit-field"><label for="f_${f.id}">${f.label}</label>`;
        formHtml += f.type === "textarea"
          ? `<textarea id="f_${f.id}" data-field-id="${f.id}" rows="4">${val}</textarea>`
          : `<input id="f_${f.id}" data-field-id="${f.id}" type="text" value="${val.replace(/"/g, "&quot;")}">`;
        formHtml += `</div>`;
      });

      formHtml += `
        <div class="edit-actions">
          <a class="button button-light" href="dashboard.html">← Back without saving</a>
          <button type="submit" class="button" data-allow-view-only>Apply Changes</button>
        </div>
      </form>`;

      editRoot.innerHTML = `
        <div class="edit-split">
          <div class="edit-col" id="edit-col"><h3>Edit</h3>${formHtml}</div>
          <div class="preview-col"><h3>Live Preview</h3><div class="preview-frame" id="preview-frame">${previewTemplate(pageKey, current)}</div></div>
        </div>`;
      cmsApplyViewOnlyLock(document.querySelector("#edit-col"));

      function refreshPreview(id, value) {
        document.querySelectorAll(`#preview-frame [data-preview="${id}"]`).forEach(el => el.textContent = value);
      }
      function refreshPreviewImage(id, dataUrl, height, pos) {
        document.querySelectorAll(`#preview-frame [data-preview-image="${id}"]`).forEach(el => {
          if (id === "logo") {
            el.style.height = height + "px";
            el.style.width = "auto";
            el.innerHTML = `<img src="${dataUrl}" alt="" style="height:100%;width:auto;display:block;object-fit:contain">`;
          } else {
            el.style.height = (height || 300) + "px";
            el.innerHTML = `<img src="${dataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:50% ${pos ?? 50}%">`;
          }
        });
      }
      function currentPos(id) {
        const range = editRoot.querySelector(`[data-pos-id="${id}"]`);
        return range ? range.value : (current[id + "_pos"] ?? 50);
      }
      function currentSize(id) {
        const range = editRoot.querySelector(`[data-size-id="${id}"]`);
        return range ? range.value : (current[id + "_h"] || 300);
      }

      // Live text updates as you type
      editRoot.querySelectorAll("[data-field-id]").forEach(input => {
        input.addEventListener("input", () => refreshPreview(input.dataset.fieldId, input.value));
      });

      // Live size updates
      editRoot.querySelectorAll("[data-size-id]").forEach(range => {
        range.addEventListener("input", () => {
          const id = range.dataset.sizeId;
          document.querySelector(`#size_readout_${id}`).textContent = range.value + "px";
          const imgInput = editRoot.querySelector(`[data-image-id="${id}"]`);
          const src = imgInput.dataset.value || current[id];
          if (src) refreshPreviewImage(id, src, range.value, currentPos(id));
        });
      });

      // Live focus-point updates
      editRoot.querySelectorAll("[data-pos-id]").forEach(range => {
        range.addEventListener("input", () => {
          const id = range.dataset.posId;
          const label = range.value < 34 ? "top" : range.value > 66 ? "bottom" : "center";
          document.querySelector(`#pos_readout_${id}`).textContent = label;
          const imgInput = editRoot.querySelector(`[data-image-id="${id}"]`);
          const src = imgInput.dataset.value || current[id];
          if (src) refreshPreviewImage(id, src, currentSize(id), range.value);
        });
      });

      // Image previews + storage as a compressed photo (keeps localStorage small
      // enough that a couple of full-size phone photos won't silently fail to save)
      editRoot.querySelectorAll("input[type=file]").forEach(input => {
        input.addEventListener("change", () => {
          const file = input.files[0];
          if (!file) return;
          compressImage(file, 1000, 0.75).then(dataUrl => {
            const slot = input.previousElementSibling;
            slot.innerHTML = `<img src="${dataUrl}" alt="">`;
            input.dataset.value = dataUrl;
            delete input.dataset.cleared;
            refreshPreviewImage(input.dataset.imageId, dataUrl, currentSize(input.dataset.imageId), currentPos(input.dataset.imageId));
          }).catch(err => alert("Couldn't process that photo: " + err.message));
        });
      });

      editRoot.querySelectorAll("[data-clear-image]").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.clearImage;
          const input = editRoot.querySelector(`[data-image-id="${id}"]`);
          input.dataset.cleared = "true";
          delete input.dataset.value;
          input.previousElementSibling.innerHTML = "<span>Click to add photo</span>";
          const frame = document.querySelector(`#preview-frame [data-preview-image="${id}"]`);
          if (frame) frame.innerHTML = id === "global" || id === "logo" ? "LOGO" : "";
          btn.remove();
        });
      });

      document.querySelector("#edit-form").addEventListener("submit", e => {
        e.preventDefault();
        document.querySelector("#confirm-modal").classList.add("open");
      });

      document.querySelector("#confirm-yes").addEventListener("click", async () => {
        const data = {};
        editRoot.querySelectorAll("[data-field-id]").forEach(el => { data[el.dataset.fieldId] = el.value; });
        editRoot.querySelectorAll("[data-image-id]").forEach(el => {
          if (el.dataset.cleared === "true") data[el.dataset.imageId] = null;
          else if (el.dataset.value) data[el.dataset.imageId] = el.dataset.value;
        });
        editRoot.querySelectorAll("[data-size-id]").forEach(el => { data[el.dataset.sizeId + "_h"] = el.value; });
        editRoot.querySelectorAll("[data-pos-id]").forEach(el => { data[el.dataset.posId + "_pos"] = el.value; });
        const confirmYesBtn = document.querySelector("#confirm-yes");
        confirmYesBtn.disabled = true;
        confirmYesBtn.textContent = "Saving…";
        const result = await cmsSavePage(pageKey, data);
        document.querySelector("#confirm-modal").classList.remove("open");
        confirmYesBtn.disabled = false;
        confirmYesBtn.textContent = "Yes, Apply Changes";
        if (!result.ok) {
          alert("This didn't save — the browser's storage is full (usually from too many/too-large photos). Try a smaller photo, or remove an existing one first, then try again.");
          return;
        }
        window.location.href = "dashboard.html?updated=" + encodeURIComponent(schema.label);
      });
      document.querySelector("#confirm-no").addEventListener("click", () => {
        document.querySelector("#confirm-modal").classList.remove("open");
      });
    }
  }

  /* ---------- "Updated!" toast on the dashboard ---------- */
  const params = new URLSearchParams(window.location.search);
  const updated = params.get("updated");
  if (updated) {
    const toast = document.querySelector("#updated-toast");
    if (toast) {
      toast.textContent = "✓ " + updated + " updated — the live pages now reflect your change.";
      toast.classList.add("show");
    }
  }
});
