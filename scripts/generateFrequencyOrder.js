#!/usr/bin/env node
// scripts/generateFrequencyOrder.js
// Fetches the last 500 items from each Monday board, counts how often
// each dropdown value appears in the last 30 days, and writes the
// sorted result to server/data/frequencyOrder.json.
//
// Run manually:    node scripts/generateFrequencyOrder.js
// Run via GitHub Actions: see .github/workflows/update-frequency.yml

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

// Load env from project root
config({ path: resolve(ROOT, ".env") });

if (!process.env.MONDAY_API_KEY) {
  console.error("Error: MONDAY_API_KEY is not set.");
  process.exit(1);
}

const MONDAY_API = "https://api.monday.com/v2";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 500;

async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

async function getItemsPage(boardId, limit = 200) {
  const query = `
    query GetItems($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          cursor
          items { created_at column_values { id text } }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { boardId, limit });
  return data.boards[0]?.items_page ?? null;
}

async function getNextItemsPage(cursor, limit = 200) {
  const query = `
    query NextPage($cursor: String!, $limit: Int!) {
      next_items_page(limit: $limit, cursor: $cursor) {
        cursor
        items { created_at column_values { id text } }
      }
    }
  `;
  const data = await mondayQuery(query, { cursor, limit });
  return data.next_items_page ?? null;
}

function getFrequencyFields(board) {
  return board.fields.filter(
    (f) => f.mondayColumnId &&
      (f.type === "select" || f.type === "multiselect" || f.type === "people")
  );
}

async function fetchBoardFrequencies(board) {
  const cutoff    = new Date(Date.now() - THIRTY_DAYS_MS);
  const freqFields = getFrequencyFields(board);
  if (!freqFields.length) return {};

  const colToField = Object.fromEntries(freqFields.map((f) => [f.mondayColumnId, f]));
  const counts     = Object.fromEntries(freqFields.map((f) => [f.key, {}]));

  let page    = await getItemsPage(board.boardId, 200);
  let fetched = 0;

  while (page && fetched < MAX_ITEMS) {
    for (const item of page.items ?? []) {
      if (new Date(item.created_at) < cutoff) continue;
      for (const cv of item.column_values ?? []) {
        const field = colToField[cv.id];
        if (!field || !cv.text) continue;
        for (const v of cv.text.split(", ").filter(Boolean)) {
          counts[field.key][v] = (counts[field.key][v] ?? 0) + 1;
        }
      }
    }
    fetched += (page.items ?? []).length;
    if (!page.cursor || (page.items ?? []).length < 200) break;
    page = await getNextItemsPage(page.cursor, 200);
  }

  // Convert counts → sorted arrays
  return Object.fromEntries(
    Object.entries(counts).map(([key, valCounts]) => [
      key,
      Object.entries(valCounts).sort((a, b) => b[1] - a[1]).map(([val]) => val),
    ])
  );
}

async function main() {
  const settings = JSON.parse(readFileSync(resolve(ROOT, "server/settings.json"), "utf-8"));
  const result   = {};

  for (const board of settings.boards ?? []) {
    if (!board.boardId) continue;
    console.log(`Fetching ${board.label ?? board.id}...`);
    try {
      result[board.id] = await fetchBoardFrequencies(board);
      const totalValues = Object.values(result[board.id]).reduce((s, arr) => s + arr.length, 0);
      console.log(`  ✓ ${totalValues} unique values across ${Object.keys(result[board.id]).length} fields`);
    } catch (err) {
      console.warn(`  ✗ Failed: ${err.message}`);
      result[board.id] = {};
    }
  }

  const outDir  = resolve(ROOT, "server/data");
  const outPath = resolve(outDir, "frequencyOrder.json");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
