// CampaignPage — create the same task for multiple products at once.
// User fills one form, picks multiple products, writes a shared brief,
// and all tasks land in the Pending queue ready to ship one by one.

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, ChevronDown, X } from "lucide-react";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import { buildColumnValues, buildAutoName } from "../components/forms/DynamicForm.jsx";
import { useMonday } from "../hooks/useMonday.js";

// ── Product multi-select ───────────────────────────────────────────────────────

function ProductMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  function toggle(opt) {
    onChange(
      selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt]
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8,
          padding: "9px 12px", borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)", background: "var(--surface)",
          color: selected.length ? "var(--text)" : "var(--text-muted)",
          fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit",
          transition: "border-color 0.15s",
        }}
        onMouseOver={(e) => e.currentTarget.style.borderColor = "var(--purple)"}
        onMouseOut={(e) => !open && (e.currentTarget.style.borderColor = "var(--border)")}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.length === 0
            ? "Select products…"
            : selected.length === 1
            ? selected[0]
            : `${selected.length} products selected`}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.6, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          maxHeight: 280, display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", padding: "6px 10px",
                borderRadius: 6, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--text)", fontSize: "0.82rem",
                fontFamily: "inherit", outline: "none",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((opt) => (
              <label key={opt} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", cursor: "pointer", fontSize: "0.85rem",
                color: "var(--text)", transition: "background 0.1s",
              }}
                onMouseOver={(e) => e.currentTarget.style.background = "var(--surface-hover, rgba(255,255,255,0.05))"}
                onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: "var(--purple)", width: 14, height: 14, flexShrink: 0 }}
                />
                {opt}
              </label>
            ))}
            {filtered.length === 0 && (
              <p style={{ padding: "12px", color: "var(--text-muted)", fontSize: "0.82rem", margin: 0 }}>No products found</p>
            )}
          </div>
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {selected.map((s) => (
            <span key={s} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 8px 3px 10px", borderRadius: 999,
              background: "rgba(124,106,247,0.15)", border: "1px solid rgba(124,106,247,0.3)",
              color: "var(--purple)", fontSize: "0.78rem", fontWeight: 500,
            }}>
              {s}
              <button type="button" onClick={() => toggle(s)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                color: "var(--purple)", display: "flex", alignItems: "center",
              }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CampaignPage({ boards, frequencyOrder, onTasksGenerated }) {
  const navigate = useNavigate();
  const [activeBoardId, setActiveBoardId] = useState(boards?.[0]?.id ?? null);
  const [campaignName, setCampaignName] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [formTask, setFormTask] = useState({});
  const [brief, setBrief] = useState("");
  const [error, setError] = useState("");

  const activeBoard = boards?.find((b) => b.id === activeBoardId);
  const { users } = useMonday(activeBoard?.boardId);

  // Product options for the active board
  const productField = activeBoard?.fields?.find((f) => f.key === "product");
  const productOptions = productField?.options ?? [];

  function handleBoardSwitch(id) {
    setActiveBoardId(id);
    setSelectedProducts([]);
    setFormTask({});
    setError("");
  }

  const handleTaskChange = useCallback((updated) => {
    setFormTask(updated);
  }, []);

  function handleCreate() {
    setError("");
    if (!campaignName.trim()) return setError("Please enter a campaign name.");
    if (selectedProducts.length === 0) return setError("Select at least one product.");

    // Validate required fields (excluding product — handled by multi-select)
    const requiredFields = activeBoard?.fields?.filter(
      (f) => f.required && f.key !== "product"
    ) ?? [];
    for (const f of requiredFields) {
      const val = formTask[f.key];
      const empty = val === null || val === undefined || val === "" ||
        (Array.isArray(val) && val.length === 0);
      if (empty) return setError(`"${f.label}" is required.`);
    }

    // Generate one task per product
    const tasks = selectedProducts.map((product) => {
      const taskData = { ...formTask, product };
      const itemName = taskData.manualName || buildAutoName(activeBoard, taskData) || `${campaignName} — ${product}`;
      return {
        id: `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        task: { ...taskData, manualName: itemName },
        brief: brief || "",
        boardType: activeBoardId,
        status: "idle",
        createdAt: Date.now(),
        campaignName: campaignName.trim(),
      };
    });

    onTasksGenerated(tasks);
    navigate("/pending");
  }

  return (
    <div className="batch-page">
      <header className="batch-header" style={{ justifyContent: "space-between" }}>
        <div className="batch-header-center">
          <Megaphone size={18} className="batch-header-icon" style={{ color: "var(--purple)" }} />
          <span className="batch-header-title">Campaign Create</span>
        </div>
        <button className="batch-back-btn" onClick={() => navigate("/")}>← Back</button>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", overflowY: "auto", height: "calc(100vh - 56px)", boxSizing: "border-box" }}>

        {/* Board selector */}
        <div className="board-tabs-bar" style={{ marginBottom: 28 }}>
          <div className="board-tabs-pill">
            {boards.map((b) => (
              <button
                key={b.id}
                className={`board-tab ${activeBoardId === b.id ? "active" : ""}`}
                onClick={() => handleBoardSwitch(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Campaign name */}
        <div className="field" style={{ marginBottom: 24 }}>
          <label>Campaign Name <span className="required"> *</span></label>
          <input
            className="form-input"
            placeholder="e.g. Memorial Day 2025"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
          />
        </div>

        {/* Products multi-select */}
        <div className="field" style={{ marginBottom: 28 }}>
          <label>Products <span className="required"> *</span></label>
          <p className="hint">One identical task will be created per product.</p>
          <ProductMultiSelect
            options={productOptions}
            selected={selectedProducts}
            onChange={setSelectedProducts}
          />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0 0 28px" }} />

        {/* Task form — product field hidden since handled above */}
        {activeBoard && (
          <DynamicForm
            board={activeBoard}
            users={users}
            frequencyOrder={frequencyOrder}
            hiddenFieldKeys={["product"]}
            onTaskChange={handleTaskChange}
            onReview={null}
          />
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "28px 0" }} />

        {/* Manual brief */}
        <div className="field" style={{ marginBottom: 28 }}>
          <label>Brief / Script</label>
          <p className="hint">This brief will be posted as an update on every task. Write it once — it applies to all products.</p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Write your shared brief, script, or creative direction here…"
            rows={10}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "12px 14px", borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text)", fontSize: "0.88rem", fontFamily: "inherit",
              resize: "vertical", lineHeight: 1.6, outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--purple)"}
            onBlur={(e) => e.target.style.borderColor = "var(--border)"}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 16,
            background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.25)",
            color: "#ff8080", fontSize: "0.85rem",
          }}>
            {error}
          </div>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          className="batch-submit-one-btn"
          style={{ width: "100%", padding: "12px 0", fontSize: "0.95rem", borderRadius: "var(--radius-sm)" }}
        >
          Create {selectedProducts.length > 0 ? `${selectedProducts.length} ` : ""}Campaign Tasks →
        </button>

      </div>
    </div>
  );
}
