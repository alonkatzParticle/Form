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
  // Cap brand knowledge for form-fill agents — full file is ~10k tokens and hits rate limits.
  // 5,000 chars covers brand overview, voice, and key product summaries.
  const rawBrand = agent.useSkillKnowledge ? getBrandKnowledge() : "";
  const brandKnowledge = rawBrand.length > 5000 ? rawBrand.slice(0, 5000) + "\n\n[…truncated for brevity]" : rawBrand;
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

  const sections = agent.scriptSections;
  if (sections) {
    const legendItems = Object.entries(sections)
      .map(([name, { color }]) => `<span style="color:${color};font-weight:700;">■</span> ${name}`)
      .join(" &nbsp; ");
    const legend = `<p style="font-size:11px;margin:2px 0 6px 0;opacity:0.8;">${legendItems}</p>`;

    // Inject legend after Script heading
    if (html.includes("Script")) {
      html = html.replace(/(<h3[^>]*>[^<]*[Ss]cript[^<]*<\/h3>)/, `$1${legend}`);
    }

    // Inject legend after Visuals heading
    if (html.includes("Visual")) {
      html = html.replace(/(<h3[^>]*>[^<]*[Vv]isual[^<]*<\/h3>)/, `$1${legend}`);
    }

    // Color-code "Label: text" lines inside the Visuals section
    // Matches lines like "Hook: ..." "Problem: ..." etc. and wraps them in section colors
    const sectionColors = Object.fromEntries(
      Object.entries(sections).map(([name, { color }]) => [name.toLowerCase(), color])
    );
    // Fallback: catch any uncolored "Label: text" blocks the AI may not have wrapped
    // Matches from a section label to the next label, </p>, or heading
    html = html.replace(
      /\b(Hook|Problem|Solution|Social Proof|CTA):\s*([\s\S]*?)(?=\b(?:Hook|Problem|Solution|Social Proof|CTA):|<\/p>|<h\d)/gi,
      (_, label, text) => {
        const color = sectionColors[label.toLowerCase()] ?? "#000";
        // Strip any inner HTML tags and collapse whitespace
        const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (!cleaned) return `<b>${label}:</b> `;
        return `<span style="color:${color};"><b>${label}:</b> ${cleaned}</span><br/>`;
      }
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
// Strategy: calibrate speaking rate from a real ElevenLabs measurement, compute exact
// target word count, ask Claude to hit it. Re-measures and retries once if still off.
// Total: up to 3 ElevenLabs calls + 2 Claude calls max.
export async function trimScriptToTarget(script, targetRange) {
  const targetMid = Math.round((targetRange.min + targetRange.max) / 2);

  async function measure(text) {
    const { estimatedSeconds } = await estimateScriptDuration(text);
    return estimatedSeconds;
  }

  async function rewrite(current, currentSecs, tWords, direction) {
    const reductionPct = Math.abs(currentSecs - targetMid) / currentSecs;
    const aggression = reductionPct > 0.25
      ? " This is a large change — cut (or add) entire sentences and whole sections aggressively. Do not just trim words."
      : "";
    const action = direction === "shorten"
      ? `Shorten it to exactly ${tWords} words. Remove whole sentences to hit the count.${aggression}`
      : `Expand it to exactly ${tWords} words. Add more detail to existing sections.${aggression}`;
    const currentWords = current.trim().split(/\s+/).length;
    const msg = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are editing a video ad script for Particle for Men. ${action} Keep the Hook→Problem→Solution→Social Proof→CTA flow. Write clean spoken words only — no section labels, no directions. Return ONLY the revised script. Word count must be exactly ${tWords} words (±3 max).`,
      messages: [{ role: "user", content: `Current script (${currentSecs}s, ${currentWords} words → target ${targetMid}s, ${tWords} words):\n\n${current}` }],
    });
    return msg.content[0].text.trim();
  }

  // Step 1 — measure current
  let currentSeconds;
  try { currentSeconds = await measure(script); }
  catch { return { script, estimatedSeconds: null }; }

  if (currentSeconds >= targetRange.min && currentSeconds <= targetRange.max) {
    return { script, estimatedSeconds: currentSeconds };
  }

  const direction = currentSeconds > targetRange.max ? "shorten" : "lengthen";

  // Step 2 — first pass: calibrate rate, compute target word count, rewrite
  const words1      = script.trim().split(/\s+/).length;
  const secsPerWord = currentSeconds / words1;
  const targetWords = Math.round(targetMid / secsPerWord);
  const revised1    = await rewrite(script, currentSeconds, targetWords, direction);

  let seconds1;
  try { seconds1 = await measure(revised1); }
  catch { return { script: revised1, estimatedSeconds: null }; }

  if (seconds1 >= targetRange.min && seconds1 <= targetRange.max) {
    return { script: revised1, estimatedSeconds: seconds1 };
  }

  // Step 3 — second pass: re-calibrate from the first result and try again
  const words2       = revised1.trim().split(/\s+/).length;
  const secsPerWord2 = seconds1 / words2;
  const targetWords2 = Math.round(targetMid / secsPerWord2);
  const revised2     = await rewrite(revised1, seconds1, targetWords2, direction);

  let seconds2 = null;
  try { seconds2 = await measure(revised2); }
  catch { /* silent */ }

  return { script: revised2, estimatedSeconds: seconds2 };
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

  // ── Measure script duration (single ElevenLabs call) ─────────────────────
  // Just measure and return the duration — no trimming here.
  // User can trim manually with "Change duration of Script" if needed.
  if (mode !== "format" && boardType === "video" && result.scriptMessage?.trim()) {
    try {
      const { estimatedSeconds } = await estimateScriptDuration(result.scriptMessage);
      result._estimatedDuration = estimatedSeconds;
    } catch (err) {
      console.warn("Duration estimate skipped:", err.message);
    }
  }

  return result;
}
