// frequencyService — tracks how often each dropdown value has been used
// on each Monday board over the last 30 days.
//
// Storage strategy:
//   - Neon Postgres (when DATABASE_URL set): persistent, 7-day TTL
//   - Static JSON fallback: server/data/frequencyOrder.json (seed file, committed to repo)
//
// On cold start, loadFrequencyIntoMemory() populates memoryCache from Neon.
// getFrequencyOrder() is synchronous — reads from memoryCache, falls back to static JSON.
// A weekly Vercel cron calls refreshAllBoards() to re-fetch from Monday + update Neon.

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getItemsPage, getNextItemsPage } from "./mondayService.js";
import { getCacheEntry, setCacheEntry, isCacheFresh, isDbAvailable } from "./dbCacheService.js";

const __dirname      = dirname(fileURLToPath(import.meta.url));
const STATIC_JSON    = resolve(__dirname, "../data/frequencyOrder.json");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS      = 500;

// In-memory mirror — populated from Neon at cold start, updated after cron refresh.
// Shape: { video: { product: [...], type: [...] }, design: { ... } }
let memoryCache = null;

function loadStaticJson() {
  try { return JSON.parse(readFileSync(STATIC_JSON, "utf-8")); }
  catch { return {}; }
}

function getFrequencyFields(board) {
  return board.fields.filter(
    (f) => f.mondayColumnId &&
      (f.type === "select" || f.type === "multiselect" || f.type === "people")
  );
}

async function fetchBoardFrequencies(board) {
  const cutoff     = new Date(Date.now() - THIRTY_DAYS_MS);
  const freqFields = getFrequencyFields(board);
  if (!freqFields.length) return {};

  const colToField = Object.fromEntries(freqFields.map((f) => [f.mondayColumnId, f]));
  const counts     = Object.fromEntries(freqFields.map((f) => [f.key, {}]));

  let page    = await getItemsPage(board.boardId, 200);
  let fetched = 0;

  while (page && fetched < MAX_ITEMS) {
    for (const item of page.items ?? []) {
      if (new Date(item.created_at) < cutoff) continue;
      for (const cv of item.column_values ?? []) {
        const field = colToField[cv.id];
        if (!field || !cv.text) continue;
        for (const v of cv.text.split(", ").filter(Boolean)) {
          counts[field.key][v] = (counts[field.key][v] ?? 0) + 1;
        }
      }
    }
    fetched += (page.items ?? []).length;
    if (!page.cursor || (page.items ?? []).length < 200) break;
    page = await getNextItemsPage(page.cursor, 200);
  }

  // Return sorted arrays (most → least used)
  return Object.fromEntries(
    Object.entries(counts).map(([key, valCounts]) => [
      key,
      Object.entries(valCounts).sort((a, b) => b[1] - a[1]).map(([val]) => val),
    ])
  );
}

// Called at cold start — loads Neon data into memory so getFrequencyOrder() is instant.
// Falls back silently if DB is unavailable or empty (static JSON seed is used instead).
export async function loadFrequencyIntoMemory(settings) {
  if (!isDbAvailable()) return;
  const result = {};
  for (const board of settings.boards ?? []) {
    const entry = await getCacheEntry(`frequency_${board.id}`);
    if (entry?.value) result[board.id] = entry.value;
  }
  if (Object.keys(result).length > 0) {
    memoryCache = result;
    console.log("[frequency] Loaded from Neon");
  }
}

// Called by weekly Vercel cron — fetches fresh data from Monday + saves to Neon.
export async function refreshAllBoards(settings) {
  console.log("[frequency] Refreshing from Monday…");
  const updated = {};

  for (const board of settings.boards ?? []) {
    if (!board.boardId) continue;
    try {
      const sortedFields = await fetchBoardFrequencies(board);
      updated[board.id]  = sortedFields;
      if (isDbAvailable()) {
        await setCacheEntry(`frequency_${board.id}`, sortedFields);
        console.log(`[frequency] ✓ ${board.label} — saved to Neon`);
      } else {
        console.log(`[frequency] ✓ ${board.label}`);
      }
    } catch (err) {
      console.warn(`[frequency] ✗ ${board.label}: ${err.message}`);
    }
  }

  memoryCache = updated;
  return updated;
}

// Synchronous — reads from in-memory cache (populated from Neon at startup).
// Falls back to the committed static JSON seed if memory is empty.
export function getFrequencyOrder() {
  return memoryCache ?? loadStaticJson();
}
