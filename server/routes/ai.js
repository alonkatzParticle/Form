// AI assist route.
// POST /api/ai/assist
// Body: { mode, input, boardType, exampleItems }
// Returns: JSON matching the VideoTask or DesignTask shape

import express from "express";
import { assistWithTask, generateBrief, trimScriptToTarget } from "../services/aiService.js";

const router = express.Router();

router.post("/assist", async (req, res) => {
  try {
    const { mode, input, boardType, exampleItems, taskContext } = req.body;

    if (!mode || !input || !boardType) {
      return res.status(400).json({ error: "mode, input, and boardType are required" });
    }

    if (!["autofill", "generate", "format"].includes(mode)) {
      return res.status(400).json({ error: "mode must be autofill, generate, or format" });
    }

    const result = await assistWithTask({ mode, input, boardType, exampleItems: exampleItems || [], taskContext: taskContext || {} });
    res.json(result);
  } catch (err) {
    console.error("AI assist error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Generate a formatted HTML brief from resolved form values.
// Body: { formValues: [{ label, value }], boardType }
// Returns: { html: "<h3>…</h3><p>…</p>" }
router.post("/brief", async (req, res) => {
  try {
    const { formValues, boardType } = req.body;
    if (!formValues || !boardType) {
      return res.status(400).json({ error: "formValues and boardType are required" });
    }
    const html = await generateBrief({ formValues, boardType });
    res.json({ html });
  } catch (err) {
    console.error("AI brief error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Trim or expand a script to a specific target duration using ElevenLabs + Claude.
// Body: { script, targetDuration, type }
// Returns: { script, estimatedSeconds }
router.post("/trim-script", async (req, res) => {
  try {
    const { script, targetDuration, type } = req.body;
    if (!script) return res.status(400).json({ error: "script is required" });

    // Build target range from user's specified duration or video type
    let targetRange;
    if (targetDuration && targetDuration > 0) {
      targetRange = { min: targetDuration - 4, max: targetDuration + 4 };
    } else if (type?.includes("Short Form")) {
      targetRange = { min: 12, max: 22 };
    } else if (type?.includes("Long Form")) {
      targetRange = { min: 60, max: 120 };
    } else {
      targetRange = { min: 28, max: 47 };
    }

    const result = await trimScriptToTarget(script, targetRange);
    res.json(result);
  } catch (err) {
    console.error("Trim script error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
