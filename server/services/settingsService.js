// settingsService — reads and writes settings.json.
// The file is read fresh on every call so changes take effect without a server restart.
// nameRules.json is merged in at read time so the client receives autoName per board.
//
// On Vercel, the bundled filesystem is read-only (only /tmp is writable).
// On first access, we copy the bundled config files to /tmp so they can be read and written.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getFrequencyOrder } from "./frequencyService.js";
import { getColumnSettings } from "./mondayService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source paths — bundled with the deployment (read-only on Vercel)
const SRC_SETTINGS   = resolve(__dirname, "../settings.json");
const SRC_NAME_RULES = resolve(__dirname, "../nameRules.json");

// Active paths — writable via /tmp on Vercel, same as source locally
const SETTINGS_PATH   = process.env.VERCEL ? "/tmp/settings.json"   : SRC_SETTINGS;
const NAME_RULES_PATH = process.env.VERCEL ? "/tmp/nameRules.json"   : SRC_NAME_RULES;

// On Vercel, copy bundled defaults to /tmp on first access so they can be written later.
// Wrapped in try/catch — if the bundled source path resolves differently inside the lambda,
// we fall back silently (reads will use the original path, writes are best-effort).
function ensureVercelCopies() {
  if (!process.env.VERCEL) return;
  try {
    if (!existsSync(SETTINGS_PATH))   copyFileSync(SRC_SETTINGS,   SETTINGS_PATH);
    if (!existsSync(NAME_RULES_PATH)) copyFileSync(SRC_NAME_RULES, NAME_RULES_PATH);
  } catch (e) {
    // Ignore — reads will fall back to the bundled source path
  }
}

// Resolve the best readable path — prefer /tmp copy if it exists, else fall back to bundled source.
function readPath(tmpPath, srcPath) {
  if (process.env.VERCEL && existsSync(tmpPath)) return tmpPath;
  return srcPath;
}

export function getSettings() {
  ensureVercelCopies();
  const settings  = JSON.parse(readFileSync(readPath(SETTINGS_PATH,   SRC_SETTINGS),   "utf-8"));
  const nameRules = JSON.parse(readFileSync(readPath(NAME_RULES_PATH, SRC_NAME_RULES), "utf-8"));
  settings.boards = settings.boards.map((board) =>
    nameRules[board.id] ? { ...board, autoName: nameRules[board.id] } : board
  );
  settings.frequencyOrder = getFrequencyOrder();
  return settings;
}

export function updateSettings(patch) {
  ensureVercelCopies();
  const current = getSettings();
  const updated = { ...current, ...patch };
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

// Replace the fields array for a specific board by its id.
// Writes only to settings.json — nameRules.json is untouched.
export function updateBoardFields(boardId, fields) {
  ensureVercelCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.boards = settings.boards.map((b) =>
    b.id === boardId ? { ...b, fields } : b
  );
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

// Save the HTML update template for a specific board.
export function updateBoardTemplate(boardId, updateTemplate) {
  ensureVercelCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.boards = settings.boards.map((b) =>
    b.id === boardId ? { ...b, updateTemplate } : b
  );
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

// Add a new option value to every board field that matches fieldKey.
// Idempotent — skips boards/fields where the option already exists.
export function addFieldOption(fieldKey, option) {
  ensureVercelCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  let changed = false;
  for (const board of settings.boards) {
    const field = board.fields?.find((f) => f.key === fieldKey);
    if (field && Array.isArray(field.options) && !field.options.includes(option)) {
      field.options.push(option);
      changed = true;
    }
  }
  if (changed) writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return changed;
}

// Replace the options array for every board field that matches fieldKey.
// Used by the settings sync to mirror Monday's authoritative label list exactly.
export function setFieldOptions(fieldKey, options) {
  ensureVercelCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  let changed = false;
  for (const board of settings.boards) {
    const field = board.fields?.find((f) => f.key === fieldKey);
    if (field && Array.isArray(field.options)) {
      const current = JSON.stringify(field.options);
      const next = JSON.stringify(options);
      if (current !== next) {
        field.options = [...options];
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return changed;
}

// Add multiple option values to a specific board's field configuration.
// Idempotent — skips options that already exist.
export function addBoardFieldOptions(boardId, fieldKey, newOptions) {
  ensureVercelCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  const board = settings.boards?.find((b) => b.id === boardId);
  if (!board) return false;
  const field = board.fields?.find((f) => f.key === fieldKey);
  if (field && Array.isArray(field.options)) {
    let changed = false;
    for (const option of newOptions) {
      if (!field.options.includes(option)) {
        field.options.push(option);
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
      return true;
    }
  }
  return false;
}

// Sync products from Monday.com status columns to settings.json options.
export async function syncProductsFromMonday() {
  const settings = getSettings();
  let totalAdded = 0;

  for (const board of settings.boards) {
    // Find the product field in the board config
    // Video board uses "product", Design board uses "productBundle"
    const productField = board.fields?.find((f) => f.key === "product" || f.key === "productBundle");
    if (!productField || !productField.mondayColumnId) continue;

    console.log(`[sync-products] Syncing "${productField.key}" options for board "${board.label}" (ID: ${board.boardId})...`);
    
    try {
      const colSettings = await getColumnSettings(board.boardId, productField.mondayColumnId);
      if (!colSettings) {
        console.warn(`[sync-products] Could not get column settings for board ${board.id}, column ${productField.mondayColumnId}`);
        continue;
      }

      // Monday status column labels are stored in settings_str as { labels: { "0": "Label1", "1": "Label2" } }
      const rawLabels = colSettings.labels ?? {};
      const mondayLabels = (Array.isArray(rawLabels)
        ? rawLabels.map((l) => l.name)
        : Object.values(rawLabels)
      )
        .map((l) => typeof l === "string" ? l.trim() : l)
        .filter((l) => l && l !== ""); // Filter out empty or default placeholders if any

      if (mondayLabels.length === 0) {
        console.warn(`[sync-products] No labels found in Monday for board ${board.id}, column ${productField.mondayColumnId}`);
        continue;
      }

      // Add options to settings.json
      const currentOptions = productField.options ?? [];
      const newOptions = mondayLabels.filter((label) => !currentOptions.includes(label));

      if (newOptions.length > 0) {
        console.log(`[sync-products] Found ${newOptions.length} new products for board ${board.id}:`, newOptions);
        addBoardFieldOptions(board.id, productField.key, newOptions);
        totalAdded += newOptions.length;
      } else {
        console.log(`[sync-products] Board ${board.id} product list is already up to date.`);
      }
    } catch (err) {
      console.error(`[sync-products] Error syncing board ${board.id}:`, err.message);
    }
  }

  return totalAdded;
}

