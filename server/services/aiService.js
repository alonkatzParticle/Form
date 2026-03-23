// AI service using Anthropic Claude.
// All prompt logic lives here so it's easy to tune without touching routes.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Builds the system prompt that tells Claude how to fill a task brief.
// exampleItems are pulled from the real Monday board so Claude learns from past tasks.
function buildSystemPrompt(boardType, exampleItems = []) {
  const fieldDefs =
    boardType === "video"
      ? `
- taskName: Short, descriptive task title (no slashes)
- department: One of: Socials, Website, Special Project, Retention, Creative, Marketing/Media, Branding, TV, Amazon, Ulta
- product: The specific product being featured
- deadline: ISO date string or null if not specified
- platform: One of: Meta, GT | Meta, Applovin, Youtube | Google, GIF | Meta
- type: One of: Iterations/Cuts, GIF Static, Miscellaneous, Collection, Motion Design, Translation, Special Project, AI Project, UGC/Creator, Script, Long Form
- videoConcept: Brief description of the overall idea or story
- hook: Opening line or visual hook (per version if applicable)
- scriptMessage: The full script or key message
- versionsNeeded: Number of versions (integer)
- sizesNeeded: Array of sizes needed, e.g. ["9x16", "4x5"]
- priority: One of: Low, Medium, High, Critical ⚠️
- dropboxLink: URL string or empty string
- targetAudience: Description of target audience (age, interests, location)
- requestor: [] (leave empty, filled by user)
- editorDesigner: [] (leave empty, filled by user)`
      : `
- taskName: Short, descriptive task title (no slashes)
- department: One of: Email, Marketing, Socials, Projects, GT, Default, Adge Data, TV, Branding, Products & Packaging, Amazon, Creative, GIF Design, Website, Ulta
- productBundle: The product or bundle being designed
- platform: One of: Meta, Google, Applovin, Newsletter, GT - Meta, Other
- websiteType: One of: PDP, LP, Other
- deadline: ISO date string or null if not specified
- priority: One of: Low, Medium, High, Critical ⚠️
- amountOfVersions: Number of versions (integer or null)
- conceptIdea: Description of the visual subject and scene
- supportingText: Additional text or copy if needed
- sizes: Array of sizes, e.g. ["1x1", "4x5"]
- otherSizes: String for custom sizes, or empty string
- howDidYouCreate: One of: Adge, Upspring, Motion, ChatGPT, or empty string
- dropbox: URL string or empty string
- requestor: [] (leave empty, filled by user)
- editorDesigner: [] (leave empty, filled by user)`;

  const examples =
    exampleItems.length > 0
      ? `\n\nHere are examples of real tasks from this board to guide your style and tone:\n${JSON.stringify(exampleItems.slice(0, 10), null, 2)}`
      : "";

  return `You are a creative marketing task brief assistant. Your job is to fill out structured task brief forms for a marketing team.

When given input, return a JSON object with these fields:
${fieldDefs}

Rules:
- Return ONLY valid JSON. No markdown, no explanation, no code fences.
- If a field cannot be determined from the input, use "" for strings, null for dates/numbers, and [] for arrays.
- Keep descriptions concise and professional.
- Match the tone and style of the examples below.${examples}`;
}

// Main AI assist function.
// mode: "autofill" | "generate" | "format"
// input: the user's rough text
// boardType: "video" | "design"
// exampleItems: recent Monday tasks for context
export async function assistWithTask({ mode, input, boardType, exampleItems }) {
  const modeInstructions = {
    autofill: `The user has provided a rough description. Fill in as many fields as you can infer from it.`,
    generate: `The user has provided a one-line idea. Generate a complete, detailed task brief from it.`,
    format: `The user has pasted an existing brief. Reformat and restructure it into the proper fields. Preserve the original intent.`,
  };

  const userMessage = `${modeInstructions[mode]}\n\nInput:\n${input}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: buildSystemPrompt(boardType, exampleItems),
    messages: [{ role: "user", content: userMessage }],
  });

  const text = message.content[0].text.trim();

  // Parse the JSON response. If it fails, return the raw text so the caller can handle it.
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`AI returned invalid JSON: ${text}`);
  }
}
