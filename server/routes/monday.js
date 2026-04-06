// Monday.com API routes.
// POST /api/monday/create-item  — create a new board item
// GET  /api/monday/users        — fetch all users for dropdowns
// GET  /api/monday/examples     — fetch recent items for AI context
// GET  /api/monday/columns      — fetch board columns (for setup/debugging)

import express from "express";
import multer from "multer";
import { createItem, createUpdate, getExampleItems, getHistoryItems, getItemFirstUpdate, getUsers, getBoardColumns, uploadFileToColumn, getItem, renameItem } from "../services/mondayService.js";
import { getSettings } from "../services/settingsService.js";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// Create a new task on a Monday board, then post a summary update on it.
// Body: { boardId, itemName, columnValues, updateBody? }
router.post("/create-item", async (req, res) => {
  try {
    const { boardId, itemName, columnValues, updateBody } = req.body;
    if (!boardId || !itemName) {
      return res.status(400).json({ error: "boardId and itemName are required" });
    }
    // Use per-user key if provided, otherwise falls back to env MONDAY_API_KEY
    const apiKey = req.headers["x-monday-api-key"] || null;
    const result = await createItem(boardId, itemName, columnValues || {}, apiKey);
    const itemId = result?.create_item?.id;
    const url = result?.create_item?.url ?? null;
    if (itemId && updateBody) {
      await createUpdate(itemId, updateBody, apiKey).catch((err) =>
        console.warn("Update post failed (item still created):", err.message)
      );
    }
    res.json({ itemId, url, create_item: result?.create_item });
  } catch (err) {
    console.error("Monday create-item error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// Fetch team members for the Requestor / Editor/Designer dropdowns.
router.get("/users", async (_req, res) => {
  try {
    const users = await getUsers();
    res.json(users);
  } catch (err) {
    console.error("Monday users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch recent board items to use as AI training examples.
// Query param: boardId
router.get("/examples", async (req, res) => {
  try {
    const { boardId } = req.query;
    if (!boardId) return res.status(400).json({ error: "boardId is required" });
    const items = await getExampleItems(boardId, 50);
    res.json(items);
  } catch (err) {
    console.error("Monday examples error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Post a text/HTML update (comment) on an existing Monday item.
// Body: { itemId, body }
router.post("/create-update", async (req, res) => {
  try {
    const { itemId, body } = req.body;
    if (!itemId || !body) {
      return res.status(400).json({ error: "itemId and body are required" });
    }
    const apiKey = req.headers["x-monday-api-key"] || null;
    const result = await createUpdate(itemId, body, apiKey);
    res.json(result);
  } catch (err) {
    console.error("Create update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Upload a file to a Monday file column on an existing item.
// Body (multipart): itemId, columnId, file (the binary).
router.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    const { itemId, columnId } = req.body;
    if (!itemId || !columnId || !req.file) {
      return res.status(400).json({ error: "itemId, columnId and file are required" });
    }
    const result = await uploadFileToColumn(
      itemId,
      columnId,
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    res.json(result);
  } catch (err) {
    console.error("File upload error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch board column IDs and types — useful when mapping form fields to columns.
router.get("/columns", async (req, res) => {
  try {
    const { boardId } = req.query;
    if (!boardId) return res.status(400).json({ error: "boardId is required" });
    const columns = await getBoardColumns(boardId);
    res.json(columns);
  } catch (err) {
    console.error("Monday columns error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch the first update (brief HTML) for a Monday task item.
// Query param: itemId
router.get("/item-update", async (req, res) => {
  try {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "itemId is required" });
    const body = await getItemFirstUpdate(itemId);
    res.json({ body: body || null });
  } catch (err) {
    console.error("Monday item-update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch the last 50 items from a board for the History drawer.
// Query param: boardType ("video" | "design")
router.get("/history", async (req, res) => {
  try {
    const { boardType } = req.query;
    if (!boardType) return res.status(400).json({ error: "boardType is required" });

    const settings = getSettings();
    const board = settings.boards.find((b) => b.id === boardType);
    if (!board?.boardId) return res.status(404).json({ error: "Board not found" });

    const items = await getHistoryItems(board.boardId, 50);

    // Map each item to a flat structure the client can use
    const history = items.map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.created_at,
      columnValues: item.column_values.map((cv) => ({
        id: cv.id,
        text: cv.text || "",
        value: cv.value || null,
      })),
    }));

    res.json(history);
  } catch (err) {
    console.error("Monday history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Name suggestion helpers (mirrors client-side buildAutoName) ───────────────

function applyNameRules(board, task) {
  if (!board.autoName) return task.taskName || "";
  return board.autoName.segments
    .map((seg) => {
      let val = task[seg.field];
      if (!val && seg.fallback) val = task[seg.fallback];
      if (!val) return null;
      if (seg.onlyWhenField && task[seg.onlyWhenField] !== seg.onlyWhenValue) return null;
      if (seg.onlyValues && !seg.onlyValues.includes(val)) return null;
      if (seg.skipValues && seg.skipValues.includes(val)) return null;
      if (seg.valueMap && seg.valueMap[val]) val = seg.valueMap[val];
      return val;
    })
    .filter(Boolean)
    .join(" | ");
}

// Fetch a task by URL or ID, compute its suggested new name from the board's
// naming rules, and return both the current and suggested names for review.
// Body: { itemUrl } or { itemId }
router.post("/suggest-rename", async (req, res) => {
  try {
    const { itemUrl, itemId: rawId } = req.body;

    // Parse item ID from URL (…/pulses/123456…) or accept it directly
    let itemId = rawId;
    if (!itemId && itemUrl) {
      const match = itemUrl.match(/\/pulses\/(\d+)/);
      if (!match) return res.status(400).json({ error: "Could not find a task ID in that URL." });
      itemId = match[1];
    }
    if (!itemId) return res.status(400).json({ error: "itemUrl or itemId is required." });

    const item = await getItem(itemId);
    if (!item) return res.status(404).json({ error: "Task not found on Monday." });

    const boardId = String(item.board.id);
    const settings = getSettings();
    const board = settings.boards.find((b) => String(b.boardId) === boardId);
    if (!board) return res.status(404).json({ error: "This board is not configured in Task Creator." });

    // Build a task object by mapping each column value back to its field key
    const colTextMap = {};
    item.column_values.forEach((cv) => { colTextMap[cv.id] = cv.text || ""; });

    const task = {};
    board.fields.forEach((f) => {
      if (f.mondayColumnId && colTextMap[f.mondayColumnId]) {
        task[f.key] = colTextMap[f.mondayColumnId];
      }
    });

    // taskName — extract from the current item name.
    // The auto-name format is "Segment1 | Segment2 | ... | UserTaskName".
    // We take everything after the last " | " as the user-written task name.
    const parts = item.name.split(" | ");
    task.taskName = parts[parts.length - 1].trim();

    const suggestedName = applyNameRules(board, task);

    res.json({
      itemId: String(itemId),
      boardId,
      boardLabel: board.label,
      currentName: item.name,
      suggestedName,
    });
  } catch (err) {
    console.error("Suggest rename error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apply a new name to a Monday task.
// Body: { itemId, boardId, newName }
router.post("/rename-item", async (req, res) => {
  try {
    const { itemId, boardId, newName } = req.body;
    if (!itemId || !boardId || !newName) {
      return res.status(400).json({ error: "itemId, boardId, and newName are required." });
    }
    const result = await renameItem(boardId, itemId, newName);
    res.json(result);
  } catch (err) {
    console.error("Rename item error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
