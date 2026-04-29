// Auto-rename service.
// Every 5 minutes (when enabled), fetches items from "Form Requests" and
// "Ready For Assignment" groups on all configured boards, and renames any
// task whose name doesn't have 2+ "|" separators using the board's naming rules.
//
// State is persisted to autoRenameState.json so the log survives server restarts.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getGroupItems, renameItem } from "./mondayService.js";
import { getSettings } from "./settingsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// On Vercel the filesystem is read-only; use /tmp for mutable state.
const STATE_PATH = process.env.VERCEL
  ? "/tmp/autoRenameState.json"
  : resolve(__dirname, "../autoRenameState.json");

// Groups to scan on every board (same IDs across both boards)
const TARGET_GROUP_IDS = ["new_group__1", "group_title"];

function loadState() {
  if (!existsSync(STATE_PATH)) return { enabled: false, lastRun: null, seenIds: [], log: [] };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { enabled: false, lastRun: null, seenIds: [], log: [] }; }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getState() {
  return loadState();
}

export function setEnabled(value) {
  const state = loadState();
  state.enabled = value;
  saveState(state);
  return state;
}

// A task is considered already formatted if its name contains 2 or more "|" chars.
function isFormatted(name) {
  return (name.match(/\|/g) || []).length >= 2;
}

// Same logic as applyNameRules in routes/monday.js — kept here to avoid circular imports.
function applyNameRules(board, task) {
  if (!board.autoName) return task.taskName || "";
  return board.autoName.segments
    .map((seg) => {
      let val = task[seg.field];
      if (!val && seg.fallback) val = task[seg.fallback];
      if (!val) return null;
      if (seg.onlyWhenField && task[seg.onlyWhenField] !== seg.onlyWhenValue) return null;
      if (seg.onlyValues && !seg.onlyValues.includes(val)) return null;
      if (seg.skipValues && seg.skipValues.includes(val)) return null;
      if (seg.requireFieldEmpty) {
        const guard = task[seg.requireFieldEmpty];
        if (guard && guard !== "None" && guard !== "") return null;
      }
      if (seg.valueMap && seg.valueMap[val]) val = seg.valueMap[val];
      return val;
    })
    .filter(Boolean)
    .join(" | ");
}

export async function runAutoRename() {
  const state = loadState();
  const settings = getSettings();
  const seenIds = new Set(state.seenIds || []);
  const newEntries = [];

  for (const board of settings.boards) {
    let groups;
    try {
      groups = await getGroupItems(board.boardId, TARGET_GROUP_IDS);
    } catch (err) {
      console.warn(`[auto-rename] Failed to fetch groups for ${board.label}:`, err.message);
      continue;
    }

    for (const group of groups) {
      const items = group.items_page?.items ?? [];

      for (const item of items) {
        if (seenIds.has(item.id)) continue;

        if (isFormatted(item.name)) {
          seenIds.add(item.id);
          newEntries.push({
            itemId: item.id,
            boardLabel: board.label,
            name: item.name,
            status: "formatted",
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        // Build task object from column values
        const colTextMap = {};
        item.column_values.forEach((cv) => { colTextMap[cv.id] = cv.text || ""; });
        const task = {};
        board.fields.forEach((f) => {
          if (f.mondayColumnId && colTextMap[f.mondayColumnId]) {
            task[f.key] = colTextMap[f.mondayColumnId];
          }
        });
        // taskName is the last segment of the current name (or the full name if not segmented)
        const parts = item.name.split(" | ");
        task.taskName = parts[parts.length - 1].trim();

        const newName = applyNameRules(board, task);

        if (!newName) {
          newEntries.push({
            itemId: item.id,
            boardLabel: board.label,
            name: item.name,
            status: "error",
            error: "Could not compute a name from the task's column values.",
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        try {
          await renameItem(board.boardId, item.id, newName);
          seenIds.add(item.id);
          newEntries.push({
            itemId: item.id,
            boardLabel: board.label,
            oldName: item.name,
            newName,
            status: "renamed",
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          newEntries.push({
            itemId: item.id,
            boardLabel: board.label,
            name: item.name,
            status: "error",
            error: err.message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Prepend new entries, keep log at max 100, keep seenIds at max 1000
  state.log = [...newEntries, ...(state.log || [])].slice(0, 100);
  state.seenIds = [...seenIds].slice(-1000);
  state.lastRun = new Date().toISOString();
  saveState(state);
  return state;
}
