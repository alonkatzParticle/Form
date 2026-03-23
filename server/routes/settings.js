// settings routes
// GET /api/settings            — returns full settings (boards, fields, board IDs)
// GET /api/settings/sync-check — compares settings field columns against live Monday board
import express from "express";
import { getSettings, updateSettings } from "../services/settingsService.js";
import { getBoardColumns } from "../services/mondayService.js";

const router = express.Router();

// Return the full settings object. The client uses this to build the board tabs and forms.
router.get("/", (_req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    console.error("Settings read error:", err.message);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

// Compare the column IDs configured in settings against the live Monday board.
// Returns:
//   missing — fields in settings whose mondayColumnId doesn't exist on the board any more
//   added   — Monday columns not yet referenced by any field in settings
//   clean   — true when there are no discrepancies
router.get("/sync-check", async (req, res) => {
  try {
    const { boardId } = req.query;
    if (!boardId) return res.status(400).json({ error: "boardId is required" });

    const settings = getSettings();
    const board = settings.boards.find((b) => b.boardId === boardId);
    if (!board) return res.status(404).json({ error: "Board not found in settings" });

    const mondayColumns = await getBoardColumns(boardId);
    const mondayColumnIds = new Set(mondayColumns.map((c) => c.id));

    // Fields whose configured column no longer exists on Monday
    const missing = board.fields
      .filter((f) => f.mondayColumnId && !mondayColumnIds.has(f.mondayColumnId))
      .map((f) => ({ key: f.key, label: f.label, mondayColumnId: f.mondayColumnId }));

    // Monday columns not referenced by any field
    const referencedIds = new Set(board.fields.filter((f) => f.mondayColumnId).map((f) => f.mondayColumnId));
    const added = mondayColumns
      .filter((c) => !referencedIds.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, type: c.type }));

    res.json({ boardLabel: board.label, missing, added, clean: missing.length === 0 && added.length === 0 });
  } catch (err) {
    console.error("Sync-check error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update settings — used by the future admin page.
router.put("/", (req, res) => {
  try {
    const updated = updateSettings(req.body);
    res.json(updated);
  } catch (err) {
    console.error("Settings write error:", err.message);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
