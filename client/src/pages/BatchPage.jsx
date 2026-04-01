// BatchPage — generate multiple task briefs in one shot.
// Supports: angle variations (different hooks/scripts) and product variations.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import HistoryDrawer from "../components/HistoryDrawer.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";

// Excludes options that don't make sense for batch product selection
const EXCLUDE_PRODUCTS = new Set(["Multiple Products", "Not a Product Task", "Test Product"]);

export default function BatchPage({ boards, frequencyOrder = {}, setPendingTasks }) {
  const navigate = useNavigate();
  
  const [boardType, setBoardType] = usePersistedState("batch_boardType", boards?.[0]?.id ?? "video");
  const [mode, setMode] = usePersistedState("batch_mode", "angles"); // "angles" | "products"
  const [count, setCount] = usePersistedState("batch_count", 3); // how many tasks (angles mode)
  const [selectedProduct, setSelectedProduct] = usePersistedState("batch_selectedProduct", ""); // single product (angles mode)
  const [selectedProducts, setSelectedProducts] = usePersistedState("batch_selectedProducts", []); // multi-product (products mode)
  const [concept, setConcept] = usePersistedState("batch_concept", ""); // free-form instruction
  const [historyTask, setHistoryTask] = usePersistedState("batch_historyTask", null); // { name, product, type, brief } reference
  const [historyOpen, setHistoryOpen] = useState(false);
  const [genError, setGenError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);

  const activeBoard = boards?.find((b) => b.id === boardType);
  const productField = activeBoard?.fields?.find((f) => f.key === "product" || f.key === "productBundle");
  const rawOptions = (productField?.options ?? []).filter((o) => !EXCLUDE_PRODUCTS.has(o));
  
  // Sort by frequency
  const freqArray = frequencyOrder[boardType]?.[productField?.key] ?? [];
  const productOptions = freqArray.length > 0
    ? [...rawOptions].sort((a, b) => {
        const ia = freqArray.indexOf(a);
        const ib = freqArray.indexOf(b);
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      })
    : rawOptions;

  const effectiveCount = mode === "angles" ? count : selectedProducts.length;
  const canGenerate = concept.trim() && (
    mode === "angles" ? true : selectedProducts.length >= 2
  );

  // ── Generation (SSE streaming) to Global Pending Queue ────────────────────
  async function handleGenerate(e) {
    e.preventDefault();
    if (!canGenerate) return;
    setGenError(null);
    setIsStarting(true); // Short UI lock while fetch initiates

    // Setup initial skeletons with a unique generated batch tag so they don't visually collide 
    // with older skeletons if any still exist in the outbox
    const batchId = Date.now();
    const skeletons = Array.from({ length: effectiveCount }, (_, i) => ({
      id: `skeleton-${batchId}-${i}`, 
      task: null, 
      brief: null, 
      status: "generating", 
      boardType,
      createdAt: batchId  // same timestamp for all skeletons in a batch
    }));
    
    // Also stamp createdAt on fulfilled tasks when they arrive;
    // see event.type === "task" handler which sets createdAt: Date.now()
    
    // Inject skeletons directly into the global queue
    const skeletonIds = skeletons.map(s => s.id);
    setPendingTasks(prev => [...prev, ...skeletons]);
    navigate(`/review?ids=${skeletonIds.join(",")}`);

    setIsStarting(false); // UI lock release after navigation

    try {
      const res = await fetch("/api/ai/batch-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept,
          boardType,
          mode,
          count,
          selectedProduct,
          selectedProducts,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server encountered an error (${res.status}). Please try again.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "start") {
              // Adjust skeletons count if AI modified it
              setPendingTasks(prev => {
                const next = [...prev];
                const mySkeletonsIdx = next.findIndex(t => t.id.startsWith(`skeleton-${batchId}`));
                if (mySkeletonsIdx === -1) return next;
                
                // Keep tasks before this batch
                const preceding = next.slice(0, mySkeletonsIdx);
                // Create exact number of new skeletons
                const adjustedSkeletons = Array.from({ length: event.total }, (_, i) => ({
                  id: `skeleton-${batchId}-${i}`, task: null, brief: null, status: "generating", boardType
                }));
                return [...preceding, ...adjustedSkeletons];
              });
            }

            if (event.type === "task") {
              const ready = { id: event.id, task: event.task, brief: event.brief, status: "idle", boardType };
              setPendingTasks(prev => {
                const next = [...prev];
                // Find the first skeleton from this batch that is still generating
                const skeletonIdx = next.findIndex(t => t.id.startsWith(`skeleton-${batchId}`) && t.status === "generating");
                if (skeletonIdx !== -1) {
                  next[skeletonIdx] = ready;
                } else {
                  next.push(ready);
                }
                return next;
              });
            }

            if (event.type === "error") {
              // Mark remaining skeletons in this batch as error
              setPendingTasks(prev => prev.map(t => 
                t.id.startsWith(`skeleton-${batchId}`) && t.status === "generating"
                  ? { ...t, status: "error", brief: `<p>Error: ${event.message}</p>` }
                  : t
              ));
            }
          } catch { /* malformed event, skip */ }
        }
      }
    } catch (err) {
      setPendingTasks(prev => prev.map(t => 
        t.id.startsWith(`skeleton-${batchId}`) && t.status === "generating"
          ? { ...t, status: "error", brief: `<p>Fatal Error: ${err.message}</p>` }
          : t
      ));
    } finally {
      setIsStarting(false);
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

  if (!boards || boards.length === 0) {
    return (
      <div className="batch-page">
        <header className="app-header">
          <h1>Batch Create</h1>
          <p>Generate multiple tasks at once</p>
        </header>
        <div className="batch-input-phase" style={{ textAlign: "center", padding: "40px" }}>Loading settings…</div>
      </div>
    );
  }

  return (
    <div className="batch-page">
      <header className="app-header">
        <h1>Batch Create</h1>
        <p>Generate multiple tasks at once</p>
      </header>

      <div className="board-tabs-bar">
        <div className="board-tabs-pill">
          {boards.map((b) => (
            <button
              key={b.id}
              className={`board-tab ${boardType === b.id ? "active" : ""}`}
              onClick={() => setBoardType(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="batch-input-phase">
        <div className="batch-input-card">
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
                    min="2" max="10"
                    className="batch-count-input"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </div>
              </div>
            )}

            {mode === "products" && (
              <div className="batch-field">
                <label className="batch-label">Products <span className="batch-label-hint">({selectedProducts.length} selected)</span></label>
                <div className="batch-product-tags">
                  {productOptions.map((p) => {
                    const active = selectedProducts.includes(p);
                    return (
                      <button
                        key={p} type="button"
                        className={`batch-product-tag ${active ? "active" : ""}`}
                        onClick={() => toggleProduct(p)}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="batch-field">
              <div className="batch-concept-header">
                <label className="batch-label" style={{marginBottom: 0}}>Concept & Instructions</label>
                <button type="button" className="batch-history-btn" onClick={() => setHistoryOpen(true)}>
                  Use past task as reference
                </button>
              </div>

              {historyTask && (
                <div className="batch-reference-chip">
                  <div className="batch-reference-inner">
                    <div className="batch-reference-icon">
                      {historyTask.loading ? <span className="batch-ref-spinner" /> : "📄"}
                    </div>
                    <div className="batch-reference-info">
                      <span className="batch-reference-name">{historyTask.name}</span>
                      <span className="batch-reference-sub">Using this task's brief as formatting reference</span>
                    </div>
                  </div>
                  <button type="button" className="batch-reference-remove" onClick={() => setHistoryTask(null)}>×</button>
                </div>
              )}

              <textarea
                className="batch-prompt-input"
                placeholder={mode === "angles" 
                  ? "e.g., Generate hooks targeting new moms focusing on convenience and lack of sleep."
                  : "e.g., Create a review-style script using a highly energetic influencer tone."}
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
              />
            </div>

            {genError && <div className="batch-error">{genError}</div>}

            <div className="batch-generate-row">
              <span className="batch-count-preview">Generating {effectiveCount} tasks</span>
              <button type="submit" className="batch-generate-btn" disabled={!canGenerate || isStarting}>
                {isStarting ? "Queuing..." : `Generate ✨`}
              </button>
            </div>
          </form>
        </div>
      </div>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        boardType={boardType}
        boardFields={activeBoard?.fields ?? []}
        onLoad={() => {
          // Temporarily doing nothing here, history reference handles itself via prop drilling
        }}
      />
    </div>
  );
}

