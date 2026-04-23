#!/usr/bin/env python3
import paramiko, time

HOST    = "76.13.2.74"
ROOT    = "root"
ROOT_PW = "o#4LY/B+&w;mKUXyknZs"
DIR     = "/var/www/brief-writer"

def run(client, cmd, desc="", timeout=120):
    print(f"\n>>> {desc or cmd[:80]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"[stderr] {err.strip()[:300]}")
    print(f"[exit {code}]")
    return code

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)
print("Connected!\n")

run(client, f"git config --global --add safe.directory {DIR}")
run(client, f"cd {DIR} && git pull origin main 2>&1", "Pull")
run(client, f"cd {DIR} && docker compose up -d adminer 2>&1", "Start Adminer", timeout=60)
time.sleep(5)
run(client, "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'", "Status")
client.close()
print("\n✅ Adminer running at http://76.13.2.74:5050")
