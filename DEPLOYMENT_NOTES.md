# Deployment Notes & Lessons Learned
> VPS: Hostinger — `76.13.2.74` | Project: Task Creator / brief-writer
> Date: April 2026

---

## 1. Hostinger VPS Has a Cloud-Level Firewall (Not OS-Level)

**Issue:** After opening a port in Docker and confirming it was listening (`ss -tlnp`), the port was still unreachable from the browser.

**Root cause:** Hostinger manages firewall rules at the cloud/infrastructure level — separate from UFW or iptables on the server itself. UFW was `inactive` and iptables had no rules, yet port 5050 was still blocked.

**Solution:** Log into **hPanel → VPS → Firewall** and add the port rule there. This must be done for every non-standard port (anything other than 80, 443, 22).

**Ports to open per project:**
| Port | Service |
|------|---------|
| 22 | SSH (usually pre-opened) |
| 80 | HTTP / Nginx |
| 443 | HTTPS (when SSL is added) |
| 5050 | Adminer (DB browser) |
| 3002+ | App container (if directly exposed) |

---

## 2. The `deploy` User Cannot `sudo` and Cannot Write to `/var/www/`

**Issue:** Deployment scripts using the `deploy` user failed to clone repos or create directories under `/var/www/` because:
- `/var/www/` is owned by `root:root`
- `deploy` has no sudo privileges

**Solution:** Always use the **root user** (or a user with sudo) to:
- Create project directories under `/var/www/`
- Write to `/etc/nginx/`
- Run `systemctl` commands

Use `deploy` only for operations inside directories it already owns (e.g. its home directory `~`).

**For future projects — set up the directory as root first:**
```bash
mkdir -p /var/www/my-project
chown deploy:deploy /var/www/my-project
chmod 755 /var/www/my-project
```
Then `deploy` can clone and manage files there.

---

## 3. Git "Dubious Ownership" Error on Server

**Issue:** When SSHing as `root` and running `git pull` on a repo owned by `deploy`, git refused with:
```
fatal: detected dubious ownership in repository at '/var/www/brief-writer'
```

**Root cause:** The directory was owned by `deploy` but git was being run by `root`, so git rejected it as a security measure.

**Solution:** Add the directory as a safe.directory for root:
```bash
git config --global --add safe.directory /var/www/brief-writer
```
Add this to any deployment script before running git commands as root.

---

## 4. Git Pull Failed Due to Local Changes on Server

**Issue:** After manually editing files on the server (happens during debugging), `git pull` refused to run because local changes would be overwritten.

**Solution:** Force-reset to the remote state — **this discards all local server changes:**
```bash
cd /var/www/my-project
git fetch origin
git reset --hard origin/main
```

**Prevention:** Never manually edit project files on the server. Always make changes locally, commit, and push. The server is deploy-only.

---

## 5. `npm ci` Fails When `package-lock.json` Is Out of Sync

**Issue:** Adding a new package (`pg`) to `package.json` locally without running `npm install` meant the `package-lock.json` wasn't updated. Docker's `npm ci` requires the lock file to match exactly:
```
npm error Missing: pg@8.20.0 from lock file
```

**Solutions (pick one):**

**Option A — Run `npm install` locally first** (preferred):
```bash
cd server && npm install
git add package-lock.json && git commit -m "Update lock file"
```

**Option B — Use `npm install` in Dockerfile** (more forgiving):
```diff
- RUN cd server && npm ci --omit=dev
+ RUN cd server && npm install --omit=dev
```
This is less reproducible but handles cases where Node isn't available in the dev environment.

We went with Option B for this project since Node wasn't in the shell PATH on the dev machine during deployment.

---

## 6. `pg_dump` Version Mismatch with Neon

**Issue:** Neon runs Postgres 17, but the Ubuntu server had `pg_dump` version 16 installed. Running `pg_dump` against Neon produced:
```
pg_dump: error: aborting because of server version mismatch
server version: 17.8; pg_dump version: 16.13
```

**Solution:** Use a Docker container of the matching version to run `pg_dump` — no installation needed:
```bash
docker run --rm postgres:17-alpine pg_dump 'postgresql://...' \
  --data-only --table=submitted_tickets --table=cache_entries \
  --no-privileges --no-owner > /tmp/neon_data.sql
```
Always match the `pg_dump` version to the server version.

---

## 7. Neon Uses `@neondatabase/serverless` — Doesn't Work with Local Postgres

**Issue:** The codebase used `@neondatabase/serverless` which communicates over HTTP (not TCP). This driver **only works with Neon**. A local Docker Postgres container requires the standard `pg` (node-postgres) library using TCP.

**Solution:** Rewrote `dbCacheService.js` to auto-detect which driver to use:
```js
const IS_NEON = DATABASE_URL?.includes("neon.tech");

if (IS_NEON) {
  // use @neondatabase/serverless
} else {
  // use pg Pool (standard TCP)
}
```
This makes the codebase portable — same code works on Vercel (Neon) and VPS (local Postgres).

---

## 8. Docker Compose Overrides `DATABASE_URL` for Local DB

**Issue:** The `.env` file had `DATABASE_URL` pointing to Neon (needed for Vercel). But on VPS we want local Postgres.

**Solution:** Override the env var directly in `docker-compose.yml` under the `environment:` key. Docker compose `environment:` values take precedence over `env_file:` values:

```yaml
services:
  app:
    env_file:
      - .env  # has Neon URL — used as fallback/Vercel only
    environment:
      DATABASE_URL: postgresql://appuser:apppass@db:5432/taskdb  # overrides for VPS
```

This way the same `.env` can be used on both Vercel and VPS without modification.

---

## 9. Vercel Cron Jobs Don't Run on VPS

**Issue:** `vercel.json` had a cron job that ran weekly:
```json
{ "path": "/api/admin/refresh-frequency", "schedule": "0 9 * * 6" }
```
This only executes on Vercel's infrastructure — it's completely ignored on VPS.

**Solution:** Replace with a `setInterval` in `server/index.js`:
```js
setInterval(() => {
  refreshAllBoards().catch(...);
}, 7 * 24 * 60 * 60 * 1000); // once per week
```

---

## 10. Existing Project on Server — Port and Directory Conflicts

**Issue:** The server already hosted another project (`particleproductionsio`) using port 3001 internally and nginx on port 8080.

**Solution:**
- Use a **different host port** for the new project (`3002:3001` instead of `3001:3001`)
- Clone into a **different directory** (`/var/www/brief-writer`)
- Add a **separate nginx vhost** for the new domain — never modify the existing one

**Always check before deploying to a shared server:**
```bash
ls /var/www/           # what projects exist
docker ps -a           # what containers are running and which ports they use
docker compose ls      # what compose projects are active
```

---

## 11. GitHub Push Protection — Secrets in Code

**Issue:** Deployment scripts contained API keys hardcoded. GitHub's secret scanning blocked the push:
```
Push cannot contain secrets
— Anthropic API Key — locations: deploy_vps.py:17
```

**Solution:**
- Add all local deployment scripts to `.gitignore` immediately
- Never commit `.env` files or scripts containing real credentials
- Use environment variables or secret managers instead

```bash
echo "deploy_vps.py" >> .gitignore
echo "deploy_root.py" >> .gitignore
git rm --cached deploy_*.py
```

---

## 12. Paramiko (Python SSH) Is the Most Reliable Remote Automation Tool

**Issue:** `expect` scripts (shell scripting with automated SSH) were unreliable with complex commands — multi-line Python code, special characters, and long waits caused the scripts to hang or silently fail.

**Solution:** Use Python's `paramiko` library for all SSH automation:
```bash
pip3 install paramiko
```

```python
import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username="root", password="...", timeout=30)
stdin, stdout, stderr = client.exec_command("docker compose up -d --build")
```

Benefits over `expect`:
- No shell quoting/escaping issues
- Handles long-running commands cleanly
- Can read/write files via SFTP in the same script
- Reliable exit codes

---

## Deployment Checklist for Future Projects

```
Pre-deployment:
[ ] Check existing projects on server (docker ps, ls /var/www)
[ ] Choose a port that's not in use
[ ] Choose a unique directory under /var/www
[ ] Open required ports in hPanel firewall
[ ] Add deployment scripts to .gitignore BEFORE committing

Server setup (run as root):
[ ] git config --global --add safe.directory /var/www/my-project
[ ] mkdir -p /var/www/my-project && chown deploy:deploy /var/www/my-project
[ ] Create .env file on server

Docker:
[ ] New port in docker-compose.yml (not 3001 — already used)
[ ] DATABASE_URL override in docker-compose environment: block
[ ] Use npm install (not npm ci) in Dockerfile, or keep lock file in sync

Nginx:
[ ] Create /etc/nginx/sites-available/my-project (as root)
[ ] ln -sf to sites-enabled
[ ] nginx -t && systemctl reload nginx

Database migration:
[ ] Use Docker to run pg_dump matching the server version
[ ] Import with: docker compose exec -T db psql -U user -d db < dump.sql

Post-deployment:
[ ] curl http://localhost:PORT/api/health
[ ] Check docker ps — all containers healthy
[ ] Verify data: SELECT COUNT(*) FROM submitted_tickets
```
