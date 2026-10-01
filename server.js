"use strict";
/* UpTrack backend — zero dependencies, Node 18+.  Run:  node server.js
   Multi-user: signup / login (scrypt + httpOnly session cookie), per-user monitors. */
const http = require("node:http"), fs = require("node:fs"), path = require("node:path"), dns = require("node:dns").promises, net = require("node:net"), crypto = require("node:crypto");

/* optional .env file (KEY=value per line; real environment variables win) */
try { for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2"); } } catch {}

const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || "127.0.0.1", ALLOW_PRIVATE = process.env.ALLOW_PRIVATE === "1";
const DEMO = process.env.DEMO_ACCOUNT !== "0", DEMO_EMAIL = "demo@uptrack.app", TRUST_PROXY = process.env.TRUST_PROXY === "1", SIGNUP = process.env.ALLOW_SIGNUP !== "0", COOKIE_SECURE = process.env.COOKIE_SECURE === "1", MAX_USERS = +process.env.MAX_USERS || 100;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "db.json");
const PUB = process.env.FRONTEND_DIR || path.join(__dirname, "public");
const TIMEOUT = 10000, FAILS = 2, RETRY_MS = 30000, MAX_MONITORS = 10, HIST = 100, DAY = 864e5, HOUR = 36e5, SESSION_MS = 30 * DAY, COOKIE = "uptrack_sid";
const busy = new Set();

/* ---------- storage (JSON file, atomic writes) ---------- */
function blank() { return { nm: 1, ni: 1, nu: 1, users: [], sessions: {}, monitors: [], incidents: [], activity: [] }; }
function mk(uid, name, url, interval, method) {
  return { id: db.nm++, uid, name, url, interval, method, paused: false, status: "online", uptime: 100, latency: 0, httpStatus: 0, totalChecks: 0, upChecks: 0, fails: 0, lastCheckedTs: 0, nextCheck: 0, addedTs: Date.now(), history: [], daily: {} };
}
function seed(uid) { [["Google", "https://google.com"], ["GitHub", "https://github.com"], ["Example", "https://example.com"]].forEach(([n, u]) => db.monitors.push(mk(uid, n, u, 5, "GET"))); }
let db; try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); if (!db.users) db = blank(); } catch { db = blank(); }
let timer;
function ensureDemo() { // shared demo account: random password (nobody can type it), logged in only via POST /api/auth/demo
  if (!DEMO) return;
  let u = db.users.find((x) => x.email === DEMO_EMAIL);
  if (!u) { u = { id: db.nu++, name: "Demo User", email: DEMO_EMAIL, tz: "(GMT+05:30) India Standard Time", createdTs: Date.now(), hourly: {} }; db.users.push(u); }
  u.demo = true; u.role = "Demo"; u.pw = u.pw && u.demoSet ? u.pw : hashPw(crypto.randomBytes(24).toString("hex")); u.demoSet = true;
  if (!u.demoResetTs || Date.now() - u.demoResetTs > 6 * HOUR) { // wipe visitor changes every 6 hours
    db.monitors = db.monitors.filter((x) => x.uid !== u.id); db.incidents = db.incidents.filter((x) => x.uid !== u.id); db.activity = db.activity.filter((x) => x.uid !== u.id);
    u.hourly = {}; u.demoResetTs = Date.now(); seed(u.id);
    for (const k in db.sessions) if (db.sessions[k].uid === u.id) delete db.sessions[k];
  }
  persist();
}
function flush() { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE + ".tmp", JSON.stringify(db)); fs.renameSync(DB_FILE + ".tmp", DB_FILE); }
function persist() { clearTimeout(timer); timer = setTimeout(flush, 500); }
function log(uid, text, color) { db.activity.unshift({ uid, text, color, ts: Date.now() }); if (db.activity.length > 500) db.activity.length = 500; }
function dur(ms) { const m = Math.round(ms / 60000); return m < 1 ? "under 1 min" : m < 60 ? m + " mins" : m < 1440 ? Math.round(m / 60) + " hrs" : Math.round(m / 1440) + " days"; }
const host = (u) => new URL(u).host;

/* ---------- auth helpers ---------- */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function hashPw(pw) { const salt = crypto.randomBytes(16).toString("hex"); return salt + ":" + crypto.scryptSync(pw, salt, 64).toString("hex"); }
function checkPw(pw, stored) { const [salt, h] = stored.split(":"); const a = Buffer.from(h, "hex"), b = crypto.scryptSync(pw, salt, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function cookies(req) { const o = {}; (req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) { const v = c.slice(i + 1).trim(); try { o[c.slice(0, i).trim()] = decodeURIComponent(v); } catch { o[c.slice(0, i).trim()] = v; } } }); return o; }
function userOf(req) {
  const t = cookies(req)[COOKIE]; if (!t) return null;
  const s = db.sessions[sha(t)]; if (!s) return null;
  if (s.exp < Date.now()) { delete db.sessions[sha(t)]; return null; }
  return db.users.find((u) => u.id === s.uid) || null;
}
function setCookie(res, val, maxAge) { res.setHeader("Set-Cookie", COOKIE + "=" + val + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + maxAge + (COOKIE_SECURE ? "; Secure" : "")); }
function device(ua) {
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return o ? b + " on " + o : b;
}
function login(res, u, req) { const t = crypto.randomBytes(32).toString("hex"); db.sessions[sha(t)] = { uid: u.id, exp: Date.now() + SESSION_MS, created: Date.now(), device: device(String(req.headers["user-agent"] || "")) }; setCookie(res, t, SESSION_MS / 1000); persist(); }
const attempts = new Map(); // in-memory brute-force limiter: 10 failed tries / 15 min / IP
const ipOf = (req) => (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress;
function limited(req) { const a = attempts.get(ipOf(req)); return !!a && a.reset > Date.now() && a.n >= 10; }
function strike(req) { const ip = ipOf(req), now = Date.now(), a = attempts.get(ip); if (!a || a.reset < now) attempts.set(ip, { n: 1, reset: now + 9e5 }); else a.n++; }
const pubUser = (u) => ({ demo: !!u.demo, id: u.id, name: u.name, email: u.email, tz: u.tz, role: u.role, plan: "UpTrack Free", createdTs: u.createdTs, accountId: "USR-" + new Date(u.createdTs).getFullYear() + "-" + String(u.id).padStart(5, "0") });

/* ---------- SSRF guard: never probe private/internal addresses ---------- */
function isPrivate(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
  const s = ip.toLowerCase(); return s === "::1" || s === "::" || /^(fc|fd|fe80|::ffff:)/.test(s);
}
async function safeHost(u) {
  if (ALLOW_PRIVATE) return;
  const r = await dns.lookup(new URL(u).hostname, { all: true });
  if (!r.length || r.some((x) => isPrivate(x.address))) throw new Error("Private or internal addresses are not allowed");
}

/* ---------- the actual uptime check ---------- */
async function check(m) {
  if (busy.has(m.id)) return; busy.add(m.id);
  const t0 = Date.now(); let code = 0, ok = false, err = "";
  try {
    await safeHost(m.url);
    const c = new AbortController(), to = setTimeout(() => c.abort(), TIMEOUT);
    try {
      const r = await fetch(m.url, { method: ["HEAD", "POST"].includes(m.method) ? m.method : "GET", redirect: "manual", signal: c.signal, headers: { "user-agent": "UpTrack/1.0" } });
      code = r.status; ok = code < 400; try { await r.body?.cancel(); } catch {}
    } finally { clearTimeout(to); }
  } catch (e) { err = e.name === "AbortError" ? "Timeout" : (e.cause && e.cause.code) || e.message; }
  busy.delete(m.id);
  const usr = db.users.find((u) => u.id === m.uid);
  if (!db.monitors.includes(m) || !usr) return;

  const now = Date.now(), lat = now - t0;
  m.totalChecks++; if (ok) m.upChecks++;
  m.lastCheckedTs = now; m.httpStatus = code; m.latency = ok ? lat : 0;
  m.uptime = +(m.upChecks / m.totalChecks * 100).toFixed(2);
  m.history.unshift({ ts: now, ok, code, latency: m.latency, err }); m.history.length = Math.min(m.history.length, HIST);
  const H = usr.hourly || (usr.hourly = {}), hb = H[Math.floor(now / HOUR)] || (H[Math.floor(now / HOUR)] = { up: 0, total: 0, lat: 0, latN: 0 });
  hb.total++; if (ok) { hb.up++; hb.lat += lat; hb.latN++; }
  const dd = m.daily[Math.floor(now / DAY)] || (m.daily[Math.floor(now / DAY)] = { up: 0, total: 0 });
  dd.total++; if (ok) dd.up++;

  m.fails = ok ? 0 : m.fails + 1;
  if (ok && m.status === "offline") {
    m.status = "online";
    db.incidents.filter((n) => n.monitorId === m.id && n.status === "ongoing").forEach((n) => { n.status = "resolved"; n.endTs = now; n.duration = dur(now - n.ts); });
    log(m.uid, m.name + " is back online", "green");
  } else if (!ok && m.fails >= FAILS && m.status !== "offline") {
    m.status = "offline";
    db.incidents.unshift({ id: db.ni++, uid: m.uid, monitorId: m.id, website: host(m.url), url: m.url, status: "ongoing", ts: now, endTs: null, duration: "", details: "Service is down", issueType: "Service Down", description: (code ? "HTTP " + code : err) + " — " + m.url + " is not responding." });
    log(m.uid, m.name + " went offline (" + (code ? "HTTP " + code : err) + ")", "red");
  }
  m.nextCheck = now + (!ok && m.fails < FAILS ? RETRY_MS : m.interval * 60000);
  persist();
}
let ticks = 0;
function tick() {
  for (const m of db.monitors) if (!m.paused && !busy.has(m.id) && m.nextCheck <= Date.now()) check(m).catch(() => {});
  if (++ticks % 120 === 0) { // prune old data every ~10 min
    const h = Math.floor(Date.now() / HOUR), d = Math.floor(Date.now() / DAY);
    db.users.forEach((u) => { for (const k in u.hourly || {}) if (+k < h - 91 * 24) delete u.hourly[k]; });
    db.monitors.forEach((m) => { for (const k in m.daily) if (+k < d - 35) delete m.daily[k]; });
    for (const k in db.sessions) if (db.sessions[k].exp < Date.now()) delete db.sessions[k];
    ensureDemo();
    for (const [k, v] of attempts) if (v.reset < Date.now()) attempts.delete(k);
  }
}

/* ---------- stats for charts ---------- */
function stats(p, usr) {
  const n = p === "24h" ? 24 : p === "7d" ? 7 : p === "90d" ? 90 : 30, step = p === "24h" ? 1 : 24, now = Math.floor(Date.now() / HOUR), H = usr.hourly || {}, uptime = [], latency = [];
  for (let i = n - 1; i >= 0; i--) {
    let U = 0, T = 0, L = 0, N = 0;
    for (let h = 0; h < step; h++) { const b = H[now - i * step - h]; if (b) { U += b.up; T += b.total; L += b.lat; N += b.latN; } }
    uptime.push(T ? +(U / T * 100).toFixed(2) : null); latency.push(N ? Math.round(L / N) : null);
  }
  return { uptime, latency };
}

/* ---------- API ---------- */
const pub = (m) => ({ id: m.id, name: m.name, url: m.url, interval: m.interval, method: m.method, paused: m.paused, status: m.status, uptime: m.uptime, latency: m.latency, httpStatus: m.httpStatus, totalChecks: m.totalChecks, lastCheckedTs: m.lastCheckedTs, addedTs: m.addedTs });
const pubInc = (n) => ({ id: n.id, website: n.website, url: n.url, status: n.status, ts: n.ts, endTs: n.endTs, duration: n.duration, details: n.details, issueType: n.issueType, description: n.description });
function send(res, code, obj) { res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, res.getHeaders())); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((ok, no) => {
    let s = ""; req.on("data", (c) => { s += c; if (s.length > 1e5) { no(new Error("Body too large")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { no(new Error("Invalid JSON")); } });
  });
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, clean = (s, n) => String(s || "").replace(/[<>&"]/g, "").trim().slice(0, n);

async function auth(req, res, p, m) {
  if (m === "GET" && p === "/api/auth/me") { const u = userOf(req); return u ? send(res, 200, pubUser(u)) : send(res, 401, { error: "Not logged in" }); }
  if (m === "POST" && p === "/api/auth/logout") { const t = cookies(req)[COOKIE]; if (t) { delete db.sessions[sha(t)]; persist(); } setCookie(res, "", 0); return send(res, 200, { ok: true }); }
  if (m === "POST" && p === "/api/auth/signup") {
    if (!SIGNUP) return send(res, 403, { error: "Signups are disabled on this server" });
    if (limited(req)) return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    strike(req);
    const b = await body(req), name = clean(b.name, 60), email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
    if (name.length < 2) return send(res, 400, { error: "Please enter your name" });
    if (!EMAIL.test(email)) return send(res, 400, { error: "Enter a valid email address" });
    if (pw.length < 8 || pw.length > 128) return send(res, 400, { error: "Password must be 8–128 characters" });
    if (db.users.some((x) => x.email === email)) return send(res, 409, { error: "An account with this email already exists" });
    if (db.users.filter((x) => !x.demo).length >= MAX_USERS) return send(res, 403, { error: "User limit reached" });
    const u = { id: db.nu++, name, email, pw: hashPw(pw), tz: "(GMT+05:30) India Standard Time", role: db.users.some((x) => !x.demo) ? "Member" : "Admin", createdTs: Date.now(), hourly: {} };
    db.users.push(u); seed(u.id); log(u.id, "Account created", "green"); login(res, u, req); return send(res, 201, pubUser(u));
  }
  if (m === "POST" && p === "/api/auth/demo") {
    const d = DEMO && db.users.find((x) => x.demo); if (!d) return send(res, 403, { error: "Demo account is disabled on this server" });
    login(res, d, req); return send(res, 200, pubUser(d));
  }
  if (m === "POST" && p === "/api/auth/login") {
    if (limited(req)) return send(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const b = await body(req), u = db.users.find((x) => x.email === String(b.email || "").trim().toLowerCase());
    if (!u || !checkPw(String(b.password || ""), u.pw)) { strike(req); return send(res, 401, { error: "Wrong email or password" }); }
    attempts.delete(ipOf(req)); if (!u.demo) log(u.id, "Signed in from " + device(String(req.headers["user-agent"] || "")), "blue"); login(res, u, req); return send(res, 200, pubUser(u));
  }
  return null;
}

async function api(req, res, u) {
  const m = req.method, p = u.pathname.replace(/\/+$/, ""); let r;
  if (m !== "GET") { // CSRF guard: JSON content-type forces a CORS preflight, and Origin must match
    if (!/application\/json/i.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Content-Type must be application/json" });
    const o = req.headers.origin; if (o) { let same = false; try { same = new URL(o).host === req.headers.host; } catch {} if (!same) return send(res, 403, { error: "Bad origin" }); }
  }
  if (p.startsWith("/api/auth/") && (m !== "PUT" && !/^\/api\/auth\/(password|delete)$/.test(p))) { const x = await auth(req, res, p, m); if (x !== null) return x; }
  const me = userOf(req); if (!me) return send(res, 401, { error: "Please log in" });
  const mine = (x) => x.uid === me.id, find = (id) => db.monitors.find((x) => x.id === id && mine(x));

  const NODEMO = { error: "Not available for the demo account. Create a free account to use this." };
  if (me.demo && ((m === "PUT" && p === "/api/auth/profile") || (m === "POST" && /^\/api\/auth\/(password|delete|sessions\/revoke)$/.test(p)))) return send(res, 403, NODEMO);
  if (m === "GET" && p === "/api/auth/sessions") {
    const keep = sha(cookies(req)[COOKIE]); const list = Object.keys(db.sessions).filter((k) => db.sessions[k].uid === me.id).map((k) => ({ id: k.slice(0, 16), device: db.sessions[k].device || "Browser", created: db.sessions[k].created || 0, current: k === keep })).sort((a, b) => b.created - a.created);
    return send(res, 200, { sessions: list });
  }
  if (m === "POST" && p === "/api/auth/sessions/revoke") {
    const b = await body(req), keep = sha(cookies(req)[COOKIE]); let n = 0;
    for (const k in db.sessions) { if (db.sessions[k].uid !== me.id || k === keep) continue; if (b.id === "others" || k.slice(0, 16) === b.id) { delete db.sessions[k]; n++; } }
    persist(); return send(res, 200, { revoked: n });
  }
  if (m === "PUT" && p === "/api/auth/profile") {
    const b = await body(req), name = clean(b.name, 60); if (name.length < 2) return send(res, 400, { error: "Please enter your name" });
    me.name = name; if (b.tz) me.tz = clean(b.tz, 60); persist(); return send(res, 200, pubUser(me));
  }
  if (m === "POST" && p === "/api/auth/password") {
    const b = await body(req); if (limited(req)) return send(res, 429, { error: "Too many attempts" });
    if (!checkPw(String(b.current || ""), me.pw)) { strike(req); return send(res, 400, { error: "Current password is wrong" }); }
    if (String(b.next || "").length < 8) return send(res, 400, { error: "New password must be at least 8 characters" });
    me.pw = hashPw(String(b.next)); const keep = sha(cookies(req)[COOKIE]);
    for (const k in db.sessions) if (db.sessions[k].uid === me.id && k !== keep) delete db.sessions[k]; // log out other devices
    log(me.id, "Password changed", "blue"); persist(); return send(res, 200, { ok: true });
  }
  if (m === "POST" && p === "/api/auth/delete") {
    const b = await body(req); if (limited(req)) return send(res, 429, { error: "Too many attempts" });
    if (!checkPw(String(b.password || ""), me.pw)) { strike(req); return send(res, 400, { error: "Password is wrong" }); }
    db.users = db.users.filter((x) => x !== me); db.monitors = db.monitors.filter((x) => x.uid !== me.id);
    db.incidents = db.incidents.filter((x) => x.uid !== me.id); db.activity = db.activity.filter((x) => x.uid !== me.id);
    for (const k in db.sessions) if (db.sessions[k].uid === me.id) delete db.sessions[k];
    setCookie(res, "", 0); persist(); return send(res, 200, { ok: true });
  }

  if (m === "GET" && p === "/api/state") return send(res, 200, { monitors: db.monitors.filter(mine).map(pub), incidents: db.incidents.filter(mine).slice(0, 200).map(pubInc), activity: db.activity.filter(mine).slice(0, 60) });
  if (m === "GET" && p === "/api/stats") return send(res, 200, stats(u.searchParams.get("period"), me));
  if (m === "GET" && (r = p.match(/^\/api\/monitors\/(\d+)\/history$/))) {
    const mon = find(+r[1]); if (!mon) return send(res, 404, { error: "Monitor not found" });
    const today = Math.floor(Date.now() / DAY), daily = [];
    for (let i = 6; i >= 0; i--) { const d = mon.daily[today - i]; daily.push(d && d.total ? +(d.up / d.total * 100).toFixed(2) : null); }
    return send(res, 200, { checks: mon.history.slice(0, 10), daily });
  }
  if (m === "POST" && p === "/api/monitors") {
    const b = await body(req), name = clean(b.name, 60); let url;
    if (!name) return send(res, 400, { error: "Name is required" });
    try { url = new URL(/^https?:\/\//i.test(b.url) ? b.url : "https://" + b.url); } catch { return send(res, 400, { error: "Invalid URL" }); }
    if (!/^https?:$/.test(url.protocol) || (!ALLOW_PRIVATE && !url.hostname.includes("."))) return send(res, 400, { error: "Invalid URL" });
    const href = url.href.replace(/\/$/, "");
    const cap = me.demo ? 5 : MAX_MONITORS; if (db.monitors.filter(mine).length >= cap) return send(res, 400, { error: "Plan limit reached (" + cap + " monitors)" });
    if (db.monitors.some((x) => mine(x) && x.url === href)) return send(res, 400, { error: "This URL is already monitored" });
    try { await safeHost(href); } catch (e) { return send(res, 400, { error: e.code === "ENOTFOUND" ? "Domain not found" : e.message }); }
    const mon = mk(me.id, name, href, [1, 5, 15, 30].includes(+b.interval) ? +b.interval : 5, ["GET", "HEAD", "POST"].includes(b.method) ? b.method : "GET");
    db.monitors.push(mon); log(me.id, "New monitor '" + name + "' added", "blue");
    await check(mon); persist(); return send(res, 201, pub(mon));
  }
  if ((r = p.match(/^\/api\/monitors\/(\d+)(?:\/(check|pause))?$/))) {
    const mon = find(+r[1]); if (!mon) return send(res, 404, { error: "Monitor not found" });
    if (m === "DELETE" && !r[2]) {
      db.monitors = db.monitors.filter((x) => x !== mon);
      db.incidents.filter((n) => n.monitorId === mon.id && n.status === "ongoing").forEach((n) => { n.status = "resolved"; n.endTs = Date.now(); n.duration = dur(n.endTs - n.ts); });
      log(me.id, "Monitor '" + mon.name + "' deleted", "red"); persist(); return send(res, 200, { ok: true });
    }
    if (m === "POST" && r[2] === "check") { if (mon.paused) return send(res, 400, { error: "Cannot check — monitor is paused" }); await check(mon); return send(res, 200, pub(mon)); }
    if (m === "POST" && r[2] === "pause") {
      mon.paused = !mon.paused; if (mon.paused) mon.latency = 0; else mon.nextCheck = 0;
      log(me.id, mon.name + (mon.paused ? " paused" : " resumed"), mon.paused ? "orange" : "green"); persist(); return send(res, 200, pub(mon));
    }
  }
  if (m === "POST" && (r = p.match(/^\/api\/incidents\/(\d+)\/resolve$/))) {
    const n = db.incidents.find((x) => x.id === +r[1] && mine(x)); if (!n) return send(res, 404, { error: "Incident not found" });
    if (n.status === "ongoing") { n.status = "resolved"; n.endTs = Date.now(); n.duration = dur(n.endTs - n.ts); log(me.id, "Incident on " + n.website + " resolved", "green"); persist(); }
    return send(res, 200, pubInc(n));
  }
  if (m === "DELETE" && p === "/api/data") { db.monitors = db.monitors.filter((x) => !mine(x)); db.incidents = db.incidents.filter((x) => !mine(x)); db.activity = db.activity.filter((x) => !mine(x)); me.hourly = {}; persist(); return send(res, 200, { ok: true }); }
  if (m === "POST" && p === "/api/reset") { db.monitors = db.monitors.filter((x) => !mine(x)); db.incidents = db.incidents.filter((x) => !mine(x)); me.hourly = {}; seed(me.id); persist(); return send(res, 200, { ok: true }); }
  return send(res, 404, { error: "Not found" });
}

/* ---------- static frontend (/ = landing page when logged out, app when logged in) ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function redirect(res, to) { res.writeHead(302, { Location: to, "Cache-Control": "no-store" }); res.end(); }
function serveStatic(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
  if (p === "/health") return send(res, 200, { ok: true });
  const loggedIn = !!userOf(req);
  if (p === "/dashboard") return redirect(res, loggedIn ? "/dashboard.html" : "/login.html");
  if (p === "/login") return redirect(res, loggedIn ? "/dashboard.html" : "/login.html");
  if (p === "/landing") return redirect(res, "/landing.html");
  if (p === "/index.html") return redirect(res, loggedIn ? "/dashboard.html" : "/");
  if (p === "/" && !loggedIn) p = "/landing.html";                                   // public home page
  else if (p === "/dashboard.html" && !loggedIn) return redirect(res, "/login.html");     // app needs login
  if (p === "/login.html" && loggedIn) return redirect(res, "/dashboard.html");
  let dec; try { dec = decodeURIComponent(p === "/" ? "/dashboard.html" : p); } catch { return send(res, 400, { error: "Bad request" }); }
  const f = path.join(PUB, dec);
  if (!f.startsWith(PUB + path.sep)) return send(res, 403, { error: "Forbidden" });
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(d);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer");
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) await api(req, res, u); else serveStatic(req, res, u.pathname);
  } catch (e) {
    const bad = e.message === "Invalid JSON" || e.message === "Body too large";
    if (!res.headersSent) send(res, bad ? 400 : 500, { error: bad ? e.message : "Server error" });
    if (!bad) console.error(e);
  }
});
ensureDemo();
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
setInterval(tick, 5000); tick();
server.listen(PORT, HOST, () => console.log("UpTrack running at http://" + HOST + ":" + PORT));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { try { flush(); } catch {} process.exit(0); });
