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
| Live settings | `/var/www/brief-writer/persist/settings.json` (survives deploys, not in git) |
| Health check | `curl https://brief-writer.particle-creative.cloud/api/health` → `{"status":"ok"}` |

> ⚠️ **This server is shared.** It also runs `dam`, `qa`, `slack-summary`, `ppd-board`,
> `particleproductionsio`, the Dropbox automations and others. Only ever touch
> `/var/www/brief-writer` and the `brief-writer-*` containers. Never run `docker compose down`
> or `docker system prune` without checking what it affects.

How it works: the server has a git clone of the GitHub repo. Deploying means the server pulls
the latest `main` and rebuilds the Docker image. There's no automatic deploy. Pushing to
GitHub alone does **not** update the live site.

---

## ⚠️ Read First: Where the Live Settings Live

`settings.json` holds all the form fields, dropdown options, allowed people and product → brand
assignments. The running app edits it by itself (dropdown syncs from Monday, new products and
campaigns typed into the form, the Settings page).

**The live copy is `/var/www/brief-writer/persist/settings.json` on the server**, outside the
Docker image, so deploys never overwrite it. (Set up in `docker-compose.yml` via `SETTINGS_DIR`.)

`server/settings.json` in git is only the **starting copy**: it's used once, the first time the
app starts with an empty `persist/` folder. After that, **changing `server/settings.json` in git
does nothing on the live site.**

To change the live settings (add a person, a field, a dropdown option…):
1. Use the Settings page if it can do it (Edit Form, Products by Brand), **or**
2. Edit the live file on the server, after making a backup:
   ```bash
   cd /var/www/brief-writer/persist
   cp settings.json settings.backup-$(date +%Y%m%d-%H%M).json
   nano settings.json          # changes apply immediately, no restart needed
   ```
3. Then copy it back into git so the repo's copy stays a good backup (step 1 below).

`nameRules.json` (task naming) is different: it's still read from git, so naming changes go
through a normal commit + deploy.

---

## Routine Deployment (Every Time)

### 1. Back up the live settings into git (recommended)

Deploys don't touch the live settings anymore, but keeping git's copy current means a fresh
server (or a lost `persist/` folder) starts from recent settings. From your Mac, in the project folder:

```bash
scp root@76.13.2.74:/var/www/brief-writer/persist/settings.json server/settings.json
git diff --stat server/settings.json     # review, then commit with your other changes
```

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
grep -n "Something you changed" /var/www/brief-writer/persist/settings.json
```

If the app isn't healthy, look at the logs: `docker compose logs --tail 100 app`

### Shortcut: `redeploy.py`

`redeploy.py` (in the project root) does step 3 and the health check for you over SSH:

```bash
python3 redeploy.py
```

It does **not** do step 1 (backing up the live settings), and it rebuilds all containers
instead of just `app`.

---

## Asking Claude Code to Deploy

Claude Code can do the whole process. Ask it to *"deploy to the VPS"*. It will:
back up the live `settings.json` into git, commit, push, pull and rebuild on the server, then
check the health endpoint. It asks for your OK before the production deploy.

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

**I changed `server/settings.json` in git but the live form didn't change**
Expected. The live copy is `persist/settings.json` on the server (see "Where the Live Settings
Live"). Make the change there or on the Settings page.

**Live settings got broken**
Restore a backup from `/var/www/brief-writer/persist/`. If there's none, delete
`persist/settings.json` and restart the app (`docker compose restart app`); it re-seeds from git's copy.

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
