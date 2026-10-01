/* UpTrack — enhance.js
   Extra UI behaviour that loads after script.js: click handling, default check interval,
   notifications bell, chart tooltips, data export and keyboard shortcuts. */
document.addEventListener("DOMContentLoaded", function () {
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clearedTs = 0, prefs = {};
  try { clearedTs = +localStorage.getItem("uptrack:cleared") || 0; prefs = JSON.parse(localStorage.getItem("uptrack:prefs")) || {}; } catch (e) {}

  /* ---------- Default check interval (remembered per browser) ---------- */
  var intervalSel = $("#s-interval");
  function minutes(v) { return parseInt(v, 10) || 5; }
  if (prefs.interval) $$("option", intervalSel).forEach(function (o) { if (minutes(o.textContent) === prefs.interval) intervalSel.value = o.textContent; });
  intervalSel.addEventListener("change", function () {
    prefs.interval = minutes(this.value);
    try { localStorage.setItem("uptrack:prefs", JSON.stringify(prefs)); } catch (e) {}
    showToast("Default interval set to " + prefs.interval + " min", "success");
  });
  $("#add-monitor-btn").addEventListener("click", function () {
    $("#m-interval").value = String(minutes(intervalSel.value));
    setTimeout(function () { $("#m-name").focus(); }, 50);
  });

  /* ---------- Buttons rendered by the tables (no inline handlers) ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act],[data-go],[data-mon],[data-inc]"); if (!t) return;
    if (t.dataset.go) { e.preventDefault(); return navigateTo(t.dataset.go); }
    if (t.dataset.mon) return viewMonitor(+t.dataset.mon);
    if (t.dataset.inc) return viewIncident(+t.dataset.inc);
    var actions = { check: checkNow, view: viewMonitor, pause: togglePause, del: deleteMonitor, iview: viewIncident, ires: resolveIncident };
    actions[t.dataset.act](+t.dataset.id);
  });
  $("#incident-period").addEventListener("change", renderIncidents);

  /* ---------- Export ---------- */
  function download(name, text, type) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function csv(rows) {   // quotes every cell and neutralises spreadsheet formulas (=, +, -, @)
    return rows.map(function (r) { return r.map(function (v) { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
  }
  window.exportData = function (kind) {
    if (kind === "monitors") download("uptrack-monitors.csv", csv([["Name", "URL", "Status", "Uptime %", "Latency ms", "Last checked"]].concat(monitors.map(function (m) { return [m.name, m.url, m.paused ? "paused" : m.status, m.uptime, m.latency, m.lastChecked]; }))), "text/csv");
    else if (kind === "incidents") download("uptrack-incidents.csv", csv([["Website", "Status", "Time", "Duration", "Type"]].concat(incidents.map(function (n) { return [n.website, n.status, n.time, n.duration, n.issueType]; }))), "text/csv");
    else download("uptrack-backup.json", JSON.stringify({ exportedAt: new Date().toISOString(), monitors: monitors, incidents: incidents, activityLog: activityLog }, null, 2), "application/json");
    showToast("Export downloaded", "success");
  };

  /* ---------- Notifications ---------- */
  var notif = document.createElement("div"); notif.className = "notif-panel"; document.body.appendChild(notif);
  function renderNotifs() {
    activityLog.forEach(function (a) { if (!a.ts) a.ts = Date.now(); });
    var on = incidents.filter(function (n) { return n.status === "ongoing" && n.ts > clearedTs; }),
        acts = activityLog.filter(function (a) { return a.ts > clearedTs; }).slice(0, 6),
        b = $("#notif-btn"), dot = $(".notif-badge", b), total = on.length + acts.length;
    if (on.length && !dot) { dot = document.createElement("span"); dot.className = "notif-badge"; b.appendChild(dot); } else if (!on.length && dot) dot.remove();
    var item = function (c, t, m) { return '<div class="activity-item"><div class="activity-dot ' + c + '"></div><div><div class="activity-text">' + esc(t) + '</div><div class="activity-time">' + esc(m) + "</div></div></div>"; };
    notif.innerHTML = '<div class="notif-head"><h3 class="card-title">Notifications</h3>' + (total ? '<button class="btn btn-ghost btn-sm" data-clear="1">Clear all</button>' : "") + "</div>" +
      (total ? on.map(function (n) { return item("red", n.website + " is down", "Ongoing · " + elapsed(Date.now() - n.ts)); }).join("") + acts.map(function (a) { return item(a.color, a.text, a.time); }).join("") : '<p class="card-desc" style="padding:18px 0;text-align:center">You are all caught up 🎉</p>');
  }
  $("#notif-btn").addEventListener("click", function (e) { e.stopPropagation(); renderNotifs(); notif.classList.toggle("open"); });
  document.addEventListener("click", function (e) { if (!notif.contains(e.target)) notif.classList.remove("open"); });
  document.addEventListener("click", function (e) { if (e.target.closest("[data-clear]")) { clearedTs = Date.now(); try { localStorage.setItem("uptrack:cleared", clearedTs); } catch (e) {} renderNotifs(); showToast("Notifications cleared", "success"); } });

  /* ---------- Chart hover tooltips ---------- */
  var tip = document.createElement("div"); tip.className = "chart-tip"; document.body.appendChild(tip);
  function dayLabel(i, n) { var d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return shortDate(d); }
  var TIPS = {
    "dashboard-chart": { l: 48, r: 56, d: function () { return dashUptimeData; },
      t: function (i, n) { return $("#topbar-period").value === "24h" ? new Date(Date.now() - (n - 1 - i) * 36e5).toLocaleTimeString("en-US", { hour: "numeric" }) : dayLabel(i, n); },
      x: function (i) { return dashLatencyData[i] != null ? "<br>Latency " + dashLatencyData[i] + " ms" : ""; } },
    "analytics-chart": { l: 44, r: 20, d: getAnalyticsSlice, t: function (i, n) { return dayLabel(i, n); } },
    "detail-chart": { l: 44, r: 20, d: function () { return window._mChartData || []; }, t: function (i) { return getLastDays(7)[i]; } }
  };
  document.addEventListener("mousemove", function (e) {
    var c = TIPS[e.target.id]; if (!c) { tip.style.display = "none"; return; }
    var d = c.d(), r = e.target.getBoundingClientRect(), i = Math.round(((e.clientX - r.left - c.l) / (r.width - c.l - c.r)) * (d.length - 1));
    if (i < 0 || i >= d.length) { tip.style.display = "none"; return; }
    tip.innerHTML = c.t(i, d.length) + "<br>" + (d[i] == null ? "No data" : "Uptime " + (+d[i]).toFixed(2) + "%" + (c.x ? c.x(i) : ""));
    tip.style.display = "block"; tip.style.left = e.clientX + 12 + "px"; tip.style.top = e.clientY + 12 + "px";
  });

  /* ---------- Keyboard, search, a11y ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if ($("#modal-overlay").classList.contains("active")) closeModal(); notif.classList.remove("open"); }
    else if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#search-input").focus(); }
  });
  $("#search-input").addEventListener("input", function () { if (this.value && !$("#page-monitors").classList.contains("active")) navigateTo("monitors"); });
  $("#search-input").title = "Press / to focus search";
  $$(".setting-row").forEach(function (r) { var i = $("input", r), l = $(".setting-label-text", r); if (i && l) i.setAttribute("aria-label", l.textContent); });
  $("#add-modal").setAttribute("role", "dialog"); $("#add-modal").setAttribute("aria-modal", "true");
  setInterval(function () { $("#topbar-date").textContent = formatDate(); }, 60000);

  window.renderNotifs = renderNotifs;
  renderNotifs();
});
