// Monday.com GraphQL API service.
// All Monday API calls go through this file so the API key and base URL are in one place.

const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayQuery(query, variables = {}) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.map((e) => e.message).join("; ") || JSON.stringify(data.errors));
  return data.data;
}

// Create a new item on a Monday board.
// columnValues is an object mapping Monday column IDs to their values.
export async function createItem(boardId, itemName, columnValues) {
  const query = `
    mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
        url
      }
    }
  `;
  // Monday expects columnValues as a JSON string
  return mondayQuery(query, {
    boardId,
    itemName,
    columnValues: JSON.stringify(columnValues),
  });
}

// Fetch the most recent items from a board for use as AI examples.
export async function getExampleItems(boardId, limit = 50) {
  const query = `
    query GetItems($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          items {
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { boardId, limit });
  return data.boards[0]?.items_page?.items || [];
}

// Fetch all users in the Monday.com account for the Requestor and Editor/Designer dropdowns.
export async function getUsers() {
  const query = `
    query {
      users {
        id
        name
        email
        photo_thumb_small
      }
    }
  `;
  const data = await mondayQuery(query);
  return data.users || [];
}

// Post a text update (comment) on an existing Monday item.
export async function createUpdate(itemId, body) {
  const query = `
    mutation CreateUpdate($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;
  return mondayQuery(query, { itemId: String(itemId), body });
}

// Upload a file to a Monday file column on an existing item.
// Monday's file upload uses a separate multipart endpoint instead of the standard GraphQL one.
export async function uploadFileToColumn(itemId, columnId, fileBuffer, fileName, mimeType) {
  const mutation = `
    mutation ($file: File!) {
      add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) {
        id
      }
    }
  `;

  const form = new FormData();
  form.append("query", mutation);
  form.append("map", JSON.stringify({ file: ["variables.file"] }));
  form.append("file", new Blob([fileBuffer], { type: mimeType }), fileName);

  const res = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: { Authorization: process.env.MONDAY_API_KEY },
    body: form,
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.map((e) => e.message).join("; "));
  return data.data;
}

// Fetch a single item by ID — returns its current name, board ID, and all column values.
export async function getItem(itemId) {
  const query = `
    query GetItem($itemId: ID!) {
      items(ids: [$itemId]) {
        id
        name
        board { id }
        column_values { id text }
      }
    }
  `;
  const data = await mondayQuery(query, { itemId: String(itemId) });
  return data.items?.[0] ?? null;
}

// Rename a Monday item by writing to its built-in "name" column.
export async function renameItem(boardId, itemId, newName) {
  const query = `
    mutation RenameItem($boardId: ID!, $itemId: ID!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) {
        id
        name
      }
    }
  `;
  return mondayQuery(query, { boardId, itemId: String(itemId), value: newName });
}

// Fetch the first page of items from a board (for frequency analysis).
// Returns { cursor, items: [{ created_at, column_values: [{ id, text }] }] }
export async function getItemsPage(boardId, limit = 200) {
  const query = `
    query GetItemsPage($boardId: ID!, $limit: Int!) {
      boards(ids: [$boardId]) {
        items_page(limit: $limit) {
          cursor
          items {
            created_at
            column_values { id text }
          }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { boardId, limit });
  return data.boards[0]?.items_page ?? null;
}

// Fetch subsequent pages using a cursor returned by getItemsPage.
export async function getNextItemsPage(cursor, limit = 200) {
  const query = `
    query NextItemsPage($limit: Int!, $cursor: String!) {
      next_items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          created_at
          column_values { id text }
        }
      }
    }
  `;
  const data = await mondayQuery(query, { limit, cursor });
  return data.next_items_page ?? null;
}

// Fetch board column details (IDs, titles, types) — useful for mapping form fields to column IDs.
export async function getBoardColumns(boardId) {
  const query = `
    query GetColumns($boardId: ID!) {
      boards(ids: [$boardId]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;
  const data = await mondayQuery(query, { boardId });
  return data.boards[0]?.columns || [];
}
