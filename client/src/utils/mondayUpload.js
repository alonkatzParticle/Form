/**
 * File upload to Monday via Vercel Blob intermediary.
 *
 * Problem solved: Monday's /v2/file API does not send CORS headers, so browsers
 * can never call it directly. Vercel serverless functions have a 4.5 MB body
 * limit, so we can't proxy through them either.
 *
 * Solution — 3-step flow:
 *   1. Browser requests a signed upload token from our server (blob-token)
 *   2. Browser uploads the file directly to Vercel Blob (CORS supported, no cap)
 *   3. Browser tells our server the blobUrl; server fetches it and forwards
 *      to Monday (server-to-server, no CORS issue, no body limit), then
 *      deletes the blob.
 *
 * Effective limit: 100 MB per file (enforced client-side and in blob-token).
 */

import { upload } from "@vercel/blob/client";
import axios from "axios";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Upload a single File to a Monday item's file column.
 * @param {string|number} itemId   - Monday item ID
 * @param {string}        columnId - Monday column ID (e.g. "files")
 * @param {File}          file     - Browser File object
 * @returns {Promise<void>}
 */
export async function uploadFileToMonday(itemId, columnId, file) {
  // Client-side size guard — show a clear error before any network call
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — ` +
      `files over 100 MB cannot be uploaded. Please attach it directly in Monday.`
    );
  }

  // Step 1 + 2: Upload directly from browser to Vercel Blob.
  // The `upload()` helper handles the token handshake with /api/monday/blob-token
  // internally and then PUTs the file straight to Vercel's CDN (CORS-safe).
  let blobUrl;
  try {
    const blob = await upload(file.name, file, {
      access: "public",
      handleUploadUrl: "/api/monday/blob-token",
    });
    blobUrl = blob.url;
  } catch (err) {
    throw new Error(
      `Failed to upload "${file.name}" to staging storage: ${err.message}`
    );
  }

  // Step 3: Tell the server to forward the blob to Monday and clean up.
  // The server fetches from Vercel Blob (datacenter-speed) and calls
  // add_file_to_column, then deletes the blob.
  try {
    await axios.post("/api/monday/blob-forward", {
      blobUrl,
      itemId: String(itemId),
      columnId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
    });
  } catch (err) {
    const detail = err.response?.data?.error ?? err.message;
    throw new Error(
      `"${file.name}" reached staging but Monday rejected it: ${detail}`
    );
  }
}
