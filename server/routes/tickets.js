// GET  /api/tickets  — fetch all shared submitted tickets from Neon
// POST /api/tickets  — save a submitted ticket to Neon
// DELETE /api/tickets/:id — remove a ticket
import express from "express";
import { getTickets, addTicket, removeTicket, isDbAvailable } from "../services/dbCacheService.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const tickets = await getTickets();
    res.json(tickets);
  } catch (err) {
    console.error("[tickets] GET failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const ticket = req.body;
    if (!ticket?.id) return res.status(400).json({ error: "ticket.id is required" });
    await addTicket(ticket);
    res.json({ ok: true, dbAvailable: isDbAvailable() });
  } catch (err) {
    console.error("[tickets] POST failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await removeTicket(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[tickets] DELETE failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
