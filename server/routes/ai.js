// AI assist route.
// POST /api/ai/assist
// Body: { mode, input, boardType, exampleItems }
// Returns: JSON matching the VideoTask or DesignTask shape

import express from "express";
import { assistWithTask } from "../services/aiService.js";

const router = express.Router();

router.post("/assist", async (req, res) => {
  try {
    const { mode, input, boardType, exampleItems } = req.body;

    if (!mode || !input || !boardType) {
      return res.status(400).json({ error: "mode, input, and boardType are required" });
    }

    if (!["autofill", "generate", "format"].includes(mode)) {
      return res.status(400).json({ error: "mode must be autofill, generate, or format" });
    }

    const result = await assistWithTask({ mode, input, boardType, exampleItems: exampleItems || [] });
    res.json(result);
  } catch (err) {
    console.error("AI assist error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
