// dbCacheService.js — Universal Postgres wrapper.
// Supports:
//   • Local Postgres (Docker container) via pg Pool — used on VPS
//   • Neon serverless Postgres via @neondatabase/serverless — used on Vercel
//   • File-based fallback (tickets.json) — used when DATABASE_URL is not set
//
// Detection: if DATABASE_URL contains "neon.tech" → Neon driver
//            otherwise → standard pg Pool (works with local Docker postgres)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─── File-based fallback ──────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");

function readTicketsFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(TICKETS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TICKETS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeTicketsFile(tickets) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
  } catch (err) {
    console.warn("[db] writeTicketsFile failed:", err.message);
  }
}

// ─── DB driver detection ──────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL;
const IS_NEON = DATABASE_URL?.includes("neon.tech");

let _pool = null;    // pg Pool  (local postgres)
let _sql  = null;    // neon()   (neon serverless)

async function query(text, params = []) {
  if (!DATABASE_URL) return null;

  if (IS_NEON) {
    // Lazy-load Neon driver (only available in prod where package is installed)
    if (!_sql) {
      const { neon } = await import("@neondatabase/serverless");
      _sql = neon(DATABASE_URL);
    }
    // Neon tagged-template driver — convert to tagged template call
    return _sql(text, params);
  } else {
    // Standard pg Pool for local Docker Postgres
    if (!_pool) {
      const pg = await import("pg");
      const { Pool } = pg.default ?? pg;
      _pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      _pool.on("error", (err) => console.warn("[db] pool error:", err.message));
    }
    const result = await _pool.query(text, params);
    return result.rows;
  }
}

// ─── Schema setup ─────────────────────────────────────────────────────────────
export async function ensureTable() {
  if (!DATABASE_URL) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS submitted_tickets (
        id           TEXT PRIMARY KEY,
        data         JSONB NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.warn("[db] ensureTable failed:", err.message);
  }
}

// ─── Cache entries ────────────────────────────────────────────────────────────
export async function getCacheEntry(key) {
  if (!DATABASE_URL) return null;
  try {
    const rows = await query(
      "SELECT value, updated_at FROM cache_entries WHERE key = $1",
      [key]
    );
    if (!rows?.length) return null;
    return { value: rows[0].value, updatedAt: new Date(rows[0].updated_at) };
  } catch (err) {
    console.warn(`[db] getCacheEntry(${key}) failed:`, err.message);
    return null;
  }
}

export async function isCacheFresh(key) {
  const entry = await getCacheEntry(key);
  if (!entry) return false;
  return Date.now() - entry.updatedAt.getTime() < SEVEN_DAYS_MS;
}

export async function setCacheEntry(key, value) {
  if (!DATABASE_URL) return;
  try {
    await query(
      `INSERT INTO cache_entries (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  } catch (err) {
    console.warn(`[db] setCacheEntry(${key}) failed:`, err.message);
  }
}

export function isDbAvailable() {
  return !!DATABASE_URL;
}

// ─── Submitted Tickets ────────────────────────────────────────────────────────
export async function getTickets() {
  if (!DATABASE_URL) {
    const tickets = readTicketsFile();
    return tickets.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)).slice(0, 200);
  }
  try {
    const rows = await query(
      "SELECT data FROM submitted_tickets ORDER BY submitted_at DESC LIMIT 200"
    );
    return (rows ?? []).map(r => r.data);
  } catch (err) {
    console.warn("[db] getTickets failed:", err.message);
    return [];
  }
}

export async function addTicket(ticket) {
  if (!DATABASE_URL) {
    const tickets = readTicketsFile().filter(t => t.id !== ticket.id);
    tickets.unshift(ticket);
    writeTicketsFile(tickets.slice(0, 500));
    return;
  }
  try {
    await query(
      `INSERT INTO submitted_tickets (id, data, submitted_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [
        ticket.id,
        JSON.stringify(ticket),
        ticket.submittedAt ? new Date(ticket.submittedAt) : new Date(),
      ]
    );
  } catch (err) {
    console.warn("[db] addTicket failed:", err.message);
  }
}

export async function removeTicket(id) {
  if (!DATABASE_URL) {
    writeTicketsFile(readTicketsFile().filter(t => t.id !== id));
    return;
  }
  try {
    await query("DELETE FROM submitted_tickets WHERE id = $1", [id]);
  } catch (err) {
    console.warn("[db] removeTicket failed:", err.message);
  }
}
