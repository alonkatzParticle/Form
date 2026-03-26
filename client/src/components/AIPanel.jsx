// AIPanel — AI assistant with three modes:
//   autofill: fills fields from a rough description
//   generate: writes a full brief from a one-liner
//   format:   reformats pasted messy notes into structured fields
import { useState } from "react";
import axios from "axios";

const MODES = [
  { id: "autofill", label: "Auto-fill", hint: "Describe your task roughly — AI will fill in the form fields." },
  { id: "generate", label: "Generate Brief", hint: "Give a one-liner idea — AI will write a complete brief." },
  { id: "format", label: "Paste & Format", hint: "Paste an existing rough brief — AI will reformat it." },
];

export default function AIPanel({ boardType, onResult, taskContext = {} }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("autofill");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const activeMode = MODES.find((m) => m.id === mode);

  async function handleSubmit() {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/ai/assist", {
        mode,
        input,
        boardType,
        taskContext,
      });
      // Pass the AI-filled task object up to the parent form
      onResult(res.data);
      setInput("");
    } catch (err) {
      setError(err.response?.data?.error || "AI request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`card ai-panel-card${open ? " ai-panel-card--open" : ""}`}>
      <button
        type="button"
        className="ai-panel-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ai-panel-toggle-label">
          <span className="ai-panel-icon">✦</span>
          AI Assistant
        </span>
        <span className="ai-panel-toggle-hint">
          {open ? "" : "Auto-fill or generate a brief with AI"}
        </span>
        <span className="ai-panel-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="card-body ai-panel">
          <div className="ai-tabs">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`ai-tab ${mode === m.id ? "active" : ""}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="hint">{activeMode.hint}</p>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!loading && input.trim()) handleSubmit();
              }
            }}
            placeholder="Type or paste here… (Enter to submit, Shift+Enter for new line)"
            rows={5}
          />

          <button className="btn-ai" onClick={handleSubmit} disabled={loading || !input.trim()}>
            {loading && <span className="btn-spinner" />}
            {loading ? "Thinking…" : "Fill Form with AI"}
          </button>

          {error && <div className="msg-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
