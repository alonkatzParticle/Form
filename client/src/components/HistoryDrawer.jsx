// HistoryDrawer — slide-in panel showing the last 50 tasks from Monday.com.
// Lets users search by name and re-populate the form with one click.

import { useState, useEffect, useRef } from "react";
import axios from "axios";

// ── Map a Monday item's column values back to form field values ───────────────
// Uses the board's field definitions (from settings) to find the right column ID.
function mapItemToTask(item, boardFields) {
  const colMap = {};
  item.columnValues.forEach((cv) => { colMap[cv.id] = cv; });

  const task = {};

  for (const field of boardFields) {
    if (!field.mondayColumnId) continue;
    if (field.type === "file") continue;

    const col = colMap[field.mondayColumnId];
    if (!col || (!col.text && !col.value)) continue;

    const text = col.text || "";
    const rawValue = col.value ? (() => { try { return JSON.parse(col.value); } catch { return null; } })() : null;

    switch (field.type) {
      case "multiselect":
        task[field.key] = text ? text.split(", ").map((s) => s.trim()).filter(Boolean) : [];
        break;

      case "people": {
        // value JSON: { "personsAndTeams": [{ "id": 123, "kind": "person" }] }
        const ids = (rawValue?.personsAndTeams || []).map((p) => String(p.id));
        task[field.key] = ids;
        break;
      }

      case "hooks":
        // Only the first hook is stored in Monday — restore as single-element array
        task[field.key] = text ? [text] : [];
        break;

      case "number":
        task[field.key] = text ? Number(text) : null;
        break;

      default:
        task[field.key] = text;
    }
  }

  return task;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HistoryDrawer({ isOpen, onClose, boardType, boardFields, onLoad }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState("");
  const [loadingId, setLoadingId] = useState(null);
  const searchRef               = useRef(null);
  const hasFetched              = useRef(false);

  // Fetch from Monday when first opened
  useEffect(() => {
    if (!isOpen || hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    setError(null);
    axios.get(`/api/monday/history?boardType=${boardType}`)
      .then((res) => setItems(res.data))
      .catch((err) => setError(err.response?.data?.error || "Failed to load history"))
      .finally(() => setLoading(false));
  }, [isOpen, boardType]);

  // Re-fetch when board switches
  useEffect(() => {
    hasFetched.current = false;
    setItems([]);
  }, [boardType]);

  // Focus search when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [isOpen]);

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleLoad(item) {
    setLoadingId(item.id);
    try {
      // Step 1: Get column-value mapped fields as a fast base
      const baseTask = mapItemToTask(item, boardFields);

      // Step 2: Fetch the Monday brief (first update) for this item
      let aiTask = null;
      try {
        const updateRes = await axios.get(`/api/monday/item-update?itemId=${item.id}`);
        const briefHtml = updateRes.data?.body;

        if (briefHtml) {
          // Step 3: Ask Haiku to extract all fields from the brief
          const aiRes = await axios.post("/api/ai/assist", {
            mode: "historyLoad",
            boardType,
            input: briefHtml,
          });
          aiTask = aiRes.data?.task ?? aiRes.data ?? null;
        }
      } catch (err) {
        console.warn("[HistoryDrawer] AI extraction failed, falling back to column values:", err.message);
      }

      // Step 4: Merge — AI result takes priority, base fills any gaps
      const merged = { ...baseTask, ...(aiTask || {}) };

      // Preserve people fields from base (AI can't resolve IDs)
      if (baseTask.requestor?.length)       merged.requestor      = baseTask.requestor;
      if (baseTask.editorDesigner?.length)  merged.editorDesigner = baseTask.editorDesigner;

      onLoad(merged);
      onClose();
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="history-backdrop" onClick={onClose} />
      )}

      <div className={`history-drawer${isOpen ? " history-drawer--open" : ""}`}>
        <div className="history-drawer-header">
          <div>
            <h3 className="history-drawer-title">Task History</h3>
            <p className="history-drawer-sub">Last 50 tasks from Monday</p>
          </div>
          <button className="history-drawer-close" onClick={onClose} aria-label="Close history">✕</button>
        </div>

        <div className="history-search-wrap">
          <input
            ref={searchRef}
            type="text"
            className="history-search"
            placeholder="Search by task name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="history-search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        <div className="history-list">
          {loading && (
            <div className="history-empty">Loading tasks…</div>
          )}
          {error && (
            <div className="history-empty history-empty--error">{error}</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="history-empty">
              {search ? "No tasks match your search." : "No tasks found."}
            </div>
          )}
          {!loading && filtered.map((item) => (
            <div key={item.id} className="history-entry">
              <div className="history-entry-main">
                <span className="history-entry-name">{item.name}</span>
                <span className="history-entry-date">{formatDate(item.createdAt)}</span>
              </div>
              <button
                className="history-load-btn"
                onClick={() => handleLoad(item)}
                disabled={loadingId === item.id}
              >
                {loadingId === item.id ? "Loading…" : "Load"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
