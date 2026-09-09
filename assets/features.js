/* ---------------------------------------------------------------------
   Extra admin tools, all localStorage-backed prototypes:
   - Sunday roles calendar   (sabc_schedule, sabc_roster)
   - Who's Who directory      (sabc_whoswho)
   - Admin user list          (sabc_admin_users)
   - Change log                (sabc_audit_log, via content.js)
--------------------------------------------------------------------- */

const DEFAULT_SCHEDULE_ROLES = ["Opening Prayer", "Worship / Singing", "Offering", "Sound", "Slides / Projection", "Greeting / Doors"];
function getScheduleRoles() { return loadJSON("sabc_schedule_roles", DEFAULT_SCHEDULE_ROLES); }

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, value) { return safeSetItem(key, JSON.stringify(value)); }
// Local calendar date (not UTC) — matches the fix in app.js. Using
// toISOString() here was quietly excluding "today's" events from the
// upcoming list in the evening, since UTC had already rolled to tomorrow.
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function uid() { return Math.random().toString(36).slice(2, 9); }

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("#cal-grid")) initCalendar();
  if (document.querySelector("#events-cal-grid")) initEventsAdmin();
  if (document.querySelector("#home-events")) renderUpcomingEvents("#home-events", 3);
  if (document.querySelector("#events-list-root")) renderUpcomingEvents("#events-list-root");
  if (document.querySelector("#whoswho-admin-root")) initWhoswhoAdmin();
  if (document.querySelector("#whoswho-public-root")) initWhoswhoPublic();
  if (document.querySelector("#admins-root")) initAdmins();
  if (document.querySelector("#log-root")) initLog();
  if (document.querySelector("#sermon-archive-admin-root")) initSermonArchiveAdmin();
  if (document.querySelector("#sermon-archive-root")) renderSermonArchivePublic();
});

/* ============================= CALENDAR ============================= */
function initCalendar() {
  requireLogin();
  const monthLabel = document.querySelector("#cal-month-label");
  const grid = document.querySelector("#cal-grid");
  const roster = document.querySelector("#roster-bar");
  const rolesBar = document.querySelector("#roles-bar");
  const panel = document.querySelector("#role-panel");
  let view = new Date(); view.setDate(1);
  let selected = null;

  function renderRolesBar() {
    if (!rolesBar) return;
    const roles = getScheduleRoles();
    rolesBar.innerHTML = roles.map(r =>
      `<span class="roster-chip">${r} <button data-remove-role="${r}" type="button">×</button></span>`
    ).join("") + `
      <input type="text" id="new-role-name" placeholder="Add a role (e.g. Nursery)" style="padding:6px 10px;border:1px solid #b9c5d3;border-radius:20px">
      <button class="button" id="add-role-name" type="button" style="padding:6px 14px">+ Add Role</button>`;
    rolesBar.querySelectorAll("[data-remove-role]").forEach(btn => btn.addEventListener("click", () => {
      const roles = getScheduleRoles().filter(r => r !== btn.dataset.removeRole);
      saveJSON("sabc_schedule_roles", roles);
      renderRolesBar();
      if (selected) renderPanel();
    }));
    rolesBar.querySelector("#add-role-name").addEventListener("click", () => {
      const input = rolesBar.querySelector("#new-role-name");
      const val = input.value.trim();
      if (!val) return;
      const roles = getScheduleRoles();
      if (!roles.includes(val)) { roles.push(val); saveJSON("sabc_schedule_roles", roles); }
      renderRolesBar();
      if (selected) renderPanel();
    });
    cmsApplyViewOnlyLock(rolesBar);
  }

  function renderRoster() {
    const names = loadJSON("sabc_roster", []);
    roster.innerHTML = names.map(n =>
      `<span class="roster-chip">${n} <button data-remove-name="${n}" type="button">×</button></span>`
    ).join("") + `
      <input type="text" id="new-roster-name" placeholder="Add a volunteer's name" style="padding:6px 10px;border:1px solid #b9c5d3;border-radius:20px">
      <button class="button" id="add-roster-name" type="button" style="padding:6px 14px">+ Add</button>`;
    roster.querySelectorAll("[data-remove-name]").forEach(btn => btn.addEventListener("click", () => {
      const names = loadJSON("sabc_roster", []).filter(n => n !== btn.dataset.removeName);
      saveJSON("sabc_roster", names);
      renderRoster(); renderNameOptions();
    }));
    document.querySelector("#add-roster-name").addEventListener("click", () => {
      const input = roster.querySelector("#new-roster-name");
      const val = input.value.trim();
      if (!val) return;
      const names = loadJSON("sabc_roster", []);
      if (!names.includes(val)) { names.push(val); saveJSON("sabc_roster", names); }
      renderRoster(); renderNameOptions();
    });
    cmsApplyViewOnlyLock(roster);
  }

  function renderNameOptions() {
    const dl = document.querySelector("#roster-datalist");
    if (!dl) return;
    dl.innerHTML = loadJSON("sabc_roster", []).map(n => `<option value="${n}">`).join("");
  }

  function renderGrid() {
    const schedule = loadJSON("sabc_schedule", {});
    monthLabel.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const firstDow = view.getDay();
    const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
    for (let day = 1; day <= daysIn; day++) {
      const d = new Date(view.getFullYear(), view.getMonth(), day);
      const iso = isoDate(d);
      const isSunday = d.getDay() === 0;
      const hasData = !!schedule[iso];
      html += `<div class="cal-day clickable${isSunday ? " sunday" : ""}${hasData ? " has-data" : ""}${selected === iso ? " selected" : ""}"
                    data-date="${iso}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll("[data-date]").forEach(el => el.addEventListener("click", () => {
      selected = el.dataset.date;
      renderGrid();
      renderPanel();
    }));
  }

  function renderPanel() {
    if (!selected) { panel.innerHTML = "<p class='field-hint'>Click a day above to fill in who's doing what.</p>"; return; }
    const schedule = loadJSON("sabc_schedule", {});
    const entry = schedule[selected] || {};
    const activeRoles = Object.keys(entry); // only roles explicitly added to THIS day
    const catalog = getScheduleRoles();
    const availableToAdd = catalog.filter(r => !activeRoles.includes(r));
    const niceDate = new Date(selected + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

    let html = `<h3>${niceDate}</h3>`;
    if (!activeRoles.length) {
      html += `<p class="field-hint">No roles added to this day yet. Pick one below to get started.</p>`;
    }
    activeRoles.forEach(role => {
      const cur = entry[role] || { name: "", status: "" };
      html += `
        <div class="role-row">
          <div>
            <label>${role}</label>
            <input type="text" list="roster-datalist" data-role="${role}" data-kind="name" value="${cur.name}" placeholder="Who's doing this?">
          </div>
          <select data-role="${role}" data-kind="status">
            <option value="" ${cur.status === "" ? "selected" : ""}>Unconfirmed</option>
            <option value="yes" ${cur.status === "yes" ? "selected" : ""}>Yes, confirmed</option>
            <option value="no" ${cur.status === "no" ? "selected" : ""}>No / can't make it</option>
          </select>
          <button type="button" data-remove-day-role="${role}" title="Remove this role from this day" style="background:none;border:0;color:#a62929;font-weight:800;cursor:pointer">✕</button>
        </div>`;
    });
    html += `<datalist id="roster-datalist"></datalist>`;
    if (availableToAdd.length) {
      html += `
        <div class="role-row" style="grid-template-columns:1fr auto">
          <select id="add-role-to-day"><option value="">+ Add a role to this day…</option>${availableToAdd.map(r => `<option value="${r}">${r}</option>`).join("")}</select>
          <button type="button" id="add-role-to-day-btn" class="button button-light">Add</button>
        </div>`;
    } else {
      html += `<p class="field-hint">Every role in your catalog is already added to this day. Add more role types above if you need another.</p>`;
    }
    html += `<div class="edit-actions"><span></span><button class="button" id="save-schedule" type="button">Apply Changes</button></div>`;
    panel.innerHTML = html;
    renderNameOptions();
    cmsApplyViewOnlyLock(panel);

    panel.querySelectorAll("[data-remove-day-role]").forEach(btn => btn.addEventListener("click", () => {
      const schedule = loadJSON("sabc_schedule", {});
      if (schedule[selected]) { delete schedule[selected][btn.dataset.removeDayRole]; saveJSON("sabc_schedule", schedule); }
      renderPanel();
      renderGrid();
    }));
    const addBtn = panel.querySelector("#add-role-to-day-btn");
    if (addBtn) addBtn.addEventListener("click", () => {
      const roleToAdd = panel.querySelector("#add-role-to-day").value;
      if (!roleToAdd) return;
      const schedule = loadJSON("sabc_schedule", {});
      if (!schedule[selected]) schedule[selected] = {};
      schedule[selected][roleToAdd] = { name: "", status: "" };
      saveJSON("sabc_schedule", schedule);
      renderPanel();
    });

    const saveBtn = document.querySelector("#save-schedule");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const newEntry = {};
      activeRoles.forEach(role => {
        const name = panel.querySelector(`[data-role="${role}"][data-kind="name"]`).value;
        const status = panel.querySelector(`[data-role="${role}"][data-kind="status"]`).value;
        newEntry[role] = { name, status };
      });
      const schedule = loadJSON("sabc_schedule", {});
      const before = schedule[selected] || {};
      schedule[selected] = newEntry;
      saveJSON("sabc_schedule", schedule);
      cmsLogRawChange("Church Calendar — " + niceDate, "sabc_schedule", selected, before, newEntry);
      renderGrid();
      const toast = document.querySelector("#cal-toast");
      if (toast) { toast.textContent = "✓ Saved for " + niceDate; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2500); }
    });
  }

  document.querySelector("#cal-prev").addEventListener("click", () => { view.setMonth(view.getMonth() - 1); renderGrid(); });
  document.querySelector("#cal-next").addEventListener("click", () => { view.setMonth(view.getMonth() + 1); renderGrid(); });

  renderRolesBar();
  renderRoster();
  renderGrid();
  renderPanel();
}

/* ============================= EVENTS (admin) ============================= */
function initEventsAdmin() {
  requireLogin();
  const monthLabel = document.querySelector("#events-cal-month-label");
  const grid = document.querySelector("#events-cal-grid");
  const panel = document.querySelector("#events-panel");
  let view = new Date(); view.setDate(1);
  let selected = null;

  function renderGrid() {
    const events = loadJSON("sabc_events", {});
    monthLabel.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const firstDow = view.getDay();
    const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
    for (let day = 1; day <= daysIn; day++) {
      const d = new Date(view.getFullYear(), view.getMonth(), day);
      const iso = isoDate(d);
      const count = (events[iso] || []).length;
      html += `<div class="cal-day clickable${count ? " has-data" : ""}${selected === iso ? " selected" : ""}" data-date="${iso}">
        ${day}${count ? `<div style="font-size:10px;color:var(--blue);font-weight:800">${count} event${count > 1 ? "s" : ""}</div>` : ""}
      </div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll("[data-date]").forEach(el => el.addEventListener("click", () => {
      selected = el.dataset.date; renderGrid(); renderPanel();
    }));
  }

  function renderPanel() {
    if (!selected) { panel.innerHTML = "<p class='field-hint'>Click a day above to add or edit events for that date.</p>"; return; }
    const events = loadJSON("sabc_events", {});
    const dayEvents = events[selected] || [];
    const niceDate = new Date(selected + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    let html = `<h3>${niceDate}</h3><div id="events-list">`;
    dayEvents.forEach(ev => {
      html += `
        <div class="role-row" data-event-id="${ev.id}" style="grid-template-columns:1fr auto">
          <div>
            <label>Event Title</label>
            <input type="text" data-ev="title" value="${ev.title || ""}" placeholder="e.g. Youth Group Night">
            <label style="margin-top:8px">Time</label>
            <input type="text" data-ev="time" value="${ev.time || ""}" placeholder="e.g. 6:30 PM">
            <label style="margin-top:8px">Description</label>
            <input type="text" data-ev="description" value="${ev.description || ""}" placeholder="Short description">
          </div>
          <button type="button" class="text-btn" data-remove-event="${ev.id}" style="color:#a62929;align-self:start">Remove</button>
        </div>`;
    });
    html += `</div>
      <button class="button button-light" id="add-event" type="button">+ Add Another Event This Day</button>
      <div class="edit-actions"><span></span><button class="button" id="save-events" type="button">Apply Changes</button></div>`;
    panel.innerHTML = html;
    cmsApplyViewOnlyLock(panel);

    panel.querySelector("#add-event").addEventListener("click", () => {
      const events = loadJSON("sabc_events", {});
      if (!events[selected]) events[selected] = [];
      events[selected].push({ id: uid(), title: "", time: "", description: "" });
      saveJSON("sabc_events", events);
      renderGrid(); renderPanel();
    });
    panel.querySelectorAll("[data-remove-event]").forEach(btn => btn.addEventListener("click", () => {
      const events = loadJSON("sabc_events", {});
      events[selected] = (events[selected] || []).filter(e => e.id !== btn.dataset.removeEvent);
      if (!events[selected].length) delete events[selected];
      saveJSON("sabc_events", events);
      renderGrid(); renderPanel();
    }));
    const saveBtn = panel.querySelector("#save-events");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const events = loadJSON("sabc_events", {});
      const before = events[selected] || [];
      const rows = panel.querySelectorAll("[data-event-id]");
      const updated = [...rows].map(row => ({
        id: row.dataset.eventId,
        title: row.querySelector('[data-ev="title"]').value,
        time: row.querySelector('[data-ev="time"]').value,
        description: row.querySelector('[data-ev="description"]').value
      }));
      if (updated.length) events[selected] = updated; else delete events[selected];
      saveJSON("sabc_events", events);
      cmsLogRawChange("Events — " + niceDate, "sabc_events", selected, before, updated);
      renderGrid();
      const toast = document.querySelector("#events-toast");
      if (toast) { toast.textContent = "✓ Saved for " + niceDate; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2500); }
    });
  }

  document.querySelector("#events-cal-prev").addEventListener("click", () => { view.setMonth(view.getMonth() - 1); renderGrid(); });
  document.querySelector("#events-cal-next").addEventListener("click", () => { view.setMonth(view.getMonth() + 1); renderGrid(); });

  renderGrid();
  renderPanel();
}

/* ====================== EVENTS (public rendering) ====================== */
function renderUpcomingEvents(targetSelector, max) {
  const el = document.querySelector(targetSelector);
  if (!el) return;
  const events = loadJSON("sabc_events", {});
  const today = isoDate(new Date());
  const flat = [];
  Object.keys(events).sort().forEach(dateKey => {
    if (dateKey >= today) events[dateKey].forEach(ev => flat.push({ ...ev, date: dateKey }));
  });
  if (!flat.length) {
    el.innerHTML = `<p class="placeholder-lines center">No upcoming events posted yet. Add some from the admin Events calendar.</p>`;
    return;
  }
  const shown = max ? flat.slice(0, max) : flat;
  let lastMonth = "";
  let html = "";
  shown.forEach(ev => {
    const d = new Date(ev.date + "T00:00:00");
    const month = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (el.dataset.grouped === "true" && month !== lastMonth) {
      html += `<div class="month-heading"><h2>${month}</h2></div>`;
      lastMonth = month;
    }
    const badge = `${d.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}<br><b>${d.getDate()}</b>`;
    if (el.dataset.grouped === "true") {
      html += `<article class="event-row"><span class="date-badge">${badge}</span><div><h3>${ev.title || "Untitled Event"}</h3><p>${ev.time ? `<strong>${ev.time}</strong> · ` : ""}${ev.description || ""}</p></div></article>`;
    } else {
      html += `<article class="card"><span class="date-badge">${badge}</span><div><h3>${ev.title || "Untitled Event"}</h3><p>${ev.time ? ev.time + " · " : ""}${ev.description || ""}</p></div></article>`;
    }
  });
  el.innerHTML = html;
}
function initWhoswhoAdmin() {
  requireLogin();
  const root = document.querySelector("#whoswho-admin-root");

  function personCardHtml(p) {
    return `<div class="person-card">
      <div class="person-photo">${p.photo ? `<img src="${p.photo}" style="object-position:50% ${p.photo_pos ?? 50}%">` : "PHOTO"}</div>
      <h3>${p.name || "(no name yet)"}</h3>
      <p class="person-role">${p.role || ""}</p>
      <p class="person-contact">${p.phone ? "☎ " + p.phone : ""}${p.phone && p.email ? "<br>" : ""}${p.email ? "✉ " + p.email : ""}</p>
    </div>`;
  }

  function refreshPreview() {
    const previewEl = document.querySelector("#whoswho-preview");
    if (!previewEl) return;
    const rows = root.querySelectorAll(".person-edit-card");
    const people = [...rows].map(row => ({
      name: row.querySelector('[data-field="name"]').value,
      role: row.querySelector('[data-field="role"]').value,
      phone: row.querySelector('[data-field="phone"]').value,
      email: row.querySelector('[data-field="email"]').value,
      photo: row.querySelector("[data-photo-for]").dataset.value || row.querySelector("[data-photo-for]").previousElementSibling.querySelector("img")?.src || null,
      photo_pos: row.querySelector("[data-pos-for]").value
    })).filter(p => p.name || p.photo);
    previewEl.innerHTML = people.length
      ? `<div class="person-grid">${people.map(personCardHtml).join("")}</div>`
      : `<p class="field-hint">Add a name or photo on the left to see it appear here.</p>`;
  }

  function render() {
    const people = loadJSON("sabc_whoswho", []);
    let html = `<div class="manage-list" id="people-list">`;
    people.forEach(p => {
      html += `
        <div class="person-edit-card" data-id="${p.id}">
          <div class="person-edit-top">
            <div class="photo-col">
              <label class="image-upload-slot" style="height:90px" for="photo_${p.id}">${p.photo ? `<img src="${p.photo}" style="object-position:50% ${p.photo_pos ?? 50}%">` : "Photo"}</label>
              <input type="file" accept="image/*" id="photo_${p.id}" data-photo-for="${p.id}" style="display:none">
              <input type="range" min="0" max="100" data-pos-for="${p.id}" value="${p.photo_pos ?? 50}" title="Focus point (top/bottom)" style="width:100%;margin-top:4px">
              ${p.photo ? `<button type="button" class="text-btn" data-clear-photo="${p.id}" data-allow-view-only style="font-size:12px;margin-top:2px">Remove photo</button>` : ""}
            </div>
            <div class="fields-col">
              <input type="text" data-field="name" placeholder="Name" value="${p.name || ""}">
              <input type="text" data-field="role" placeholder="Role (e.g. Deacon, Worship Leader)" value="${p.role || ""}">
              <input type="text" data-field="phone" placeholder="Phone" value="${p.phone || ""}">
              <input type="text" data-field="email" placeholder="Email" value="${p.email || ""}">
            </div>
          </div>
          <button type="button" class="button button-light" data-remove="${p.id}" style="margin-top:10px">Remove This Person</button>
        </div>`;
    });
    html += `</div>
      <button class="button button-light" id="add-person" type="button">+ Add Person</button>
      <div class="edit-actions"><span></span><button class="button" id="save-people" type="button" data-allow-view-only>Apply Changes</button></div>
      <p id="whoswho-toast" class="toast"></p>`;

    root.innerHTML = `
      <div class="edit-split">
        <div class="edit-col">${html}</div>
        <div class="preview-col"><h3>Live Preview</h3><div class="preview-frame" id="whoswho-preview"></div></div>
      </div>`;
    cmsApplyViewOnlyLock(root);
    refreshPreview();

    root.querySelectorAll('[data-field], [data-pos-for]').forEach(el => el.addEventListener("input", refreshPreview));

    root.querySelectorAll("[data-clear-photo]").forEach(btn => btn.addEventListener("click", () => {
      const people = loadJSON("sabc_whoswho", []);
      const person = people.find(p => p.id === btn.dataset.clearPhoto);
      if (person) { person.photo = null; saveJSON("sabc_whoswho", people); }
      render();
    }));

    root.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
      const people = loadJSON("sabc_whoswho", []).filter(p => p.id !== btn.dataset.remove);
      saveJSON("sabc_whoswho", people);
      render();
    }));
    root.querySelectorAll("[data-photo-for]").forEach(input => input.addEventListener("change", () => {
      const file = input.files[0]; if (!file) return;
      compressImage(file, 500, 0.75).then(dataUrl => {
        const posRange = root.querySelector(`[data-pos-for="${input.dataset.photoFor}"]`);
        input.previousElementSibling.innerHTML = `<img src="${dataUrl}" style="object-position:50% ${posRange ? posRange.value : 50}%">`;
        input.dataset.value = dataUrl;
        refreshPreview();
      }).catch(err => alert("Couldn't process that photo: " + err.message));
    }));
    root.querySelectorAll("[data-pos-for]").forEach(range => range.addEventListener("input", () => {
      const img = root.querySelector(`#photo_${range.dataset.posFor}`).previousElementSibling.querySelector("img");
      if (img) img.style.objectPosition = `50% ${range.value}%`;
    }));
    document.querySelector("#add-person").addEventListener("click", () => {
      const people = loadJSON("sabc_whoswho", []);
      people.push({ id: uid(), name: "", role: "", phone: "", email: "", photo: null });
      saveJSON("sabc_whoswho", people);
      render();
    });
    document.querySelector("#save-people").addEventListener("click", () => {
      const before = loadJSON("sabc_whoswho", []);
      const rows = root.querySelectorAll(".person-edit-card");
      const people = [...rows].map(row => ({
        id: row.dataset.id,
        name: row.querySelector('[data-field="name"]').value,
        role: row.querySelector('[data-field="role"]').value,
        phone: row.querySelector('[data-field="phone"]').value,
        email: row.querySelector('[data-field="email"]').value,
        photo: row.querySelector("[data-photo-for]").dataset.value || (before.find(p => p.id === row.dataset.id) || {}).photo || null,
        photo_pos: row.querySelector("[data-pos-for]").value
      }));
      saveJSON("sabc_whoswho", people);
      cmsLogRawChange("Who's Who", "sabc_whoswho", null, before, people);
      const toast = document.querySelector("#whoswho-toast");
      toast.textContent = "✓ Who's Who updated — the live page now reflects this.";
      toast.classList.add("show");
    });
  }
  render();
}

/* ============================= WHO'S WHO (public page) ============================= */
function initWhoswhoPublic() {
  const root = document.querySelector("#whoswho-public-root");
  const people = loadJSON("sabc_whoswho", []).filter(p => p.name);
  if (!people.length) {
    root.innerHTML = `<p class="placeholder-lines center">No one's been added yet. Once the admin team adds people on the Who's Who admin page, they'll show up here with their photo, role, and contact info.</p>`;
    return;
  }
  root.innerHTML = `<div class="person-grid">` + people.map(p => `
    <div class="person-card">
      <div class="person-photo">${p.photo ? `<img src="${p.photo}" style="object-position:50% ${p.photo_pos ?? 50}%">` : "PHOTO"}</div>
      <h3>${p.name}</h3>
      <p class="person-role">${p.role || ""}</p>
      <p class="person-contact">${p.phone ? "☎ " + p.phone : ""}${p.phone && p.email ? "<br>" : ""}${p.email ? "✉ " + p.email : ""}</p>
    </div>`).join("") + `</div>`;
}

/* ============================= ADMIN USERS ============================= */
function initAdmins() {
  requireLogin();
  const root = document.querySelector("#admins-root");

  function render() {
    const users = loadJSON("sabc_admin_users", [
      { id: uid(), name: "Pastor Ladd Dunfield", email: "ladd@thebeggardanced.com", access: "Full Admin" }
    ]);
    saveJSON("sabc_admin_users", users);
    let html = `<div class="manage-list">`;
    users.forEach(u => {
      html += `
        <div class="manage-row" data-id="${u.id}" style="grid-template-columns:1fr 1fr 1fr auto">
          <input type="text" data-field="name" placeholder="Name" value="${u.name}">
          <input type="text" data-field="email" placeholder="Email" value="${u.email}">
          <select data-field="access">
            <option ${u.access === "Full Admin" ? "selected" : ""}>Full Admin</option>
            <option ${u.access === "Can Edit" ? "selected" : ""}>Can Edit</option>
            <option ${u.access === "View Only" ? "selected" : ""}>View Only</option>
          </select>
          <button type="button" data-remove="${u.id}">Remove</button>
        </div>`;
    });
    html += `</div>
      <button class="button button-light" id="add-admin" type="button">+ Add Admin</button>
      <div class="edit-actions"><span></span><button class="button" id="save-admins" type="button">Apply Changes</button></div>
      <p class="field-hint" style="margin-top:16px">Prototype note: this list doesn't control real login access yet — everyone still shares the one demo password/code until the real backend is built. This is here so the roster and permissions are already planned out.</p>
      <p id="admins-toast" class="toast"></p>`;
    root.innerHTML = html;
    cmsApplyViewOnlyLock(root);

    root.querySelectorAll("[data-remove]").forEach(btn => btn.addEventListener("click", () => {
      const users = loadJSON("sabc_admin_users", []).filter(u => u.id !== btn.dataset.remove);
      saveJSON("sabc_admin_users", users);
      render();
    }));
    document.querySelector("#add-admin").addEventListener("click", () => {
      const users = loadJSON("sabc_admin_users", []);
      users.push({ id: uid(), name: "", email: "", access: "Can Edit" });
      saveJSON("sabc_admin_users", users);
      render();
    });
    document.querySelector("#save-admins").addEventListener("click", () => {
      const before = loadJSON("sabc_admin_users", []);
      const rows = root.querySelectorAll(".manage-row");
      const users = [...rows].map(row => ({
        id: row.dataset.id,
        name: row.querySelector('[data-field="name"]').value,
        email: row.querySelector('[data-field="email"]').value,
        access: row.querySelector('[data-field="access"]').value
      }));
      saveJSON("sabc_admin_users", users);
      cmsLogRawChange("Admin Users", "sabc_admin_users", null, before, users);
      const toast = document.querySelector("#admins-toast");
      toast.textContent = "✓ Admin list updated.";
      toast.classList.add("show");
    });
  }
  render();
}

/* ============================= CHANGE LOG ============================= */
/* Turns a raw (non-CMS-schema) snapshot into something readable for the
   before/after preview — Who's Who, Admin Users, Calendar, and Events all
   store their data differently, so each gets its own small renderer. */
function renderRawSnapshot(revertKey, snapshot) {
  if (!snapshot) return "<p class='field-hint'>(empty)</p>";
  if (revertKey === "sabc_whoswho" && Array.isArray(snapshot)) {
    if (!snapshot.length) return "<p class='field-hint'>No one in the directory.</p>";
    return "<ul>" + snapshot.map(p => `<li><b>${p.name || "(no name)"}</b> — ${p.role || ""}${p.phone ? " · " + p.phone : ""}${p.email ? " · " + p.email : ""}</li>`).join("") + "</ul>";
  }
  if (revertKey === "sabc_admin_users" && Array.isArray(snapshot)) {
    if (!snapshot.length) return "<p class='field-hint'>No admins listed.</p>";
    return "<ul>" + snapshot.map(u => `<li><b>${u.name || u.email}</b> — ${u.access}</li>`).join("") + "</ul>";
  }
  if (revertKey === "sabc_schedule" && typeof snapshot === "object") {
    const roles = Object.keys(snapshot);
    if (!roles.length) return "<p class='field-hint'>No roles set for this day.</p>";
    return "<ul>" + roles.map(r => `<li><b>${r}</b>: ${snapshot[r].name || "(nobody yet)"} — ${snapshot[r].status === "yes" ? "✓ confirmed" : snapshot[r].status === "no" ? "✗ can't make it" : "(unconfirmed)"}</li>`).join("") + "</ul>";
  }
  if (revertKey === "sabc_events" && Array.isArray(snapshot)) {
    if (!snapshot.length) return "<p class='field-hint'>No events that day.</p>";
    return "<ul>" + snapshot.map(e => `<li><b>${e.title || "Untitled"}</b>${e.time ? " — " + e.time : ""}</li>`).join("") + "</ul>";
  }
  return `<pre style="white-space:pre-wrap;font-size:12px">${JSON.stringify(snapshot, null, 2)}</pre>`;
}

/* Rebuilds a full-page snapshot for the CMS-schema pages (Home, About,
   etc.) so previewTemplate() — the same function that powers the live
   editor preview — can render "what it looked like" for a log entry too.
   Fields this entry didn't touch fall back to the current live value. */
function buildPreviewSnapshot(pageKey, changes, useAfter) {
  const snap = cmsGetPage(pageKey);
  changes.forEach(c => {
    if (c.isRaw || !c.revertable) return;
    snap[c.field] = useAfter ? c.rawNew : c.rawOld;
  });
  return snap;
}

function initLog() {
  requireLogin();
  const root = document.querySelector("#log-root");
  const log = loadJSON("sabc_audit_log", []);

  if (!log.length) {
    root.innerHTML = "<p class='field-hint'>No changes logged yet. Every time someone applies changes in the admin area, it'll show up here.</p>";
  } else {
    root.innerHTML = log.map((entry, idx) => {
      const isRaw = entry.changes[0] && entry.changes[0].isRaw;
      const canRevert = entry.changes.some(c => c.revertable);
      return `
      <div class="log-entry">
        <time>${new Date(entry.ts).toLocaleString()}</time>
        <span class="log-page">${entry.page}</span>
        ${entry.changes.map(c => isRaw ? "" : `<p class="log-change"><b>${c.field}</b>: "${c.old}" → "${c.new}"</p>`).join("")}
        <div class="log-actions">
          <button type="button" class="text-btn" data-toggle-preview="${idx}" data-allow-view-only>👁 Preview before/after</button>
          ${canRevert ? `<button type="button" class="text-btn" data-revert="${idx}" style="color:#a62929">↩ Revert to before</button>` : ""}
        </div>
        <div class="log-preview" id="preview-${idx}" style="display:none"></div>
      </div>`;
    }).join("");

    root.querySelectorAll("[data-toggle-preview]").forEach(btn => btn.addEventListener("click", () => {
      const idx = btn.dataset.togglePreview;
      const entry = log[idx];
      const box = document.querySelector(`#preview-${idx}`);
      if (box.style.display === "none") {
        const isRaw = entry.changes[0] && entry.changes[0].isRaw;
        let beforeHtml, afterHtml;
        if (isRaw) {
          const c = entry.changes[0];
          beforeHtml = renderRawSnapshot(c.revertKey, c.rawOld);
          afterHtml = renderRawSnapshot(c.revertKey, c.rawNew);
        } else if (typeof previewTemplate === "function" && CMS_SCHEMA[entry.page]) {
          beforeHtml = previewTemplate(entry.page, buildPreviewSnapshot(entry.page, entry.changes, false));
          afterHtml = previewTemplate(entry.page, buildPreviewSnapshot(entry.page, entry.changes, true));
        } else {
          beforeHtml = afterHtml = "<p class='field-hint'>Preview not available for this entry.</p>";
        }
        box.innerHTML = `<div class="preview-before-after">
          <div><h4>Before</h4><div class="preview-frame">${beforeHtml}</div></div>
          <div><h4>After</h4><div class="preview-frame">${afterHtml}</div></div>
        </div>`;
        box.style.display = "block";
        btn.textContent = "🙈 Hide preview";
      } else {
        box.style.display = "none";
        btn.textContent = "👁 Preview before/after";
      }
    }));

    root.querySelectorAll("[data-revert]").forEach(btn => btn.addEventListener("click", () => {
      const idx = btn.dataset.revert;
      const entry = log[idx];
      if (!confirm("Revert this change? This restores the previous version (text/lists only — photos aren't auto-reverted, re-upload if one was part of this change).")) return;
      const isRaw = entry.changes[0] && entry.changes[0].isRaw;
      const result = isRaw ? cmsRevertRawEntry(entry) : cmsRevertLogEntry(entry);
      if (result.ok) {
        cmsLogChange(entry.page + " (reverted)", [{ field: "Revert", old: "(the change above)", new: "(restored to before)" }]);
        alert("Reverted. The live page will show this the next time it loads.");
        initLog();
      } else {
        alert("Couldn't revert this one — nothing revertable was recorded for it (usually means it was a photo-only change).");
      }
    }));
    if (!cmsCanEdit()) root.querySelectorAll("[data-revert]").forEach(b => b.disabled = true);
  }

  document.querySelector("#download-log").addEventListener("click", () => {
    const text = log.map(e => `${e.ts} — ${e.page}\n` + e.changes.map(c => `  ${c.field}: "${c.old}" → "${c.new}"`).join("\n")).join("\n\n");
    const blob = new Blob([text || "No changes logged yet."], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sabc-change-log.txt";
    a.click();
  });
}

/* ============================= SERMON ARCHIVE ============================= */
function extractYoutubeId(raw) {
  if (!raw) return "";
  const match = String(raw).match(/(?:v=|youtu\.be\/|embed\/)?([a-zA-Z0-9_-]{11})(?:[?&]|$)/);
  return match ? match[1] : raw;
}

function initSermonArchiveAdmin() {
  requireLogin();
  const root = document.querySelector("#sermon-archive-admin-root");

  function render() {
    const sermons = loadJSON("sabc_sermon_archive", []);
    const byYear = {};
    sermons.forEach(s => { (byYear[s.year] = byYear[s.year] || []).push(s); });
    const years = Object.keys(byYear).sort((a, b) => b - a);

    let html = `
      <div class="role-panel" style="margin-top:0">
        <h3>Add a Sermon</h3>
        <div class="role-row" style="grid-template-columns:100px 1fr 1fr">
          <input type="number" id="new-sermon-year" placeholder="Year" value="${new Date().getFullYear()}">
          <input type="text" id="new-sermon-title" placeholder="Sermon title">
          <input type="text" id="new-sermon-speaker" placeholder="Speaker">
        </div>
        <div class="role-row" style="grid-template-columns:1fr 1fr;margin-top:10px">
          <input type="text" id="new-sermon-passage" placeholder="Bible passage">
          <input type="text" id="new-sermon-youtube" placeholder="YouTube link or video ID (optional)">
        </div>
        <div class="edit-actions"><span></span><button class="button" id="add-sermon-btn" type="button">+ Add Sermon</button></div>
      </div>
      <div id="sermon-list" style="margin-top:20px">`;

    if (!years.length) {
      html += `<p class="field-hint">No sermons added yet.</p>`;
    }
    years.forEach(year => {
      html += `<h3>${year}</h3>`;
      byYear[year].forEach(s => {
        html += `
          <div class="manage-row" data-id="${s.id}" style="grid-template-columns:1fr 1fr 1fr 1fr auto">
            <input type="text" data-sf="title" value="${s.title || ""}" placeholder="Title">
            <input type="text" data-sf="speaker" value="${s.speaker || ""}" placeholder="Speaker">
            <input type="text" data-sf="passage" value="${s.passage || ""}" placeholder="Passage">
            <input type="text" data-sf="youtube_id" value="${s.youtube_id || ""}" placeholder="YouTube link/ID">
            <button type="button" data-remove-sermon="${s.id}">Remove</button>
          </div>`;
      });
    });
    html += `</div>
      <div class="edit-actions"><span></span><button class="button" id="save-sermons" type="button">Apply Changes</button></div>
      <p id="sermon-toast" class="toast"></p>`;

    root.innerHTML = html;
    cmsApplyViewOnlyLock(root);

    document.querySelector("#add-sermon-btn").addEventListener("click", () => {
      const year = document.querySelector("#new-sermon-year").value.trim();
      const title = document.querySelector("#new-sermon-title").value.trim();
      if (!year || !title) { alert("At least a year and title are needed."); return; }
      const sermons = loadJSON("sabc_sermon_archive", []);
      sermons.push({
        id: uid(), year,
        title,
        speaker: document.querySelector("#new-sermon-speaker").value.trim(),
        passage: document.querySelector("#new-sermon-passage").value.trim(),
        youtube_id: extractYoutubeId(document.querySelector("#new-sermon-youtube").value.trim())
      });
      saveJSON("sabc_sermon_archive", sermons);
      cmsLogRawChange("Sermon Archive", "sabc_sermon_archive", null, loadJSON("sabc_sermon_archive", []).slice(0, -1), sermons);
      render();
    });

    root.querySelectorAll("[data-remove-sermon]").forEach(btn => btn.addEventListener("click", () => {
      const sermons = loadJSON("sabc_sermon_archive", []).filter(s => s.id !== btn.dataset.removeSermon);
      saveJSON("sabc_sermon_archive", sermons);
      render();
    }));

    document.querySelector("#save-sermons").addEventListener("click", () => {
      const before = loadJSON("sabc_sermon_archive", []);
      const rows = root.querySelectorAll("#sermon-list .manage-row");
      const updated = [...rows].map(row => ({
        id: row.dataset.id,
        year: (before.find(s => s.id === row.dataset.id) || {}).year,
        title: row.querySelector('[data-sf="title"]').value,
        speaker: row.querySelector('[data-sf="speaker"]').value,
        passage: row.querySelector('[data-sf="passage"]').value,
        youtube_id: extractYoutubeId(row.querySelector('[data-sf="youtube_id"]').value)
      }));
      saveJSON("sabc_sermon_archive", updated);
      cmsLogRawChange("Sermon Archive", "sabc_sermon_archive", null, before, updated);
      const toast = document.querySelector("#sermon-toast");
      toast.textContent = "✓ Sermon archive updated.";
      toast.classList.add("show");
    });
  }
  render();
}

function renderSermonArchivePublic() {
  const root = document.querySelector("#sermon-archive-root");
  const sermons = loadJSON("sabc_sermon_archive", []);
  const byYear = {};
  sermons.forEach(s => { (byYear[s.year] = byYear[s.year] || []).push(s); });
  const years = Object.keys(byYear).sort((a, b) => b - a);
  const thisYear = String(new Date().getFullYear());
  if (!years.includes(thisYear)) years.unshift(thisYear);

  root.innerHTML = `<div class="archive-list">` +
    years.map(y => `<button type="button" data-archive-year="${y}">${y} <span>›</span></button><div class="archive-year-panel" id="archive-panel-${y}" style="display:none"></div>`).join("") +
    `</div>`;

  root.querySelectorAll("[data-archive-year]").forEach(btn => btn.addEventListener("click", () => {
    const y = btn.dataset.archiveYear;
    const panel = document.querySelector(`#archive-panel-${y}`);
    const open = panel.style.display !== "none";
    root.querySelectorAll(".archive-year-panel").forEach(p => p.style.display = "none");
    if (open) return;
    const list = byYear[y] || [];
    panel.innerHTML = list.length
      ? list.map(s => `
          <div class="event-row">
            <div>
              <h3>${s.title}</h3>
              <p>${[s.speaker, s.passage].filter(Boolean).join(" · ")}</p>
              ${s.youtube_id ? `<a class="text-link" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${s.youtube_id}">Watch on YouTube →</a>` : ""}
            </div>
          </div>`).join("")
      : `<p class="field-hint">No sermons added for ${y} yet.</p>`;
    panel.style.display = "block";
  }));
}
