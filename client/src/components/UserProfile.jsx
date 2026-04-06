// UserProfile — slide-in panel for setting the user's Monday API key.
// The key is stored in localStorage and injected by the axios interceptor in main.jsx.
// No server storage needed — key lives client-side and survives refreshes.
import { useState, useEffect } from "react";
import { X, Key, CheckCircle, Trash2 } from "lucide-react";

const STORAGE_KEY = "user_monday_api_key";

export default function UserProfile({ isOpen, onClose }) {
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  // Load existing key status on open
  useEffect(() => {
    if (isOpen) {
      const existing = localStorage.getItem(STORAGE_KEY);
      setHasKey(!!existing);
      setInput(""); // don't pre-fill for security
      setSaved(false);
    }
  }, [isOpen]);

  function handleSave() {
    const trimmed = input.trim();
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setHasKey(true);
    setInput("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClear() {
    localStorage.removeItem(STORAGE_KEY);
    setHasKey(false);
    setInput("");
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200 }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 380,
        background: "var(--surface)", borderLeft: "1px solid var(--border)",
        zIndex: 201, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.3)"
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 24px", borderBottom: "1px solid var(--border)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Key size={18} style={{ color: "var(--purple)" }} />
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--text)" }}>
              Your Profile
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "28px 24px", flex: 1, overflowY: "auto" }}>

          {/* Status badge */}
          {hasKey && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(99, 217, 158, 0.12)", border: "1px solid rgba(99,217,158,0.3)",
              borderRadius: "var(--radius-sm)", padding: "10px 14px", marginBottom: 24
            }}>
              <CheckCircle size={15} style={{ color: "var(--success, #63d99e)", flexShrink: 0 }} />
              <span style={{ fontSize: "0.85rem", color: "var(--text)" }}>
                API key saved — tasks will be created under your Monday identity
              </span>
            </div>
          )}

          <label style={{
            display: "block", fontSize: "0.78rem", fontWeight: 600,
            color: "var(--text-muted)", textTransform: "uppercase",
            letterSpacing: "0.05em", marginBottom: 8
          }}>
            Monday API Key
          </label>
          <p style={{ fontSize: "0.83rem", color: "var(--text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Tasks and updates you submit will be created using your Monday account.
            Find your key in Monday → Profile → Developer → API Token v2.
          </p>

          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={hasKey ? "Enter new key to replace…" : "Paste your Monday API token…"}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--bg)",
              color: "var(--text)", fontSize: "0.9rem", boxSizing: "border-box",
              outline: "none", marginBottom: 12,
              fontFamily: "monospace"
            }}
          />

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={!input.trim()}
              style={{
                flex: 1, padding: "10px 0", borderRadius: "var(--radius-sm)",
                background: saved ? "var(--success, #63d99e)" : "var(--purple)",
                color: "#fff", border: "none", cursor: input.trim() ? "pointer" : "not-allowed",
                fontWeight: 600, fontSize: "0.88rem", opacity: input.trim() ? 1 : 0.5,
                transition: "background 0.2s"
              }}
            >
              {saved ? "✓ Saved!" : "Save Key"}
            </button>
            {hasKey && (
              <button
                onClick={handleClear}
                title="Remove saved key"
                style={{
                  padding: "10px 14px", borderRadius: "var(--radius-sm)",
                  background: "transparent", border: "1px solid var(--border)",
                  color: "var(--text-muted)", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem"
                }}
              >
                <Trash2 size={14} />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
