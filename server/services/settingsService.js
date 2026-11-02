// settingsService — reads and writes settings.json.
// The file is read fresh on every call so changes take effect without a server restart.
// nameRules.json is merged in at read time so the client receives autoName per board.
//
// Where the live settings.json lives:
//   • SETTINGS_DIR set (VPS) — a folder outside the Docker image, so edits survive deploys.
//     The copy in git only seeds it the first time; after that the folder's copy is the live one.
//   • On Vercel — /tmp, because the bundled filesystem is read-only.
//   • Otherwise (local dev) — the bundled server/settings.json itself.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getFrequencyOrder } from "./frequencyService.js";
import { getColumnSettings } from "./mondayService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source paths — bundled with the deployment (read-only on Vercel)
const SRC_SETTINGS   = resolve(__dirname, "../settings.json");
const SRC_NAME_RULES = resolve(__dirname, "../nameRules.json");

// Active paths. nameRules.json is only ever edited in git, so it stays bundled outside Vercel.
const SETTINGS_DIR    = process.env.SETTINGS_DIR || (process.env.VERCEL ? "/tmp" : null);
const SETTINGS_PATH   = SETTINGS_DIR ? resolve(SETTINGS_DIR, "settings.json") : SRC_SETTINGS;
const NAME_RULES_PATH = process.env.VERCEL ? "/tmp/nameRules.json" : SRC_NAME_RULES;

// Seed the writable copies from the bundled files the first time they're needed.
// Wrapped in try/catch — on Vercel the bundled source path can resolve differently inside the
// lambda, so we fall back silently (reads use the original path, writes are best-effort).
function ensureWritableCopies() {
  try {
    if (SETTINGS_PATH !== SRC_SETTINGS && !existsSync(SETTINGS_PATH)) {
      mkdirSync(SETTINGS_DIR, { recursive: true });
      copyFileSync(SRC_SETTINGS, SETTINGS_PATH);
      console.log(`[settings] Seeded ${SETTINGS_PATH} from the bundled settings.json`);
    }
    if (NAME_RULES_PATH !== SRC_NAME_RULES && !existsSync(NAME_RULES_PATH)) {
      copyFileSync(SRC_NAME_RULES, NAME_RULES_PATH);
    }
  } catch (e) {
    console.warn("[settings] Could not seed writable settings copy:", e.message);
  }
}

// Resolve the best readable path — prefer the writable copy if it exists, else the bundled source.
function readPath(activePath, srcPath) {
  if (activePath !== srcPath && existsSync(activePath)) return activePath;
  return srcPath;
}

export function getSettings() {
  ensureWritableCopies();
  const settings  = JSON.parse(readFileSync(readPath(SETTINGS_PATH,   SRC_SETTINGS),   "utf-8"));
  const nameRules = JSON.parse(readFileSync(readPath(NAME_RULES_PATH, SRC_NAME_RULES), "utf-8"));
  settings.boards = settings.boards.map((board) =>
    nameRules[board.id] ? { ...board, autoName: nameRules[board.id] } : board
  );
  settings.frequencyOrder = getFrequencyOrder();
  return settings;
}

export function updateSettings(patch) {
  ensureWritableCopies();
  const current = getSettings();
  const updated = { ...current, ...patch };
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

// Replace the fields array for a specific board by its id.
// Writes only to settings.json — nameRules.json is untouched.
export function updateBoardFields(boardId, fields) {
  ensureWritableCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.boards = settings.boards.map((b) =>
    b.id === boardId ? { ...b, fields } : b
  );
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

// Save the HTML update template for a specific board.
export function updateBoardTemplate(boardId, updateTemplate) {
  ensureWritableCopies();
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
  ensureWritableCopies();
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

// Merge product → brand assignments into settings.productBrands (shared by both boards).
// Products with no entry belong to the brand field's default (Particle).
export function setProductBrands(assignments) {
  ensureWritableCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.productBrands = { ...(settings.productBrands ?? {}), ...assignments };
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings.productBrands;
}

// Replace the options array for a specific board field that matches fieldKey.
// Used to mirror Monday's authoritative visible options list exactly.
export function setBoardFieldOptions(boardId, fieldKey, options) {
  ensureWritableCopies();
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  const board = settings.boards?.find((b) => b.id === boardId);
  if (!board) return false;
  const field = board.fields?.find((f) => f.key === fieldKey);
  if (field && Array.isArray(field.options)) {
    const current = JSON.stringify(field.options);
    const next = JSON.stringify(options);
    if (current !== next) {
      field.options = [...options];
      writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
      return true;
    }
  }
  return false;
}

// Turn a Monday column's settings into its list of active, visible label names, in Monday's order.
// Status columns store labels as {id: name} with positions in labels_positions_v2;
// dropdown columns store them as [{id, name}], already in display order.
// Deactivated, empty and placeholder "-" labels are left out.
export function getActiveColumnLabels(colSettings) {
  const rawLabels = colSettings?.labels ?? {};
  const labelEntries = Array.isArray(rawLabels)
    ? rawLabels.map((l) => [String(l.id), l.name])
    : Object.entries(rawLabels);
  const deactivated = new Set(colSettings?.deactivated_labels ?? []);
  const positions = colSettings?.labels_positions_v2 ?? {};

  const validEntries = labelEntries.filter(([id, label]) => {
    if (deactivated.has(id) || deactivated.has(Number(id))) return false;
    if (!label || typeof label !== "string") return false;
    const trimmed = label.trim();
    if (!trimmed || trimmed === "-") return false;
    return true;
  });

  validEntries.sort((a, b) => (positions[a[0]] ?? 999) - (positions[b[0]] ?? 999));

  return Array.from(new Set(validEntries.map(([, label]) => label.trim())));
}

// Sync products from Monday.com status columns to settings.json options.
// Updates options to only show options that are active and visible on Monday.com.
export async function syncProductsFromMonday() {
  const settings = getSettings();
  let totalUpdated = 0;

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

      const mondayLabels = getActiveColumnLabels(colSettings);

      if (mondayLabels.length === 0) {
        console.warn(`[sync-products] No valid labels found in Monday for board ${board.id}, column ${productField.mondayColumnId}`);
        continue;
      }

      const currentOptions = productField.options ?? [];
      const hasChanged =
        mondayLabels.length !== currentOptions.length ||
        mondayLabels.some((l, idx) => l !== currentOptions[idx]);

      if (hasChanged) {
        setBoardFieldOptions(board.id, productField.key, mondayLabels);
        console.log(`[sync-products] Board ${board.id} product list updated (${mondayLabels.length} active products).`);
        totalUpdated++;
      } else {
        console.log(`[sync-products] Board ${board.id} product list is already up to date with Monday.`);
      }
    } catch (err) {
      console.error(`[sync-products] Error syncing board ${board.id}:`, err.message);
    }
  }

  return totalUpdated;
}


