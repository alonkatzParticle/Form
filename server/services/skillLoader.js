// skillLoader.js — Loads and caches skill knowledge from server/skills/*.md
// Skills are extracted from .skill archives in the project root.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "skills");

function load(filename) {
  try {
    return readFileSync(join(SKILLS_DIR, filename), "utf-8");
  } catch {
    return "";
  }
}

// Loaded once at module import time (server startup)
const creativeSkill  = load("creative-tickets.md");
const staticSkill    = load("static-tickets.md");
const copyDatabase   = load("copy-database.md");
const brandKnowledge = load("Particle_For_Men_Brand_Knowledge.md");

export function getSkillContent(boardType) {
  if (boardType === "video") {
    return creativeSkill;
  }
  if (boardType === "design") {
    return staticSkill + (copyDatabase ? `\n\n---\n\n# APPENDIX: Copy Database\n\n${copyDatabase}` : "");
  }
  return "";
}

// Brand knowledge is separate from creative patterns — used by Wednesday and
// any agent that needs deep product/brand context (not just script structures).
export function getBrandKnowledge() {
  return brandKnowledge;
}
