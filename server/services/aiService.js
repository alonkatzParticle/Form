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

// Average spoken words per second — used to give Claude a concrete word-count target.
const WORDS_PER_SECOND = 2.5;

// Trims or expands a script to fit within the target range using ElevenLabs + Claude.
// Tells Claude the exact word count to aim for so it knows how aggressively to cut.
// Max 3 iterations. Fails gracefully — returns the last script + duration.
export async function trimScriptToTarget(script, targetRange) {
  let current = script;
  let lastSeconds = null;

  for (let i = 0; i < 3; i++) {
    let seconds;
    try {
      ({ estimatedSeconds: seconds } = await estimateScriptDuration(current));
    } catch {
      break; // ElevenLabs unavailable — skip trimming
    }
    lastSeconds = seconds;

    if (seconds >= targetRange.min && seconds <= targetRange.max) break;

    const direction = seconds > targetRange.max ? "shorten" : "lengthen";
    const targetMid = Math.round((targetRange.min + targetRange.max) / 2);

    // Give Claude a concrete word-count target so it knows exactly how much to cut/add
    const currentWords = current.trim().split(/\s+/).length;
    const targetWords  = Math.round(targetMid * WORDS_PER_SECOND);
    const pctChange    = Math.round(Math.abs(targetWords - currentWords) / currentWords * 100);
    const action       = direction === "shorten"
      ? `Cut it from ~${currentWords} words down to ~${targetWords} words (remove ~${pctChange}% of the content). Remove whole sentences — don't just trim words.`
      : `Expand it from ~${currentWords} words up to ~${targetWords} words (add ~${pctChange}% more content). Add detail to existing sections.`;

    const msg = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are editing a video ad script for Particle for Men. The script needs to read in exactly ${targetMid} seconds of spoken audio (acceptable range: ${targetRange.min}–${targetRange.max}s). ${action} Keep the natural Hook→Problem→Solution→Social Proof→CTA flow. Write clean spoken words only — no section labels, no directions. Return ONLY the revised script text, nothing else.`,
      messages: [{ role: "user", content: `Current script (${seconds}s, ${currentWords} words — target ${targetMid}s / ~${targetWords} words):\n\n${current}` }],
    });
    current = msg.content[0].text.trim();
  }

  // Always re-measure the final script so the returned duration reflects what Claude
  // actually produced — not the measurement from before the last edit.
  try {
    ({ estimatedSeconds: lastSeconds } = await estimateScriptDuration(current));
  } catch { /* silent — return last known measurement */ }

  return { script: current, estimatedSeconds: lastSeconds };
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
