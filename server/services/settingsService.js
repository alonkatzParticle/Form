// settingsService — reads and writes settings.json.
// The file is read fresh on every call so changes take effect without a server restart.
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = resolve(__dirname, "../settings.json");

export function getSettings() {
  const raw = readFileSync(SETTINGS_PATH, "utf-8");
  return JSON.parse(raw);
}

export function updateSettings(patch) {
  const current = getSettings();
  const updated = { ...current, ...patch };
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
}
