// settings routes
// GET /api/settings            — returns full settings (boards, fields, board IDs)
// GET /api/settings/sync-check — compares settings field columns against live Monday board
import express from "express";
import { getSettings, updateSettings, updateBoardFields, updateBoardTemplate, addFieldOption, setFieldOptions } from "../services/settingsService.js";

import { getBoardColumns, getColumnSettings } from "../services/mondayService.js";

import { AI_AGENTS, FIELD_DEFINITIONS } from "../aiAgents.js";

// Map settings board labels → boardType keys used in AI_AGENTS
const BOARD_TYPE_KEYS = { "Video Projects": "video", "Design Projects - 2.0": "design" };

const router = express.Router();

// Return all AI agent prompt data for the read-only prompts viewer in Settings.
//
// Auto-discovery: most agents are picked up automatically from AI_AGENTS.
// Special cases handled here:
//   "wednesday"    — nested per-board object → expanded into wednesday_video, wednesday_design
//   "briefWriter"  — has a departments map → expanded into per-department sub-entries per board
//
// Adding a new top-level agent to AI_AGENTS.js will appear in the viewer automatically.
// Adding a new department to briefWriter.departments will also appear automatically.
router.get("/prompts", (_req, res) => {
  try {
    const agents = [];

    for (const [key, agent] of Object.entries(AI_AGENTS)) {

      // ── wednesday: nested per-board object ─────────────────────────────────
      if (key === "wednesday") {
        for (const [boardId, wa] of Object.entries(agent)) {
          agents.push({
            key: `wednesday_${boardId}`,
            name: `Wednesday (${boardId})`,
            description: "Conversational AI sidebar assistant.",
            model: wa.model,
            systemPrompt: wa.systemPrompt,
            scope: boardId,
          });
        }
        continue;
      }

      // ── briefWriter: expand departments map into per-department sub-entries ─
      if (key === "briefWriter" && agent.departments) {
        for (const [boardId, deptMap] of Object.entries(agent.departments)) {
          for (const [deptName, deptConfig] of Object.entries(deptMap)) {
            const displayName = deptName === "_default"
              ? "Other Departments"
              : deptName;
            agents.push({
              key: `briefWriter__${boardId}__${deptName}`,
              name: `Brief Writer — ${displayName}`,
              description: deptName === "_default"
                ? `Generic brief writer for all ${boardId} departments not listed above.`
                : `Brief writer for the ${displayName} department on the ${boardId} board.`,
              model: agent.model,
              systemPrompt: deptConfig.systemPrompt ?? "",
              modeInstruction: "",
              examples: { [boardId]: deptConfig.example ?? "" },
              scope: boardId,
              colorCode: deptConfig.colorCode ?? false,
              supportedDepts: deptName === "_default" ? "all" : [deptName],
            });
          }
        }
        continue;
      }

      // ── all other agents: standard flat entry ───────────────────────────────
      agents.push({
        key,
        name: agent.name,
        description: agent.description ?? "",
        model: agent.model,
        systemPrompt: agent.systemPrompt ?? "",
        modeInstruction: agent.modeInstruction ?? "",
        examples: agent.examples ?? null,
        scope: "all",
        supportedDepts: agent.supportedDepts ?? "all",
      });
    }

    // Build boardDepartments map from settings.json so the viewer can show dept pills
    const settings = getSettings();
    const boardDepartments = {};
    for (const board of settings.boards) {
      const bKey = BOARD_TYPE_KEYS[board.label];
      if (!bKey) continue;
      const deptField = board.fields.find((f) => f.key === "department");
      if (deptField?.options) boardDepartments[bKey] = deptField.options;
    }

    res.json({ fieldDefinitions: FIELD_DEFINITIONS, agents, boardDepartments });
  } catch (err) {
    console.error("Prompts read error:", err.message);
    res.status(500).json({ error: "Failed to read AI prompts" });
  }
});


// Verify the settings password. Returns 200 on match, 401 on wrong password.

router.post("/auth", (req, res) => {
  const { password } = req.body;
  if (password === process.env.SETTINGS_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Incorrect password" });
  }
});

// Return all settings, with dropdown field options synced from Monday's live column labels.
// Any new labels found in Monday are merged into the response AND persisted to settings.json.
router.get("/", async (_req, res) => {
  try {
    const settings = getSettings();

    // Collect dropdown fields that have a Monday column to sync against
    const syncTasks = [];
    for (const board of settings.boards) {
      for (const field of board.fields ?? []) {
        if (field.mondayValueType === "dropdown" && field.mondayColumnId) {
          syncTasks.push({ boardId: board.boardId, field });
        }
      }
    }

    // Fetch Monday column labels in parallel, ignore individual failures
    if (syncTasks.length > 0) {
      const results = await Promise.allSettled(
        syncTasks.map(({ boardId, field }) =>
          getColumnSettings(boardId, field.mondayColumnId)
            .then((colSettings) => ({ field, colSettings }))
        )
      );

      for (const result of results) {
        if (result.status !== "fulfilled" || !result.value.colSettings) continue;
        const { field, colSettings } = result.value;

        // labels may be an array [{id, name}] or an object
        const rawLabels = colSettings.labels ?? [];
        const mondayLabels = (Array.isArray(rawLabels)
          ? rawLabels.map((l) => l.name)
          : Object.values(rawLabels)
        ).filter(Boolean);

        const currentOptions = field.options ?? [];
        // Replace: use Monday as source of truth — remove stale, add new
        const hasChanged =
          mondayLabels.length !== currentOptions.length ||
          mondayLabels.some((l) => !currentOptions.includes(l)) ||
          currentOptions.some((l) => !mondayLabels.includes(l));

        if (hasChanged) {
          field.options = [...mondayLabels];
          setFieldOptions(field.key, mondayLabels);
          const removed = currentOptions.filter((l) => !mondayLabels.includes(l));
          const added   = mondayLabels.filter((l) => !currentOptions.includes(l));
          console.log(`[settings] Synced "${field.key}" — added: [${added.join(", ")}] removed: [${removed.join(", ")}]`);
        }
      }
    }

    res.json(settings);
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

// Update settings — generic patch or targeted board-level update.
// { boardId, fields }          → update that board's fields array only
// { boardId, updateTemplate }  → update that board's HTML update template only
// Otherwise fall back to a shallow settings merge.
router.put("/", (req, res) => {
  try {
    const { boardId, fields, updateTemplate } = req.body;
    let updated;
    if (boardId && Array.isArray(fields)) {
      updated = updateBoardFields(boardId, fields);
    } else if (boardId && typeof updateTemplate === "string") {
      updated = updateBoardTemplate(boardId, updateTemplate);
    } else {
      updated = updateSettings(req.body);
    }
    res.json(updated);
  } catch (err) {
    console.error("Settings write error:", err.message);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;
