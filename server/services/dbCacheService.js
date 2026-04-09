// dbCacheService.js — Neon Postgres wrapper for persistent caching.
// When DATABASE_URL is set (Vercel + Neon): uses Postgres.
// Otherwise: falls back to a local JSON file so all users share the same history.

import { neon } from "@neondatabase/serverless";
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

// ─── Neon DB ──────────────────────────────────────────────────────────────────
let _sql = null;
function getDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_DATABASE_URL;
  if (!url) return null;
  if (!_sql) _sql = neon(url);
  return _sql;
}

export async function ensureTable() {
  const sql = getDb();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS cache_entries (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Shared past-tickets history visible to all users
  await sql`
    CREATE TABLE IF NOT EXISTS submitted_tickets (
      id           TEXT PRIMARY KEY,
      data         JSONB NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// Returns { value, updatedAt } if the entry exists, otherwise null.
export async function getCacheEntry(key) {
  const sql = getDb();
  if (!sql) return null;
  try {
    const rows = await sql`
      SELECT value, updated_at FROM cache_entries WHERE key = ${key}
    `;
    if (!rows.length) return null;
    return { value: rows[0].value, updatedAt: new Date(rows[0].updated_at) };
  } catch (err) {
    console.warn(`[db] getCacheEntry(${key}) failed:`, err.message);
    return null;
  }
}

// Returns true if a valid (non-stale) entry exists, false otherwise.
export async function isCacheFresh(key) {
  const entry = await getCacheEntry(key);
  if (!entry) return false;
  return Date.now() - entry.updatedAt.getTime() < SEVEN_DAYS_MS;
}

// Upsert a cache entry.
export async function setCacheEntry(key, value) {
  const sql = getDb();
  if (!sql) return;
  try {
    await sql`
      INSERT INTO cache_entries (key, value, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
    `;
  } catch (err) {
    console.warn(`[db] setCacheEntry(${key}) failed:`, err.message);
  }
}

export function isDbAvailable() {
  return !!process.env.DATABASE_URL;
}

// ─── Submitted Tickets (shared across all users) ──────────────────────────────

export async function getTickets() {
  const sql = getDb();
  if (!sql) {
    // File-based fallback: return all tickets sorted newest first
    const tickets = readTicketsFile();
    return tickets.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)).slice(0, 200);
  }
  try {
    const rows = await sql`
      SELECT data FROM submitted_tickets
      ORDER BY submitted_at DESC
      LIMIT 200
    `;
    return rows.map(r => r.data);
  } catch (err) {
    console.warn("[db] getTickets failed:", err.message);
    return [];
  }
}

export async function addTicket(ticket) {
  const sql = getDb();
  if (!sql) {
    // File-based fallback: upsert by id
    const tickets = readTicketsFile().filter(t => t.id !== ticket.id);
    tickets.unshift(ticket);
    writeTicketsFile(tickets.slice(0, 500)); // cap at 500
    return;
  }
  try {
    await sql`
      INSERT INTO submitted_tickets (id, data, submitted_at)
      VALUES (
        ${ticket.id},
        ${JSON.stringify(ticket)},
        ${ticket.submittedAt ? new Date(ticket.submittedAt) : new Date()}
      )
      ON CONFLICT (id) DO UPDATE
        SET data = EXCLUDED.data
    `;
  } catch (err) {
    console.warn("[db] addTicket failed:", err.message);
  }
}

export async function removeTicket(id) {
  const sql = getDb();
  if (!sql) {
    // File-based fallback
    writeTicketsFile(readTicketsFile().filter(t => t.id !== id));
    return;
  }
  try {
    await sql`DELETE FROM submitted_tickets WHERE id = ${id}`;
  } catch (err) {
    console.warn("[db] removeTicket failed:", err.message);
  }
}
