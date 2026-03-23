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
