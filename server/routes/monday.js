// Monday.com API routes.
// POST /api/monday/create-item  — create a new board item
// GET  /api/monday/users        — fetch all users for dropdowns
// GET  /api/monday/examples     — fetch recent items for AI context
// GET  /api/monday/columns      — fetch board columns (for setup/debugging)

import express from "express";
import { createItem, getExampleItems, getUsers, getBoardColumns } from "../services/mondayService.js";

const router = express.Router();

// Create a new task on a Monday board.
// Body: { boardId, itemName, columnValues }
router.post("/create-item", async (req, res) => {
  try {
    const { boardId, itemName, columnValues } = req.body;
    if (!boardId || !itemName) {
      return res.status(400).json({ error: "boardId and itemName are required" });
    }
    const result = await createItem(boardId, itemName, columnValues || {});
    res.json(result);
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

export default router;
