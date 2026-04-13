/**
 * Direct browser-to-Monday file upload.
 *
 * Uploads a File object to a Monday.com file column without routing through
 * the server, bypassing Vercel's 4.5 MB serverless request body limit.
 * Files up to Monday's own 500 MB limit are supported.
 *
 * Flow:
 *   1. Fetch the effective API key from /api/monday/upload-token
 *   2. POST the file directly to https://api.monday.com/v2/file using
 *      Monday's multipart file upload format
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
 * @returns {Promise<object>}      - Monday API response
 */
export async function uploadFileToMonday(itemId, columnId, file) {
  const token = await getUploadToken();

  // Monday's file upload requires a multipart body with:
  //   - "query"            → the GraphQL mutation string
  //   - "variables[file]"  → the binary file
  const query = `mutation ($file: File!) {
    add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) {
      id
    }
  }`;

  const fd = new FormData();
  fd.append("query", query);
  fd.append("variables[file]", file, file.name);

  const response = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: {
      Authorization: token,
      "API-Version": "2024-01",
    },
    body: fd,
  });

  if (!response.ok) {
    throw new Error(`Monday file upload failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`Monday file upload error: ${json.errors[0].message}`);
  }

  return json;
}
