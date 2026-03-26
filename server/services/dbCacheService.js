// dbCacheService.js — Neon Postgres wrapper for persistent caching.
// Only active when DATABASE_URL is set (Vercel production).
// Local dev falls back to file-based cache with no changes.

import { neon } from "@neondatabase/serverless";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let _sql = null;
function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
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
