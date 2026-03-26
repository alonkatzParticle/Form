// useMonday — React hook for Monday.com API calls.
// Fetches users once on mount. Examples are now fetched server-side.
import { useState, useEffect } from "react";
import axios from "axios";

export function useMonday(boardId) {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!boardId) return;

    setLoading(true);
    setError(null);

    axios.get("/api/monday/users")
      .then((res) => {
        setUsers(res.data.map((u) => ({
          ...u,
          name: u.name.replace(/\b\w/g, (c) => c.toUpperCase()),
        })));
      })
      .catch((err) => {
        const e = err.response?.data?.error;
        setError(typeof e === "string" ? e : e?.message || err.message || "Unknown error");
      })
      .finally(() => setLoading(false));
  }, [boardId]);

  return { users, loading, error };
}
