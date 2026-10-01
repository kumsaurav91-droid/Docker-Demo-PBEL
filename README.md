# ⚡ UpTrack — Website Uptime Monitor

<div align="center">

> *"Know the moment your website goes down — before your customers do."*

**A lightweight, self-hosted uptime monitor with multi-user support, smart incident tracking, 90-day analytics, and zero external dependencies.**

[Features](#-features) • [Problem & Solution](#-the-problem-we-solve) • [Quick Start](#-quick-start) • [Tech Stack](#️-tech-stack) • [API Reference](#-api-reference)

---

<img src="https://cdn.corenexis.com/f/sfvGvlNAanR.png" alt="UpTrack Dashboard Preview" width="100%"/>

</div>

---

## 🌐 About the Project

**UpTrack** is a fast, self-hosted uptime monitor built to give you total control of your monitoring data without monthly subscriptions or complex database setups.

- ⏱️ **Continuous Checks**: Monitors sites every 1 to 30 mins with automatic retries.
- 🛡️ **Zero False Alarms**: Smart 2-consecutive failure debouncing.
- 🚀 **Zero Dependencies**: Pure Node.js native standard library — runs instantly.
- 🔒 **Privacy-First**: Multi-tenant isolation, scrypt hashing, and SSRF shielding.

---

## 💡 The Problem We Solve

| The Problem | UpTrack's Solution |
|---|---|
| Finding out about outages from angry customers | **24/7 background health-checks** with immediate status updates |
| False alarms from transient network glitches | **Smart Incident Engine** (triggers only after 2 consecutive failures) |
| No clear log of exact downtime duration | **Automated Incident Logging** with exact downtime duration tracking |
| Expensive SaaS subscriptions with strict limits | **100% Free & Self-Hosted** (10 monitors per account) |
| Complex databases (Postgres, Mongo, Redis) | **Atomic JSON File Storage** (zero configuration needed) |

---

## 🎯 Target Audience

- 👨‍💻 **Developers & Freelancers**: Track all client sites and generate proof of uptime.
- 🏪 **E-Commerce & Business Owners**: Catch store or landing page outages immediately.
- 🎓 **Students & Makers**: Keep portfolios and side projects monitored with zero cost.
- 👥 **Small Teams**: Private individual accounts for team members in one deployment.

---

## ✨ Key Features

<!-- 📸 Feature Showcase / Secondary Screenshot Slot -->
<!-- <img src="docs/features.png" alt="Features Overview" width="100%" onerror="this.style.display='none'"/> -->

- **⏱️ Automated Checks**: Configurable intervals (1, 5, 15, 30 min) via `GET`, `HEAD` or `POST` with 10s timeout.
- **🛡️ Smart Incidents**: Sites go *offline* only after 2 consecutive failures; auto-resolves on first recovery.
- **📊 90-Day Analytics**: Historical uptime % and response latency charts (24h / 7d / 30d / 90d).
- **🔒 Isolated Accounts**: Private dashboards, monitors, and independent active session management.
- **🎨 Glassmorphic UI**: Fast, responsive interface with Dark / Light theme toggle and instant Demo mode.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend** | Node.js 18+ | Zero-dependency server, scheduler & REST API |
| **Frontend** | HTML5, CSS3, JavaScript | Lightweight, fast dashboard with zero build step |
| **Storage** | Atomic JSON Flat-File Engine | Self-contained, portable, zero-config persistence |
| **Security** | Node `crypto` | Password hashing & session protection |
| **Deployment** | Docker & Docker Compose | 1-command Alpine container deploy with volumes |

---

## 📁 Project Structure

```text
uptrack/
├── 📂 public/                   # Static Frontend
│   ├── landing.html            # Landing page 
│   ├── login.html              # Authentication portal (Login, Signup, Demo)
│   ├── dashboard.html          # Core monitoring dashboard
│   ├── 📂 css/                 # style.css · landing.css · auth.css
│   └── 📂 js/                  # script.js · api.js · auth.js · enhance.js · login.js
│
├── 📂 data/                     # Persistent JSON Database
│   └── .gitkeep                # db.json is created automatically on first run
│
├── server.js                   # Unified Server (Auth, Uptime Scheduler, API)
├── Dockerfile                  # Production Alpine container
├── docker-compose.yml          # Container orchestration with healthchecks & volumes
├── .env        
├── package.json               
├── .gitignore                  
└── README.md                   
```

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/kumsaurav91-droid/Docker-Demo-PBEL.git
cd uptrack
```

---


### 2. Running with Docker Compose (Recommended)
One single command builds the lightweight image and starts the monitor with persistent data storage:

```bash
# Start container
docker compose up -d --build
```

- Follow logs: `docker compose logs -f`
- Stop container: `docker compose down`


---

### 3️. Running Directly with Node.js (No Docker)

Because UpTrack has **ZERO npm dependencies**, you don't even need to run `npm install`!

```bash
# Start the server
node server.js
```

Open **`http://localhost:3000`** (or `http://127.0.0.1:3000`) in your browser.

---

### 4️. Initial Setup & First Account

1. Visit `http://localhost:3000` and click **"Create free account"** (or use the instant **"Log in with Demo Account"** button).
2. The **first registered account** automatically receives full administrative privileges.
3. Every new account is pre-populated with 3 sample monitors so your dashboard is ready right away.

---
## 🔐 Environment Variables

`.env` (used when running with `node server.js`), or define variables under `environment:` in `docker-compose.yml` (used with Docker):

```ini
# ─────────────────────────────────────────────────────────────
# UpTrack — Environment Configuration
# ─────────────────────────────────────────────────────────────

# Server Port & Binding Host
PORT=3000
HOST=127.0.0.1

# Registration Controls
ALLOW_SIGNUP=1      # Set to 0 to disable public signups after creating your admin account
DEMO_ACCOUNT=1      # Set to 0 to remove the demo user and login button
MAX_USERS=100       # Maximum allowed registered user accounts

# Production & Proxy Settings
COOKIE_SECURE=0     # Set to 1 when serving over HTTPS (SSL/TLS)
TRUST_PROXY=0       # Set to 1 behind reverse proxies (Nginx / Caddy) for accurate client IP tracking
ALLOW_PRIVATE=0     # Set to 1 if you want to monitor localhost / private internal subnets

# Data Storage Path
DB_FILE=data/db.json
```

> Real environment variables always win over values in `.env`.

---

## 📡 API Summary

All write requests require `Content-Type: application/json`.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/signup` · `/login` · `/demo` | User registration / login / demo access |
| `POST` | `/api/auth/logout` · `/password` | End session · Update password |
| `GET` | `/api/auth/me` · `/sessions` | Profile info · Active device sessions |
| `POST` | `/api/auth/sessions/revoke` | Revoke a device session |
| `GET` | `/api/state` | Monitors, active incidents & activity log |
| `GET` | `/api/stats?period=24h\|7d\|30d\|90d` | Performance & response latency charts |
| `POST` | `/api/monitors` | Add a new monitor `{name, url, interval, method}` |
| `POST` | `/api/monitors/:id/check` · `/pause` | Trigger manual check · Pause / resume |
| `DELETE`| `/api/monitors/:id` | Delete monitor & history |
| `POST` | `/api/incidents/:id/resolve` | Resolve an active incident |
| `PUT` | `/api/auth/profile` | Update name / timezone |
| `POST` | `/api/auth/delete` | Delete own account |
| `DELETE`| `/api/data` · `POST` `/api/reset` | Clear monitoring data · Restore starter monitors |
| `GET` | `/health` | System health check (200 OK) |

---

## 🗺️ Roadmap

- [ ] 🔔 **Telegram, Discord & Webhook alerts**
- [ ] 📧 **Email (SMTP) outage alerts**
- [ ] 🌐 **Public shareable status pages**
- [ ] 🔒 **SSL certificate expiry tracking**
- [ ] 🔍 **Keyword / response body assertions**
- [ ] 🔑 **Two-Factor Authentication (2FA)**

---

<div align="center">

### **Built with ❤️ by Saurav Kumar**

[![GitHub](https://img.shields.io/badge/GitHub-Saurav%20Kumar-181717?style=flat-square&logo=github)](https://github.com/kumsaurav91-droid)

⭐ **Star this repo if UpTrack helps you keep your sites online!** ⭐

</div>
