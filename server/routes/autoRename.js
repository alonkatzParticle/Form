// Auto-rename routes.
// GET  /api/auto-rename/status  — current state (enabled, lastRun, log)
// POST /api/auto-rename/toggle  — enable or disable the scheduled job
// POST /api/auto-rename/run     — trigger a manual run immediately

import express from "express";
import { getState, setEnabled, runAutoRename } from "../services/autoRenameService.js";

const router = express.Router();

router.get("/status", (_req, res) => {
  try {
    res.json(getState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/toggle", (req, res) => {
  try {
    const { enabled } = req.body;
    const state = setEnabled(typeof enabled === "boolean" ? enabled : !getState().enabled);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/run", async (_req, res) => {
  try {
    const state = await runAutoRename();
    res.json(state);
  } catch (err) {
    console.error("[auto-rename] Manual run failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
