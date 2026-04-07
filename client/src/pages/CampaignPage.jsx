// CampaignPage — create the same task for multiple products at once.
// User fills one form, picks multiple products, writes a shared brief,
// and all tasks land in the Pending queue ready to ship one by one.

import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, ChevronDown, X } from "lucide-react";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import { buildAutoName } from "../components/forms/DynamicForm.jsx";
import { useMonday } from "../hooks/useMonday.js";

// Fields the campaign page manages itself — hidden from DynamicForm
const HIDDEN_FIELDS = ["product", "taskName"];

// ── Product multi-select ───────────────────────────────────────────────────────

function ProductMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef(null);

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

  function handleOpen() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen((p) => !p);
    setSearch("");
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (!btnRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div>
      {/* Trigger button — styled to match .field inputs */}
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8,
          padding: "9px 12px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--input-bg)",
          color: selected.length ? "var(--text)" : "var(--placeholder)",
          fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--purple)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(108,99,255,0.12)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.length === 0
            ? "Select products…"
            : selected.length === 1
            ? selected[0]
            : `${selected.length} products selected`}
        </span>
        <ChevronDown size={14} style={{ opacity: 0.5, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {/* Fixed-position dropdown — avoids overflow clipping from scrollable parent */}
      {open && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            maxHeight: 300,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
            <input
              autoFocus
              type="text"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "6px 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--input-bg)", color: "var(--text)",
                fontSize: "0.85rem", fontFamily: "inherit", outline: "none",
              }}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map((opt) => (
              <label
                key={opt}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 14px", cursor: "pointer", fontSize: "0.88rem",
                  color: "var(--text)", background: selected.includes(opt) ? "rgba(108,99,255,0.06)" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseOver={(e) => { if (!selected.includes(opt)) e.currentTarget.style.background = "var(--bg)"; }}
                onMouseOut={(e) => { e.currentTarget.style.background = selected.includes(opt) ? "rgba(108,99,255,0.06)" : "transparent"; }}
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
              <p style={{ padding: "12px 14px", color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>No products found</p>
            )}
          </div>
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {selected.map((s) => (
            <span key={s} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 8px 3px 10px", borderRadius: 999,
              background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)",
              color: "var(--purple)", fontSize: "0.78rem", fontWeight: 500,
            }}>
              {s}
              <button type="button" onClick={() => toggle(s)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                color: "var(--purple)", display: "flex", alignItems: "center", lineHeight: 1,
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

  // Product options from the active board's product field
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

    // Validate required fields (DynamicForm hides product + taskName — skip those)
    const requiredFields = activeBoard?.fields?.filter(
      (f) => f.required && !HIDDEN_FIELDS.includes(f.key)
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
      const platform = taskData.platform || "";
      const itemName = [product, platform, campaignName.trim()].filter(Boolean).join(" | ");
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

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", height: "calc(100vh - 56px)", overflowY: "auto", boxSizing: "border-box" }}>

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

        {/* Campaign name — uses .field CSS so it matches the rest of the form */}
        <div className="field" style={{ marginBottom: 20 }}>
          <label>Campaign Name <span className="required">*</span></label>
          <input
            type="text"
            placeholder="e.g. Memorial Day 2025"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
          />
        </div>

        {/* Products multi-select */}
        <div className="field" style={{ marginBottom: 28 }}>
          <label>Products <span className="required">*</span></label>
          <p className="hint">One identical task will be created per product. Name format: Product | Platform | Campaign</p>
          <ProductMultiSelect
            options={productOptions}
            selected={selectedProducts}
            onChange={setSelectedProducts}
          />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0 0 28px" }} />

        {/* Task form — product + taskName hidden since handled above */}
        {activeBoard && (
          <DynamicForm
            board={activeBoard}
            users={users}
            frequencyOrder={frequencyOrder}
            hiddenFieldKeys={HIDDEN_FIELDS}
            onTaskChange={handleTaskChange}
            onReview={null}
          />
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "28px 0" }} />

        {/* Manual brief */}
        <div className="field" style={{ marginBottom: 28 }}>
          <label>Brief / Script</label>
          <p className="hint">Posted as an update on every task — write once, applies to all products.</p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Write your shared brief, script, or creative direction here…"
            rows={10}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 16,
            background: "var(--red-bg)", border: "1px solid rgba(255,59,48,0.2)",
            color: "var(--red)", fontSize: "0.85rem",
          }}>
            {error}
          </div>
        )}

        {/* Create button */}
        <button
          onClick={handleCreate}
          className="batch-submit-one-btn"
          style={{ width: "100%", padding: "12px 0", fontSize: "0.95rem", borderRadius: "var(--radius-sm)", marginBottom: 40 }}
        >
          Create {selectedProducts.length > 0 ? `${selectedProducts.length} ` : ""}Campaign Task{selectedProducts.length !== 1 ? "s" : ""} →
        </button>

      </div>
    </div>
  );
}
