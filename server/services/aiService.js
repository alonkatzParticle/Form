// AI service — reads all prompts and settings from ../aiAgents.js
// To change AI behavior, edit aiAgents.js. This file handles the API calls only.
import Anthropic from "@anthropic-ai/sdk";
import { getSkillContent, getBrandKnowledge } from "./skillLoader.js";
import { getRecentTasks } from "./recentTasksService.js";
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
function buildSystemPrompt(agent, boardType) {
  const fieldDefs = FIELD_DEFINITIONS[boardType] ?? "";

  // Skill rules section (voice, anti-patterns, format structures — no bulky examples)
  const rawSkill = agent.useSkillKnowledge ? getSkillContent(boardType) : "";
  const rawBrand = agent.useSkillKnowledge ? getBrandKnowledge() : "";
  // Cap brand knowledge — full file is ~50k chars; first 4k covers brand overview + voice
  const brandKnowledge = rawBrand.length > 4000 ? rawBrand.slice(0, 4000) + "\n\n[…truncated]" : rawBrand;
  const skillSection = (rawSkill || brandKnowledge)
    ? `\n\n---\n\n## BRAND & PRODUCT KNOWLEDGE\n\n${brandKnowledge}${rawSkill ? `\n\n---\n\n## CREATIVE SYSTEM KNOWLEDGE\n\n${rawSkill}` : ""}\n\n---\n\n`
    : "";

  // Recent real examples fetched live from Monday (last 6 months, cached in memory)
  const recentExamples = agent.useSkillKnowledge ? getRecentTasks(boardType) : [];
  const boardExamples = recentExamples.length > 0
    ? `\n\n---\n\n## RECENT REAL TASKS (use these as style and format reference)\n\n${recentExamples.join("\n\n---\n\n")}\n\n---\n\n`
    : "";

  return fillPlaceholders(agent.systemPrompt, {
    FIELD_DEFINITIONS: fieldDefs,
    SKILL_KNOWLEDGE: skillSection,
    BOARD_EXAMPLES: boardExamples,
  });
}

// Generates a formatted HTML brief from resolved form values.
// formValues: [{ label, value }] — only non-empty, display-ready values.
// Department is extracted from formValues automatically.
export async function generateBrief({ formValues, boardType, estimatedDurationText = null }) {
  const agent = AI_AGENTS.briefWriter;
  const fieldList = formValues.map(({ label, value }) => `${label}: ${value}`).join("\n");

  // Extract department from the filled form values (e.g. "Department: Marketing/Media")
  const department = formValues.find(
    (fv) => fv.label?.toLowerCase() === "department"
  )?.value ?? "";

  // Resolve department-specific config.
  // Priority: exact dept match → _default for this board → legacy fallback
  const deptConfig =
    agent.departments?.[boardType]?.[department] ??
    agent.departments?.[boardType]?.["_default"] ??
    { systemPrompt: agent.systemPrompt, example: agent.examples?.[boardType], colorCode: true };

  if (!deptConfig?.systemPrompt) {
    throw new Error(`No brief config for boardType "${boardType}" / department "${department}"`);
  }

  // scriptSections are still computed but only used when colorCode is explicitly true
  const scriptSectionsDef = Object.entries(agent.scriptSections || {})
    .map(([name, { color, description }]) => `- ${name} (${description}): color ${color}`)
    .join("\n");

  const system = fillPlaceholders(deptConfig.systemPrompt, {
    BRIEF_EXAMPLE: deptConfig.example ?? "",
    SCRIPT_SECTIONS: scriptSectionsDef,
  });

  const message = await withRetry(() => getClient().messages.create({
    model: agent.model,
    max_tokens: agent.maxTokens,
    system,
    messages: [{ role: "user", content: `Board type: ${boardType}\nDepartment: ${department || "(not specified)"}\n\nFilled values:\n${fieldList}` }],
  }));

  let html = message.content[0].text.trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Only inject color-coding legend for departments that use it
  const sections = deptConfig.colorCode ? agent.scriptSections : null;
  if (sections) {
    const legendItems = Object.entries(sections)
      .map(([name, { color }]) => `<span style="color:${color};font-weight:700;">■</span> ${name}`)
      .join(" &nbsp; ");
    const legend = `<p style="font-size:14px;margin:2px 0 10px 0;">${legendItems}</p>`;

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
    // Fallback: catch any uncolored "Label: text" blocks the AI may not have wrapped.
    // Strips the label text — color alone identifies the section.
    html = html.replace(
      /\b(Hook|Problem|Solution|Social Proof|CTA):\s*([\s\S]*?)(?=\b(?:Hook|Problem|Solution|Social Proof|CTA):|<\/p>|<h\d)/gi,
      (_, label, text) => {
        const color = sectionColors[label.toLowerCase()] ?? "#000";
        const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (!cleaned) return "";
        return `<span style="color:${color};">${cleaned}</span><br/>`;
      }
    );
  }

  // Directly inject the duration into the metadata line — don't rely on AI to include it
  if (estimatedDurationText) {
    const alreadyHas = html.includes("Duration");
    if (!alreadyHas) {
      html = html.replace(/(<p[^>]*>)([\/s\S]*?)(<\/p>)/, (match, open, content, close) =>
        `${open}${content} &nbsp;|&nbsp; <b>Est. Duration:</b> ${estimatedDurationText}${close}`
      );
    }
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
// Strategy: measure with ElevenLabs, tell Claude the exact current seconds and how many
// more to cut/add — no word count math. Repeat up to 3 times with fresh measurements.
// Total: up to 4 ElevenLabs calls + 3 Claude calls max.
export async function trimScriptToTarget(script, targetRange) {
  const targetMid = Math.round((targetRange.min + targetRange.max) / 2);

  async function measure(text) {
    const { estimatedSeconds } = await estimateScriptDuration(text);
    return estimatedSeconds;
  }

  async function rewrite(current, currentSecs) {
    const delta     = Math.abs(currentSecs - targetMid);
    const direction = currentSecs > targetRange.max ? "shorten" : "lengthen";
    const isLarge   = delta / currentSecs > 0.2;

    const instruction = direction === "shorten"
      ? `This script is ${currentSecs} seconds long. Cut it down to ${targetMid} seconds — that means removing about ${delta} seconds of spoken content.${isLarge ? " This is a significant cut. Remove entire sentences and whole sections. Be aggressive — do not just trim individual words." : " Remove the least important sentences."}`
      : `This script is ${currentSecs} seconds long. Expand it to ${targetMid} seconds — that means adding about ${delta} seconds of spoken content. Expand existing sections with more detail.`;

    const msg = await withRetry(() => getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are editing a video ad script for Particle for Men. ${instruction} Keep the Hook→Problem→Solution→Social Proof→CTA flow. Write clean spoken words only — no section labels, no directions. Return ONLY the revised script, nothing else.`,
      messages: [{ role: "user", content: current }],
    }));
    return msg.content[0].text.trim();
  }

  // Measure current
  let current = script;
  let currentSecs;
  try { currentSecs = await measure(current); }
  catch { return { script, estimatedSeconds: null }; }

  // Up to 3 passes
  for (let i = 0; i < 3; i++) {
    if (currentSecs >= targetRange.min && currentSecs <= targetRange.max) break;

    current = await rewrite(current, currentSecs);

    let measured = null;
    try { measured = await measure(current); }
    catch { break; }
    currentSecs = measured;
  }

  return { script: current, estimatedSeconds: currentSecs };
}

const MODE_TO_AGENT = {
  autofill:           AI_AGENTS.autoFill,
  generate:           AI_AGENTS.generateTask,
  format:             AI_AGENTS.pasteFormat,
  reference:          AI_AGENTS.reference,
  historyLoad:        AI_AGENTS.historyLoad,
  batch:              AI_AGENTS.batchGenerate,
  singleTaskGenerate: AI_AGENTS.singleTaskGenerate,
};

// Retry an async fn up to maxAttempts on overloaded / rate-limit errors.
async function withRetry(fn, maxAttempts = 4, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err?.status === 529 || err?.status === 429 ||
        err?.error?.type === "overloaded_error" || err?.error?.type === "rate_limit_error";
      if (!retryable || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.warn(`[AI] Attempt ${attempt} failed (${err.error?.type ?? err.status}). Retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Main AI assist function — powers the form-fill AI panel.
// mode: "autofill" | "generate" | "format" | "historyLoad" | "batch"
export async function assistWithTask({ mode, input, boardType, taskContext = {} }) {
  const agent = MODE_TO_AGENT[mode] ?? AI_AGENTS.autoFill;

  const message = await withRetry(() => getClient().messages.create({
    model: agent.model,
    max_tokens: agent.maxTokens,
    system: buildSystemPrompt(agent, boardType),
    messages: [{ role: "user", content: `${agent.modeInstruction}\n\nInput:\n${input}` }],
  }));

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
    // AI responded conversationally instead of with JSON — surface as a user-facing error
    // Extract the readable part (strip any code fences that survived)
    const readable = text.replace(/```[\s\S]*?```/g, "").trim();
    const err = new Error(readable || "AI could not generate a brief from this input. Please add more detail.");
    err.statusCode = 422;
    throw err;
  }

  return result;
}
