#!/usr/bin/env python3
"""Install Certbot and get SSL cert for brief-writer.particle-creative.cloud"""

import paramiko, time

HOST    = "76.13.2.74"
ROOT    = "root"
ROOT_PW = "o#4LY/B+&w;mKUXyknZs"
DOMAIN  = "brief-writer.particle-creative.cloud"

def run(client, cmd, desc="", timeout=120):
    print(f"\n>>> {desc or cmd[:80]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"[stderr] {err.strip()[:400]}")
    print(f"[exit {code}]")
    return code

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)
print("Connected as root!\n")

# 1. Install certbot + nginx plugin
run(client,
    "apt-get install -y certbot python3-certbot-nginx 2>&1 | tail -5",
    "Install Certbot", timeout=120)

# 2. Get certificate (non-interactive, auto nginx config)
run(client,
    f"certbot --nginx -d {DOMAIN} --non-interactive --agree-tos --email admin@particle-creative.cloud --redirect 2>&1",
    "Get SSL certificate & configure nginx", timeout=120)

# 3. Verify nginx config
run(client, "nginx -t", "Verify nginx config")

# 4. Check cert expiry
run(client, f"certbot certificates 2>&1 | grep -A5 '{DOMAIN}'", "Certificate details")

# 5. Test HTTPS
time.sleep(3)
run(client, f"curl -s https://{DOMAIN}/api/health", "HTTPS health check")

client.close()
print(f"\n✅ HTTPS live at https://{DOMAIN}")
print("   Auto-renews every 90 days via certbot's built-in cron/systemd timer")
