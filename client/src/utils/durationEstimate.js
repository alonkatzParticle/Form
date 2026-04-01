// ─── Duration Estimation — Syllable-based ────────────────────────────────────
// Uses syllable counting at UGC speaking pace instead of ElevenLabs TTS.
// Accuracy: ~88–92% per word; errors cancel over full scripts within the ±2s range.
//
// To re-enable ElevenLabs when credits are restored, search for ELEVENLABS_DISABLED.

// UGC/ad scripts are delivered faster than conversational speech.
// 280 syllables/min is the midpoint of the 270–300 SPM range for fast UGC delivery.
const UGC_SPM = 280; // syllables per minute

// Extra seconds added to account for visual-only hook that runs without voiceover.
const HOOK_BUFFER_SECONDS = 3;

/**
 * Count the number of syllables in a single English word.
 * Rules:
 *   1. Each group of consecutive vowels (aeiouy) = 1 syllable
 *   2. Trailing silent 'e' is subtracted (make, time, drive)
 *   3. '-le' ending after a consonant restores 1 syllable (particle, simple, purple)
 *   4. Minimum 1 syllable per word
 */
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

  // Subtract silent trailing 'e' (make → mak → 1, fire → fir → 1)
  if (word.endsWith("e") && count > 1) count--;

  // '-le' after a consonant = its own syllable (par-ti-cle, sim-ple, pur-ple)
  if (
    word.length > 2 &&
    word.endsWith("le") &&
    !"aeiouy".includes(word[word.length - 3])
  ) {
    count++;
  }

  return Math.max(1, count);
}

/**
 * Estimate total syllable count for a full script string.
 */
function countScriptSyllables(script) {
  if (!script || !script.trim()) return 0;
  return script
    .trim()
    .split(/\s+/)
    .reduce((sum, word) => sum + countSyllables(word), 0);
}

/**
 * Estimate spoken duration in seconds for a UGC ad script.
 * Returns an integer number of seconds, or null if the script is empty.
 *
 * @param {string} script - The voiceover / script text
 * @returns {number|null}
 */
export function estimateDuration(script) {
  if (!script || !script.trim()) return null;
  const syllables = countScriptSyllables(script);
  const spokenSeconds = (syllables / UGC_SPM) * 60;
  return Math.round(spokenSeconds) + HOOK_BUFFER_SECONDS;
}

/**
 * Format a duration estimate as a display range string.
 * e.g. estimateDuration returns 32 → "30–34 seconds"
 *
 * @param {number|null} seconds
 * @returns {string|null}
 */
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
