// useMonday — React hook for Monday.com API calls.
// Fetches users and board examples once on mount, caches them in state.
import { useState, useEffect } from "react";
import axios from "axios";

export function useMonday(boardId) {
  const [users, setUsers] = useState([]);
  const [exampleItems, setExampleItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!boardId) return;

    setLoading(true);
    setError(null);

    Promise.all([
      axios.get("/api/monday/users"),
      axios.get(`/api/monday/examples?boardId=${boardId}`),
    ])
      .then(([usersRes, examplesRes]) => {
        setUsers(usersRes.data);
        setExampleItems(examplesRes.data);
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message);
      })
      .finally(() => setLoading(false));
  }, [boardId]);

  return { users, exampleItems, loading, error };
}
