// frequencyService — tracks how often each dropdown value has been used
// on each Monday board over the last 30 days.
//
// The cache (frequencyCache.json) is written to disk so it survives server
// restarts.  Call refreshAllBoards() on startup and every 6 hours;
// call getFrequencyOrder() synchronously when building the settings response.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getItemsPage, getNextItemsPage } from "./mondayService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, "../frequencyCache.json");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 500; // per board — more than enough to cover 30 days

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(data) {
  writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
}

// Returns only the fields that have enumerable values AND a Monday column ID.
function getFrequencyFields(board) {
  return board.fields.filter(
    (f) =>
      f.mondayColumnId &&
      (f.type === "select" || f.type === "multiselect" || f.type === "people")
  );
}

// Paginates through the board's items (up to MAX_ITEMS), filters to the last
// 30 days, and counts how often each value appears per field.
async function fetchBoardFrequencies(board) {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const freqFields = getFrequencyFields(board);
  if (!freqFields.length) return {};

  // columnId → field for fast lookup while iterating column_values
  const colToField = Object.fromEntries(freqFields.map((f) => [f.mondayColumnId, f]));

  // Initialise count buckets
  const counts = Object.fromEntries(freqFields.map((f) => [f.key, {}]));

  let page = await getItemsPage(board.boardId, 200);
  let fetched = 0;

  while (page && fetched < MAX_ITEMS) {
    for (const item of page.items ?? []) {
      if (new Date(item.created_at) < cutoff) continue;

      for (const cv of item.column_values ?? []) {
        const field = colToField[cv.id];
        if (!field || !cv.text) continue;

        // select → single value; multiselect & people → comma-separated list
        const values = cv.text.split(", ").filter(Boolean);
        for (const v of values) {
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

// Re-fetch frequencies for every board and write the result to disk.
export async function refreshAllBoards(settings) {
  console.log("[frequency] Refreshing cache…");
  const cache = loadCache();

  for (const board of settings.boards) {
    try {
      cache[board.id] = {
        lastUpdated: new Date().toISOString(),
        fields: await fetchBoardFrequencies(board),
      };
      console.log(`[frequency] ✓  ${board.label}`);
    } catch (err) {
      console.warn(`[frequency] ✗  ${board.label}: ${err.message}`);
    }
  }

  saveCache(cache);
}

// Returns { [boardId]: { [fieldKey]: ["MostUsed", "Second", ...] } }.
// Values are sorted most → least frequent.  Returns empty objects when the
// cache hasn't been populated yet — the UI will simply use the default order.
export function getFrequencyOrder(settings) {
  const cache = loadCache();
  const result = {};

  for (const board of settings.boards) {
    const boardCache = cache[board.id];
    if (!boardCache?.fields) {
      result[board.id] = {};
      continue;
    }
    result[board.id] = Object.fromEntries(
      Object.entries(boardCache.fields).map(([key, counts]) => [
        key,
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([val]) => val),
      ])
    );
  }

  return result;
}
