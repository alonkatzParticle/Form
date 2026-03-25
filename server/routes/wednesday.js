// Wednesday — conversational AI assistant routes.
// POST /api/wednesday/chat  — SSE streaming chat endpoint

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { AI_AGENTS, FIELD_DEFINITIONS } from "../aiAgents.js";
import { getSkillContent, getBrandKnowledge } from "../services/skillLoader.js";
import { getSettings } from "../services/settingsService.js";

const router = express.Router();

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Format the current form state into a readable list for Wednesday's system prompt.
function formatFormState(formState, boardType) {
  const settings = getSettings();
  const board = settings.boards.find((b) => b.id === boardType);
  if (!board || !formState) return "Form is empty.";

  const lines = board.fields
    .filter((f) => f.type !== "file")
    .map((f) => {
      const val = formState[f.key];
      const isEmpty =
        val === null ||
        val === undefined ||
        val === "" ||
        (Array.isArray(val) && val.length === 0);
      const display = isEmpty
        ? "[empty]"
        : Array.isArray(val)
        ? val.join(", ")
        : String(val);
      return `- ${f.label}: ${display}`;
    });

  return lines.join("\n");
}

// Build Wednesday's system prompt with current form state injected.
function buildSystemPrompt(boardType, formState) {
  const agent = AI_AGENTS.wednesday[boardType] ?? AI_AGENTS.wednesday.video;
  const fieldDefs = FIELD_DEFINITIONS[boardType] ?? "";
  const skillKnowledge = getSkillContent(boardType);
  const brandKnowledge = getBrandKnowledge();
  const skillSection = (skillKnowledge || brandKnowledge)
    ? `\n\n---\n\n## BRAND & PRODUCT KNOWLEDGE\n\n${brandKnowledge}${skillKnowledge ? `\n\n---\n\n## CREATIVE KNOWLEDGE\n\n${skillKnowledge}` : ""}\n\n---\n\n`
    : "";

  const formStateStr = formatFormState(formState, boardType);

  return agent.systemPrompt
    .replaceAll("{{FORM_STATE}}", formStateStr)
    .replaceAll("{{FIELD_DEFINITIONS}}", fieldDefs)
    .replaceAll("{{SKILL_KNOWLEDGE}}", skillSection);
}

// POST /api/wednesday/chat
// Body: { messages: [{role, content}], boardType, formState }
// Returns: SSE stream of text chunks
router.post("/chat", async (req, res) => {
  const { messages = [], boardType = "video", formState = {} } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const agent = AI_AGENTS.wednesday[boardType] ?? AI_AGENTS.wednesday.video;
    const system = buildSystemPrompt(boardType, formState);

    // Cap history at last 20 messages to stay within token limits
    const history = messages.slice(-20);

    const stream = await getClient().messages.stream({
      model: agent.model,
      max_tokens: agent.maxTokens,
      system,
      messages: history,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("[wednesday] Chat error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
