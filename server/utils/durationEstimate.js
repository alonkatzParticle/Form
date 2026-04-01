// ─── Duration Estimation — Syllable-based (server copy) ──────────────────────
// Mirror of client/src/utils/durationEstimate.js — keep in sync if changing constants.
// Used by server/routes/ai.js for batch brief generation.

const UGC_SPM = 280;
const HOOK_BUFFER_SECONDS = 3;

function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  let count = 0;
  let prevVowel = false;
  for (const ch of word) {
    const isVowel = "aeiouy".includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  if (word.endsWith("e") && count > 1) count--;
  if (word.length > 2 && word.endsWith("le") && !"aeiouy".includes(word[word.length - 3])) count++;
  return Math.max(1, count);
}

export function estimateDuration(script) {
  if (!script || !script.trim()) return null;
  const syllables = script.trim().split(/\s+/).reduce((sum, w) => sum + countSyllables(w), 0);
  return Math.round((syllables / UGC_SPM) * 60) + HOOK_BUFFER_SECONDS;
}

export function formatDurationRange(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const s = Math.round(seconds);
  const lo = Math.max(0, s - 2);
  const hi = s + 2;
  if (hi < 60) return `${lo}–${hi} seconds`;
  function fmt(t) {
    if (t < 60) return `${t}s`;
    const m = Math.floor(t / 60);
    const rem = t % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  return `${fmt(lo)}–${fmt(hi)}`;
}
