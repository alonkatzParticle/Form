// UserProfile — slide-in panel for setting the user's Monday API key.
// Stored in localStorage, injected via axios interceptor in main.jsx.
import { useState, useEffect } from "react";
import { X, Key, Check, Trash2, ExternalLink } from "lucide-react";

const STORAGE_KEY = "user_monday_api_key";

export default function UserProfile({ isOpen, onClose }) {
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setHasKey(!!localStorage.getItem(STORAGE_KEY));
      setInput("");
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
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 300,
          backdropFilter: "blur(2px)",
        }}
      />

      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 360,
        background: "var(--bg, #0f1117)",
        borderLeft: "1px solid var(--border, rgba(255,255,255,0.08))",
        zIndex: 301,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.4)",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px",
          borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Key size={16} style={{ color: "var(--purple, #7c6af7)" }} />
            <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text, #e8e8f0)" }}>
              Your Profile
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted, #888)", padding: 6, borderRadius: 6,
              display: "flex", alignItems: "center",
              transition: "color 0.15s",
            }}
            onMouseOver={e => e.currentTarget.style.color = "var(--text, #e8e8f0)"}
            onMouseOut={e => e.currentTarget.style.color = "var(--text-muted, #888)"}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 20px", flex: 1, overflowY: "auto" }}>

          {/* Section label */}
          <div style={{
            fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em",
            color: "var(--text-muted, #888)", textTransform: "uppercase",
            marginBottom: 10,
          }}>
            Monday API Key
          </div>

          {/* Status */}
          {hasKey && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 8, marginBottom: 16,
              background: "rgba(99,217,158,0.08)",
              border: "1px solid rgba(99,217,158,0.2)",
            }}>
              <Check size={13} style={{ color: "#63d99e", flexShrink: 0 }} />
              <span style={{ fontSize: "0.82rem", color: "var(--text, #e8e8f0)" }}>
                API key saved — tasks created under your account
              </span>
            </div>
          )}

          <p style={{
            fontSize: "0.82rem", color: "var(--text-muted, #888)",
            marginBottom: 14, lineHeight: 1.6,
          }}>
            Tasks you submit will be created using your Monday identity.{" "}
            <a
              href="https://monday.com/settings/developer"
              target="_blank" rel="noreferrer"
              style={{ color: "var(--purple, #7c6af7)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              Get your token <ExternalLink size={11} />
            </a>
          </p>

          {/* Input */}
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={hasKey ? "Enter new key to replace…" : "Paste your API token…"}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(255,255,255,0.08))",
              background: "var(--surface, #1a1d2e)",
              color: "var(--text, #e8e8f0)",
              fontSize: "0.88rem",
              outline: "none",
              marginBottom: 10,
              fontFamily: "inherit",
            }}
            onFocus={e => e.target.style.borderColor = "var(--purple, #7c6af7)"}
            onBlur={e => e.target.style.borderColor = "var(--border, rgba(255,255,255,0.08))"}
          />

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={!input.trim()}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8,
                background: saved ? "rgba(99,217,158,0.15)" : "var(--purple, #7c6af7)",
                border: saved ? "1px solid rgba(99,217,158,0.3)" : "none",
                color: saved ? "#63d99e" : "#fff",
                fontWeight: 600, fontSize: "0.85rem",
                cursor: input.trim() ? "pointer" : "not-allowed",
                opacity: input.trim() ? 1 : 0.4,
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {saved ? <><Check size={13} /> Saved!</> : "Save Key"}
            </button>

            {hasKey && (
              <button
                onClick={handleClear}
                style={{
                  padding: "9px 14px", borderRadius: 8,
                  background: "transparent",
                  border: "1px solid var(--border, rgba(255,255,255,0.08))",
                  color: "var(--text-muted, #888)",
                  cursor: "pointer", fontSize: "0.82rem",
                  display: "flex", alignItems: "center", gap: 5,
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor = "rgba(255,80,80,0.4)"; e.currentTarget.style.color = "#ff6b6b"; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border, rgba(255,255,255,0.08))"; e.currentTarget.style.color = "var(--text-muted, #888)"; }}
              >
                <Trash2 size={13} /> Clear
              </button>
            )}
          </div>

          {/* Fallback note */}
          <p style={{
            fontSize: "0.75rem", color: "var(--text-muted, #888)",
            marginTop: 20, lineHeight: 1.5,
            padding: "10px 12px", borderRadius: 8,
            background: "var(--surface, #1a1d2e)",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
          }}>
            If no key is saved, the shared workspace key is used as fallback.
          </p>
        </div>
      </div>
    </>
  );
}
