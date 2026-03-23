// ElevenLabs service for estimating script/voiceover duration.
// We generate TTS audio, measure its duration, then discard the audio.
// This gives the creative team an accurate estimate of video length.

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

// Default voice ID — a neutral English voice. Can be changed without code edits
// by setting ELEVENLABS_VOICE_ID in .env.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

export async function estimateScriptDuration(script) {
  if (!script || script.trim().length === 0) {
    throw new Error("Script text is required");
  }

  // Request TTS audio from ElevenLabs
  const res = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${DEFAULT_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_monolingual_v1",
      voice_settings: { stability: 0.5, similarity_boost: 0.5 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs API error: ${res.status} ${errText}`);
  }

  // Read the audio bytes to calculate duration.
  // MP3 at 128kbps = 16000 bytes/sec. This gives a good enough estimate without
  // parsing actual MP3 frames.
  const audioBuffer = await res.arrayBuffer();
  const bytes = audioBuffer.byteLength;
  const estimatedSeconds = Math.round(bytes / 16000);

  return { estimatedSeconds };
}
