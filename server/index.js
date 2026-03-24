// Main server entry point.
// To add a new route, import it here and register it with app.use().
import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from the project root (one level up from server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

import mondayRoutes from "./routes/monday.js";
import aiRoutes from "./routes/ai.js";
import elevenLabsRoutes from "./routes/elevenlabs.js";
import settingsRoutes from "./routes/settings.js";
import { getSettings } from "./services/settingsService.js";
import { getBoardColumns } from "./services/mondayService.js";
import { refreshAllBoards } from "./services/frequencyService.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/monday", mondayRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/elevenlabs", elevenLabsRoutes);
app.use("/api/settings", settingsRoutes);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  runSyncCheck();
  // Populate the frequency cache on startup, then refresh every 6 hours.
  refreshAllBoards(getSettings()).catch((err) =>
    console.warn("[frequency] Initial refresh failed:", err.message)
  );
  setInterval(
    () =>
      refreshAllBoards(getSettings()).catch((err) =>
        console.warn("[frequency] Scheduled refresh failed:", err.message)
      ),
    6 * 60 * 60 * 1000
  );
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
