// server/app.js — Express app setup (exported for both local dev and Vercel serverless).
// Do not call app.listen() here — that lives in index.js (local dev only).

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from the project root (one level up from server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env"), override: true });

import mondayRoutes from "./routes/monday.js";
import aiRoutes from "./routes/ai.js";
import elevenLabsRoutes from "./routes/elevenlabs.js";
import settingsRoutes from "./routes/settings.js";
import autoRenameRoutes from "./routes/autoRename.js";
import wednesdayRoutes from "./routes/wednesday.js";
import adminRoutes from "./routes/admin.js";
import ticketsRoutes from "./routes/tickets.js";
import { startRecentTasksRefresh } from "./services/recentTasksService.js";
import { ensureTable } from "./services/dbCacheService.js";
import { loadFrequencyIntoMemory } from "./services/frequencyService.js";
import { getSettings } from "./services/settingsService.js";

// On cold start: ensure DB table exists, load frequency from Neon into memory,
// and fetch recent task examples. All non-blocking — static JSON seed covers the gap.
export const startupReady = ensureTable()
  .then(() => Promise.all([
    loadFrequencyIntoMemory(getSettings()),
    startRecentTasksRefresh(),
  ]))
  .catch(() => {});

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Routes
app.use("/api/monday", mondayRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/elevenlabs", elevenLabsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/auto-rename", autoRenameRoutes);
app.use("/api/wednesday", wednesdayRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tickets", ticketsRoutes);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// In Docker / self-hosted production: serve the pre-built React app.
// Vercel handles static files itself (it sets VERCEL=1), so this block is skipped there.
// Local dev also skips it (NODE_ENV is not 'production').
if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
  const distPath = resolve(__dirname, "../client/dist");
  app.use(express.static(distPath));
  // SPA fallback — any unknown route returns index.html
  app.get("*", (_req, res) => res.sendFile(resolve(distPath, "index.html")));
}

export default app;
