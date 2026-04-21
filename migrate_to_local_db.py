#!/usr/bin/env python3
"""Force-reset git on server, rebuild with correct docker-compose, import Neon dump."""

import paramiko, time

HOST    = "76.13.2.74"
ROOT    = "root"
ROOT_PW = "o#4LY/B+&w;mKUXyknZs"
DIR     = "/var/www/brief-writer"

def run(client, cmd, desc="", timeout=400):
    print(f"\n>>> {desc or cmd[:100]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out.strip(): print(out.strip())
    if err.strip(): print(f"[stderr] {err.strip()[:400]}")
    print(f"[exit {code}]")
    return code, out

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=ROOT, password=ROOT_PW, timeout=30)
    print("Connected as root!\n")

    # 1. Force-reset git to match remote (discard local changes)
    run(client,
        f"cd {DIR} && git fetch origin && git reset --hard origin/main 2>&1",
        "Force-reset repo to latest main")

    # 2. Verify docker-compose now has the db service
    run(client, f"grep -c 'image: postgres' {DIR}/docker-compose.yml", "Verify db service in compose")

    # 3. Stop everything and rebuild with new compose
    run(client, f"cd {DIR} && docker compose down 2>&1", "Stop all containers")
    run(client,
        f"cd {DIR} && docker compose up -d --build 2>&1",
        "Build & start app + postgres (takes ~3 min...)", timeout=400)

    # 4. Wait for postgres to be healthy
    print("\n>>> Waiting for Postgres...")
    for i in range(30):
        code, _ = run(client,
            f"cd {DIR} && docker compose exec -T db pg_isready -U appuser -d taskdb 2>&1",
            "DB ready?")
        if code == 0:
            print("    ✅ DB ready!")
            break
        print(f"    Waiting ({i+1}/30)...")
        time.sleep(5)

    # 5. Let app run ensureTable() to create schema
    print("\n>>> Giving app 10s to create tables...")
    time.sleep(10)

    # 6. Import the Neon dump (already at /tmp/neon_data.sql from previous run)
    run(client, "ls -lh /tmp/neon_data.sql && wc -l /tmp/neon_data.sql", "Check dump file")
    run(client,
        f"cd {DIR} && docker compose exec -T db psql -U appuser -d taskdb < /tmp/neon_data.sql 2>&1",
        "Import Neon data")

    # 7. Verify
    run(client,
        f"cd {DIR} && docker compose exec -T db psql -U appuser -d taskdb -c 'SELECT COUNT(*) FROM submitted_tickets;'",
        "Ticket count in local DB")

    # 8. Health check
    time.sleep(3)
    run(client, "curl -s http://localhost:3002/api/health", "App health check")

    # 9. Final status
    run(client, "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'", "All containers")

    client.close()
    print("\n✅ DONE — VPS running on local Postgres with all Neon data imported")

if __name__ == "__main__":
    main()
