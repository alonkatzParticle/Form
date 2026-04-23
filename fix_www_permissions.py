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
    if err.strip(): print(f"[stderr] {err.strip()}")
    print(f"[exit {code}]")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)
print("Connected!\n")

# Check current /var/www permissions and deploy's groups
run(client, "ls -la /var/www/", "Current /var/www permissions")
run(client, "groups deploy", "deploy user's groups")

# Set /var/www group to docker, add group-write + setgid
# setgid (2xxx) means new subdirectories inherit the 'docker' group automatically
run(client, "chown root:docker /var/www/", "Set group to docker")
run(client, "chmod 2775 /var/www/", "Set permissions (rwxrwsr-x) + setgid")

# Verify
run(client, "ls -la /var/www/", "New /var/www permissions")

# Test: can deploy now create a directory?
run(client, "sudo -u deploy mkdir -p /var/www/test-project && echo 'SUCCESS' && rmdir /var/www/test-project", "Test deploy can create directories")

client.close()
print("\n✅ Done — deploy user can now create /var/www/* directories without root")
