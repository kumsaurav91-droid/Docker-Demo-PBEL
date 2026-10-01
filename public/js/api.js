/* UpTrack — api.js
   Connects the UI to the backend: loads state, wires up the monitor/incident actions and chart data. */
document.addEventListener("DOMContentLoaded", function () {
  var $ = function (s) { return document.querySelector(s); }, detailId = null, incId = null;
  function ago(ms) { var m = Math.round(ms / 60000); return m < 1 ? "Just now" : (m < 60 ? m + " min" : m < 1440 ? Math.round(m / 60) + " hr" : Math.round(m / 1440) + " day") + " ago"; }
  function fmt(d) { return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  function find(id) { return monitors.filter(function (m) { return m.id === id; })[0]; }
  function fail(e) { showToast(e.message || "Something went wrong", "error"); }
  function call(method, path, body) {
    return fetch("/api" + path, { method: method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) { location.href = "/login.html"; throw new Error("Session expired"); } if (!r.ok) throw new Error(j.error || "Request failed"); return j; }); });
  }
  function activePage() { var p = $(".page.active"); return p ? p.id : ""; }

  function applyState(s) {
    monitors = s.monitors.map(function (m) {
      m.lastChecked = m.lastCheckedTs ? ago(Date.now() - m.lastCheckedTs) : "Pending";
      m.addedOn = new Date(m.addedTs).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return m;
    });
    incidents = s.incidents.map(function (n) { n.time = fmt(new Date(n.ts)); if (n.status === "ongoing") n.duration = ago(Date.now() - n.ts).replace(" ago", ""); return n; });
    activityLog = s.activity.map(function (a) { a.time = ago(Date.now() - a.ts); return a; });
    if (window.syncPauseAll) syncPauseAll();
  }
  function loadStats() {
    return call("GET", "/stats?period=" + $("#topbar-period").value).then(function (r) {
      dashUptimeData = r.uptime;
      dashLatencyData = r.latency;
      if (activePage() === "page-dashboard") drawDashboardChart();
    }).catch(function () {});
  }
  function loadAnalytics() {
    return call("GET", "/stats?period=" + $("#analytics-period").value).then(function (r) {
      analyticsSeries = r.uptime;
      $("#page-analytics .card-meta").textContent = "Last " + ($("#analytics-period").value || 30) + " days";
      if (activePage() === "page-analytics") drawAnalyticsChart();
    }).catch(function () {});
  }
  function refresh(force) {
    return call("GET", "/state").then(function (s) {
      applyState(s);
      var ap = activePage();
      if (ap === "page-dashboard") { renderDashboard(); loadStats(); }
      else if (ap === "page-monitors") renderMonitors();
      else if (ap === "page-incidents") renderIncidents();
      else if (ap === "page-analytics") renderAnalytics();
      else if (force && ap === "page-monitor-detail" && detailId != null) viewMonitor(detailId);
      else if (force && ap === "page-incident-detail" && incId != null) viewIncident(incId);
      updateAllCounts(); renderNotifs();
    }).catch(function () {});
  }

  window.refreshState = refresh;

  fetch("/api/state").then(function (r) { if (r.status === 401) { location.href = "/login.html"; throw 0; } if (!r.ok) throw 0; return r.json(); }).then(start).catch(function () {
    showToast("Cannot reach the server. Please try again.", "error");
  });

  function start(s) {
    applyState(s);

    /* ----- actions now go to the server ----- */
    checkNow = function (id) {
      var n = find(id); showToast("Checking " + (n ? n.name : "monitor") + "…", "success");
      return call("POST", "/monitors/" + id + "/check").then(function (m) {
        showToast(m.name + " — " + (m.httpStatus ? "HTTP " + m.httpStatus : "no response") + (m.latency ? " · " + m.latency + " ms" : ""), m.status === "online" ? "success" : "error");
        return refresh(true);
      }).catch(fail);
    };
    togglePause = function (id) {
      return call("POST", "/monitors/" + id + "/pause").then(function (m) { showToast(m.name + (m.paused ? " paused" : " resumed"), "success"); return refresh(true); }).catch(fail);
    };
    deleteMonitor = function (id) {
      var n = find(id); if (!n || !confirm("Are you sure you want to delete \"" + n.name + "\"? This cannot be undone.")) return;
      return call("DELETE", "/monitors/" + id).then(function () {
        showToast(n.name + " deleted", "error");
        if (activePage() === "page-monitor-detail") navigateTo("monitors");
        return refresh();
      }).catch(fail);
    };
    resolveIncident = function (id) {
      return call("POST", "/incidents/" + id + "/resolve").then(function () { showToast("Incident resolved", "success"); return refresh(true); }).catch(fail);
    };
    addMonitor = function (name, hostname) {
      var body = { name: name, url: "https://" + hostname, interval: +$("#m-interval").value, method: $("#m-method").value };
      showToast("Adding " + name + "…", "success");
      call("POST", "/monitors", body).then(function (m) {
        var up = m.httpStatus > 0 && m.httpStatus < 400; showToast(m.name + (up ? " added — site is UP" : " added — first check failed, retrying shortly"), up ? "success" : "error"); return refresh();
      }).catch(fail);
    };
    window.clearMonitoring = function () {
      if (!confirm("Delete all monitors and incidents? This cannot be undone.")) return;
      call("DELETE", "/data").then(function () { showToast("All monitoring data deleted", "error"); return refresh(); }).catch(fail);
    };
    window.restoreSamples = function () {
      if (!confirm("Restore the starter monitors? Current data will be replaced.")) return;
      call("POST", "/reset").then(function () { showToast("Starter data restored", "success"); return refresh(); }).catch(fail);
    };

    /* ----- detail pages use real history ----- */
    var vm = viewMonitor;
    viewMonitor = function (id) {
      vm(id); detailId = id;
      call("GET", "/monitors/" + id + "/history").then(function (h) {
        var tb = $("#monitor-detail-content .detail-bottom tbody"), m = find(id); if (!tb || !m) return;
        tb.innerHTML = h.checks.length ? h.checks.map(function (c) {
          return '<tr><td style="color:var(--text-3)">' + new Date(c.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + '</td><td><span class="status-dot ' + (c.ok ? "online" : "offline") + '"></span></td><td>' + (c.latency ? c.latency + " ms" : "—") + '</td><td><span class="mono">' + (c.code || "—") + "</span></td></tr>";
        }).join("") : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3)">No checks yet</td></tr>';
        setTimeout(function () { window._mChartData = h.daily; drawDetailChart(h.daily); }, 150);
      }).catch(function () {});
    };
    var vi = viewIncident; viewIncident = function (id) { incId = id; vi(id); };

    /* ----- chart periods ----- */
    $("#topbar-period").addEventListener("change", loadStats);
    $("#analytics-period").addEventListener("change", loadAnalytics);
    var nt = navigateTo;
    navigateTo = function (p) { nt(p); if (p === "dashboard") loadStats(); else if (p === "analytics") loadAnalytics(); };

    setInterval(function () { if (!document.hidden) refresh(false); }, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(false); });
    renderDashboard(); updateAllCounts(); renderNotifs(); loadStats();
  }
});
