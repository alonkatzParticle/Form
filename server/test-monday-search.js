import 'dotenv/config';
import fetch from "node-fetch";

async function test(queryVar) {
  const query = `
    query SearchHistory($boardId: ID!, $queryVar: String!) {
      boards(ids: [$boardId]) {
        items_page(limit: 10, query_params: { rules: [{ column_id: "name", compare_value: [$queryVar], operator: contains_text }] }) {
          items { id name }
        }
      }
    }
  `;
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "API-Version": "2024-01",
      Authorization: process.env.MONDAY_API_KEY,
    },
    body: JSON.stringify({ query, variables: { boardId: "1483329065", queryVar } }),
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}
test("test");
