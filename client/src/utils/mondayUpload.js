/**
 * Direct browser-to-Monday file upload.
 *
 * Uploads a File object to a Monday.com file column without routing through
 * the server, bypassing Vercel's 4.5 MB serverless request body limit.
 *
 * Uses the same multipart format as the server-side uploadFileToColumn:
 *   - "query"   → the GraphQL mutation
 *   - "map"     → maps the "file" variable to the multipart part
 *   - "file"    → the actual binary file
 *
 * Note: API-Version header is intentionally omitted from the file upload
 * endpoint because it can cause CORS preflight failures.
 */

import axios from "axios";

let _cachedToken = null;

async function getUploadToken() {
  if (_cachedToken) return _cachedToken;
  const { data } = await axios.get("/api/monday/upload-token");
  _cachedToken = data.token;
  return _cachedToken;
}

/**
 * Upload a single File to a Monday item's file column.
 * @param {string|number} itemId   - Monday item ID
 * @param {string}        columnId - Monday column ID (e.g. "files")
 * @param {File}          file     - Browser File object
 * @returns {Promise<object>}      - Monday API response data
 */
export async function uploadFileToMonday(itemId, columnId, file) {
  const token = await getUploadToken();

  const mutation = `
    mutation ($file: File!) {
      add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) {
        id
      }
    }
  `;

  // Use the same multipart format as the server (GraphQL multipart spec)
  const fd = new FormData();
  fd.append("query", mutation);
  fd.append("map", JSON.stringify({ file: ["variables.file"] }));
  fd.append("file", file, file.name);

  let response;
  try {
    response = await fetch("https://api.monday.com/v2/file", {
      method: "POST",
      headers: {
        // Only Authorization — no API-Version, no Content-Type
        // (Content-Type is set automatically by fetch for FormData with the boundary)
        Authorization: token,
      },
      body: fd,
    });
  } catch (networkErr) {
    // Likely a CORS error — the browser blocked the request
    throw new Error(
      `Monday file upload blocked (possible CORS issue). File: "${file.name}". ` +
      `Error: ${networkErr.message}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable body)");
    throw new Error(
      `Monday file upload failed (HTTP ${response.status}). ` +
      `File: "${file.name}". Response: ${body}`
    );
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(
      `Monday rejected the file upload for "${file.name}": ${json.errors.map(e => e.message).join("; ")}`
    );
  }

  return json.data;
}
