// geminiService.js — uses Google Gemini to analyze video and image references.
// Videos are uploaded via Gemini's File API (much faster than base64 inline).
// Images are sent inline (small enough).
// A 90-second overall timeout guards against hanging requests.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const MODEL = "gemini-2.0-flash";
const TIMEOUT_MS = 90_000; // 90 seconds max

let _genAI = null;
let _fileManager = null;

function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _genAI;
}

function getFileManager() {
  if (!_fileManager) _fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
  return _fileManager;
}

const ANALYSIS_INSTRUCTION = `You are a creative analyst helping a marketing team understand reference media.
Analyze the provided image or video and write a detailed, structured description covering:
1. Overall format and structure (length estimate if video, layout if image)
2. Visual style — tone, colors, energy, aesthetic
3. Script/narration (verbatim if possible, or close paraphrase)
4. Hook — what grabs attention in the first few seconds / at first glance
5. Key messages and claims made
6. Call to action
7. Target audience impression
8. What makes this piece effective (or not)

Be specific and concrete. The marketing team will use your analysis to create a similar or inspired piece.`;

/** True for MIME types that are videos */
function isVideo(mimeType) {
  return mimeType?.startsWith("video/");
}

/** Determine if a URL is a YouTube link and return the canonical watch URL, or null. */
function asYouTubeUri(url) {
  try {
    const { hostname, pathname, searchParams } = new URL(url);
    const isYT = ["www.youtube.com", "youtube.com", "youtu.be"].includes(hostname);
    if (!isYT) return null;
    let videoId = searchParams.get("v");
    if (!videoId && hostname === "youtu.be") videoId = pathname.slice(1).split("?")[0];
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

/** Fetch a URL as binary. Returns { base64, mimeType } or null. */
async function fetchAsBase64(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    return { base64: Buffer.from(buffer).toString("base64"), mimeType };
  } catch {
    return null;
  }
}

/**
 * Upload a video file to Gemini's File API, wait for it to become ACTIVE, then return the file URI.
 * Much faster than base64 inline for videos.
 */
async function uploadVideoFile(base64, mimeType, displayName = "reference-video") {
  // Write to a temp file (File API requires a file path or stream)
  const ext = mimeType.split("/")[1]?.split(";")[0] || "mp4";
  const tmpPath = join(tmpdir(), `gemini-ref-${randomUUID()}.${ext}`);

  try {
    writeFileSync(tmpPath, Buffer.from(base64, "base64"));

    const uploadResult = await getFileManager().uploadFile(tmpPath, {
      mimeType,
      displayName,
    });

    let file = uploadResult.file;

    // Poll until ACTIVE (video processing can take a few seconds)
    let attempts = 0;
    while (file.state === FileState.PROCESSING && attempts < 20) {
      await new Promise((r) => setTimeout(r, 3000));
      file = await getFileManager().getFile(file.name);
      attempts++;
    }

    if (file.state === FileState.FAILED) {
      throw new Error("Gemini video processing failed — try a shorter clip or an image instead.");
    }

    return file.uri;
  } finally {
    // Always clean up the temp file
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Main export — analyze a video or image reference with Gemini.
 *
 * @param {object} opts
 * @param {string|null} opts.fileData     Base64-encoded file content (from client upload)
 * @param {string|null} opts.mimeType     MIME type of uploaded file (e.g. "video/mp4", "image/jpeg")
 * @param {string|null} opts.fileUrl      URL to a video or image (YouTube, direct link, etc.)
 * @param {string}      opts.instructions User instructions on how to use the reference
 * @returns {Promise<string>} A detailed text description of the reference for Claude
 */
export async function analyzeReference({ fileData, mimeType, fileUrl, instructions }) {
  const model = getGenAI().getGenerativeModel({
    model: MODEL,
    systemInstruction: ANALYSIS_INSTRUCTION,
  });

  const parts = [];

  // ── Case 1: file uploaded directly from client ───────────────────────────────
  if (fileData && mimeType) {
    if (isVideo(mimeType)) {
      // Use File API for videos — much more reliable than inline base64
      const fileUri = await uploadVideoFile(fileData, mimeType);
      parts.push({ fileData: { fileUri, mimeType } });
    } else {
      // Images are fine as inline data
      parts.push({ inlineData: { data: fileData, mimeType } });
    }
  }
  // ── Case 2: URL provided ─────────────────────────────────────────────────────
  else if (fileUrl) {
    const ytUri = asYouTubeUri(fileUrl);

    if (ytUri) {
      // YouTube: native support via fileData URI
      parts.push({ fileData: { fileUri: ytUri, mimeType: "video/youtube" } });
    } else {
      // Try fetching the URL
      const fetched = await fetchAsBase64(fileUrl);
      if (fetched) {
        if (isVideo(fetched.mimeType)) {
          const fileUri = await uploadVideoFile(fetched.base64, fetched.mimeType);
          parts.push({ fileData: { fileUri, mimeType: fetched.mimeType } });
        } else {
          parts.push({ inlineData: { data: fetched.base64, mimeType: fetched.mimeType } });
        }
      } else {
        // Fallback: let Gemini reason from the URL string alone
        parts.push({
          text: `The user provided this URL as a reference. You cannot access it directly — use the user's instructions and your best judgment:\n\nURL: ${fileUrl}`,
        });
      }
    }
  } else {
    throw new Error("Either fileData+mimeType or fileUrl must be provided");
  }

  // Always append the user's instructions
  parts.push({ text: `\n\nUser instructions for this reference:\n${instructions}` });

  // Run Gemini with an overall timeout
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Gemini analysis timed out after 90 seconds. Try a shorter clip or a still image.")), TIMEOUT_MS)
  );

  const analysisPromise = model.generateContent({ contents: [{ role: "user", parts }] });

  const result = await Promise.race([analysisPromise, timeoutPromise]);
  const text = result.response.text();

  if (!text) throw new Error("Gemini returned an empty analysis");
  return text;
}
