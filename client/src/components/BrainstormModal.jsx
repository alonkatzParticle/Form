// BrainstormModal — fullscreen creative ideation chat with Wednesday.
// Triggered from the AI Panel when Step 1 is complete.
// No form-filling — pure creative conversation.
// When concept is ready, Wednesday outputs [FILL_FORM]{...}[/FILL_FORM] which
// shows a confirmation card. On confirm → populates the home form and closes.

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

const STORAGE_KEY = "brainstorm_chat";
const MAX_HISTORY = 30;

// ── Parse [FILL_FORM] blocks ──────────────────────────────────────────────────
function parseBrainstormResponse(text) {
  const fillMatch = text.match(/\[FILL_FORM\]\s*([\s\S]*?)\s*\[\/FILL_FORM\]/);
  if (!fillMatch) return { visibleText: text.trim(), fillData: null };

  let fillData = null;
  try { fillData = JSON.parse(fillMatch[1].trim()); } catch { /* invalid */ }

  const visibleText = text
    .replace(/\[FILL_FORM\][\s\S]*?\[\/FILL_FORM\]/g, "")
    .trim();

  return { visibleText, fillData };
}

// ── Field label helper ────────────────────────────────────────────────────────
function fieldLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

// ── FillFormCard — confirmation card shown before creating the task ────────────
function FillFormCard({ fillData, status, onConfirm, onCancel }) {
  const entries = Object.entries(fillData).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--purple)",
      borderRadius: "var(--radius)",
      padding: "16px",
      marginTop: "12px",
    }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
        ✦ Proposed Task
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
        {entries.map(([key, val]) => (
          <div key={key} style={{ display: "flex", gap: "8px", fontSize: "0.83rem", lineHeight: 1.4 }}>
            <span style={{ color: "var(--text-muted)", minWidth: "110px", flexShrink: 0 }}>{fieldLabel(key)}</span>
            <span style={{ color: "var(--text)", wordBreak: "break-word" }}>
              {Array.isArray(val) ? val.join(", ") : String(val)}
            </span>
          </div>
        ))}
      </div>
      {status === "pending" && (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onConfirm}
            style={{ padding: "7px 18px", borderRadius: 6, border: "none", background: "var(--purple)", color: "#fff", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}
          >
            Create Task →
          </button>
          <button
            onClick={onCancel}
            style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: "0.85rem", cursor: "pointer" }}
          >
            Not yet
          </button>
        </div>
      )}
      {status === "confirmed" && (
        <div style={{ fontSize: "0.83rem", color: "var(--purple)", fontWeight: 600 }}>✓ Creating task…</div>
      )}
      {status === "cancelled" && (
        <div style={{ fontSize: "0.83rem", color: "var(--text-muted)" }}>Dismissed — keep chatting!</div>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg, onFillConfirm, onFillCancel }) {
  const isWed = msg.role === "assistant";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isWed ? "flex-start" : "flex-end",
      marginBottom: "4px",
    }}>
      {isWed && (
        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--purple)", marginBottom: "4px", letterSpacing: "0.05em" }}>
          WEDNESDAY
        </div>
      )}
      {msg.visibleText && (
        <div style={{
          maxWidth: "72%",
          padding: isWed ? "12px 16px" : "10px 16px",
          borderRadius: isWed ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
          background: isWed ? "var(--card)" : "var(--purple)",
          color: isWed ? "var(--text)" : "#fff",
          fontSize: "0.9rem",
          lineHeight: 1.6,
          border: isWed ? "1px solid var(--border)" : "none",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        }}>
          <div className="wed-msg-markdown" style={{ color: "inherit" }}>
            <ReactMarkdown>{msg.visibleText}</ReactMarkdown>
          </div>
        </div>
      )}
      {msg.fillData && (
        <div style={{ maxWidth: "72%", width: "100%" }}>
          <FillFormCard
            fillData={msg.fillData}
            status={msg.fillStatus ?? "pending"}
            onConfirm={() => onFillConfirm(msg.id)}
            onCancel={() => onFillCancel(msg.id)}
          />
        </div>
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: "4px" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--purple)", marginBottom: "4px", letterSpacing: "0.05em" }}>
        WEDNESDAY
      </div>
      <div className="wed-typing" style={{ padding: "12px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "4px 16px 16px 16px" }}>
        <span /><span /><span />
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function BrainstormModal({ isOpen, onClose, step1Context = {}, onFillForm }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);
  const greetedRef = useRef(false);

  // Load history from localStorage on mount
  useEffect(() => {
    if (!isOpen) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setMessages(JSON.parse(saved)); } catch { setMessages([]); }
    } else {
      setMessages([]);
    }
  }, [isOpen]);

  // Greet on first open (only if no history)
  useEffect(() => {
    if (!isOpen || greetedRef.current) return;
    greetedRef.current = true;
    // Small delay to let history load first
    setTimeout(() => {
      setMessages((prev) => {
        if (prev.length > 0) return prev; // has history, skip greeting
        sendGreeting();
        return prev;
      });
    }, 150);
  }, [isOpen]); // eslint-disable-line

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // Focus input when opens
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Persist messages
  function save(msgs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs)); } catch {}
  }

  function addMessage(msg) {
    const full = { id: Date.now() + Math.random(), ...msg };
    setMessages((prev) => {
      const next = [...prev, full];
      save(next);
      return next;
    });
    return full;
  }

  function updateMessage(id, patch) {
    setMessages((prev) => {
      const next = prev.map((m) => m.id === id ? { ...m, ...patch } : m);
      save(next);
      return next;
    });
  }

  function buildGreetingText() {
    const { product, type, platform, department } = step1Context;
    const parts = [type, product, platform].filter(Boolean);
    if (parts.length > 0) {
      return `Hey! I can see you're working on **${parts.join(" · ")}**. What's the concept? Give me the angle, the hook, or even just a vibe — and we'll build from there.`;
    }
    return "Hey! What are we working on today? Tell me the product and I'll help you develop the concept.";
  }

  async function sendGreeting() {
    await streamFrom("/api/wednesday/brainstorm", "[GREETING]", true);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    addMessage({ role: "user", visibleText: text });
    await streamFrom("/api/wednesday/brainstorm", text, false);
  }

  async function streamFrom(url, userContent, isInternal) {
    setStreaming(true);
    setStreamText("");

    let fullText = "";
    abortRef.current = new AbortController();

    // Build history
    const history = [
      ...messages.map((m) => ({ role: m.role, content: m.rawContent ?? m.visibleText ?? "" })),
      { role: "user", content: userContent },
    ].slice(-MAX_HISTORY);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          step1Context,
          isInternal,
        }),
        signal: abortRef.current.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              fullText += parsed.text;
              setStreamText(fullText);
            }
          } catch { /* skip bad chunks */ }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      fullText = "Sorry, something went wrong. Try again.";
    }

    setStreaming(false);
    setStreamText("");

    if (fullText) {
      const { visibleText, fillData } = parseBrainstormResponse(fullText);
      addMessage({
        role: "assistant",
        visibleText: visibleText || (fillData ? "Here's what I've put together:" : ""),
        rawContent: fullText,
        fillData,
        fillStatus: fillData ? "pending" : null,
      });
    }
  }

  function handleFillConfirm(msgId) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.fillData) return;
    updateMessage(msgId, { fillStatus: "confirmed" });
    onFillForm?.(msg.fillData);
    onClose();
  }

  function handleFillCancel(msgId) {
    updateMessage(msgId, { fillStatus: "cancelled" });
  }

  function handleNewSession() {
    abortRef.current?.abort();
    setMessages([]);
    setStreamText("");
    setStreaming(false);
    greetedRef.current = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    // Re-trigger greeting
    setTimeout(() => sendGreeting(), 100);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 500,
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      animation: "fadeIn 0.15s ease",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        height: 60,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px", padding: "6px 0" }}
        >
          ← Back to form
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.1rem", color: "var(--purple)" }}>✦</span>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>Brainstorm with Wednesday</span>
        </div>
        <button
          onClick={handleNewSession}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem", padding: "5px 12px" }}
        >
          New Session
        </button>
      </div>

      {/* Step 1 context pill */}
      {Object.values(step1Context).some(Boolean) && (
        <div style={{
          padding: "8px 24px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          flexShrink: 0,
        }}>
          {Object.entries(step1Context).filter(([, v]) => v).map(([k, v]) => (
            <span key={k} style={{
              padding: "2px 10px",
              borderRadius: 20,
              background: "var(--purple-light, rgba(109,40,217,0.08))",
              color: "var(--purple)",
              fontSize: "0.78rem",
              fontWeight: 600,
            }}>
              {v}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ maxWidth: 720, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
          {messages.map((msg) => (
            <Message
              key={msg.id}
              msg={msg}
              onFillConfirm={handleFillConfirm}
              onFillCancel={handleFillCancel}
            />
          ))}

          {streaming && (
            streamText
              ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: "4px" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--purple)", marginBottom: "4px", letterSpacing: "0.05em" }}>WEDNESDAY</div>
                  <div style={{ maxWidth: "72%", padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: "var(--card)", border: "1px solid var(--border)", fontSize: "0.9rem", lineHeight: 1.6 }}>
                    <div className="wed-msg-markdown"><ReactMarkdown>{streamText}</ReactMarkdown></div>
                  </div>
                </div>
              )
              : <TypingIndicator />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "16px 24px",
        background: "var(--surface)",
        flexShrink: 0,
      }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your concept, ask for hooks, or say 'write the full script'…"
            disabled={streaming}
            rows={2}
            style={{
              flex: 1,
              resize: "none",
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: "0.9rem",
              lineHeight: 1.5,
              fontFamily: "inherit",
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--purple)"}
            onBlur={(e) => e.target.style.borderColor = "var(--border)"}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            style={{
              padding: "12px 20px",
              borderRadius: 10,
              border: "none",
              background: input.trim() && !streaming ? "var(--purple)" : "var(--border)",
              color: input.trim() && !streaming ? "#fff" : "var(--text-muted)",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: input.trim() && !streaming ? "pointer" : "not-allowed",
              transition: "background 0.15s",
              flexShrink: 0,
            }}
          >
            Send
          </button>
        </div>
        <div style={{ maxWidth: 720, margin: "6px auto 0", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
