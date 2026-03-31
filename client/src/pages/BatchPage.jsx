// BatchPage — generate multiple task briefs in one shot.
// Supports: angle variations (different hooks/scripts) and product variations.
import { useState, useRef } from "react";
import axios from "axios";

const STATUS = { idle: "idle", loading: "loading", done: "done", submitting: "submitting", submitted: "submitted", error: "error" };

function StatusDot({ status }) {
  const icons = { idle: "○", done: "●", submitted: "✓", error: "!" };
  const cls = { idle: "batch-dot--idle", done: "batch-dot--selected", submitted: "batch-dot--submitted", error: "batch-dot--error" };
  return <span className={`batch-dot ${cls[status] ?? "batch-dot--idle"}`}>{icons[status] ?? "○"}</span>;
}

export default function BatchPage({ onClose, initialBoardId, boards }) {
  const [boardType, setBoardType]     = useState(initialBoardId ?? boards?.[0]?.id ?? "video");
  const [prompt, setPrompt]           = useState("");
  const [phase, setPhase]             = useState("input"); // "input" | "review"
  const [tasks, setTasks]             = useState([]);      // [{ id, task, brief, status }]
  const [selectedId, setSelectedId]   = useState(null);
  const [generating, setGenerating]   = useState(false);
  const [genError, setGenError]       = useState(null);
  const [editingBrief, setEditingBrief] = useState("");    // editable brief HTML
  const textareaRef = useRef(null);

  const activeBoard = boards?.find((b) => b.id === boardType);
  const selected = tasks.find((t) => t.id === selectedId);

  // ── Generation ────────────────────────────────────────────────────────────
  async function handleGenerate(e) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await axios.post("/api/ai/batch", { prompt: prompt.trim(), boardType });
      const raw = res.data?.tasks ?? [];
      const enriched = raw.map((t) => ({ ...t, status: "idle", editedBrief: null }));
      setTasks(enriched);
      setSelectedId(enriched[0]?.id ?? null);
      setEditingBrief(enriched[0]?.brief ?? "");
      setPhase("review");
    } catch (err) {
      setGenError(err.response?.data?.error || err.message || "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  // ── Task selection ────────────────────────────────────────────────────────
  function selectTask(id) {
    // Save any edits to the previously selected task
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const next = tasks.find((t) => t.id === id);
    setSelectedId(id);
    setEditingBrief(next?.editedBrief ?? next?.brief ?? "");
  }

  function handleBriefChange(html) {
    setEditingBrief(html);
  }

  // ── Submit single ─────────────────────────────────────────────────────────
  async function handleSubmitOne(id) {
    const entry = tasks.find((t) => t.id === id);
    if (!entry || entry.status === "submitted") return;

    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitting" } : t));

    const briefToSubmit = id === selectedId ? editingBrief : (entry.editedBrief ?? entry.brief);

    try {
      // Create the Monday item
      const createRes = await axios.post("/api/monday/create-item", {
        boardType,
        task: entry.task,
      });
      const itemId = createRes.data?.itemId;

      // Post the brief as an update
      if (itemId && briefToSubmit) {
        await axios.post("/api/monday/create-update", {
          itemId,
          body: briefToSubmit,
        });
      }
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitted" } : t));
    } catch (err) {
      console.error("[Batch] Submit error:", err.message);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "error" } : t));
    }
  }

  // ── Submit all ────────────────────────────────────────────────────────────
  async function handleSubmitAll() {
    // Save current edits first
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const pending = tasks.filter((t) => t.status !== "submitted");
    for (const t of pending) {
      await handleSubmitOne(t.id);
    }
  }

  const submittedCount = tasks.filter((t) => t.status === "submitted").length;
  const pendingCount   = tasks.filter((t) => t.status !== "submitted").length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="batch-page">
      {/* Header */}
      <header className="batch-header">
        <button className="batch-back-btn" onClick={onClose} title="Back to form">← Back</button>
        <div className="batch-header-center">
          <span className="batch-header-icon">⚡</span>
          <span className="batch-header-title">Batch Create</span>
          {phase === "review" && (
            <span className="batch-header-count">{tasks.length} tasks</span>
          )}
        </div>
        {/* Board selector */}
        {phase === "input" && (
          <select
            className="batch-board-select"
            value={boardType}
            onChange={(e) => setBoardType(e.target.value)}
          >
            {boards?.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        )}
        {phase === "review" && pendingCount > 0 && (
          <button className="batch-submit-all-btn" onClick={handleSubmitAll}>
            Submit All ({pendingCount})
          </button>
        )}
      </header>

      {/* Input phase */}
      {phase === "input" && (
        <div className="batch-input-phase">
          <div className="batch-input-card">
            <h2 className="batch-input-title">What do you need?</h2>
            <p className="batch-input-hint">
              Describe your batch — angles on one concept, or one concept across multiple products.
            </p>
            <div className="batch-examples">
              <span className="batch-example" onClick={() => setPrompt("3 angles on one concept — transformation, social proof, and pain point")}>
                Multiple angles
              </span>
              <span className="batch-example" onClick={() => setPrompt("Same concept adapted for different products")}>
                Multiple products
              </span>
            </div>
            <form onSubmit={handleGenerate}>
              <textarea
                ref={textareaRef}
                className="batch-prompt-input"
                placeholder={`Describe what you need — e.g. "3 UGC angles with different emotional hooks" or "same concept adapted for 3 different products"`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(e); }}
              />
              {genError && <p className="batch-error">{genError}</p>}
              <div className="batch-generate-row">
                <span className="batch-shortcut">⌘↵ to generate</span>
                <button
                  type="submit"
                  className="batch-generate-btn"
                  disabled={generating || !prompt.trim()}
                >
                  {generating ? (
                    <><span className="batch-spinner" /> Generating…</>
                  ) : (
                    "⚡ Generate Tasks"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review phase — split layout */}
      {phase === "review" && (
        <div className="batch-review">
          {/* Left sidebar — task list */}
          <aside className="batch-sidebar">
            <div className="batch-sidebar-label">Generated Tasks</div>
            <ul className="batch-task-list">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className={`batch-task-item ${selectedId === t.id ? "batch-task-item--active" : ""} batch-task-item--${t.status}`}
                  onClick={() => selectTask(t.id)}
                >
                  <StatusDot status={selectedId === t.id && t.status === "idle" ? "done" : t.status} />
                  <div className="batch-task-meta">
                    <span className="batch-task-name">{t.task?.taskName || t.task?.conceptIdea || `Task ${tasks.indexOf(t) + 1}`}</span>
                    <span className="batch-task-sub">{[t.task?.product, t.task?.type].filter(Boolean).join(" · ")}</span>
                  </div>
                  {t.status === "submitted" && <span className="batch-status-badge batch-status-badge--ok">✓</span>}
                  {t.status === "error"     && <span className="batch-status-badge batch-status-badge--err">!</span>}
                </li>
              ))}
            </ul>

            <div className="batch-sidebar-footer">
              {submittedCount > 0 && (
                <p className="batch-submitted-count">{submittedCount} of {tasks.length} submitted</p>
              )}
              <button
                className="batch-new-btn"
                onClick={() => { setPhase("input"); setTasks([]); setSelectedId(null); setPrompt(""); }}
              >
                + New Batch
              </button>
            </div>
          </aside>

          {/* Right panel — brief preview + submit */}
          <main className="batch-main">
            {selected ? (
              <>
                <div className="batch-main-header">
                  <div>
                    <h3 className="batch-main-title">{selected.task?.taskName || `Task ${tasks.indexOf(selected) + 1}`}</h3>
                    <p className="batch-main-sub">{[selected.task?.product, selected.task?.platform, selected.task?.type].filter(Boolean).join(" · ")}</p>
                  </div>
                  <button
                    className="batch-submit-one-btn"
                    onClick={() => handleSubmitOne(selected.id)}
                    disabled={selected.status === "submitted" || selected.status === "submitting"}
                  >
                    {selected.status === "submitted"  ? "✓ Submitted"  :
                     selected.status === "submitting" ? "Submitting…" :
                     selected.status === "error"      ? "⟳ Retry"     : "Submit →"}
                  </button>
                </div>

                {/* Editable brief */}
                <div className="batch-brief-scroll">
                  {selected.brief ? (
                    <div
                      className="batch-brief-content"
                      contentEditable={selected.status !== "submitted"}
                      suppressContentEditableWarning
                      onInput={(e) => handleBriefChange(e.currentTarget.innerHTML)}
                      dangerouslySetInnerHTML={{ __html: editingBrief }}
                    />
                  ) : (
                    <p className="batch-no-brief">Brief generation failed for this task.</p>
                  )}
                </div>
              </>
            ) : (
              <div className="batch-empty-state">Select a task from the list to preview its brief.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
