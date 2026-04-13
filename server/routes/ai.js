// AI assist route.
// POST /api/ai/assist
// Body: { mode, input, boardType }
// Returns: JSON matching the VideoTask or DesignTask shape

import express from "express";
import { assistWithTask, generateBrief, trimScriptToTarget } from "../services/aiService.js";
import { analyzeReference, generateImage } from "../services/geminiService.js";
import { AI_AGENTS } from "../aiAgents.js";
import { estimateDuration, formatDurationRange } from "../utils/durationEstimate.js";
// ELEVENLABS_DISABLED — restore import when credits available:
// import { estimateScriptDuration } from "../services/elevenLabsService.js";

const router = express.Router();

// Helper: estimate script duration and inject into formValues + return formatted text.
// Only runs for the Marketing/Media department on the video board.
async function injectDurationEstimate(task, formValues, boardType) {
  if (boardType !== "video" || task.department !== "Marketing/Media" || task.type === "TV") {
    return { formValues, durationText: null };
  }
  const SCRIPT_KEYS = ["scriptMessage", "script", "copyText", "bodyText"];
  const scriptKey = SCRIPT_KEYS.find(k => task[k] && String(task[k]).trim().length > 0);
  if (!scriptKey) return { formValues, durationText: null };

  // Syllable-based instant estimation
  const seconds = estimateDuration(String(task[scriptKey]));
  const durationText = formatDurationRange(seconds);
  if (!durationText) return { formValues, durationText: null };
  const filtered = formValues.filter(f => f.label !== "Estimated Duration");
  return {
    formValues: [...filtered, { label: "Estimated Duration", value: durationText }],
    durationText
  };
}

router.post("/assist", async (req, res) => {
  try {
    const { mode, input, boardType, taskContext } = req.body;

    if (!mode || !input || !boardType) {
      return res.status(400).json({ error: "mode, input, and boardType are required" });
    }

    if (!["autofill", "generate", "format", "historyLoad"].includes(mode)) {
      return res.status(400).json({ error: "mode must be autofill, generate, format, or historyLoad" });
    }

    const result = await assistWithTask({ mode, input, boardType, taskContext: taskContext || {} });
    res.json(result);
  } catch (err) {
    console.error("AI assist error:", err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Analyze a video or image reference with Gemini, then fill the form with Claude.
// Body: { fileData?, mimeType?, fileUrl?, instructions, boardType, taskContext? }
// fileData: base64-encoded file (for uploads). fileUrl: remote URL (YouTube or image/video link).
// Returns: JSON matching the board's task shape (same as /api/ai/assist)
router.post("/analyze-reference", async (req, res) => {
  try {
    const { fileData, mimeType, fileUrl, instructions, boardType, taskContext } = req.body;

    if (!boardType) return res.status(400).json({ error: "boardType is required" });
    if (!instructions?.trim()) return res.status(400).json({ error: "instructions are required" });
    if (!fileData && !fileUrl) return res.status(400).json({ error: "Either fileData or fileUrl is required" });

    // Guard against oversized uploads (20 MB limit for base64 = ~15 MB raw)
    if (fileData && fileData.length > 20 * 1024 * 1024 * 1.37) {
      return res.status(413).json({ error: "File is too large. Please upload files under 15 MB." });
    }

    // Step 1: Gemini analyzes the media
    const referenceAnalysis = await analyzeReference({
      fileData: fileData || null,
      mimeType: mimeType || null,
      fileUrl: fileUrl || null,
      instructions,
    });

    // Step 2: Claude fills the form using the reference analysis + instructions
    const input = `REFERENCE ANALYSIS (from Gemini):\n${referenceAnalysis}\n\nUSER INSTRUCTIONS:\n${instructions}`;
    const result = await assistWithTask({
      mode: "reference",
      input,
      boardType,
      taskContext: taskContext || {},
    });

    // Attach the reference analysis so the client can share it with Wednesday
    res.json({ ...result, _referenceAnalysis: referenceAnalysis });
  } catch (err) {
    console.error("Analyze-reference error:", err.message);
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

// Generate a batch of 2–5 distinct task objects + their briefs in one call.
// Body: { prompt, boardType }
// Returns: { tasks: [{ id, task, brief }] }
router.post("/batch", async (req, res) => {
  try {
    const { prompt, boardType } = req.body;
    if (!prompt || !boardType) {
      return res.status(400).json({ error: "prompt and boardType are required" });
    }

    // Step 1: Generate all task objects in one Sonnet call
    const batchResult = await assistWithTask({ mode: "batch", input: prompt, boardType });
    const tasks = Array.isArray(batchResult?.tasks) ? batchResult.tasks.slice(0, 10) : [];

    if (tasks.length === 0) {
      return res.status(422).json({ error: "AI did not return any tasks. Try a more specific prompt." });
    }

    // Step 2: Generate briefs for all tasks in parallel
    const withBriefs = await Promise.all(
      tasks.map(async (task, i) => {
        try {
          // Build display-ready form values for the brief writer
          let formValues = Object.entries(task)
            .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
            .map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join(", ") : String(v) }));

          const { formValues: fv, durationText } = await injectDurationEstimate(task, formValues, boardType);
          const brief = await generateBrief({ formValues: fv, boardType, estimatedDurationText: durationText });
          return { id: `batch-${i}-${Date.now()}`, task, brief };
        } catch {
          return { id: `batch-${i}-${Date.now()}`, task, brief: null };
        }
      })
    );

    res.json({ tasks: withBriefs });
  } catch (err) {
    console.error("Batch generate error:", err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Streaming batch — N parallel individual Haiku calls, one per task.
// Each task is seeded with a specific angle type or product — streams as they complete.
// Body: { concept, boardType, mode, count, selectedProduct, selectedProducts }
router.post("/batch-stream", async (req, res) => {
  const { concept, boardType, mode, count, selectedProduct, selectedProducts } = req.body;
  if (!concept || !boardType) {
    return res.status(400).json({ error: "concept and boardType are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Angle seeds — ensures variety across parallel calls
  const ANGLE_TYPES = [
    "emotional transformation (before/after journey)",
    "social proof and testimonials",
    "pain point / problem-first",
    "benefit-first / solution reveal",
    "humor and relatable scenario",
    "urgency and scarcity",
    "science and ingredient authority",
    "lifestyle aspiration",
    "comparison (before vs after product)",
    "curiosity hook / open loop",
  ];

  let seeds;
  if (mode === "products" && Array.isArray(selectedProducts) && selectedProducts.length > 0) {
    seeds = selectedProducts.map((product) => ({ product, angleType: null }));
  } else {
    const n = Math.min(Math.max(Number(count) || 3, 2), 10);
    seeds = Array.from({ length: n }, (_, i) => ({
      product: selectedProduct || null,
      angleType: ANGLE_TYPES[i % ANGLE_TYPES.length],
    }));
  }

  emit({ type: "start", total: seeds.length });

  await Promise.all(
    seeds.map(async (seed, i) => {
      try {
        const productLine = seed.product  ? `Product: ${seed.product}.`       : "";
        const angleLine   = seed.angleType ? `Angle to use: ${seed.angleType}.` : "";
        const taskPrompt  = [concept, productLine, angleLine].filter(Boolean).join("\n");

        const taskResult = await assistWithTask({ mode: "singleTaskGenerate", input: taskPrompt, boardType });
        // singleTaskGenerate returns a plain object; guard against wrapped format
        const task = taskResult?.tasks?.[0] ?? taskResult;

        let formValues = Object.entries(task)
          .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join(", ") : String(v) }));

        const { formValues: fv, durationText } = await injectDurationEstimate(task, formValues, boardType);
        const brief = await generateBrief({ formValues: fv, boardType, estimatedDurationText: durationText });
        emit({ type: "task", index: i, id: `batch-${i}-${Date.now()}`, task, brief });
      } catch (err) {
        console.error(`[Batch] Task ${i} failed:`, err.message);
        emit({ type: "task", index: i, id: `batch-${i}-${Date.now()}`, task: null, brief: null });
      }
    })
  );

  emit({ type: "done" });
  res.end();
});

// Generate an image with Nano Banana 2 (gemini-3.1-flash-image-preview).
// Body: { prompt }
// Returns: { base64, mimeType }
router.post("/generate-image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: "prompt is required" });
    const result = await generateImage(prompt.trim());
    res.json(result);
  } catch (err) {
    console.error("[generate-image] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
