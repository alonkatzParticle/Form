#!/usr/bin/env python3
import paramiko

HOST    = "76.13.2.74"
ROOT    = "root"
ROOT_PW = "o#4LY/B+&w;mKUXyknZs"

def run(client, cmd, desc=""):
    print(f"\n>>> {desc or cmd}")
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"[stderr] {err.strip()[:300]}")
    print(f"[exit {code}]")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)
print("Connected!\n")

# Check what firewall is active
run(client, "ufw status", "UFW status")
run(client, "iptables -L INPUT -n --line-numbers 2>/dev/null | head -20", "iptables INPUT rules")
run(client, "ss -tlnp | grep 5050", "Is port 5050 actually listening?")

client.close()
