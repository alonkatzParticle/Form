// recentTasksService.js — Fetches and caches recent tasks from Monday boards.
// Used to inject real recent examples into AI prompts instead of static skill file examples.
//
// Strategy: fetch at startup + refresh every 6 hours.
// Filters to items with a deadline date within the last 6 months.
// Stores formatted summaries in memory — no disk I/O on each AI request.

import { getSettings } from "./settingsService.js";
import { getExampleItems } from "./mondayService.js";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_EXAMPLES        = 10;
const SIX_MONTHS_MS       = 6 * 30 * 24 * 60 * 60 * 1000;

// In-memory cache: { video: [...], design: [...] }
let cache = { video: [], design: [] };
let lastFetch = null;

// Deadline column IDs per board type (from settings.json)
const DEADLINE_COLUMN = {
  video:  "date_Mjj2cG7T",
  design: "date_Mjj20aki",
};

// Fields to extract per board type — maps fieldKey → Monday column ID
const FIELD_MAP = {
  video: {
    type:         "color_Mjj2",
    platform:     "color_Mjj2cG7T__1",
    product:      "text_Mjj2",
    videoConcept: "long_text_Mjj2",
    script:       "long_text_Mjj21",
    visuals:      "long_text_visuals",
  },
  design: {
    type:         "color_design_type",
    platform:     "color_design_platform",
    product:      "text_design_product",
    concept:      "long_text_design_concept",
    supportingText: "long_text_design_support",
  },
};

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

  // Filter to items with a deadline in the last 6 months
  const recent = items.filter((item) => {
    const col = item.column_values.find((c) => c.id === deadlineColId);
    if (!col?.text) return false;
    const d = new Date(col.text);
    return !isNaN(d) && d.getTime() >= cutoff;
  });

  // Sort by deadline descending (most recent first)
  recent.sort((a, b) => {
    const dateA = new Date(a.column_values.find((c) => c.id === deadlineColId)?.text || 0);
    const dateB = new Date(b.column_values.find((c) => c.id === deadlineColId)?.text || 0);
    return dateB - dateA;
  });

  // Format into compact summaries for the AI prompt
  return recent.slice(0, MAX_EXAMPLES).map((item) => {
    const get = (id) => item.column_values.find((c) => c.id === id)?.text?.trim() || "";
    const trunc = (s, n) => s.length > n ? s.slice(0, n) + "…" : s;

    if (boardType === "video") {
      return [
        `Task: ${item.name}`,
        get("label4")                  && `Type: ${get("label4")}`,
        get("single_selectu06tevn")    && `Platform: ${get("single_selectu06tevn")}`,
        get("label9")                  && `Product: ${get("label9")}`,
        get("long_text_mkn8c1ax")      && `Concept: ${trunc(get("long_text_mkn8c1ax"), 200)}`,
        get("long_text_Mjj2uK4g")      && `Script: ${trunc(get("long_text_Mjj2uK4g"), 300)}`,
      ].filter(Boolean).join("\n");
    } else {
      return [
        `Task: ${item.name}`,
        get("status_1__1")             && `Department: ${get("status_1__1")}`,
        get("single_selectrz7230p")    && `Platform: ${get("single_selectrz7230p")}`,
        get("label9")                  && `Product: ${get("label9")}`,
        get("long_textpvqldjpg")       && `Concept: ${trunc(get("long_textpvqldjpg"), 250)}`,
        get("long_text_mkngjytf")      && `Supporting Text: ${trunc(get("long_text_mkngjytf"), 150)}`,
      ].filter(Boolean).join("\n");
    }
  }).filter((s) => s.length > 20);
}

export async function refreshRecentTasks() {
  const settings = getSettings();
  const results = {};

  for (const board of settings.boards || []) {
    const boardType = board.id; // "video" or "design"
    if (!board.boardId || !DEADLINE_COLUMN[boardType]) continue;
    results[boardType] = await fetchBoardExamples(board.boardId, boardType);
  }

  cache = { ...cache, ...results };
  lastFetch = Date.now();
  console.log(`[recentTasks] Refreshed — video: ${cache.video.length} examples, design: ${cache.design.length} examples`);
}

export function getRecentTasks(boardType) {
  return cache[boardType] || [];
}

export function startRecentTasksRefresh() {
  refreshRecentTasks().catch((err) =>
    console.warn("[recentTasks] Initial fetch failed:", err.message)
  );
  setInterval(() => {
    refreshRecentTasks().catch((err) =>
      console.warn("[recentTasks] Refresh failed:", err.message)
    );
  }, REFRESH_INTERVAL_MS);
}
