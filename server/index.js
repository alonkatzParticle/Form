// server/index.js — Local dev entry point.
// Imports the configured Express app and starts the HTTP server with background jobs.
// On Vercel, api/index.js is used instead (no listen, no intervals).

import app from "./app.js";
import { getSettings, syncProductsFromMonday } from "./services/settingsService.js";
import { getBoardColumns } from "./services/mondayService.js";
import { getState as getAutoRenameState, runAutoRename } from "./services/autoRenameService.js";
import { refreshAllBoards } from "./services/frequencyService.js";

const PORT = process.env.PORT || 3001;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  runSyncCheck();

  // Auto-rename: run every 5 minutes if enabled.
  setInterval(() => {
    if (getAutoRenameState().enabled) {
      runAutoRename().catch((err) =>
        console.warn("[auto-rename] Scheduled run failed:", err.message)
      );
    }
  }, 5 * 60 * 1000);

  // Frequency refresh: replaces the Vercel cron (vercel.json runs this weekly).
  // On VPS there is no Vercel cron, so we schedule it here instead.
  setInterval(() => {
    refreshAllBoards().catch((err) =>
      console.warn("[frequency] Scheduled refresh failed:", err.message)
    );
  }, WEEK_MS);

  // Daily product sync: check every 5 minutes if it's 7 AM Jerusalem Time (UTC+3) and run once per day.
  let lastProductSyncDate = "";
  setInterval(() => {
    try {
      const jerusalemTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jerusalem",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      }).formatToParts(new Date());

      const parts = Object.fromEntries(jerusalemTime.map(p => [p.type, p.value]));
      const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
      const hour = parseInt(parts.hour, 10);

      if (hour >= 7 && dateStr !== lastProductSyncDate) {
        console.log(`[cron] Running scheduled daily product sync at ${parts.hour}:${parts.minute} Jerusalem time...`);
        syncProductsFromMonday().then((added) => {
          lastProductSyncDate = dateStr;
          console.log(`[cron] Scheduled daily product sync completed. Added products: ${added}`);
        }).catch((err) => {
          console.warn("[cron] Scheduled daily product sync failed:", err.message);
        });
      }
    } catch (err) {
      console.warn("[cron] Time check for daily product sync failed:", err.message);
    }
  }, 5 * 60 * 1000);
});

// On startup, compare each board's configured columns against live Monday columns.
// Logs warnings if columns have been added to or removed from Monday since last update.
async function runSyncCheck() {
  try {
    const settings = getSettings();
    for (const board of settings.boards) {
      const mondayColumns = await getBoardColumns(board.boardId);
      const mondayColumnIds = new Set(mondayColumns.map((c) => c.id));

      const referencedIds = new Set(board.fields.filter((f) => f.mondayColumnId).map((f) => f.mondayColumnId));

      const missing = board.fields.filter((f) => f.mondayColumnId && !mondayColumnIds.has(f.mondayColumnId));
      const added = mondayColumns.filter((c) => !referencedIds.has(c.id));

      if (missing.length > 0) {
        console.warn(`\n[sync-check] ⚠️  "${board.label}" — columns removed from Monday (update settings.json):`);
        missing.forEach((f) => console.warn(`  • field "${f.key}" mapped to "${f.mondayColumnId}" — column not found`));
      }
      if (added.length > 0) {
        console.warn(`\n[sync-check] ℹ️  "${board.label}" — new Monday columns not yet in settings.json:`);
        added.forEach((c) => console.warn(`  • "${c.title}" (id: ${c.id}, type: ${c.type})`));
      }
      if (missing.length === 0 && added.length === 0) {
        console.log(`[sync-check] ✓  "${board.label}" columns are in sync`);
      }
    }
  } catch (err) {
    console.warn("[sync-check] Could not complete column sync check:", err.message);
  }
}
