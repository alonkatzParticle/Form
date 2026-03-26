// recentTasksService.js — Fetches and caches recent tasks from Monday boards.
// Used to inject real recent examples into AI prompts.
//
// Storage strategy:
//   - LOCAL (no DATABASE_URL): in-memory only, refreshed on startup
//   - VERCEL (DATABASE_URL set): Neon Postgres, 7-day TTL — skips Monday fetch if fresh

import { getSettings } from "./settingsService.js";
import { getExampleItems } from "./mondayService.js";
import { getCacheEntry, setCacheEntry, isCacheFresh, isDbAvailable } from "./dbCacheService.js";

const MAX_EXAMPLES   = 10;
const SIX_MONTHS_MS  = 6 * 30 * 24 * 60 * 60 * 1000;

const DEADLINE_COLUMN = {
  video:  "date_Mjj2cG7T",
  design: "date_Mjj20aki",
};

// In-memory cache
let cache = { video: [], design: [] };

async function fetchBoardExamples(boardId, boardType) {
  let items;
  try {
    items = await getExampleItems(boardId, 100);
  } catch (err) {
    console.warn(`[recentTasks] Failed to fetch ${boardType} board:`, err.message);
    return [];
  }

  const deadlineColId = DEADLINE_COLUMN[boardType];
  const cutoff = Date.now() - SIX_MONTHS_MS;

  const recent = items
    .filter((item) => {
      const col = item.column_values.find((c) => c.id === deadlineColId);
      if (!col?.text) return false;
      const d = new Date(col.text);
      return !isNaN(d) && d.getTime() >= cutoff;
    })
    .sort((a, b) => {
      const dA = new Date(a.column_values.find((c) => c.id === deadlineColId)?.text || 0);
      const dB = new Date(b.column_values.find((c) => c.id === deadlineColId)?.text || 0);
      return dB - dA;
    });

  return recent.slice(0, MAX_EXAMPLES).map((item) => {
    const get  = (id) => item.column_values.find((c) => c.id === id)?.text?.trim() || "";
    const trunc = (s, n) => s.length > n ? s.slice(0, n) + "…" : s;

    if (boardType === "video") {
      return [
        `Task: ${item.name}`,
        get("label4")               && `Type: ${get("label4")}`,
        get("single_selectu06tevn") && `Platform: ${get("single_selectu06tevn")}`,
        get("label9")               && `Product: ${get("label9")}`,
        get("long_text_mkn8c1ax")   && `Concept: ${trunc(get("long_text_mkn8c1ax"), 200)}`,
        get("long_text_Mjj2uK4g")   && `Script: ${trunc(get("long_text_Mjj2uK4g"), 300)}`,
      ].filter(Boolean).join("\n");
    } else {
      return [
        `Task: ${item.name}`,
        get("status_1__1")          && `Department: ${get("status_1__1")}`,
        get("single_selectrz7230p") && `Platform: ${get("single_selectrz7230p")}`,
        get("label9")               && `Product: ${get("label9")}`,
        get("long_textpvqldjpg")    && `Concept: ${trunc(get("long_textpvqldjpg"), 250)}`,
        get("long_text_mkngjytf")   && `Supporting Text: ${trunc(get("long_text_mkngjytf"), 150)}`,
      ].filter(Boolean).join("\n");
    }
  }).filter((s) => s.length > 20);
}

export async function refreshRecentTasks() {
  const settings = getSettings();

  for (const board of settings.boards || []) {
    const boardType = board.id;
    if (!board.boardId || !DEADLINE_COLUMN[boardType]) continue;
    const dbKey = `recent_tasks_${boardType}`;

    // If DB is available and cache is fresh, load from DB instead of Monday
    if (isDbAvailable() && await isCacheFresh(dbKey)) {
      const entry = await getCacheEntry(dbKey);
      if (entry?.value) {
        cache[boardType] = entry.value;
        console.log(`[recentTasks] ${boardType} loaded from DB (${entry.value.length} examples)`);
        continue;
      }
    }

    const examples = await fetchBoardExamples(board.boardId, boardType);
    cache[boardType] = examples;

    if (isDbAvailable()) {
      await setCacheEntry(dbKey, examples);
      console.log(`[recentTasks] ${boardType} fetched from Monday, saved to DB (${examples.length} examples)`);
    } else {
      console.log(`[recentTasks] ${boardType} fetched from Monday (${examples.length} examples)`);
    }
  }
}

export function getRecentTasks(boardType) {
  return cache[boardType] || [];
}

export function startRecentTasksRefresh() {
  refreshRecentTasks().catch((err) =>
    console.warn("[recentTasks] Initial fetch failed:", err.message)
  );
}
