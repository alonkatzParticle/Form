// BatchPage — generate multiple task briefs in one shot.
// Supports: angle variations (different hooks/scripts) and product variations.
import { useState, useRef } from "react";
import axios from "axios";
import HistoryDrawer from "../components/HistoryDrawer.jsx";

function StatusDot({ status }) {
  const icons = { idle: "○", done: "●", submitted: "✓", error: "!" };
  const cls   = { idle: "batch-dot--idle", done: "batch-dot--selected", submitted: "batch-dot--submitted", error: "batch-dot--error" };
  return <span className={`batch-dot ${cls[status] ?? "batch-dot--idle"}`}>{icons[status] ?? "○"}</span>;
}

// Excludes options that don't make sense for batch product selection
const EXCLUDE_PRODUCTS = new Set(["Multiple Products", "Not a Product Task", "Test Product"]);

export default function BatchPage({ onClose, initialBoardId, boards, frequencyOrder = {} }) {
  const [boardType, setBoardType]         = useState(initialBoardId ?? boards?.[0]?.id ?? "video");
  const [mode, setMode]                   = useState("angles"); // "angles" | "products"
  const [count, setCount]                 = useState(3);        // how many tasks (angles mode)
  const [selectedProduct, setSelectedProduct] = useState("");   // single product (angles mode)
  const [selectedProducts, setSelectedProducts] = useState([]); // multi-product (products mode)
  const [concept, setConcept]             = useState("");        // free-form instruction
  const [historyTask, setHistoryTask]     = useState(null);      // { name, product, type, brief } reference
  const [historyOpen, setHistoryOpen]     = useState(false);

  const [phase, setPhase]                 = useState("input");  // "input" | "review"
  const [tasks, setTasks]                 = useState([]);
  const [selectedId, setSelectedId]       = useState(null);
  const [generating, setGenerating]       = useState(false);
  const [genError, setGenError]           = useState(null);
  const [editingBrief, setEditingBrief]   = useState("");

  const activeBoard = boards?.find((b) => b.id === boardType);
  const productField = activeBoard?.fields?.find((f) => f.key === "product" || f.key === "productBundle");
  const rawOptions = (productField?.options ?? []).filter((o) => !EXCLUDE_PRODUCTS.has(o));
  // Sort by frequency — same logic as main form
  const freqArray = frequencyOrder[boardType]?.[productField?.key] ?? [];
  const productOptions = freqArray.length > 0
    ? [...rawOptions].sort((a, b) => {
        const ia = freqArray.indexOf(a);
        const ib = freqArray.indexOf(b);
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      })
    : rawOptions;
  const selected = tasks.find((t) => t.id === selectedId);

  // Build structured prompt from form inputs
  function buildPrompt() {
    const referenceSection = historyTask
      ? `REFERENCE TASK: "${historyTask.name}"\n${historyTask.brief ? `Brief context:\n${historyTask.brief.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}` : ""}\n\n`
      : "";

    if (mode === "angles") {
      const prod = selectedProduct ? `for ${selectedProduct}` : "";
      return `${referenceSection}Generate ${count} distinct task angles ${prod}. ${concept}`.trim();
    } else {
      const prods = selectedProducts.join(", ");
      return `${referenceSection}Generate one task for each of these products: ${prods}. ${concept}`.trim();
    }
  }

  const effectiveCount = mode === "angles" ? count : selectedProducts.length;
  const canGenerate = concept.trim() && (
    mode === "angles" ? true : selectedProducts.length >= 2
  );

  // ── Generation ────────────────────────────────────────────────────────────
  async function handleGenerate(e) {
    e.preventDefault();
    if (!canGenerate) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await axios.post("/api/ai/batch", { prompt: buildPrompt(), boardType });
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

  // Toggle a product tag (products mode)
  function toggleProduct(p) {
    setSelectedProducts((prev) =>
      prev.includes(p)
        ? prev.filter((x) => x !== p)
        : prev.length < 10 ? [...prev, p] : prev
    );
  }

  // ── History load ──────────────────────────────────────────────────────────
  async function handleHistoryLoad(task) {
    // Show the chip immediately with a loading state
    const base = {
      name:    task.name || task.taskName || "Unnamed task",
      product: task.product || task.productBundle || "",
      type:    task.type || "",
      brief:   null,
      loading: true,
    };
    setHistoryTask(base);

    // Pre-select product if in angles mode
    if ((task.product || task.productBundle) && mode === "angles") {
      setSelectedProduct(task.product || task.productBundle);
    }
    setHistoryOpen(false);

    // Fetch the full Monday brief so the AI reads the actual task content
    try {
      const res = await axios.get(`/api/monday/item-update?itemId=${task.id}`);
      const briefHtml = res.data?.body || "";
      setHistoryTask((prev) => prev ? { ...prev, brief: briefHtml, loading: false } : null);
    } catch {
      setHistoryTask((prev) => prev ? { ...prev, loading: false } : null);
    }
  }

  // ── Task selection ────────────────────────────────────────────────────────
  function selectTask(id) {
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const next = tasks.find((t) => t.id === id);
    setSelectedId(id);
    setEditingBrief(next?.editedBrief ?? next?.brief ?? "");
  }

  // ── Submit single ─────────────────────────────────────────────────────────
  async function handleSubmitOne(id) {
    const entry = tasks.find((t) => t.id === id);
    if (!entry || entry.status === "submitted") return;
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitting" } : t));
    const briefToSubmit = id === selectedId ? editingBrief : (entry.editedBrief ?? entry.brief);
    try {
      const createRes = await axios.post("/api/monday/create-item", { boardType, task: entry.task });
      const itemId = createRes.data?.itemId;
      if (itemId && briefToSubmit) {
        await axios.post("/api/monday/create-update", { itemId, body: briefToSubmit });
      }
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitted" } : t));
    } catch (err) {
      console.error("[Batch] Submit error:", err.message);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "error" } : t));
    }
  }

  // ── Submit all ────────────────────────────────────────────────────────────
  async function handleSubmitAll() {
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const pending = tasks.filter((t) => t.status !== "submitted");
    for (const t of pending) await handleSubmitOne(t.id);
  }

  const submittedCount = tasks.filter((t) => t.status === "submitted").length;
  const pendingCount   = tasks.filter((t) => t.status !== "submitted").length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="batch-page">

      {/* Header */}
      <header className="batch-header">
        <button className="batch-back-btn" onClick={onClose}>← Back</button>
        <div className="batch-header-center">
          <span className="batch-header-icon">⚡</span>
          <span className="batch-header-title">Batch Create</span>
          {phase === "review" && <span className="batch-header-count">{tasks.length} tasks</span>}
        </div>
        {phase === "input" && (
          <select className="batch-board-select" value={boardType} onChange={(e) => setBoardType(e.target.value)}>
            {boards?.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        )}
        {phase === "review" && pendingCount > 0 && (
          <button className="batch-submit-all-btn" onClick={handleSubmitAll}>Submit All ({pendingCount})</button>
        )}
      </header>

      {/* Input phase */}
      {phase === "input" && (
        <div className="batch-input-phase">
          <div className="batch-input-card">

            {/* Mode selector */}
            <div className="batch-mode-tabs">
              <button
                className={`batch-mode-tab ${mode === "angles" ? "active" : ""}`}
                onClick={() => setMode("angles")}
              >
                Multiple Angles
              </button>
              <button
                className={`batch-mode-tab ${mode === "products" ? "active" : ""}`}
                onClick={() => setMode("products")}
              >
                Multiple Products
              </button>
            </div>

            <form onSubmit={handleGenerate}>

              {/* Angles mode: product dropdown + count */}
              {mode === "angles" && (
                <div className="batch-angles-row">
                  <div className="batch-field">
                    <label className="batch-label">Product</label>
                    <select
                      className="batch-select"
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                    >
                      <option value="">— any —</option>
                      {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="batch-field batch-field--narrow">
                    <label className="batch-label">How many? <span className="batch-label-hint">(2–10)</span></label>
                    <input
                      type="number"
                      className="batch-count-input"
                      min={2} max={10}
                      value={count}
                      onChange={(e) => setCount(Math.min(10, Math.max(2, Number(e.target.value))))}
                    />
                  </div>
                </div>
              )}

              {/* Products mode: tag grid */}
              {mode === "products" && (
                <div className="batch-field">
                  <label className="batch-label">
                    Select products <span className="batch-label-hint">({selectedProducts.length} selected, max 10)</span>
                  </label>
                  <div className="batch-product-tags">
                    {productOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`batch-product-tag ${selectedProducts.includes(p) ? "active" : ""}`}
                        onClick={() => toggleProduct(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  {selectedProducts.length > 0 && (
                    <button
                      type="button"
                      className="batch-clear-tags"
                      onClick={() => setSelectedProducts([])}
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              )}

              {/* Concept / description */}
              <div className="batch-field">
                <div className="batch-concept-header">
                  <label className="batch-label">
                    {mode === "angles" ? "What do you want?" : "Describe the concept"}
                  </label>
                  <button
                    type="button"
                    className="batch-history-btn"
                    onClick={() => setHistoryOpen(true)}
                    title="Load a past task as reference"
                  >
                    🕐 From History
                  </button>
                </div>

                {/* Reference chip — shown when a history task is selected */}
                {historyTask && (
                  <div className="batch-reference-chip">
                    <div className="batch-reference-chip-inner">
                      <span className="batch-reference-icon">
                        {historyTask.loading ? <span className="batch-ref-spinner" /> : "📋"}
                      </span>
                      <div className="batch-reference-info">
                        <span className="batch-reference-name">{historyTask.name}</span>
                        <span className="batch-reference-sub">
                          {historyTask.loading
                            ? "Fetching brief…"
                            : `${[historyTask.product, historyTask.type].filter(Boolean).join(" · ")}${historyTask.brief ? " · Brief ready" : ""}`}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="batch-reference-remove"
                      onClick={() => setHistoryTask(null)}
                      title="Remove reference"
                    >×</button>
                  </div>
                )}

                <textarea
                  className="batch-prompt-input"
                  placeholder={
                    historyTask
                      ? "What would you like to do differently? e.g. use a pain point angle, adapt for a younger audience…"
                      : mode === "angles"
                        ? "Describe the concept — e.g. transformation story, UGC style, pain point focus…"
                        : "Describe the shared concept — the same idea will be adapted for each product"
                  }
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  rows={4}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(e); }}
                />
              </div>

              {mode === "products" && selectedProducts.length < 2 && (
                <p className="batch-mode-hint">Select at least 2 products to generate</p>
              )}

              {genError && <p className="batch-error">{genError}</p>}

              <div className="batch-generate-row">
                <span className="batch-shortcut">⌘↵ to generate</span>
                {effectiveCount > 0 && canGenerate && (
                  <span className="batch-count-preview">Will generate {effectiveCount} task{effectiveCount !== 1 ? "s" : ""}</span>
                )}
                <button
                  type="submit"
                  className="batch-generate-btn"
                  disabled={generating || !canGenerate}
                >
                  {generating ? <><span className="batch-spinner" /> Generating…</> : "⚡ Generate Tasks"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review phase */}
      {phase === "review" && (
        <div className="batch-review">
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
              {submittedCount > 0 && <p className="batch-submitted-count">{submittedCount} of {tasks.length} submitted</p>}
              <button
                className="batch-new-btn"
                onClick={() => { setPhase("input"); setTasks([]); setSelectedId(null); setConcept(""); }}
              >
                + New Batch
              </button>
            </div>
          </aside>

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
                     selected.status === "submitting" ? "Submitting…"  :
                     selected.status === "error"      ? "⟳ Retry"      : "Submit →"}
                  </button>
                </div>
                <div className="batch-brief-scroll">
                  {selected.brief ? (
                    <div
                      className="batch-brief-content"
                      contentEditable={selected.status !== "submitted"}
                      suppressContentEditableWarning
                      onInput={(e) => setEditingBrief(e.currentTarget.innerHTML)}
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

      {/* History drawer */}
      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        boardType={boardType}
        boardFields={activeBoard?.fields ?? []}
        onLoad={handleHistoryLoad}
      />
    </div>
  );
}
