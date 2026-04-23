/**
 * File upload to Monday via direct server proxy.
 *
 * VPS-compatible replacement for the Vercel Blob intermediary flow.
 *
 * Flow:
 *   1. Browser POSTs the file as multipart/form-data to /api/monday/upload-file
 *   2. Server (multer, memoryStorage) receives it and forwards to Monday
 *      via add_file_to_column (server-to-server, no CORS issue)
 *
 * No external storage needed. Max file size enforced client-side (100 MB)
 * and by nginx (500 MB client_max_body_size).
 */

import axios from "axios";

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Upload a single File to a Monday item's file column.
 * @param {string|number} itemId   - Monday item ID
 * @param {string}        columnId - Monday column ID (e.g. "files")
 * @param {File}          file     - Browser File object
 * @param {string}        [apiKey] - Optional Monday API key (from localStorage)
 * @returns {Promise<void>}
 */
export async function uploadFileToMonday(itemId, columnId, file, apiKey) {
  // Client-side size guard
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — ` +
      `files over 100 MB cannot be uploaded. Please attach it directly in Monday.`
    );
  }

  const formData = new FormData();
  formData.append("itemId", String(itemId));
  formData.append("columnId", columnId);
  formData.append("file", file, file.name);

  const headers = {};
  if (apiKey) headers["x-monday-api-key"] = apiKey;

  try {
    await axios.post("/api/monday/upload-file", formData, {
      headers,
      // Don't set Content-Type manually — axios sets it with boundary for multipart
      timeout: 120_000, // 2 min timeout for large files
      onUploadProgress: (evt) => {
        if (evt.total) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          console.log(`[upload] ${file.name}: ${pct}%`);
        }
      },
    });
  } catch (err) {
    const detail = err.response?.data?.error ?? err.message;
    throw new Error(`Failed to upload "${file.name}" to Monday: ${detail}`);
  }
}
