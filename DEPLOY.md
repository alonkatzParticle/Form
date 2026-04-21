# Deployment Guide — Task Creator (Brief Writer)

See `SERVER.md` for SSH credentials and server info.

---

## One-Time Server Setup

> Run these steps once when setting up a new server.

### 1. SSH into the server

```bash
ssh deploy@76.13.2.74
```

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker deploy   # allow deploy user to run docker without sudo
newgrp docker                     # apply group change immediately
```

Verify Docker works:

```bash
docker --version
docker compose version
```

### 3. Clone the repository

```bash
cd /var/www
git clone https://github.com/alonkatzParticle/Form.git task-creator
cd task-creator
```

### 4. Create the `.env` file

```bash
nano .env
```

Paste and fill in all values:

```env
MONDAY_API_KEY=
MONDAY_BOARD_ID_VIDEO=
MONDAY_BOARD_ID_DESIGN=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
GEMINI_API_KEY=
PORT=3001
SETTINGS_PASSWORD=
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
```

> ⚠️ Never commit `.env` to git. It is already in `.gitignore`.

### 5. Build and start the container

```bash
docker compose up -d --build
```

### 6. Verify the app is running

```bash
docker compose ps
curl http://localhost:3001/api/health
```

You should see `{"ok":true}` or similar.

---

## Set Up Nginx (Reverse Proxy)

Routes traffic from port 80 (HTTP) to the Docker container on port 3001.

### 1. Install Nginx

```bash
sudo apt install nginx -y
```

### 2. Create the site config

```bash
sudo nano /etc/nginx/sites-available/task-creator
```

Paste:

```nginx
server {
    listen 80;
    server_name brief-writer.particle-creative.cloud;

    # Allow large file uploads (videos, assets)
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

### 3. Enable the site and reload Nginx

```bash
sudo ln -s /etc/nginx/sites-available/task-creator /etc/nginx/sites-enabled/
sudo nginx -t          # test config — must say "ok"
sudo systemctl reload nginx
```

### 4. Point the DNS

In your DNS provider, set an **A record**:

| Name | Type | Value |
|---|---|---|
| `brief-writer` | A | `76.13.2.74` |

DNS propagation can take a few minutes.

### 5. (Optional) HTTPS with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d brief-writer.particle-creative.cloud
```

Certbot auto-renews the certificate. After this the site will be accessible at `https://`.

---

## Routine Deployments

> Run these every time you push new changes to `main`.

```bash
ssh deploy@76.13.2.74
cd /var/www/task-creator
git pull origin main
docker compose up -d --build
```

Build takes ~2 minutes. The old container stays live until the new one is ready.

---

## Useful Commands

| Task | Command |
|---|---|
| View live logs | `docker compose logs -f` |
| Restart container | `docker compose restart` |
| Stop container | `docker compose down` |
| Check container status | `docker compose ps` |
| Rebuild without cache | `docker compose build --no-cache && docker compose up -d` |
| Open a shell inside container | `docker compose exec app sh` |

---

## Troubleshooting

**Container won't start**
```bash
docker compose logs app
```
Usually a missing `.env` variable or a port conflict.

**Site not reachable after DNS change**
- Check DNS has propagated: `nslookup brief-writer.particle-creative.cloud`
- Check Nginx is running: `sudo systemctl status nginx`
- Check container is up: `docker compose ps`

**Changes not showing after deploy**
Make sure you ran `docker compose up -d --build` (not just `restart`). The `--build` flag is required to pick up code changes.
