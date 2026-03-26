// AI service — reads all prompts and settings from ../aiAgents.js
// To change AI behavior, edit aiAgents.js. This file handles the API calls only.
import Anthropic from "@anthropic-ai/sdk";
import { getSkillContent, getBrandKnowledge } from "./skillLoader.js";
import { AI_AGENTS, FIELD_DEFINITIONS } from "../aiAgents.js";
import { estimateScriptDuration } from "./elevenLabsService.js";

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// Replace {{PLACEHOLDERS}} in a prompt string with runtime values.
function fillPlaceholders(template, replacements) {
  return Object.entries(replacements).reduce(
    (str, [key, val]) => str.replaceAll(`{{${key}}}`, val ?? ""),
    template
  );
}

// Builds the final system prompt for a given form-fill agent.
function buildSystemPrompt(agent, boardType, exampleItems = []) {
  const fieldDefs = FIELD_DEFINITIONS[boardType] ?? "";

  const skillKnowledge = agent.useSkillKnowledge ? getSkillContent(boardType) : "";
  const brandKnowledge = agent.useSkillKnowledge ? getBrandKnowledge() : "";
  const skillSection = (skillKnowledge || brandKnowledge)
    ? `\n\n---\n\n## BRAND & PRODUCT KNOWLEDGE\n\nYou have deep knowledge of this brand. Use it to generate production-quality content — especially hooks, video concepts, scripts, concept ideas, and task names. Apply the brand voice, product details, and naming conventions from the knowledge below.\n\n${brandKnowledge}${skillKnowledge ? `\n\n---\n\n## CREATIVE SYSTEM KNOWLEDGE\n\n${skillKnowledge}` : ""}\n\n---\n\n`
    : "";

  const boardExamples =
    exampleItems.length > 0
      ? `\n\nHere are examples of real tasks from this board to guide your style and tone:\n${JSON.stringify(exampleItems.slice(0, 10), null, 2)}`
      : "";

  return fillPlaceholders(agent.systemPrompt, {
    FIELD_DEFINITIONS: fieldDefs,
    SKILL_KNOWLEDGE: skillSection,
    BOARD_EXAMPLES: boardExamples,
  });
}

// Generates a formatted HTML brief from resolved form values.
// formValues: [{ label, value }] — only non-empty, display-ready values.
export async function generateBrief({ formValues, boardType }) {
  const agent = AI_AGENTS.briefWriter;
  const fieldList = formValues.map(({ label, value }) => `${label}: ${value}`).join("\n");
  const example = agent.examples[boardType] ?? agent.examples.video;

  const scriptSectionsDef = Object.entries(agent.scriptSections || {})
    .map(([name, { color, description }]) => `- ${name} (${description}): color ${color}`)
    .join("\n");

  const system = fillPlaceholders(agent.systemPrompt, {
    BRIEF_EXAMPLE: example,
    SCRIPT_SECTIONS: scriptSectionsDef,
  });

  const message = await getClient().messages.create({
    model: agent.model,
    max_tokens: agent.maxTokens,
    system,
    messages: [{ role: "user", content: `Board type: ${boardType}\n\nFilled values:\n${fieldList}` }],
  });

  let html = message.content[0].text.trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Inject color legend right after the Script heading (if one exists)
  const sections = agent.scriptSections;
  if (sections && html.includes("Script")) {
    const legendItems = Object.entries(sections)
      .map(([name, { color }]) => `<span style="color:${color};font-weight:700;">■</span> ${name}`)
      .join(" &nbsp; ");
    const legend = `<p style="font-size:11px;margin:2px 0 6px 0;opacity:0.8;">${legendItems}</p>`;
    html = html.replace(
      /(<h3[^>]*>[^<]*[Ss]cript[^<]*<\/h3>)/,
      `$1${legend}`
    );
  }

  return html;
}

// ─── Script duration helpers ──────────────────────────────────────────────────

// Returns the target seconds range based on video type and optional user override.
function getTargetRange(task) {
  if (task.targetDuration && task.targetDuration > 0) {
    const t = Number(task.targetDuration);
    return { min: t - 4, max: t + 4 };
  }
  const type = task.type || "";
  if (type.includes("Short Form")) return { min: 12, max: 22 };
  if (type.includes("Long Form"))  return { min: 60, max: 120 };
  return { min: 28, max: 47 }; // default 30-45s with small buffer
}

// Trims or expands a script to hit a target duration.
// Strategy:
//   1. Measure current script once with ElevenLabs → get real duration + calibrate speaking rate
//   2. Calculate exact target word count using that calibrated rate (avoids hardcoded assumptions)
//   3. One Claude call — rewrite to exactly that word count
//   4. One final ElevenLabs measure to confirm
// Total: 2 ElevenLabs calls + 1 Claude call. Fast and accurate.
export async function trimScriptToTarget(script, targetRange) {
  const targetMid = Math.round((targetRange.min + targetRange.max) / 2);

  // Step 1 — measure current duration
  let currentSeconds;
  try {
    ({ estimatedSeconds: currentSeconds } = await estimateScriptDuration(script));
  } catch {
    // ElevenLabs unavailable — return script unchanged
    return { script, estimatedSeconds: null };
  }

  // Already on target — nothing to do
  if (currentSeconds >= targetRange.min && currentSeconds <= targetRange.max) {
    return { script, estimatedSeconds: currentSeconds };
  }

  // Step 2 — calibrate speaking rate from the actual measurement, then compute target word count
  const currentWords  = script.trim().split(/\s+/).length;
  const secsPerWord   = currentSeconds / currentWords;          // calibrated to this script + voice
  const targetWords   = Math.round(targetMid / secsPerWord);
  const direction     = currentSeconds > targetRange.max ? "shorten" : "lengthen";
  const action        = direction === "shorten"
    ? `Rewrite it to be exactly ${targetWords} words. Remove whole sentences to hit the count — don't just shave words.`
    : `Rewrite it to be exactly ${targetWords} words. Expand existing sections with more detail to hit the count.`;

  // Step 3 — one Claude call with a precise word count target
  const msg = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are editing a video ad script for Particle for Men. ${action} Keep the natural Hook→Problem→Solution→Social Proof→CTA flow. Write clean spoken words only — no section labels, no directions. Return ONLY the revised script, nothing else. Word count must be exactly ${targetWords} words (±3 words maximum).`,
    messages: [{ role: "user", content: `Current script (${currentSeconds}s, ${currentWords} words → target ${targetMid}s, ${targetWords} words):\n\n${script}` }],
  });
  const revised = msg.content[0].text.trim();

  // Step 4 — final measurement to confirm and return accurate duration
  let finalSeconds = null;
  try {
    ({ estimatedSeconds: finalSeconds } = await estimateScriptDuration(revised));
  } catch { /* silent */ }

  return { script: revised, estimatedSeconds: finalSeconds };
}

// Maps the mode string from the client to the agent object in aiAgents.js
const MODE_TO_AGENT = {
  autofill: AI_AGENTS.autoFill,
  generate: AI_AGENTS.generateTask,
  format:   AI_AGENTS.pasteFormat,
};

// Main AI assist function — powers the form-fill AI panel.
// mode: "autofill" | "generate" | "format"
export async function assistWithTask({ mode, input, boardType, exampleItems, taskContext = {} }) {
  const agent = MODE_TO_AGENT[mode] ?? AI_AGENTS.autoFill;

  const message = await getClient().messages.create({
    model: agent.model,
    max_tokens: agent.maxTokens,
    system: buildSystemPrompt(agent, boardType, exampleItems),
    messages: [{ role: "user", content: `${agent.modeInstruction}\n\nInput:\n${input}` }],
  });

  let text = message.content[0].text.trim();
  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Fallback: extract the outermost JSON object in case the model added surrounding text
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    text = text.slice(jsonStart, jsonEnd + 1);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`AI returned invalid JSON: ${text}`);
  }

  // ── Duration trim loop ────────────────────────────────────────────────────
  // Only for generate/autofill on video board with a non-empty script.
  // pasteFormat preserves the user's original script as-is.
  if (mode !== "format" && boardType === "video" && result.scriptMessage?.trim()) {
    try {
      const targetRange = getTargetRange({ ...result, targetDuration: taskContext.targetDuration });
      const { script, estimatedSeconds } = await trimScriptToTarget(result.scriptMessage, targetRange);
      result.scriptMessage = script;
      if (estimatedSeconds !== null) result._estimatedDuration = estimatedSeconds;
    } catch (err) {
      console.warn("Duration trim skipped:", err.message);
    }
  }

  return result;
}
