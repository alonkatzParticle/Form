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

      let display;
      if (isEmpty) {
        display = "[empty]";
      } else if (f.type === "hooks" && Array.isArray(val)) {
        // Render hooks as a numbered list so Wednesday can reference them by number
        const filled = val.filter(Boolean);
        if (filled.length === 0) {
          display = "[empty]";
        } else {
          display = "\n" + filled.map((h, i) => `    ${i + 1}. ${h}`).join("\n");
        }
      } else if (Array.isArray(val)) {
        display = val.join(", ");
      } else {
        display = String(val);
      }
      return `- ${f.label}: ${display}`;
    });

  return lines.join("\n");
}

function buildSystemPrompt(boardType, formState, referenceContext, clarificationMode) {
  const agent = AI_AGENTS.wednesday[boardType] ?? AI_AGENTS.wednesday.video;
  const fieldDefs = FIELD_DEFINITIONS[boardType] ?? "";
  const skillKnowledge = getSkillContent(boardType);
  const brandKnowledge = getBrandKnowledge();
  const skillSection = (skillKnowledge || brandKnowledge)
    ? `\n\n---\n\n## BRAND & PRODUCT KNOWLEDGE\n\n${brandKnowledge}${skillKnowledge ? `\n\n---\n\n## CREATIVE KNOWLEDGE\n\n${skillKnowledge}` : ""}\n\n---\n\n`
    : "";

  const formStateStr = formatFormState(formState, boardType);

  // Inject reference context if the user loaded a reference in the AI panel
  const referenceSection = referenceContext
    ? `\n\n## ACTIVE REFERENCE\nThe user loaded a media reference in the AI panel. Here is the Gemini analysis of that reference — use it when the user asks about it or wants to apply it:\n\n${referenceContext}\n`
    : "";

  // Inject clarification-mode instructions when opened from an AI panel "Generate Brief" failure
  const clarificationSection = clarificationMode
    ? `\n\n## CLARIFICATION MODE\nYou were opened automatically because the user's "Generate Brief" input was too vague for the AI to generate a good brief. Your job right now is to help them be more specific.\nAsk targeted follow-up questions — one or two at a time — to understand: the product, the video type/format, the target emotion or pain point, and any creative angle they have in mind.\nOnce you feel you have enough to generate a strong brief, explicitly tell the user: **"I think we have enough — go back to the AI panel and try Generate Brief again with this in your prompt: [give them a refined one-liner they can copy]."**\nDo NOT try to fill the form directly in this mode. Your only goal is to help them craft a better input for the AI panel.\n`
    : "";

  return agent.systemPrompt
    .replaceAll("{{FORM_STATE}}", formStateStr)
    .replaceAll("{{FIELD_DEFINITIONS}}", fieldDefs)
    .replaceAll("{{SKILL_KNOWLEDGE}}", skillSection)
    + referenceSection
    + clarificationSection;
}

// POST /api/wednesday/chat
// Body: { messages: [{role, content}], boardType, formState, referenceContext? }
// Returns: SSE stream of text chunks
router.post("/chat", async (req, res) => {
  const { messages = [], boardType = "video", formState = {}, referenceContext = null, clarificationMode = false } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const agent = AI_AGENTS.wednesday[boardType] ?? AI_AGENTS.wednesday.video;
    const system = buildSystemPrompt(boardType, formState, referenceContext, clarificationMode);

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
