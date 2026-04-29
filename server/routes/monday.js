// Monday.com API routes.
// POST /api/monday/create-item   — create a new board item
// GET  /api/monday/users         — fetch all users for dropdowns
// GET  /api/monday/examples      — fetch recent items for AI context
// GET  /api/monday/columns       — fetch board columns (for setup/debugging)
// POST /api/monday/blob-token    — generate Vercel Blob client upload token
// POST /api/monday/blob-forward  — fetch blob and upload to Monday, then delete blob

import express from "express";
import multer from "multer";
import { handleUpload } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { createItem, createUpdate, getMe, getExampleItems, getHistoryItems, getItemFirstUpdate, getUsers, getBoardColumns, uploadFileToColumn, getItem, renameItem } from "../services/mondayService.js";
import { getSettings } from "../services/settingsService.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
});

const router = express.Router();

// ── Vercel Blob upload token ─────────────────────────────────────────────────
// Called by the browser to get a signed token for direct Vercel Blob upload.
// Uses handleUpload which handles both token generation and upload-completed
// callbacks in a single endpoint.
//
// CRITICAL (@vercel/blob v2.x): In v2.x, handleUpload determines the callbackUrl
// from Vercel system env vars (VERCEL_PROJECT_PRODUCTION_URL), NOT from the
// `request.url` we pass. If that env var is absent, callbackUrl is `undefined`
// → blob stays in "pending" state → CDN always returns 404.
//
// Fix: return `callbackUrl` explicitly from onBeforeGenerateToken. v2.x
// will use this value directly, bypassing env-var detection entirely.
router.post("/blob-token", async (req, res) => {
  try {
    // Build the absolute callback URL that Vercel Blob will POST to after upload.
    // Priority: x-forwarded-host (real hostname behind Vercel's proxy)
    //           → VERCEL_PROJECT_PRODUCTION_URL (Vercel system env)
    //           → VERCEL_URL (deployment URL)
    //           → request Host header (local dev)
    const host =
      req.headers["x-forwarded-host"]?.split(",")[0].trim() ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      req.get("host");
    const callbackUrl = `https://${host}${req.originalUrl}`;
    console.log("[blob-token] Using callbackUrl:", callbackUrl);

    const jsonResponse = await handleUpload({
      body: req.body,
      request: {
        headers: { get: (h) => req.headers[h.toLowerCase()] ?? null },
        url: callbackUrl, // path extraction in v2.x
      },
      onBeforeGenerateToken: async (_pathname) => ({
        allowedContentTypes: [
          "image/*", "video/*", "application/pdf",
          "application/zip", "application/x-zip-compressed",
        ],
        maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB client-side cap
        addRandomSuffix: true,
        callbackUrl, // ← v2.x: explicit override so the blob is confirmed correctly
      }),
      onUploadCompleted: async () => {
        // Nothing to do — blob-forward handles Monday upload and cleanup
      },
    });
    res.json(jsonResponse);
  } catch (err) {
    console.error("[blob-token]", err);
    res.status(400).json({ error: err.message });
  }
});

// Fetches a Vercel Blob by its public URL.
//
// KEY INSIGHT: When using handleUpload client uploads, the blob may be in a
// "pending" state on the public CDN until the upload callback is confirmed.
// Fetching with the BLOB_READ_WRITE_TOKEN Authorization header hits Vercel's
// ORIGIN storage API directly — this always works regardless of CDN state
// or callback timing.
async function fetchBlobAuthenticated(url) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // First attempt: authenticated origin fetch (most reliable)
  console.log(`[blob-forward] Fetching blob (authenticated): ${url}`);
  const res = await fetch(url, { headers });
  if (res.ok) {
    console.log(`[blob-forward] Blob fetched OK (${res.status}), size: ${res.headers.get("content-length") ?? "unknown"} bytes`);
    return res;
  }
  console.warn(`[blob-forward] Authenticated fetch got ${res.status}, falling back to unauthenticated…`);

  // Second attempt: unauthenticated (in case token was wrong/absent)
  const res2 = await fetch(url);
  if (res2.ok) {
    console.log(`[blob-forward] Unauthenticated fetch succeeded (${res2.status})`);
    return res2;
  }

  throw new Error(`Failed to fetch blob: authenticated=${res.status}, unauthenticated=${res2.status} (url=${url})`);
}

// ── Vercel Blob → Monday forward ─────────────────────────────────────────────
// After the browser uploads a file to Vercel Blob, it calls this endpoint.
// We fetch the blob (server-to-server, fast), send it to Monday via
// add_file_to_column, then delete the blob (cleanup).
// Body: { blobUrl, itemId, columnId, fileName, mimeType, mondayApiKey? }
router.post("/blob-forward", async (req, res) => {
  const { blobUrl, itemId, columnId, fileName, mimeType } = req.body;
  if (!blobUrl || !itemId || !columnId) {
    return res.status(400).json({ error: "blobUrl, itemId, and columnId are required" });
  }

  const apiKey = req.headers["x-monday-api-key"] || null;

  try {
    // 1. Fetch the blob using authenticated origin API (bypasses CDN pending state)
    const blobRes = await fetchBlobAuthenticated(blobUrl);
    const buffer = Buffer.from(await blobRes.arrayBuffer());
    console.log(`[blob-forward] Fetched ${buffer.length} bytes, forwarding to Monday…`);

    // 2. Upload to Monday (server-to-server, no CORS, no body limit)
    await uploadFileToColumn(itemId, columnId, buffer, fileName, mimeType, apiKey);

    // 3. Delete the blob (fire-and-forget — don't fail the request on cleanup error)
    del(blobUrl).catch((e) => console.warn("[blob-forward] del failed:", e.message));

    res.json({ success: true });
  } catch (err) {
    console.error("[blob-forward]", err);
    // Attempt cleanup even on failure
    del(blobUrl).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── Legacy: direct Monday API key for old client upload (kept for backward compat)
router.get("/upload-token", (req, res) => {
  const key = req.headers["x-monday-api-key"] || process.env.MONDAY_API_KEY || null;
  if (!key) return res.status(503).json({ error: "No Monday API key configured" });
  res.json({ token: key });
});

// Returns true when a Monday API error is an authorization failure.
// Used to detect when a user's personal key lacks board-write permission.
function isUnauthorized(err) {
  const msg = err.message?.toLowerCase() ?? "";
  return msg.includes("unauthorized") || msg.includes("not authorized") || msg.includes("access denied");
}

// Create a new task on a Monday board, then post a summary update on it.
// Body: { boardId, itemName, columnValues, updateBody? }
router.post("/create-item", async (req, res) => {
  try {
    const { boardId, itemName, columnValues, updateBody, createdBy } = req.body;
    if (!boardId || !itemName) {
      return res.status(400).json({ error: "boardId and itemName are required" });
    }
    const userKey  = req.headers["x-monday-api-key"] || null;
    console.log(`[create-item] boardId=${boardId} itemName="${itemName}"`);
    const adminKey = null; // null → mondayService falls back to process.env.MONDAY_API_KEY

    // Try with the user's personal key first (preserves Monday authorship).
    // If Monday rejects it (board write permission), fall back to admin key.
    let result;
    try {
      result = await createItem(boardId, itemName, columnValues || {}, userKey);
    } catch (authErr) {
      if (isUnauthorized(authErr) && userKey) {
        console.warn(`[create-item] Personal key unauthorized — retrying with admin key. Creator: ${createdBy || "unknown"}`);
        result = await createItem(boardId, itemName, columnValues || {}, adminKey);
      } else {
        throw authErr;
      }
    }

    const itemId = result?.create_item?.id;
    const url = result?.create_item?.url ?? null;
    if (itemId && updateBody) {
      await createUpdate(itemId, updateBody, adminKey).catch((err) =>
        console.warn("Update post failed (item still created):", err.message)
      );
    }
    res.json({ itemId, url, create_item: result?.create_item });
  } catch (err) {
    const isDeactivatedLabel = err.message?.includes("label has been deactivated") ||
      err.message?.includes("deactivated") ||
      err.message?.includes("ColumnValueException");

    if (isDeactivatedLabel) {
      const { boardId, columnValues, itemName, updateBody } = req.body;
      const apiKey = null; // deactivated-label retry always uses admin key
      const settings = getSettings();
      const board = settings.boards?.find((b) => b.boardId === boardId);

      // Build reverse map: mondayColumnId → field label for user-facing messages
      const colIdToLabel = {};
      if (board?.fields) {
        for (const f of board.fields) {
          if (f.mondayColumnId) colIdToLabel[f.mondayColumnId] = f.label;
        }
      }

      // Try to identify EXACTLY which columns Monday flagged from the raw error messages
      const rawErrors = err.mondayErrors || [];
      const badColIds = new Set();
      for (const e of rawErrors) {
        const msg = JSON.stringify(e);
        for (const colId of Object.keys(columnValues || {})) {
          if (msg.includes(colId)) badColIds.add(colId);
        }
      }

      // Fall back to all status-type columns if we couldn't parse specifics
      const allStatusCols = Object.entries(columnValues || {})
        .filter(([, v]) => v && typeof v === "object" && "label" in v)
        .map(([colId]) => colId);
      const colsToStrip = badColIds.size > 0 ? [...badColIds] : allStatusCols;

      const badDescriptions = colsToStrip
        .map((colId) => `"${colIdToLabel[colId] || colId}" (value: "${columnValues[colId]?.label ?? "?"}")`)
        .join(", ");

      console.warn(
        `[create-item] Deactivated label — retrying without: ${badDescriptions}\n` +
        `  Board: ${boardId} | Item: ${itemName}\n` +
        `  Raw Monday error: ${err.message}`
      );

      // Retry without the bad status columns
      const cleanedColumnValues = { ...columnValues };
      for (const colId of colsToStrip) delete cleanedColumnValues[colId];

      try {
        const retryResult = await createItem(boardId, itemName, cleanedColumnValues, apiKey);
        const itemId = retryResult?.create_item?.id;
        const url = retryResult?.create_item?.url ?? null;
        if (itemId && updateBody) {
          await createUpdate(itemId, updateBody, apiKey).catch((e) =>
            console.warn("Update post failed after retry:", e.message)
          );
        }
        return res.json({
          itemId, url,
          create_item: retryResult?.create_item,
          warning: `Task created, but these fields could not be set (options deactivated in Monday): ${badDescriptions}. Update them directly in Monday.`,
        });
      } catch (retryErr) {
        console.error("[create-item] Retry also failed:", retryErr.message);
        return res.status(422).json({
          error: `Could not create task even after stripping problematic fields. Monday error: ${retryErr.message}`,
          code: "DEACTIVATED_LABEL",
        });
      }
    }

    console.error("Monday create-item error:", err.message);
    res.status(500).json({ error: err.message });
  }
});



// Resolve the Monday identity for the API key in the request header.
// Used by the client to store the user's name alongside their key.
router.get("/me", async (req, res) => {
  try {
    const apiKey = req.headers["x-monday-api-key"] || null;
    const me = await getMe(apiKey);
    if (!me) return res.status(404).json({ error: "Could not resolve user" });
    res.json(me);
  } catch (err) {
    console.error("Monday /me error:", err.message);
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
    const userKey = req.headers["x-monday-api-key"] || null;
    let result;
    try {
      result = await createUpdate(itemId, body, userKey);
    } catch (authErr) {
      if (isUnauthorized(authErr) && userKey) {
        console.warn("[create-update] Personal key unauthorized — retrying with admin key");
        result = await createUpdate(itemId, body, null);
      } else {
        throw authErr;
      }
    }
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
    const userKey = req.headers["x-monday-api-key"] || null;
    if (!itemId || !columnId || !req.file) {
      return res.status(400).json({ error: "itemId, columnId and file are required" });
    }
    let result;
    try {
      result = await uploadFileToColumn(itemId, columnId, req.file.buffer, req.file.originalname, req.file.mimetype, userKey);
    } catch (authErr) {
      if (isUnauthorized(authErr) && userKey) {
        console.warn("[upload-file] Personal key unauthorized — retrying with admin key");
        result = await uploadFileToColumn(itemId, columnId, req.file.buffer, req.file.originalname, req.file.mimetype, null);
      } else {
        throw authErr;
      }
    }
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

function toTitleCase(str) {
  return str.trim().replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

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
      if (seg.requireFieldEmpty) {
        const guard = task[seg.requireFieldEmpty];
        if (guard && guard !== "None" && guard !== "") return null;
      }
      if (seg.aliasWhenValue && seg.aliasWhenValue[val]) {
        const aliasVal = task[seg.aliasWhenValue[val]];
        if (aliasVal) return toTitleCase(String(aliasVal));
        return null;
      }
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
