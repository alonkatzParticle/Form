// UserProfile — slide-in panel for per-user Monday API key.
// Key stored in localStorage, injected via axios interceptor.
// On save, resolves Monday identity and stores name for creator attribution.
import { useState, useEffect } from "react";
import { X, Key, Check, Trash2, ExternalLink, Loader } from "lucide-react";
import axios from "axios";

const KEY_STORAGE  = "user_monday_api_key";
const NAME_STORAGE = "user_monday_name";

export default function UserProfile({ isOpen, onClose }) {
  const [input,     setInput]     = useState("");
  const [saved,     setSaved]     = useState(false);
  const [resolving, setResolving] = useState(false);
  const [hasKey,    setHasKey]    = useState(false);
  const [userName,  setUserName]  = useState("");

  useEffect(() => {
    if (isOpen) {
      setHasKey(!!localStorage.getItem(KEY_STORAGE));
      setUserName(localStorage.getItem(NAME_STORAGE) || "");
      setInput("");
      setSaved(false);
    }
  }, [isOpen]);

  async function handleSave() {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Save key immediately so the interceptor picks it up for the /me call
    localStorage.setItem(KEY_STORAGE, trimmed);
    setHasKey(true);
    setInput("");
    setResolving(true);

    try {
      const { data } = await axios.get("/api/monday/me", {
        headers: { "X-Monday-Api-Key": trimmed },
      });
      const name = data.name || data.email || "Unknown";
      localStorage.setItem(NAME_STORAGE, name);
      setUserName(name);
    } catch {
      // Key saved but couldn't resolve name — not a blocker
      localStorage.removeItem(NAME_STORAGE);
      setUserName("");
    } finally {
      setResolving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  function handleClear() {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(NAME_STORAGE);
    setHasKey(false);
    setUserName("");
    setInput("");
  }

  if (!isOpen) return null;

  // Hardcoded light colours so typed text is always visible on dark surface
  const TEXT       = "#e0e0f0";
  const MUTED      = "#9090a8";
  const SURFACE    = "#1a1d2e";
  const BORDER     = "rgba(255,255,255,0.1)";
  const PURPLE     = "#7c6af7";
  const BG         = "#0f1117";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, backdropFilter: "blur(2px)" }} />

      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 360, background: BG, borderLeft: `1px solid ${BORDER}`, zIndex: 301, display: "flex", flexDirection: "column", boxShadow: "-8px 0 40px rgba(0,0,0,0.4)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Key size={16} style={{ color: PURPLE }} />
            <span style={{ fontSize: "0.95rem", fontWeight: 600, color: TEXT }}>Your Profile</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, padding: 6, borderRadius: 6, display: "flex" }}
            onMouseOver={e => e.currentTarget.style.color = TEXT} onMouseOut={e => e.currentTarget.style.color = MUTED}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 20px", flex: 1, overflowY: "auto" }}>

          {/* Section label */}
          <div style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase", marginBottom: 10 }}>
            Monday API Key
          </div>

          {/* Resolved identity */}
          {hasKey && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, marginBottom: 16, background: "rgba(99,217,158,0.08)", border: "1px solid rgba(99,217,158,0.2)" }}>
              <Check size={13} style={{ color: "#63d99e", flexShrink: 0 }} />
              <span style={{ fontSize: "0.82rem", color: TEXT }}>
                {userName ? <>Signed in as <strong>{userName}</strong></> : "API key saved"}
              </span>
            </div>
          )}

          <p style={{ fontSize: "0.82rem", color: MUTED, marginBottom: 14, lineHeight: 1.6 }}>
            Tasks you submit will be created under your Monday identity.{" "}
            <a href="https://monday.com/settings/developer" target="_blank" rel="noreferrer"
              style={{ color: PURPLE, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
              Get your token <ExternalLink size={11} />
            </a>
          </p>

          {/* Input — explicit light text so it's always readable */}
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder={hasKey ? "Enter new key to replace…" : "Paste your API token…"}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: SURFACE,
              color: TEXT,           // ← explicit light colour
              caretColor: TEXT,      // ← cursor visible
              fontSize: "0.88rem",
              outline: "none",
              marginBottom: 10,
              fontFamily: "inherit",
            }}
            onFocus={e => e.target.style.borderColor = PURPLE}
            onBlur={e => e.target.style.borderColor = BORDER}
          />

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={!input.trim() || resolving}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 8,
                background: saved ? "rgba(99,217,158,0.15)" : PURPLE,
                border: saved ? "1px solid rgba(99,217,158,0.3)" : "none",
                color: saved ? "#63d99e" : "#fff",
                fontWeight: 600, fontSize: "0.85rem",
                cursor: (input.trim() && !resolving) ? "pointer" : "not-allowed",
                opacity: (input.trim() && !resolving) ? 1 : 0.4,
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {resolving ? <><Loader size={13} style={{ animation: "spin 1s linear infinite" }} /> Resolving…</>
               : saved   ? <><Check size={13} /> Saved!</>
               : "Save Key"}
            </button>

            {hasKey && (
              <button onClick={handleClear}
                style={{ padding: "9px 14px", borderRadius: 8, background: "transparent", border: `1px solid ${BORDER}`, color: MUTED, cursor: "pointer", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 5, transition: "border-color 0.15s, color 0.15s" }}
                onMouseOver={e => { e.currentTarget.style.borderColor = "rgba(255,80,80,0.4)"; e.currentTarget.style.color = "#ff6b6b"; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = MUTED; }}>
                <Trash2 size={13} /> Clear
              </button>
            )}
          </div>

          <p style={{ fontSize: "0.75rem", color: MUTED, marginTop: 20, lineHeight: 1.5, padding: "10px 12px", borderRadius: 8, background: SURFACE, border: `1px solid ${BORDER}` }}>
            If no key is saved, the shared workspace key is used as fallback.
          </p>
        </div>
      </div>
    </>
  );
}
