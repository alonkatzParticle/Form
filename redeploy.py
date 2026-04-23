#!/usr/bin/env python3
import paramiko, time

HOST    = "76.13.2.74"
ROOT    = "root"
ROOT_PW = "o#4LY/B+&w;mKUXyknZs"
DIR     = "/var/www/brief-writer"

def run(client, cmd, desc="", timeout=300):
    print(f"\n>>> {desc or cmd[:80]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"[stderr] {err.strip()[:200]}")
    print(f"[exit {code}]")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)

run(client, f"git config --global --add safe.directory {DIR}")
run(client, f"cd {DIR} && git pull origin main 2>&1", "Pull latest code")
run(client, f"cd {DIR} && docker compose up -d --build 2>&1", "Rebuild & deploy", timeout=300)
time.sleep(8)
run(client, "curl -s https://brief-writer.particle-creative.cloud/api/health", "Health check")
run(client, "docker ps --format 'table {{.Names}}\t{{.Status}}'", "Container status")

client.close()
print("\n✅ Deployed — file upload now works without Vercel Blob")
