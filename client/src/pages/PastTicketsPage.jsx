import { useState } from "react";
import { isVisible, buildAutoName } from "../components/forms/DynamicForm.jsx";
import { useMonday } from "../hooks/useMonday.js";
import { ExternalLink, Clock, Inbox, RotateCcw } from "lucide-react";

function formatTimeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function getSidebarLabel(t, board) {
  const task = t.task;
  if (!task) return { title: "Submitted Task", sub: "" };
  const concept = task.conceptIdea || task.videoConceptLabel || task.manualName || "";
  const autoName = buildAutoName(board, task) || "";
  if (concept && concept !== autoName) {
    return { title: concept, sub: [task.product, task.type].filter(Boolean).join(" · ") };
  }
  const segments = autoName.split(" | ");
  if (segments.length > 1) {
    return { title: segments[segments.length - 1], sub: segments.slice(0, -1).join(" · ") };
  }
  return { title: autoName || "Submitted Task", sub: [task.product, task.type].filter(Boolean).join(" · ") };
}

function ReadOnlyField({ label, value }) {
  if (!value && value !== 0) return null;
  const displayVal = Array.isArray(value) ? value.filter(Boolean).join(", ") : String(value);
  if (!displayVal.trim()) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: "0.92rem", color: "var(--text)", background: "var(--surface)",
        border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
        padding: "10px 14px", lineHeight: 1.5, whiteSpace: "pre-wrap"
      }}>
        {displayVal}
      </div>
    </div>
  );
}

export default function PastTicketsPage({ submittedTasks, boards, onRequeue, onRefresh }) {
  const [selectedId, setSelectedId] = useState(submittedTasks?.[0]?.id ?? null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh?.(); } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  }
  
  const selected = submittedTasks?.find(t => t.id === selectedId);
  const activeBoard = boards?.find(b => b.id === selected?.boardType) ?? boards?.[0];
  const { users } = useMonday(activeBoard?.boardId);

  // Sort newest first
  const sorted = [...(submittedTasks ?? [])].sort((a, b) => (b.submittedAt ?? b.createdAt ?? 0) - (a.submittedAt ?? a.createdAt ?? 0));

  const visibleFields = activeBoard?.fields?.filter(f =>
    selected?.task && isVisible(f, selected.task) && f.type !== "file" && f.mondayValueType !== "item_name"
  ) ?? [];

  function getUserName(id) {
    return users?.find(u => String(u.id) === String(id))?.name ?? id;
  }

  function getDisplayValue(field, task) {
    const val = task[field.key];
    if (val === null || val === undefined || val === "") return null;
    if (Array.isArray(val) && val.length === 0) return null;
    if (field.type === "people") return val.map(getUserName).join(", ");
    if (field.type === "hooks") return val.filter(Boolean).map((h, i) => `${i + 1}. ${h}`).join("\n");
    if (Array.isArray(val)) return val.join(", ");
    return val;
  }

  return (
    <div className="batch-page">
      <header className="batch-header" style={{ justifyContent: "space-between", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <div className="batch-header-center">
          <Clock size={18} style={{ marginRight: 8, color: "var(--text-muted)" }} />
          <span className="batch-header-title">Past Tickets</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 8 }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{sorted.length} submitted</span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text-muted)",
              fontSize: "0.8rem", cursor: refreshing ? "not-allowed" : "pointer",
              opacity: refreshing ? 0.5 : 1, transition: "all 0.15s"
            }}
          >
            <RotateCcw size={13} style={{ animation: refreshing ? "btn-spin 0.6s linear infinite" : "none" }} />
            {refreshing ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, padding: 48, textAlign: "center" }}>
          <Inbox size={48} style={{ opacity: 0.25, color: "var(--text-muted)" }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", margin: 0 }}>
            No submitted tasks yet.<br />Tasks you submit will appear here for easy reference.
          </p>
        </div>
      ) : (
        <div className="batch-review">
          {/* Left sidebar list */}
          <aside className="batch-sidebar">
            <div className="batch-sidebar-label">Submitted ({sorted.length})</div>
            <ul className="batch-task-list">
              {sorted.map(t => {
                const board = boards?.find(b => b.id === t.boardType);
                const { title, sub } = getSidebarLabel(t, board);
                return (
                  <li
                    key={t.id}
                    className={`batch-task-item ${selectedId === t.id ? "batch-task-item--active" : ""}`}
                    onClick={() => setSelectedId(t.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="batch-dot batch-dot--selected" style={{ opacity: selectedId === t.id ? 1 : 0.3 }}>●</span>
                    <div className="batch-task-meta" style={{ flex: 1, minWidth: 0 }}>
                      <span className="batch-task-name" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                      <span className="batch-task-sub" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
                      <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", opacity: 0.7 }}>
                        {formatTimeAgo(t.submittedAt ?? t.createdAt)}
                      </span>
                    </div>
                    {t.mondayUrl && (
                      <a
                        href={t.mondayUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Open in Monday.com"
                        style={{ color: "var(--purple)", flexShrink: 0, padding: "2px 4px", opacity: 0.7, transition: "opacity 0.15s" }}
                        onMouseOver={e => e.currentTarget.style.opacity = "1"}
                        onMouseOut={e => e.currentTarget.style.opacity = "0.7"}
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Right detail pane */}
          <main className="batch-main">
            {selected ? (
              <>
                <div className="batch-main-header">
                  <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
                    <h2 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontWeight: 600, color: "var(--text)" }}>
                      {selected.task?.manualName ?? buildAutoName(activeBoard, selected.task)}
                    </h2>
                    <p className="batch-main-sub" style={{ paddingLeft: 0, margin: 0 }}>
                      Submitted {formatTimeAgo(selected.submittedAt ?? selected.createdAt)} · {activeBoard?.label ?? ""}
                      {selected.createdBy && (
                        <> · <span style={{ color: "var(--purple, #7c6af7)", fontWeight: 500 }}>by {selected.createdBy}</span></>
                      )}
                    </p>
                  </div>
                  {selected.mondayUrl && (
                    <a
                      href={selected.mondayUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "10px 18px", borderRadius: "var(--radius-sm)",
                        background: "var(--purple)", color: "#fff",
                        textDecoration: "none", fontWeight: 600, fontSize: "0.88rem",
                        flexShrink: 0, transition: "opacity 0.15s"
                      }}
                      onMouseOver={e => e.currentTarget.style.opacity = "0.85"}
                      onMouseOut={e => e.currentTarget.style.opacity = "1"}
                    >
                      <ExternalLink size={14} />
                      Open in Monday
                    </a>
                  )}
                  {onRequeue && (
                    <button
                      onClick={() => onRequeue(selected)}
                      title="Send back to Pending Queue"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "10px 18px", borderRadius: "var(--radius-sm)",
                        background: "transparent", border: "1px solid var(--border)",
                        color: "var(--text)", cursor: "pointer",
                        fontWeight: 600, fontSize: "0.88rem", flexShrink: 0,
                        transition: "background 0.15s"
                      }}
                      onMouseOver={e => e.currentTarget.style.background = "var(--surface-hover, rgba(255,255,255,0.06))"}
                      onMouseOut={e => e.currentTarget.style.background = "transparent"}
                    >
                      <RotateCcw size={14} />
                      Re-queue
                    </button>
                  )}
                </div>

                <div className="batch-split-view" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                  {/* Form fields read-only */}
                  <div className="batch-split-left" style={{ flex: 1, overflowY: "auto", borderRight: "1px solid var(--border)" }}>
                    <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
                      {visibleFields.map(f => (
                        <ReadOnlyField
                          key={f.key}
                          label={f.label}
                          value={getDisplayValue(f, selected.task)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Brief read-only */}
                  <div className="batch-split-right" style={{ width: "45%", display: "flex", flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                      <h4 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Brief</h4>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
                      {selected.brief ? (
                        <div
                          className="batch-brief-content"
                          dangerouslySetInnerHTML={{ __html: selected.brief }}
                          style={{ border: "none", padding: 0, background: "transparent", pointerEvents: "none", userSelect: "text" }}
                        />
                      ) : (
                        <div className="batch-empty-state">No brief recorded for this task.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="batch-empty-state">Select a task to view its details.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
