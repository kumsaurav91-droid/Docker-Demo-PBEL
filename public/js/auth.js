/* UpTrack — auth.js: loads the logged-in user, fills profile/settings, handles logout,
   profile save, change password and delete account. */
document.addEventListener("DOMContentLoaded", function () {
  var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function api(method, path, body) {
    return fetch("/api" + path, { method: method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) { location.href = "/login.html"; throw new Error("Session expired"); } if (!r.ok) throw new Error(j.error || "Request failed"); return j; }); });
  }
  function toast(m, t) { if (window.showToast) showToast(m, t); }
  function date(ts, long) { return new Date(ts).toLocaleDateString("en-US", { month: long ? "long" : "short", day: "numeric", year: "numeric" }); }
  function initials(n) { return n.split(/\s+/).map(function (w) { return w[0] || ""; }).join("").slice(0, 2).toUpperCase() || "U"; }

  function pauseInput() { return $$("#panel-general .check-label").filter(function (l) { return /Pause all/.test(l.textContent); })[0].querySelector("input"); }
  window.syncPauseAll = function () { pauseInput().checked = monitors.length > 0 && monitors.every(function (m) { return m.paused; }); };

  function fill(u) {
    var v = { name: u.name, email: u.email, initials: initials(u.name), since: date(u.createdTs), sinceLong: date(u.createdTs, true), accountId: u.accountId, tz: (u.tz.match(/\(GMT([^)]*)\)/) || [0, ""])[1] };
    $$("[data-u]").forEach(function (e) { var k = e.dataset.u; if (e.tagName === "INPUT") e.value = v[k]; else e.textContent = v[k]; });
    if ($("#s-name")) $("#s-name").value = u.name;
    if ($("#s-email")) $("#s-email").value = u.email;
    var tz = $("#s-timezone"); if (tz) $$("#s-timezone option").forEach(function (o) { if (o.textContent === u.tz) tz.value = o.value || o.textContent; });
    var g = $("#greeting"); if (g && window.getGreeting) g.textContent = getGreeting() + ", " + u.name.split(" ")[0] + " 👋";
  }
  api("GET", "/auth/me").then(fill).catch(function () {});

  function wipeLocal() { try { localStorage.removeItem("uptrack:cleared"); } catch (e) {} } // per-user browser state
  $("#logout-btn").addEventListener("click", function () { api("POST", "/auth/logout").then(function () { wipeLocal(); location.href = "/login.html"; }); });

  // Save general settings -> profile on server
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#panel-general .form-actions .btn-primary")) return;
    api("PUT", "/auth/profile", { name: $("#s-name").value, tz: $("#s-timezone").value }).then(function (u) { fill(u); toast("Settings saved", "success"); }).catch(function (x) { toast(x.message, "error"); });
    // "Pause all monitors" must be saved on the server too, otherwise the checker keeps running
    var want = pauseInput().checked;
    api("GET", "/state").then(function (s) {
      var all = s.monitors.length > 0 && s.monitors.every(function (m) { return m.paused; }); if (want === all) return;
      return Promise.all(s.monitors.filter(function (m) { return m.paused !== want; }).map(function (m) { return api("POST", "/monitors/" + m.id + "/pause"); }))
        .then(function () { if (window.refreshState) refreshState(true); });
    }).catch(function () {});
  });

  $("#pw-save").addEventListener("click", function () {
    var cur = $("#pw-cur").value, nw = $("#pw-new").value, cf = $("#pw-conf").value;
    if (!cur || !nw) return toast("Fill in all password fields", "error");
    if (nw !== cf) return toast("New passwords do not match", "error");
    api("POST", "/auth/password", { current: cur, next: nw }).then(function () { ["#pw-cur", "#pw-new", "#pw-conf"].forEach(function (i) { $(i).value = ""; }); toast("Password changed — other devices logged out", "success"); }).catch(function (x) { toast(x.message, "error"); });
  });

  $("#delete-account").addEventListener("click", function () {
    if (!confirm("Permanently delete your account and all monitors? This cannot be undone.")) return;
    var pw = prompt("Enter your password to confirm:"); if (!pw) return;
    api("POST", "/auth/delete", { password: pw }).then(function () { wipeLocal(); location.href = "/login.html"; }).catch(function (x) { toast(x.message, "error"); });
  });

  /* ---------- Active sessions (Security page) ---------- */
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function renderSessions() {
    var box = $("#session-list"); if (!box) return;
    api("GET", "/auth/sessions").then(function (r) {
      box.innerHTML = r.sessions.map(function (s) {
        return '<div class="session-item"><div class="session-info"><span class="session-device">' + esc(s.device) + '</span><span class="session-meta">Signed in ' + new Date(s.created).toLocaleString() + '</span></div>' +
          (s.current ? '<span class="badge badge-green">Current</span>' : '<button class="btn btn-ghost btn-sm" data-revoke="' + esc(s.id) + '">Log out</button>') + '</div>';
      }).join("");
      $("#logout-others").style.display = r.sessions.length > 1 ? "" : "none";
    }).catch(function () {});
  }
  function revoke(id) {
    api("POST", "/auth/sessions/revoke", { id: id }).then(function () { toast("Device logged out", "success"); renderSessions(); }).catch(function (x) { toast(x.message, "error"); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-revoke]"); if (b) return revoke(b.dataset.revoke);
    if (e.target.closest("#logout-others")) return revoke("others");
    if (e.target.closest('[data-page="security"]')) setTimeout(renderSessions, 50);
  });
  renderSessions();
});
