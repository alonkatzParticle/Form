// settingsService — reads and writes settings.json.
// The file is read fresh on every call so changes take effect without a server restart.
// nameRules.json is merged in at read time so the client receives autoName per board.
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getFrequencyOrder } from "./frequencyService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(__dirname, "../settings.json");
const NAME_RULES_PATH = resolve(__dirname, "../nameRules.json");

export function getSettings() {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  const nameRules = JSON.parse(readFileSync(NAME_RULES_PATH, "utf-8"));
  settings.boards = settings.boards.map((board) =>
    nameRules[board.id] ? { ...board, autoName: nameRules[board.id] } : board
  );
  settings.frequencyOrder = getFrequencyOrder(settings);
  return settings;
}

export function updateSettings(patch) {
  const current = getSettings();
  const updated = { ...current, ...patch };
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

// Replace the fields array for a specific board by its id.
// Writes only to settings.json — nameRules.json is untouched.
export function updateBoardFields(boardId, fields) {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.boards = settings.boards.map((b) =>
    b.id === boardId ? { ...b, fields } : b
  );
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}

// Save the HTML update template for a specific board.
export function updateBoardTemplate(boardId, updateTemplate) {
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  settings.boards = settings.boards.map((b) =>
    b.id === boardId ? { ...b, updateTemplate } : b
  );
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  return settings;
}
