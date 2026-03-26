// frequencyService — tracks how often each dropdown value has been used
// on each Monday board over the last 30 days.
//
// Storage strategy:
//   - LOCAL (no DATABASE_URL): file-based cache at server/frequencyCache.json
//   - VERCEL (DATABASE_URL set): Neon Postgres via dbCacheService, 7-day TTL
//
// Call refreshAllBoards() on startup; call getFrequencyOrder() synchronously
// when building the settings response.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getItemsPage, getNextItemsPage } from "./mondayService.js";
import { getCacheEntry, setCacheEntry, isCacheFresh, isDbAvailable } from "./dbCacheService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = process.env.VERCEL
  ? "/tmp/frequencyCache.json"
  : resolve(__dirname, "../frequencyCache.json");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 500;

// In-memory mirror so getFrequencyOrder() stays synchronous
let memoryCache = null;

function loadFileCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, "utf-8")); }
  catch { return {}; }
}

function saveFileCache(data) {
  try { writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2)); }
  catch { /* read-only fs on Vercel — DB is the real store */ }
}

function getFrequencyFields(board) {
  return board.fields.filter(
    (f) => f.mondayColumnId &&
      (f.type === "select" || f.type === "multiselect" || f.type === "people")
  );
}

async function fetchBoardFrequencies(board) {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const freqFields = getFrequencyFields(board);
  if (!freqFields.length) return {};

  const colToField = Object.fromEntries(freqFields.map((f) => [f.mondayColumnId, f]));
  const counts = Object.fromEntries(freqFields.map((f) => [f.key, {}]));

  let page = await getItemsPage(board.boardId, 200);
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

  return counts;
}

// Re-fetch frequencies for every board and persist.
export async function refreshAllBoards(settings) {
  // If DB is available, check if all boards are still fresh — skip if so.
  if (isDbAvailable()) {
    const allFresh = await Promise.all(
      settings.boards.map((b) => isCacheFresh(`frequency_${b.id}`))
    );
    if (allFresh.every(Boolean)) {
      console.log("[frequency] DB cache is fresh — skipping Monday fetch");
      await loadFromDb(settings);
      return;
    }
  }

  console.log("[frequency] Refreshing from Monday…");
  const fileCache = loadFileCache();

  for (const board of settings.boards) {
    try {
      const fields = await fetchBoardFrequencies(board);
      const entry = { lastUpdated: new Date().toISOString(), fields };
      fileCache[board.id] = entry;

      if (isDbAvailable()) {
        await setCacheEntry(`frequency_${board.id}`, entry);
        console.log(`[frequency] ✓ ${board.label} — saved to DB`);
      } else {
        console.log(`[frequency] ✓ ${board.label}`);
      }
    } catch (err) {
      console.warn(`[frequency] ✗ ${board.label}: ${err.message}`);
    }
  }

  saveFileCache(fileCache);
  memoryCache = fileCache;
}

// Load data from DB into memory (used when cache is fresh).
async function loadFromDb(settings) {
  const result = {};
  for (const board of settings.boards) {
    const entry = await getCacheEntry(`frequency_${board.id}`);
    if (entry?.value) result[board.id] = entry.value;
  }
  memoryCache = result;
}

// Synchronous — uses in-memory mirror populated by refreshAllBoards().
export function getFrequencyOrder(settings) {
  const cache = memoryCache ?? loadFileCache();
  const result = {};

  for (const board of settings.boards) {
    const boardCache = cache[board.id];
    if (!boardCache?.fields) { result[board.id] = {}; continue; }
    result[board.id] = Object.fromEntries(
      Object.entries(boardCache.fields).map(([key, counts]) => [
        key,
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([val]) => val),
      ])
    );
  }

  return result;
}
