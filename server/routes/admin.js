// admin routes — internal endpoints called by Vercel cron jobs.
// POST /api/admin/refresh-frequency — re-fetches dropdown frequency from Monday + saves to Neon

import express from "express";
import { refreshAllBoards } from "../services/frequencyService.js";
import { getSettings, syncProductsFromMonday } from "../services/settingsService.js";

const router = express.Router();

// Called by Vercel cron every Saturday at 9am UTC.
// Fetches the last 500 items from each Monday board, counts dropdown value frequency,
// saves the sorted result to Neon Postgres, and updates the in-memory cache.
router.post("/refresh-frequency", async (_req, res) => {
  try {
    const settings = getSettings();
    const result   = await refreshAllBoards(settings);
    const summary  = Object.fromEntries(
      Object.entries(result).map(([board, fields]) => [
        board,
        `${Object.keys(fields).length} fields`,
      ])
    );
    console.log("[cron] refresh-frequency complete:", summary);
    res.json({ ok: true, updated: summary });
  } catch (err) {
    console.error("[cron] refresh-frequency failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Called by Vercel cron daily at 4:00 AM UTC (7:00 AM Jerusalem Time).
// Syncs products from Monday.com status columns and updates settings.json.
router.post("/sync-products", async (_req, res) => {
  try {
    const addedCount = await syncProductsFromMonday();
    console.log("[cron] sync-products complete. Added products:", addedCount);
    res.json({ ok: true, added: addedCount });
  } catch (err) {
    console.error("[cron] sync-products failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
