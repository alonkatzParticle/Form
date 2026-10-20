# Deployment Guide — Task Creator (Brief Writer)

See `SERVER.md` (local only, not in git) for SSH passwords.
See `DEPLOYMENT_NOTES.md` for the history of problems we hit during the first setup.

---

## The Setup at a Glance

| What | Value |
|---|---|
| Live URL | https://brief-writer.particle-creative.cloud |
| Server | Hostinger VPS `76.13.2.74` |
| Log in as | **`root`** (the `deploy` user can't use sudo and gets git ownership errors) |
| Project folder | `/var/www/brief-writer` |
| Containers | `brief-writer-app-1` (the app), `brief-writer-db-1` (Postgres), `brief-writer-adminer-1` (DB browser) |
| App port | Host `3002` → container `3001` (nginx forwards the domain to 3002) |
| Nginx config | `/etc/nginx/sites-available/brief-writer` |
| Health check | `curl https://brief-writer.particle-creative.cloud/api/health` → `{"status":"ok"}` |

> ⚠️ **This server is shared.** It also runs `dam`, `qa`, `slack-summary`, `ppd-board`,
> `particleproductionsio`, the Dropbox automations and others. Only ever touch
> `/var/www/brief-writer` and the `brief-writer-*` containers. Never run `docker compose down`
> or `docker system prune` without checking what it affects.

How it works: the server has a git clone of the GitHub repo. Deploying means the server pulls
the latest `main` and rebuilds the Docker image. There's no automatic deploy. Pushing to
GitHub alone does **not** update the live site.

---

## ⚠️ Read First: `settings.json` Changes on the Live Server

`server/settings.json` holds all the form fields, dropdown options and allowed people. It gets
built into the Docker image, **and the running app also edits it by itself**:

- When someone types a new option into a "creatable" dropdown (e.g. a new campaign name), it's saved to the file.
- The daily product sync rewrites the product lists from Monday.

Those edits exist **only inside the running container**, not in git. Every deploy replaces the
container with a fresh copy built from git, so **any changes made on the live site get wiped**
unless you copy them into git first.

So: **before every deploy, pull the live `settings.json` and compare it with the one in git.**
(Step 1 below.)

---

## Routine Deployment (Every Time)

### 1. Check for live settings changes

From your Mac, in the project folder:

```bash
ssh root@76.13.2.74 "docker exec brief-writer-app-1 cat /app/server/settings.json" > /tmp/live_settings.json
git show origin/main:server/settings.json | diff - /tmp/live_settings.json
```

- **No output** → nothing changed on the live site. Go to step 2.
- **Differences shown** → those are live edits (new options, product sync). Copy them into your
  local `server/settings.json` **as well as** your own change, so nothing is lost.

If you're changing `settings.json` yourself (adding a person, a dropdown option, etc.), the
safest order is: pull the live file → make your change on top of it → commit.

### 2. Commit and push

```bash
git add <files>
git commit -m "Describe the change"
git push origin main
```

### 3. Pull and rebuild on the server

```bash
ssh root@76.13.2.74
cd /var/www/brief-writer
git pull origin main
docker compose up -d --build app
```

- `app` at the end rebuilds **only the app container**. The database and Adminer keep running.
- The build takes about 1–2 minutes. The site has a few seconds of downtime while the container restarts.
- If `git pull` fails with "dubious ownership", run once:
  `git config --global --add safe.directory /var/www/brief-writer`
- If `git pull` fails because of local changes on the server, someone edited files on the
  server directly. Check what changed (`git diff`). If it's not needed, run
  `git reset --hard origin/main`. Never edit code on the server. The server is deploy-only.

### 4. Check it worked

```bash
curl -s https://brief-writer.particle-creative.cloud/api/health      # → {"status":"ok"}
docker ps --filter name=brief-writer                                   # app should say (healthy)
docker exec brief-writer-app-1 grep -n "Something you changed" /app/server/settings.json
```

If the app isn't healthy, look at the logs: `docker compose logs --tail 100 app`

### Shortcut: `redeploy.py`

`redeploy.py` (in the project root) does step 3 and the health check for you over SSH:

```bash
python3 redeploy.py
```

It does **not** do step 1 (the live settings check), and it rebuilds all containers instead of
just `app`. Always do step 1 by hand first.

---

## Asking Claude Code to Deploy

Claude Code can do the whole process. Ask it to *"deploy to the VPS"*. It will:
pull the live `settings.json`, merge any live changes, commit, push, pull and rebuild on the
server, then check the health endpoint. It asks for your OK before the production deploy.

---

## Useful Commands (run on the server, inside `/var/www/brief-writer`)

| Task | Command |
|---|---|
| Live logs | `docker compose logs -f app` |
| Container status | `docker compose ps` |
| Restart the app without rebuilding | `docker compose restart app` |
| Rebuild from scratch (cache problems) | `docker compose build --no-cache app && docker compose up -d app` |
| Shell inside the app container | `docker compose exec app sh` |
| Which commit is live | `git log -1 --oneline` |
| Database browser (Adminer) | `http://76.13.2.74:5050` (server `db`, user/pass/db in `docker-compose.yml`) |

---

## Troubleshooting

**Changes don't show up after deploying**
- Did you push to GitHub *before* pulling on the server? Compare `git log -1 --oneline` on both.
- `docker compose restart` doesn't pick up code changes. You need `up -d --build`.

**A dropdown option or person disappeared after deploying**
The live `settings.json` wasn't copied into git first (step 1). Re-add it in git and deploy again.

**Build fails with `npm ci` / lock file errors**
`client/package-lock.json` is out of sync. Run `npm install` in `client/` locally, then commit the lock file.

**Container won't start**
`docker compose logs app`. Usually a missing `.env` value. The server's `.env` is at
`/var/www/brief-writer/.env`. It's not in git, so edit it on the server and keep a backup.
`DATABASE_URL` in `.env` is ignored on the VPS; `docker-compose.yml` overrides it to use the local Postgres.

**Site not reachable but container is healthy**
- `systemctl status nginx` and `nginx -t`
- Non-standard ports (like 5050) must also be opened in **Hostinger hPanel → VPS → Firewall**. The server's own firewall isn't what blocks them.

---

## One-Time Server Setup (Already Done, for Reference)

Only needed when moving to a brand-new server. Run as `root`.

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Project
mkdir -p /var/www/brief-writer && chown deploy:deploy /var/www/brief-writer
git clone https://github.com/alonkatzParticle/Form.git /var/www/brief-writer
git config --global --add safe.directory /var/www/brief-writer
cd /var/www/brief-writer
nano .env          # copy the keys from .env.example and fill them in
docker compose up -d --build
```

Nginx (`/etc/nginx/sites-available/brief-writer`):

```nginx
server {
    server_name brief-writer.particle-creative.cloud;
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/brief-writer /etc/nginx/sites-enabled/brief-writer
nginx -t && systemctl reload nginx
certbot --nginx -d brief-writer.particle-creative.cloud   # HTTPS, auto-renews
```

DNS: an **A record** for `brief-writer` pointing to `76.13.2.74`.
