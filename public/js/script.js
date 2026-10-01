/* ========================================================
   UpTrack — script.js (Final Polished Version)
   Full logic: data, rendering, navigation, charts, modals,
   delete, pause/resume, profile, security tabs, activity.
   ======================================================== */

// ========================================================
// 1. STATE
// ========================================================

// Filled by api.js from the server
var monitors = [];
var incidents = [];
var activityLog = [];

// Chart series (null = no data for that period)
var dashUptimeData = [];
var dashLatencyData = [];
var analyticsSeries = [];

var currentMonitorFilter = "all";
var currentIncidentFilter = "all";
var currentSearch = "";

// ========================================================
// 2. HELPERS
// ========================================================

function getStats() {
  var total = monitors.length, online = 0, offline = 0, paused = 0;
  var uptimeSum = 0, latencySum = 0, latencyCount = 0;
  for (var i = 0; i < monitors.length; i++) {
    var m = monitors[i];
    if (m.paused) { paused++; continue; }
    if (m.status === "online") online++;
    else offline++;
    uptimeSum += m.uptime;
    if (m.latency > 0) { latencySum += m.latency; latencyCount++; }
  }
  var active = total - paused;
  return {
    total: total, online: online, offline: offline, paused: paused,
    uptime: active > 0 ? (uptimeSum / active).toFixed(1) : "0.0",
    latency: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0
  };
}

function countIncidents(status) {
  var c = 0;
  for (var i = 0; i < incidents.length; i++) {
    if (status === "all" || incidents[i].status === status) c++;
  }
  return c;
}

function $(s, r) { return (r || document).querySelector(s); }
function esc(s) { return String(s).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function elapsed(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " hr" : Math.round(m / 1440) + " day"; }
function shortDate(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

// Y-axis grid values (100 down to min) with at most ~5 lines
function gridVals(min) {
  var span = 100 - min, step = [1, 2, 5, 10, 20, 25, 50].filter(function(x) { return span / x <= 5; })[0] || 50, out = [];
  for (var v = 100; v >= min; v -= step) out.unshift(v);
  return out;
}
function getLastDays(n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); out.push(d.toLocaleDateString("en-US", { weekday: "short" })); }
  return out;
}
function dateTicks(n, k) {
  var out = [];
  for (var i = 0; i < k; i++) { var d = new Date(); d.setDate(d.getDate() - Math.round((n - 1) * (1 - i / (k - 1)))); out.push(shortDate(d)); }
  return out;
}
function getDashLabels() {
  var p = $("#topbar-period").value;
  if (p !== "24h") return dateTicks(p === "7d" ? 7 : 30, 7);
  var out = [];
  for (var k = 0; k < 7; k++) out.push(new Date(Date.now() - 23 * (1 - k / 6) * 36e5).toLocaleTimeString("en-US", { hour: "numeric" }));
  return out;
}
function getAnalyticsLabels(k) { return dateTicks(parseInt($("#analytics-period").value, 10) || 30, k); }
function getAnalyticsSlice() { return analyticsSeries; }

function getGreeting() {
  var h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate() {
  var now = new Date();
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type) {
  var container = document.getElementById("toast-container");
  var t = document.createElement("div");
  t.className = "toast " + (type || "");
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(function() {
    t.classList.add("removing");
    setTimeout(function() { t.remove(); }, 200);
  }, 3000);
}

function updateAllCounts() {
  var s = getStats();
  var el;
  el = document.getElementById("fc-all"); if (el) el.textContent = s.total;
  el = document.getElementById("fc-online"); if (el) el.textContent = s.online;
  el = document.getElementById("fc-offline"); if (el) el.textContent = s.offline;
  el = document.getElementById("fc-paused"); if (el) el.textContent = s.paused;
  el = document.getElementById("ep-used"); if (el) el.value = monitors.length + " / 10";
  el = document.getElementById("pu-monitors"); if (el) el.textContent = monitors.length;
  el = document.getElementById("ic-all"); if (el) el.textContent = incidents.length;
  el = document.getElementById("ic-ongoing"); if (el) el.textContent = countIncidents("ongoing");
  el = document.getElementById("ic-resolved"); if (el) el.textContent = countIncidents("resolved");
}

// ========================================================
// 3. RENDER — DASHBOARD
// ========================================================

function statCard(label, value, sub, cls) {
  return '<div class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value' + (cls ? " " + cls : "") + '">' + value + '</div><div class="stat-sub">' + sub + '</div></div>';
}

function renderDashboard() {
  var s = getStats(), first = (($("#s-name") || {}).value || "").trim().split(/\s+/)[0];
  var pct = function(n) { return (s.total > 0 ? (n / s.total * 100).toFixed(1) : "0.0") + "% of total"; };
  $("#greeting").textContent = getGreeting() + (first ? ", " + first : "") + " \ud83d\udc4b";
  $("#dash-stats").innerHTML = statCard("Total Monitors", s.total, s.paused + " paused")
    + statCard("Online", s.online, pct(s.online), "green")
    + statCard("Offline", s.offline, pct(s.offline), "red")
    + statCard("Overall Uptime", s.uptime + "%", "Across active monitors");
  var ms = monitors.slice().sort(function (a, b) { return (a.status === "offline" ? 0 : 1) - (b.status === "offline" ? 0 : 1); }).slice(0, 6);
  $("#dash-monitors").innerHTML = ms.length ? ms.map(function (m) { return '<button class="mini-row" data-mon="' + m.id + '"><span class="status-dot ' + (m.paused ? "paused" : m.status) + '"></span><span class="grow">' + esc(m.name) + '</span><span class="dim">' + (m.paused ? "Paused" : m.status === "online" ? "Online" : "Offline") + " · " + m.uptime.toFixed(2) + "%</span></button>"; }).join("") : '<p class="card-desc">No monitors yet. Add one from the Monitors page.</p>';
  var inc = incidents.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
  $("#dash-incidents").innerHTML = inc.length ? inc.map(function (n) { return '<button class="mini-row" data-inc="' + n.id + '"><span class="status-badge ' + n.status + '">' + (n.status === "ongoing" ? "Ongoing" : "Resolved") + '</span><span class="grow">' + esc(n.website) + '</span><span class="dim">' + esc(n.time) + "</span></button>"; }).join("") : '<p class="card-desc">No incidents 🎉</p>';
  setTimeout(drawDashboardChart, 50);
}

// ========================================================
// 4. RENDER — MONITORS TABLE
// ========================================================

function renderMonitors() {
    updateAllCounts();
    var q = currentSearch.toLowerCase(), h = "";
    monitors.forEach(function (m) {
      var eff = m.paused ? "paused" : m.status;
      if (currentMonitorFilter !== "all" && eff !== currentMonitorFilter) return;
      if (q && m.name.toLowerCase().indexOf(q) < 0 && m.url.toLowerCase().indexOf(q) < 0) return;
      var w = m.paused ? "Paused" : m.status === "online" ? "Online" : "Offline", b = function (a, t, x) { return '<button class="table-action"' + (x || "") + ' data-act="' + a + '" data-id="' + m.id + '">' + t + "</button>"; };
      h += "<tr" + (m.paused ? ' style="opacity:.55"' : "") + '><td><span class="status-dot ' + eff + '" title="' + w + '"></span> <small>' + w + '</small></td><td style="font-weight:600">' + esc(m.name) + '</td><td><span class="table-url">' + esc(m.url) + '</span></td><td><span class="mono">' + m.uptime.toFixed(2) + '%</span></td><td>' + (m.latency > 0 ? m.latency + " ms" : "—") + '</td><td style="color:var(--text-3)">' + esc(m.lastChecked) + "</td><td>" + b("check", "Check Now") + b("view", "View") + b("pause", m.paused ? "Resume" : "Pause") + b("del", "Delete", ' style="color:var(--red)"') + "</td></tr>";
    });
    $("#monitors-tbody").innerHTML = h || '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-3)">No monitors found</td></tr>';
}

// ========================================================
// 5. RENDER — MONITOR DETAIL
// ========================================================

function viewMonitor(id) {
  var m = null;
  for (var i = 0; i < monitors.length; i++) {
    if (monitors[i].id === id) { m = monitors[i]; break; }
  }
  if (!m) return;

  navigateTo("monitor-detail");

  var container = document.getElementById("monitor-detail-content");
  var statusBadge = m.paused ? '<span class="badge badge-orange">Paused</span>'
    : m.status === "online" ? '<span class="badge badge-green">Online</span>'
    : '<span class="badge badge-red">Offline</span>';

  var uptimeChange = 'Since monitoring started';
  var uptimeClass = m.uptime > 99 ? 'up' : 'down';
  var httpText = !m.httpStatus ? 'No response yet' : m.httpStatus < 400 ? 'OK' : 'Error';

  var checksHtml = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3)">Loading\u2026</td></tr>';

  container.innerHTML = ''
    + '<a href="#" class="back-link" onclick="navigateTo(\'monitors\'); return false;">← Back to Monitors</a>'
    + '<div class="detail-header">'
    + '  <div><div class="detail-title-area"><span class="detail-name">' + m.name + '</span>' + statusBadge + '</div>'
    + '  <div class="detail-url">' + m.url + ' · Added on ' + m.addedOn + '</div></div>'
    + '  <div class="detail-actions">'
    + '    <button class="btn btn-outline btn-sm" onclick="checkNow(' + m.id + '); viewMonitor(' + m.id + ')">Check Now</button>'
    + '    <button class="btn btn-outline btn-sm" onclick="togglePause(' + m.id + '); viewMonitor(' + m.id + ')">' + (m.paused ? 'Resume' : 'Pause') + '</button>'
    + '    <button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red)" onclick="deleteMonitor(' + m.id + ')">Delete</button>'
    + '  </div></div>'
    + '<div class="detail-stats">'
    + '  <div class="detail-stat"><div class="detail-stat-label">Uptime</div><div class="detail-stat-value">' + m.uptime.toFixed(2) + '%</div><div class="detail-stat-sub"><span class="' + uptimeClass + '">' + uptimeChange + '</span></div></div>'
    + '  <div class="detail-stat"><div class="detail-stat-label">Response Time</div><div class="detail-stat-value">' + (m.latency > 0 ? m.latency + ' ms' : '—') + '</div><div class="detail-stat-sub">Average</div></div>'
    + '  <div class="detail-stat"><div class="detail-stat-label">HTTP Status</div><div class="detail-stat-value">' + m.httpStatus + '</div><div class="detail-stat-sub">' + httpText + '</div></div>'
    + '  <div class="detail-stat"><div class="detail-stat-label">Total Checks</div><div class="detail-stat-value">' + m.totalChecks.toLocaleString() + '</div><div class="detail-stat-sub">All time</div></div>'
    + '</div>'
    + '<div class="card"><div class="card-header"><h2 class="card-title">Uptime (Last 7 Days)</h2></div><div class="chart-wrap"><canvas id="detail-chart"></canvas></div></div>'
    + '<div class="detail-bottom">'
    + '  <div class="card"><h3 class="card-title" style="margin-bottom:14px;">Recent Checks</h3><table class="data-table"><thead><tr><th>Time</th><th>Status</th><th>Response Time</th><th>HTTP Code</th></tr></thead><tbody>' + checksHtml + '</tbody></table></div>'
    + '  <div class="card"><h3 class="card-title" style="margin-bottom:14px;">Status Distribution</h3><div class="donut-wrap"><canvas id="donut-chart" width="160" height="160"></canvas><div class="donut-legend"><div class="donut-legend-item"><span class="donut-legend-dot" style="background:var(--green)"></span> Uptime ' + m.uptime.toFixed(2) + '%</div><div class="donut-legend-item"><span class="donut-legend-dot" style="background:var(--red)"></span> Downtime ' + (100 - m.uptime).toFixed(2) + '%</div></div></div></div>'
    + '</div>';

  window._mChartData = null; // set by api.js once the real history arrives
  window._mUptime = m.uptime;
  setTimeout(function() { drawDonutChart(m.uptime); }, 60);
}

// ========================================================
// 6. RENDER — INCIDENTS TABLE
// ========================================================

function renderIncidents() {
    updateAllCounts();
    var lim = [7, 30, 1e5][$("#incident-period").selectedIndex] * 864e5, h = "";
    incidents.forEach(function (n) {
      if (currentIncidentFilter !== "all" && n.status !== currentIncidentFilter) return;
      if (Date.now() - n.ts > lim) return;
      var on = n.status === "ongoing";
      h += '<tr><td><span class="status-badge ' + n.status + '">' + (on ? "Ongoing" : "Resolved") + '</span></td><td style="font-weight:600">' + esc(n.website) + '</td><td style="color:var(--text-3)">' + esc(n.time) + "</td><td>" + (on ? elapsed(Date.now() - n.ts) : esc(n.duration)) + '</td><td style="color:var(--text-2)">' + esc(n.details) + '</td><td><button class="table-action" data-act="iview" data-id="' + n.id + '">View</button>' + (on ? '<button class="table-action" style="color:var(--green)" data-act="ires" data-id="' + n.id + '">Resolve</button>' : "") + "</td></tr>";
    });
    $("#incidents-tbody").innerHTML = h || '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-3)">No incidents found</td></tr>';
}

// ========================================================
// 7. RENDER — INCIDENT DETAIL
// ========================================================

function viewIncident(id) {
  var inc = null;
  for (var i = 0; i < incidents.length; i++) {
    if (incidents[i].id === id) { inc = incidents[i]; break; }
  }
  if (!inc) return;

  navigateTo("incident-detail");

  var container = document.getElementById("incident-detail-content");
  var statusBadge = inc.status === "ongoing" ? '<span class="badge badge-orange">Ongoing</span>' : '<span class="badge badge-green">Resolved</span>';

  var timelineHtml = '';
  if (inc.status === "ongoing") {
    timelineHtml = '<li class="timeline-item"><div class="timeline-dot red"></div><div><div class="timeline-text">Incident detected</div><div class="timeline-time">' + inc.time + '</div></div></li>'
      + '<li class="timeline-item"><div class="timeline-dot red"></div><div><div class="timeline-text">Still down</div><div class="timeline-time">5 mins later</div></div></li>'
      + '<li class="timeline-item"><div class="timeline-dot red"></div><div><div class="timeline-text">Still down</div><div class="timeline-time">10 mins later</div></div></li>';
  } else {
    timelineHtml = '<li class="timeline-item"><div class="timeline-dot red"></div><div><div class="timeline-text">Incident detected</div><div class="timeline-time">' + inc.time + '</div></div></li>'
      + '<li class="timeline-item"><div class="timeline-dot red"></div><div><div class="timeline-text">Service degraded</div><div class="timeline-time">During ' + inc.duration + '</div></div></li>'
      + '<li class="timeline-item"><div class="timeline-dot green"></div><div><div class="timeline-text">Resolved</div><div class="timeline-time">After ' + inc.duration + '</div></div></li>';
  }

  var retryHtml = '<tr><td style="color:var(--text-3)">Check 1</td><td><span class="status-badge ongoing">Timeout</span></td><td>—</td><td>Request timeout</td></tr>'
    + '<tr><td style="color:var(--text-3)">Check 2</td><td><span class="status-badge ongoing">Timeout</span></td><td>—</td><td>Connection refused</td></tr>';
  if (inc.status === "resolved") {
    retryHtml += '<tr><td style="color:var(--text-3)">Check 3</td><td><span class="status-badge resolved">200 OK</span></td><td>82 ms</td><td>Recovered successfully</td></tr>';
  }

  var resolveBtn = inc.status === "ongoing"
    ? '<button class="btn btn-primary btn-sm" onclick="resolveIncident(' + inc.id + '); viewIncident(' + inc.id + ');" style="margin-top:12px">Mark as Resolved</button>'
    : '';

  container.innerHTML = ''
    + '<a href="#" class="back-link" onclick="navigateTo(\'incidents\'); return false;">← Back to Incidents</a>'
    + '<div class="detail-header"><div><div class="detail-title-area"><span class="detail-name">Incident Details</span>' + statusBadge + '</div></div></div>'
    + '<div class="incident-detail-grid">'
    + '  <div class="card">'
    + '    <div class="incident-info-row"><span class="incident-info-label">Website</span><span class="incident-info-value">' + inc.website + '</span></div>'
    + '    <div class="incident-info-row"><span class="incident-info-label">Incident Time</span><span class="incident-info-value">' + inc.time + '</span></div>'
    + '    <div class="incident-info-row"><span class="incident-info-label">Duration</span><span class="incident-info-value">' + inc.duration + '</span></div>'
    + '    <div class="incident-info-row"><span class="incident-info-label">Issue Type</span><span class="incident-info-value">' + inc.issueType + '</span></div>'
    + '    <div class="incident-info-row"><span class="incident-info-label">Details</span><span class="incident-info-value" style="max-width:280px;white-space:normal;text-align:right;">' + inc.description + '</span></div>'
    + resolveBtn
    + '  </div>'
    + '  <div class="card"><h3 class="card-title" style="margin-bottom:14px;">Status Timeline</h3><ul class="timeline-list">' + timelineHtml + '</ul></div>'
    + '</div>'
    + '<div class="card"><h3 class="card-title" style="margin-bottom:14px;">Retry Logs</h3><table class="data-table"><thead><tr><th>Check</th><th>Status</th><th>Response Time</th><th>Message</th></tr></thead><tbody>' + retryHtml + '</tbody></table></div>';
}

// ========================================================
// 8. RENDER — ANALYTICS
// ========================================================

function renderAnalytics() {
  var s = getStats();
  var totalChecks = 0;
  for (var i = 0; i < monitors.length; i++) totalChecks += monitors[i].totalChecks;

  var grid = document.getElementById("analytics-stats");
  grid.innerHTML = ''
    + '<div class="stat-card"><div class="stat-label">Average Uptime</div><div class="stat-value">' + s.uptime + '%</div></div>'
    + '<div class="stat-card"><div class="stat-label">Avg Response Time</div><div class="stat-value">' + s.latency + ' ms</div></div>'
    + '<div class="stat-card"><div class="stat-label">Total Checks</div><div class="stat-value">' + totalChecks.toLocaleString() + '</div></div>'
    + '<div class="stat-card"><div class="stat-label">Total Incidents</div><div class="stat-value red">' + incidents.length + '</div></div>';

  setTimeout(drawAnalyticsChart, 50);
}

// ========================================================
// 9. RENDER — PROFILE
// ========================================================

function renderProfile() {
  var s = getStats();
  var totalChecks = 0;
  for (var i = 0; i < monitors.length; i++) totalChecks += monitors[i].totalChecks;

  // Update usage stats
  var el;
  el = document.getElementById("pu-monitors"); if (el) el.textContent = monitors.length;
  el = document.getElementById("pu-checks"); if (el) el.textContent = totalChecks.toLocaleString();
  el = document.getElementById("pu-incidents"); if (el) el.textContent = incidents.length;
  el = document.getElementById("pu-uptime"); if (el) el.textContent = s.uptime + "%";

  // Activity log
  var actEl = document.getElementById("profile-activity");
  if (actEl) {
    var html = "";
    for (var i = 0; i < activityLog.length; i++) {
      var a = activityLog[i];
      html += '<div class="activity-item"><div class="activity-dot ' + a.color + '"></div><div><div class="activity-text">' + esc(a.text) + '</div><div class="activity-time">' + esc(a.time) + '</div></div></div>';
    }
    actEl.innerHTML = html;
  }
}

// ========================================================
// 10. RENDER — ACTIVITY LOG (Data page)
// ========================================================

function renderActivityLog() {
  var el = document.getElementById("sec-activity-log");
  if (!el) return;

  var secActivity = (typeof activityLog !== "undefined" && activityLog ? activityLog : []).slice(0, 15);

  var html = "";
  for (var i = 0; i < secActivity.length; i++) {
    var a = secActivity[i];
    html += '<div class="activity-item"><div class="activity-dot ' + a.color + '"></div><div><div class="activity-text">' + esc(a.text) + '</div><div class="activity-time">' + esc(a.time) + '</div></div></div>';
  }
  el.innerHTML = html || '<p class="card-desc">No activity yet.</p>';
}

// ----- shared chart helpers -----
function chartBase(id, H) {
  var canvas = document.getElementById(id);
  if (!canvas) return null;
  var ctx = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
  var W = canvas.parentElement.getBoundingClientRect().width;
  var dark = document.documentElement.getAttribute("data-theme") === "dark";
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
  ctx.font = "10px 'IBM Plex Mono', monospace";
  return { ctx: ctx, W: W, H: H, dark: dark, grid: dark ? "rgba(255,255,255,0.06)" : "rgba(44,42,38,0.06)", label: dark ? "#6b6560" : "#9a9488" };
}
function values(a) { return a.filter(function(v) { return v != null; }); }
function noData(c) {
  c.ctx.fillStyle = c.label; c.ctx.textAlign = "center"; c.ctx.font = "13px 'Source Sans 3', sans-serif";
  c.ctx.fillText("Collecting data\u2026 your first checks will appear here", c.W / 2, c.H / 2);
}
// Horizontal grid + % labels on the left; returns the y-mapper
function uptimeGrid(c, pad, min, max) {
  var cH = c.H - pad.top - pad.bottom;
  var gy = function(v) { return pad.top + cH - ((v - min) / (max - min)) * cH; };
  c.ctx.textAlign = "right"; c.ctx.fillStyle = c.label; c.ctx.strokeStyle = c.grid; c.ctx.lineWidth = 1;
  gridVals(min).forEach(function(v) {
    c.ctx.beginPath(); c.ctx.moveTo(pad.left, gy(v)); c.ctx.lineTo(c.W - pad.right, gy(v)); c.ctx.stroke();
    c.ctx.fillText(v + "%", pad.left - 6, gy(v) + 3);
  });
  return gy;
}
function xLabels(c, pad, labels) {
  c.ctx.textAlign = "center"; c.ctx.fillStyle = c.label;
  labels.forEach(function(l, i, arr) { c.ctx.fillText(l, pad.left + (i / (arr.length - 1)) * (c.W - pad.left - pad.right), c.H - 6); });
}
// Draws a smooth line through runs of real values; null values leave a gap
function plot(c, data, gx, gy, o) {
  var ctx = c.ctx, run = [], runs = [];
  data.forEach(function(v, i) { if (v == null) { if (run.length) runs.push(run); run = []; } else run.push(i); });
  if (run.length) runs.push(run);
  ctx.save(); ctx.strokeStyle = o.color; ctx.lineWidth = 2; if (o.dashed) ctx.setLineDash([5, 3]);
  runs.forEach(function(r) {
    ctx.beginPath(); ctx.moveTo(gx(r[0]), gy(data[r[0]]));
    for (var k = 1; k < r.length; k++) {
      var a = r[k - 1], b = r[k], mx = (gx(a) + gx(b)) / 2;
      ctx.quadraticCurveTo(gx(a), gy(data[a]), mx, (gy(data[a]) + gy(data[b])) / 2);
    }
    var last = r[r.length - 1]; ctx.lineTo(gx(last), gy(data[last])); ctx.stroke();
    if (r.length === 1) { ctx.beginPath(); ctx.arc(gx(last), gy(data[last]), 3, 0, Math.PI * 2); ctx.fillStyle = o.color; ctx.fill(); }
    else if (o.areaTo != null) {
      ctx.lineTo(gx(last), o.areaTo); ctx.lineTo(gx(r[0]), o.areaTo); ctx.closePath();
      var g = ctx.createLinearGradient(0, o.areaFrom, 0, o.areaTo);
      g.addColorStop(0, c.dark ? "rgba(58,154,92,0.12)" : "rgba(58,154,92,0.06)"); g.addColorStop(1, "rgba(58,154,92,0)");
      ctx.fillStyle = g; ctx.fill();
    }
  });
  ctx.restore();
}

// ========================================================
// 11. CHARTS — Dashboard (dual axis)
// ========================================================

function drawDashboardChart() {
  var c = chartBase("dashboard-chart", 220); if (!c) return;
  if (!values(dashUptimeData).length) return noData(c);
  var pad = { top: 20, right: 56, bottom: 30, left: 48 }, cW = c.W - pad.left - pad.right, cH = c.H - pad.top - pad.bottom;
  var up = dashUptimeData, lat = dashLatencyData, n = Math.max(up.length - 1, 1);
  var uMin = Math.min(96, Math.floor(Math.min.apply(null, values(up))) - 1);
  var lMax = Math.max(400, Math.ceil(Math.max.apply(null, values(lat)) / 100) * 100);
  var gx = function(i) { return pad.left + (i / n) * cW; };
  var gyU = uptimeGrid(c, pad, uMin, 100.5);
  var gyL = function(v) { return pad.top + cH - (v / lMax) * cH; };

  c.ctx.textAlign = "left"; c.ctx.fillStyle = c.label;
  [0, 1, 2, 3, 4].forEach(function(i) { c.ctx.fillText(Math.round(i * lMax / 4) + "ms", c.W - pad.right + 6, gyL(i * lMax / 4) + 3); });
  xLabels(c, pad, getDashLabels());

  plot(c, up, gx, gyU, { color: "#3a9a5c", areaFrom: pad.top, areaTo: pad.top + cH });
  plot(c, lat, gx, gyL, { color: "#4a7abf", dashed: true });
  lat.forEach(function(v, i) {   // spike markers
    if (v > 150) {
      c.ctx.beginPath(); c.ctx.arc(gx(i), gyL(v), 4, 0, Math.PI * 2); c.ctx.fillStyle = "#c44545"; c.ctx.fill();
      c.ctx.strokeStyle = c.dark ? "#2a2723" : "#fff"; c.ctx.lineWidth = 2; c.ctx.stroke();
    }
  });
}

// ========================================================
// 12. CHART — Monitor Detail (7-day uptime)
// ========================================================

function drawDetailChart(data) {
  var c = chartBase("detail-chart", 200); if (!c) return;
  if (!values(data).length) return noData(c);
  var pad = { top: 16, right: 20, bottom: 28, left: 44 }, cW = c.W - pad.left - pad.right;
  var gx = function(i) { return pad.left + (i / Math.max(data.length - 1, 1)) * cW; };
  var gy = uptimeGrid(c, pad, Math.min(93, Math.floor(Math.min.apply(null, values(data))) - 1), 101);
  c.ctx.textAlign = "center"; c.ctx.fillStyle = c.label;
  getLastDays(7).forEach(function(d, i) { c.ctx.fillText(d, gx(i), c.H - 6); });
  plot(c, data, gx, gy, { color: "#3a9a5c", areaFrom: pad.top, areaTo: c.H - pad.bottom });
  data.forEach(function(v, i) { if (v != null) { c.ctx.beginPath(); c.ctx.arc(gx(i), gy(v), 3, 0, Math.PI * 2); c.ctx.fillStyle = "#3a9a5c"; c.ctx.fill(); } });
}

// ========================================================
// 13. CHART — Donut
// ========================================================

function drawDonutChart(uptime) {
  var canvas = document.getElementById("donut-chart");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var size = 160;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + "px"; canvas.style.height = size + "px";
  ctx.scale(dpr, dpr);

  var cx = size / 2, cy = size / 2, r = 60, lw = 20;
  var upAngle = (uptime / 100) * Math.PI * 2;
  var isDark = document.documentElement.getAttribute("data-theme") === "dark";

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#c44545"; ctx.lineWidth = lw; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + upAngle);
  ctx.strokeStyle = "#3a9a5c"; ctx.lineWidth = lw; ctx.lineCap = "butt"; ctx.stroke();
  ctx.fillStyle = isDark ? "#e8e4dd" : "#2c2a26";
  ctx.font = "bold 16px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(uptime.toFixed(1) + "%", cx, cy);
}

// ========================================================
// 14. CHART — Analytics
// ========================================================

function drawAnalyticsChart() {
  var c = chartBase("analytics-chart", 220); if (!c) return;
  var data = getAnalyticsSlice();
  if (!values(data).length) return noData(c);
  var pad = { top: 16, right: 20, bottom: 30, left: 44 }, cW = c.W - pad.left - pad.right;
  var gx = function(i) { return pad.left + (i / Math.max(data.length - 1, 1)) * cW; };
  var gy = uptimeGrid(c, pad, Math.min(97, Math.floor(Math.min.apply(null, values(data))) - 1), 100.5);
  xLabels(c, pad, getAnalyticsLabels(7));
  plot(c, data, gx, gy, { color: "#3a9a5c", areaFrom: pad.top, areaTo: c.H - pad.bottom });
}

// ========================================================
// 15. NAVIGATION
// ========================================================

function navigateTo(pageName) {
  var pages = document.querySelectorAll(".page");
  for (var i = 0; i < pages.length; i++) pages[i].classList.remove("active");
  var target = document.getElementById("page-" + pageName);
  if (target) target.classList.add("active");

  var links = document.querySelectorAll(".sidebar-link");
  for (var j = 0; j < links.length; j++) {
    links[j].classList.remove("active");
    if (links[j].getAttribute("data-page") === pageName) links[j].classList.add("active");
  }

  if (pageName === "monitor-detail") {
    var ml = document.querySelector('.sidebar-link[data-page="monitors"]');
    if (ml) ml.classList.add("active");
  }
  if (pageName === "incident-detail") {
    var il = document.querySelector('.sidebar-link[data-page="incidents"]');
    if (il) il.classList.add("active");
  }

  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("active");

  if (pageName === "dashboard") renderDashboard();
  else if (pageName === "monitors") renderMonitors();
  else if (pageName === "incidents") renderIncidents();
  else if (pageName === "analytics") renderAnalytics();
  else if (pageName === "profile") renderProfile();
  else if (pageName === "data") renderActivityLog();

  window.scrollTo(0, 0);
}

// ========================================================
// 16. MONITOR ACTIONS
// ========================================================

// Implemented in api.js (they call the server). Declared here so inline onclick handlers can find them.
var checkNow, togglePause, deleteMonitor, addMonitor, resolveIncident;

// ========================================================
// 17. MODAL
// ========================================================

function openModal() { document.getElementById("modal-overlay").classList.add("active"); }
function closeModal() { document.getElementById("modal-overlay").classList.remove("active"); document.getElementById("add-monitor-form").reset(); }

// ========================================================
// 18. THEME
// ========================================================

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  var btn = document.getElementById("theme-toggle");
  if (theme === "dark") {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  } else {
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
  }
  try { localStorage.setItem("uptrack:theme", theme); } catch (e) {}
  var radio = $('input[name="theme"][value="' + theme + '"]'); if (radio) radio.checked = true;
  var lc = document.getElementById("theme-light-card"), dc = document.getElementById("theme-dark-card");
  if (lc) lc.classList.toggle("selected", theme === "light");
  if (dc) dc.classList.toggle("selected", theme === "dark");

  setTimeout(function() {
    var ap = document.querySelector(".page.active");
    if (ap) {
      if (ap.id === "page-dashboard") drawDashboardChart();
      if (ap.id === "page-analytics") drawAnalyticsChart();
      if (ap.id === "page-monitor-detail" && window._mChartData) {
        drawDetailChart(window._mChartData);
        if (window._mUptime) drawDonutChart(window._mUptime);
      }
    }
  }, 60);
}

// ========================================================
// 19. EVENT LISTENERS
// ========================================================

document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("topbar-date").textContent = formatDate();

  // Sidebar nav
  var sLinks = document.querySelectorAll(".sidebar-link");
  for (var i = 0; i < sLinks.length; i++) {
    sLinks[i].addEventListener("click", function(e) {
      e.preventDefault();
      navigateTo(this.getAttribute("data-page"));
    });
  }

  // Hamburger
  document.getElementById("hamburger-btn").addEventListener("click", function() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-overlay").classList.toggle("active");
  });
  document.getElementById("sidebar-overlay").addEventListener("click", function() {
    document.getElementById("sidebar").classList.remove("open");
    this.classList.remove("active");
  });

  // Add monitor
  document.getElementById("add-monitor-btn").addEventListener("click", openModal);
  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", function(e) { if (e.target === this) closeModal(); });

  // Add monitor form
  document.getElementById("add-monitor-form").addEventListener("submit", function(e) {
    e.preventDefault();
    var name = $("#m-name").value.replace(/[<>&"]/g, "").trim();
    var host = $("#m-url").value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    if (!name) return showToast("Enter a website name", "error");
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/.test(host)) return showToast("Enter a valid domain, e.g. example.com", "error");
    if (monitors.length >= 10) return showToast("Plan limit reached (10 monitors)", "error");
    if (monitors.some(function(m) { return m.url === "https://" + host; })) return showToast("This URL is already monitored", "error");
    addMonitor(name, host); closeModal();
  });

  // Search
  document.getElementById("search-input").addEventListener("input", function() {
    currentSearch = this.value;
    var ap = document.querySelector(".page.active");
    if (ap && ap.id === "page-monitors") renderMonitors();
  });

  // Monitor filters
  var mf = document.querySelectorAll("#monitor-filters .filter-tab");
  for (var a = 0; a < mf.length; a++) {
    mf[a].addEventListener("click", function() {
      for (var k = 0; k < mf.length; k++) mf[k].classList.remove("active");
      this.classList.add("active");
      currentMonitorFilter = this.getAttribute("data-filter");
      renderMonitors();
    });
  }

  // Incident filters
  var inf = document.querySelectorAll("#incident-filters .filter-tab");
  for (var b = 0; b < inf.length; b++) {
    inf[b].addEventListener("click", function() {
      for (var k = 0; k < inf.length; k++) inf[k].classList.remove("active");
      this.classList.add("active");
      currentIncidentFilter = this.getAttribute("data-filter");
      renderIncidents();
    });
  }

  // Analytics tabs
  var at = document.querySelectorAll("#analytics-tabs .tab-btn");
  for (var c = 0; c < at.length; c++) {
    at[c].addEventListener("click", function() {
      for (var k = 0; k < at.length; k++) at[k].classList.remove("active");
      this.classList.add("active");
    });
  }

  // Settings tabs
  var st = document.querySelectorAll("[data-stab]");
  for (var d = 0; d < st.length; d++) {
    st[d].addEventListener("click", function() {
      for (var k = 0; k < st.length; k++) st[k].classList.remove("active");
      this.classList.add("active");
      var panels = document.querySelectorAll(".settings-panel");
      for (var p = 0; p < panels.length; p++) panels[p].classList.remove("active");
      var target = document.getElementById("panel-" + this.getAttribute("data-stab"));
      if (target) target.classList.add("active");
    });
  }

  // Theme toggle
  document.getElementById("theme-toggle").addEventListener("click", function() {
    var cur = document.documentElement.getAttribute("data-theme");
    setTheme(cur === "dark" ? "light" : "dark");
  });

  // Theme radio cards
  var tr = document.querySelectorAll('input[name="theme"]');
  for (var f = 0; f < tr.length; f++) {
    tr[f].addEventListener("change", function() { setTheme(this.value); });
  }

  // Resize
  window.addEventListener("resize", function() {
    var ap = document.querySelector(".page.active");
    if (ap) {
      if (ap.id === "page-dashboard") drawDashboardChart();
      if (ap.id === "page-analytics") drawAnalyticsChart();
      if (ap.id === "page-monitor-detail" && window._mChartData) drawDetailChart(window._mChartData);
    }
  });

  // ===== INITIAL RENDER =====
  var savedTheme = null; try { savedTheme = localStorage.getItem("uptrack:theme"); } catch (e) {}
  setTheme(savedTheme || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  navigateTo("dashboard");
});
