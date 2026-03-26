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

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source paths — bundled with the deployment (read-only on Vercel)
const SRC_SETTINGS   = resolve(__dirname, "../settings.json");
const SRC_NAME_RULES = resolve(__dirname, "../nameRules.json");

// Active paths — writable via /tmp on Vercel, same as source locally
const SETTINGS_PATH   = process.env.VERCEL ? "/tmp/settings.json"   : SRC_SETTINGS;
const NAME_RULES_PATH = process.env.VERCEL ? "/tmp/nameRules.json"   : SRC_NAME_RULES;

// On Vercel, copy bundled defaults to /tmp on first access so they can be written later.
function ensureVercelCopies() {
  if (!process.env.VERCEL) return;
  if (!existsSync(SETTINGS_PATH))   copyFileSync(SRC_SETTINGS,   SETTINGS_PATH);
  if (!existsSync(NAME_RULES_PATH)) copyFileSync(SRC_NAME_RULES, NAME_RULES_PATH);
}

export function getSettings() {
  ensureVercelCopies();
  const settings  = JSON.parse(readFileSync(SETTINGS_PATH,   "utf-8"));
  const nameRules = JSON.parse(readFileSync(NAME_RULES_PATH, "utf-8"));
  settings.boards = settings.boards.map((board) =>
    nameRules[board.id] ? { ...board, autoName: nameRules[board.id] } : board
  );
  settings.frequencyOrder = getFrequencyOrder(settings);
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
