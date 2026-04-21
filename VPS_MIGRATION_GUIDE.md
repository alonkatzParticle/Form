# VPS Deployment Runbook
### Migrating a Vercel + Neon Project to a Self-Hosted VPS

> **Server:** Hostinger VPS (Ubuntu 24.04) | **Tools:** Docker, Nginx, Paramiko
> Use this guide as a step-by-step runbook for any project currently on Vercel with a Neon Postgres database.

---

## Overview

```
BEFORE:  Browser → Vercel (host) → Neon Postgres (DB)
AFTER:   Browser → VPS + Nginx (host) → Local Postgres in Docker (DB)
```

All your API keys, third-party services, and app logic stay the same. Only the host and database location change.

---

## Part 1 — Pre-Flight Checks

### 1.1 Check What's Already on the Server

Before touching anything, SSH in and audit:

```bash
# What projects already exist?
ls -la /var/www/

# What Docker containers are running and on which ports?
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# What Docker Compose projects are active?
docker compose ls
```

**Write down every port already in use.** You must pick a unique port for your new project.

### 1.2 Choose Your Project Setup

Decide before you start:

| Decision | Notes |
|---|---|
| **Deploy directory** | e.g. `/var/www/my-project` |
| **App port** | e.g. `3003:3001` (pick one not in use) |
| **Domain** | e.g. `my-project.yourdomain.com` |
| **DB credentials** | Pick a user/password/dbname for local Postgres |

### 1.3 Open Ports in Hostinger hPanel

> ⚠️ **Hostinger uses a cloud-level firewall — not UFW or iptables.** You MUST open ports in hPanel or they will be blocked even if the container is running.

Go to: **hPanel → VPS → Firewall** and add rules for:
- Port `80` — HTTP
- Port `443` — HTTPS (when you add SSL later)
- Port `5050` — Adminer (optional, DB browser)
- Your app port (e.g. `3003`) — only if you want direct access

---

## Part 2 — Code Changes Required

Make these changes in your project **before** deploying. Commit and push everything.

### 2.1 Update `docker-compose.yml`

Replace any existing `docker-compose.yml` with this template:

```yaml
services:
  app:
    build: .
    ports:
      - "3003:3001"         # change 3003 to your chosen host port
    env_file:
      - .env                # loads your existing env (e.g. Neon DATABASE_URL for Vercel)
    environment:
      # This overrides DATABASE_URL from .env — points to local Postgres on VPS
      DATABASE_URL: postgresql://appuser:apppass@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  db:
    image: postgres:16-alpine        # match your Neon version if possible
    environment:
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: apppass
      POSTGRES_DB: mydb
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "appuser", "-d", "mydb"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  adminer:
    image: adminer:latest
    ports:
      - "5050:8080"
    restart: unless-stopped
    depends_on:
      - db

volumes:
  pgdata:
```

### 2.2 Update Your Database Client

If your project uses `@neondatabase/serverless`, it **won't work with local Postgres** — Neon's driver uses HTTP, not TCP. Add the standard `pg` library and auto-detect which to use:

**Install:**
```bash
cd server && npm install pg
git add package-lock.json package.json && git commit -m "Add pg for local Postgres"
```

**Update your DB file:**
```js
// db.js — works with both Neon and local Postgres
const DATABASE_URL = process.env.DATABASE_URL;
const IS_NEON = DATABASE_URL?.includes("neon.tech");

let _pool = null;
let _sql  = null;

export async function query(text, params = []) {
  if (!DATABASE_URL) return null;

  if (IS_NEON) {
    if (!_sql) {
      const { neon } = await import("@neondatabase/serverless");
      _sql = neon(DATABASE_URL);
    }
    return _sql(text, params);
  } else {
    if (!_pool) {
      const { Pool } = await import("pg");
      _pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: false,
        max: 10,
      });
    }
    const result = await _pool.query(text, params);
    return result.rows;
  }
}
```

> **Why this works:** The `environment:` block in `docker-compose.yml` overrides the `DATABASE_URL` from `.env`. On VPS it points to `db` (local container). On Vercel it's the Neon URL — so both work from the same codebase.

### 2.3 Fix the Dockerfile — Use `npm install` Instead of `npm ci`

If your Dockerfile uses `npm ci` for the server, change it to `npm install`. This avoids build failures when you add new packages but haven't updated the lock file:

```diff
- RUN cd server && npm ci --omit=dev
+ RUN cd server && npm install --omit=dev
```

> **Note:** `npm ci` requires the lock file to be perfectly in sync. `npm install` is more forgiving. Restore `npm ci` later if you want reproducible builds — just make sure `package-lock.json` is always committed.

### 2.4 Move Any Vercel Cron Jobs to `setInterval`

If your `vercel.json` has cron jobs, they won't run on VPS. Move them to `server/index.js`:

```js
// Replace vercel.json crons with setIntervals
setInterval(() => {
  myScheduledJob().catch(err => console.warn("[cron] failed:", err.message));
}, 7 * 24 * 60 * 60 * 1000); // weekly
```

### 2.5 Add Deployment Scripts to `.gitignore`

Any script you write containing server passwords or API keys must never be committed:

```bash
echo "deploy.py" >> .gitignore
echo "migrate.py" >> .gitignore
echo "*.local.py" >> .gitignore
```

---

## Part 3 — Server Setup (Run Once Per Project)

### 3.1 Create the Project Directory

SSH in as **root** and create the directory with correct ownership:

```bash
mkdir -p /var/www/my-project
chown deploy:deploy /var/www/my-project
chmod 755 /var/www/my-project
```

> The `deploy` user has no sudo. Always create `/var/www/` subdirectories as root first.

### 3.2 Clone the Repo

Switch to the deploy user (or stay as root and set safe directory):

```bash
git config --global --add safe.directory /var/www/my-project
git clone https://github.com/yourorg/your-repo.git /var/www/my-project
```

### 3.3 Create the `.env` File on the Server

Copy your environment variables from Vercel (Dashboard → Settings → Environment Variables). Create the `.env` at the project root on the server:

```bash
nano /var/www/my-project/.env
```

Paste all variables. The `DATABASE_URL` can be the Neon one — it will be overridden by docker-compose anyway. But include it in case you ever run the app outside Docker.

```env
MONDAY_API_KEY=...
ANTHROPIC_API_KEY=...
DATABASE_URL=postgresql://neondb_owner:...@neon.tech/neondb?sslmode=require
# etc.
```

---

## Part 4 — Build and Start

```bash
cd /var/www/my-project
docker compose up -d --build
```

This will:
1. Build the Docker image (takes 2–5 min first time)
2. Pull `postgres:16-alpine` and `adminer` images
3. Start all three containers
4. Wait for Postgres to be healthy before starting the app

**Verify:**
```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl http://localhost:3003/api/health
```

---

## Part 5 — Migrate Neon Data to Local Postgres

### 5.1 Dump Data from Neon

Use a Docker container matching your Neon server version (Neon is usually Postgres 16 or 17). This avoids version mismatch errors with locally installed `pg_dump`:

```bash
# Find your Neon version — check Neon dashboard or the error message if pg_dump fails
# Replace 'postgres:17-alpine' if needed

NEON_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

docker run --rm postgres:17-alpine pg_dump "$NEON_URL" \
  --data-only \
  --no-privileges \
  --no-owner \
  > /tmp/neon_data.sql

echo "Dump complete: $(wc -l < /tmp/neon_data.sql) lines"
```

> **`--data-only`** skips schema creation — your app's `ensureTable()` / migrations will create the tables. If your app doesn't auto-create tables, remove `--data-only` and use a full dump instead.

### 5.2 Wait for App to Create Tables

The app runs `ensureTable()` on startup. Give it 10–15 seconds after first boot:

```bash
sleep 15
docker compose exec db psql -U appuser -d mydb -c "\dt"
# Should show your tables
```

### 5.3 Import the Dump

```bash
cd /var/www/my-project
docker compose exec -T db psql -U appuser -d mydb < /tmp/neon_data.sql
```

### 5.4 Verify

```bash
# Check row counts match Neon
docker compose exec db psql -U appuser -d mydb -c "SELECT COUNT(*) FROM your_main_table;"
```

---

## Part 6 — Nginx Setup

### 6.1 Create the Vhost Config (as root)

```bash
cat > /etc/nginx/sites-available/my-project << 'EOF'
server {
    listen 80;
    server_name my-project.yourdomain.com;
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF
```

### 6.2 Enable and Reload

```bash
ln -sf /etc/nginx/sites-available/my-project /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Part 7 — DNS Cutover

1. Log into your DNS provider
2. Point your domain's **A record** to the VPS IP (e.g. `76.13.2.74`)
3. TTL changes take 1–60 minutes to propagate
4. Test: `curl http://my-project.yourdomain.com/api/health`

---

## Part 8 — Adminer (DB Browser)

Access your database in the browser at: `http://YOUR_SERVER_IP:5050`

> Remember: open port `5050` in **hPanel → Firewall** first, otherwise you'll get "connection refused".

Login:
| Field | Value |
|---|---|
| System | PostgreSQL |
| Server | `db` |
| Username | `appuser` |
| Password | `apppass` |
| Database | `mydb` |

---

## Part 9 — Shutdown Neon (Final Step)

Only do this after you've confirmed:
- [ ] DNS is pointing to VPS
- [ ] All users are on the new URL
- [ ] Vercel project is disabled or deleted
- [ ] Local Postgres has all the data (`SELECT COUNT(*)`)
- [ ] No more writes going to Neon

Then delete the Neon project from the Neon dashboard.

---

## Part 10 — Routine Deployment (After First Setup)

Every time you push new code:

```bash
# On the server
cd /var/www/my-project
git pull origin main
docker compose up -d --build
```

Or automate it from your local machine using the Paramiko pattern:

```python
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("YOUR_VPS_IP", username="root", password="YOUR_ROOT_PW", timeout=30)

for cmd in [
    "cd /var/www/my-project && git pull origin main",
    "cd /var/www/my-project && docker compose up -d --build",
]:
    _, stdout, _ = client.exec_command(cmd)
    print(stdout.read().decode())

client.close()
```

---

## Quick Reference

| Task | Command |
|---|---|
| Check all containers | `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'` |
| View app logs | `cd /var/www/my-project && docker compose logs -f app` |
| Restart app only | `docker compose restart app` |
| Full rebuild | `docker compose up -d --build` |
| Stop everything | `docker compose down` |
| Open DB shell | `docker compose exec db psql -U appuser -d mydb` |
| Check nginx | `nginx -t && systemctl reload nginx` |
| Force git reset | `git fetch origin && git reset --hard origin/main` |

---

## Common Errors & Fixes

| Error | Fix |
|---|---|
| `Connection refused` on a port | Open port in **hPanel → Firewall** (not UFW) |
| `fatal: detected dubious ownership` | `git config --global --add safe.directory /path` |
| `npm ci` fails — missing packages | Change to `npm install` in Dockerfile OR commit `package-lock.json` |
| `pg_dump version mismatch` | Use `docker run postgres:17-alpine pg_dump ...` |
| `git pull` fails — local changes | `git reset --hard origin/main` |
| `service "db" is not running` | Old `docker-compose.yml` without `db:` service — check git pull succeeded |
| GitHub push blocked — secrets | Add scripts with credentials to `.gitignore` before committing |
