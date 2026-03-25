// server/app.js — Express app setup (exported for both local dev and Vercel serverless).
// Do not call app.listen() here — that lives in index.js (local dev only).

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from the project root (one level up from server/)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env"), override: true });

import mondayRoutes from "./routes/monday.js";
import aiRoutes from "./routes/ai.js";
import elevenLabsRoutes from "./routes/elevenlabs.js";
import settingsRoutes from "./routes/settings.js";
import autoRenameRoutes from "./routes/autoRename.js";
import wednesdayRoutes from "./routes/wednesday.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Routes
app.use("/api/monday", mondayRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/elevenlabs", elevenLabsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/auto-rename", autoRenameRoutes);
app.use("/api/wednesday", wednesdayRoutes);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

export default app;
