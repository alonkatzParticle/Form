// ElevenLabs route for script duration estimation.
// POST /api/elevenlabs/duration
// Body: { script }
// Returns: { estimatedSeconds }

import express from "express";
import { estimateScriptDuration } from "../services/elevenLabsService.js";

const router = express.Router();

router.post("/duration", async (req, res) => {
  try {
    const { script } = req.body;
    if (!script) {
      return res.status(400).json({ error: "script is required" });
    }
    const result = await estimateScriptDuration(script);
    res.json(result);
  } catch (err) {
    console.error("ElevenLabs duration error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
