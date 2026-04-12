// WednesdayPanel — conversational AI assistant sidebar.
// Slides in from the right, side by side with the form.
// Wednesday reads the form state, chats naturally, and proposes field changes
// which the user can confirm or cancel via inline cards.

import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

const STORAGE_KEY = (boardId) => `wednesday_chat_${boardId}`;
const MAX_HISTORY = 20;

// Fields the AI is never allowed to change — enforced client-side regardless of what the model returns
const PROTECTED_FIELDS = new Set(["department", "product", "productBundle", "platform"]);

// ── Parse Wednesday's response ────────────────────────────────────────────────
// Extracts [PROPOSE]{...}[/PROPOSE] or [CONFIRM]{...}[/CONFIRM] blocks from text.
// Returns { visibleText, changes, changeType: "propose"|"confirm"|null }
function parseResponse(text) {
  const proposeMatch = text.match(/\[PROPOSE\]\s*([\s\S]*?)\s*\[\/PROPOSE\]/);
  const confirmMatch = text.match(/\[CONFIRM\]\s*([\s\S]*?)\s*\[\/CONFIRM\]/);

  const match = proposeMatch || confirmMatch;
  const changeType = proposeMatch ? "propose" : confirmMatch ? "confirm" : null;

  if (!match) {
    // Fallback: if the entire message is a JSON object, treat it as a silent PROPOSE.
    // This handles cases where the model forgets to wrap its output in tags.
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      try {
        const raw = JSON.parse(trimmed);
        const changes = Object.fromEntries(Object.entries(raw).filter(([k]) => !PROTECTED_FIELDS.has(k)));
        if (Object.keys(changes).length > 0) return { visibleText: "", changes, changeType: "propose" };
      } catch { /* not valid JSON, fall through */ }
    }
    return { visibleText: trimmed, changes: null, changeType: null };
  }

  let rawChanges = null;
  try { rawChanges = JSON.parse(match[1].trim()); } catch { /* invalid JSON, treat as no changes */ }

  // Strip any protected fields the model tried to include
  const changes = rawChanges
    ? Object.fromEntries(Object.entries(rawChanges).filter(([k]) => !PROTECTED_FIELDS.has(k)))
    : null;

  const visibleText = text
    .replace(/\[PROPOSE\][\s\S]*?\[\/PROPOSE\]/g, "")
    .replace(/\[CONFIRM\][\s\S]*?\[\/CONFIRM\]/g, "")
    .trim();

  return { visibleText, changes, changeType };
}


// ── Field label lookup ────────────────────────────────────────────────────────
function fieldLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ── Change confirmation card ──────────────────────────────────────────────────
function ChangeCard({ changes, changeType, status, onConfirm, onCancel }) {
  const rows = Object.entries(changes).map(([key, val]) => {
    if (changeType === "confirm" && val && typeof val === "object" && "from" in val) {
      return { label: fieldLabel(key), from: val.from || "[empty]", to: val.to || "[empty]" };
    }
    return { label: fieldLabel(key), from: "[empty]", to: Array.isArray(val) ? val.join(", ") : String(val ?? "") };
  });

  return (
    <div className={`wed-card wed-card--${status}`}>
      <table className="wed-card-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="wed-card-field">{r.label}</td>
              <td className="wed-card-from">{r.from}</td>
              <td className="wed-card-arrow">→</td>
              <td className="wed-card-to">{r.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === "pending" && (
        <div className="wed-card-actions">
          <button className="wed-card-confirm" onClick={onConfirm}>Apply</button>
          <button className="wed-card-cancel" onClick={onCancel}>Cancel</button>
        </div>
      )}
      {status === "applied" && <div className="wed-card-status">Applied ✓</div>}
      {status === "cancelled" && <div className="wed-card-status wed-card-status--cancelled">Cancelled</div>}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg, onConfirm, onCancel }) {
  const isWed = msg.role === "assistant";
  return (
    <div className={`wed-msg ${isWed ? "wed-msg--assistant" : "wed-msg--user"}`}>
      {isWed && <div className="wed-msg-name">Wednesday</div>}
      {msg.visibleText && (
        <div className="wed-msg-text wed-msg-markdown">
          <ReactMarkdown>{msg.visibleText}</ReactMarkdown>
        </div>
      )}
      {msg.changes && (
        <ChangeCard
          changes={msg.changes}
          changeType={msg.changeType}
          status={msg.cardStatus ?? "pending"}
          onConfirm={() => onConfirm(msg.id)}
          onCancel={() => onCancel(msg.id)}
        />
      )}
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="wed-msg wed-msg--assistant">
      <div className="wed-msg-name">Wednesday</div>
      <div className="wed-typing">
        <span /><span /><span />
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function WednesdayPanel({ isOpen, onClose, boardType, boardLabel, formState, onApplyChanges, chatResetKey, referenceContext, seedMessage, onSeedConsumed, taskReference, onClearTaskReference }) {
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState("");
  const [streaming, setStreaming]     = useState(false);
  const [streamText, setStreamText]   = useState("");
  const [lastChanges, setLastChanges] = useState(null); // for undo
  const [clarificationMode, setClarificationMode] = useState(false);
  const clarificationRef = useRef(false);
  const taskReferenceRef = useRef(taskReference);
  useEffect(() => { taskReferenceRef.current = taskReference; }, [taskReference]);

  const [panelTop, setPanelTop] = useState(124);

  const bottomRef    = useRef(null);
  const inputRef     = useRef(null);
  const prevBoardRef = useRef(boardType);
  const abortRef     = useRef(null);
  // Track whether a seed message is incoming so the greeting effect can skip immediately
  const seedPendingRef = useRef(!!seedMessage);
  useEffect(() => { seedPendingRef.current = !!seedMessage; }, [seedMessage]);

  // Adjust panel top based on scroll — shrink up to first navbar when board tabs scroll away
  useEffect(() => {
    const HEADER_H    = 60;
    const TABS_H      = 56;
    const GAP         = 8;
    function onScroll() {
      const scrolled = window.scrollY;
      const top = scrolled >= TABS_H
        ? HEADER_H + GAP
        : HEADER_H + TABS_H - scrolled + GAP;
      setPanelTop(top);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Load chat history from localStorage when board changes — strip any stale seed messages
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY(boardType));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Filter out any seed messages that may have been saved from a prior session
        setMessages(parsed.filter((m) => !m._isSeed));
      } catch { setMessages([]); }
    } else {
      setMessages([]);
    }
  }, [boardType]);

  // Clear chat when draft is cleared (task submitted or discarded)
  useEffect(() => {
    if (chatResetKey === 0) return; // skip initial mount
    setMessages([]);
    try { localStorage.removeItem(STORAGE_KEY(boardType)); } catch {}
  }, [chatResetKey]);

  // Inject a seed message from the AI panel (clarification request) as Wednesday's first message
  useEffect(() => {
    if (!seedMessage) return;
    const seedMsg = {
      id: Date.now(),
      role: "assistant",
      visibleText: seedMessage,
      changes: null,
      changeType: null,
      cardStatus: null,
      _isSeed: true, // never persisted to localStorage
    };
    setMessages((prev) => {
      if (prev.some((m) => m.visibleText === seedMessage)) return prev;
      return [...prev, seedMsg];
    });
    clarificationRef.current = true;
    setClarificationMode(true);
    onSeedConsumed?.();
  }, [seedMessage]);

  // Detect board switch mid-conversation
  useEffect(() => {
    if (prevBoardRef.current !== boardType && messages.length > 0) {
      prevBoardRef.current = boardType;
      sendMessage(`[BOARD_SWITCH] Switched to ${boardLabel}`);
    } else {
      prevBoardRef.current = boardType;
    }
  }, [boardType]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // Focus input when panel opens; greet if first open and no seed message is incoming
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    // Skip greeting if a clarification seed is about to be injected
    if (messages.length === 0 && !seedPendingRef.current) {
      sendMessage("[GREETING]");
    }
  }, [isOpen]);

  // Persist messages to localStorage — skip during clarification mode (transient)
  function saveMessages(msgs) {
    if (clarificationRef.current) return; // synchronous ref check avoids closure timing issues
    try {
      localStorage.setItem(STORAGE_KEY(boardType), JSON.stringify(msgs.filter((m) => !m._isSeed)));
    } catch {}
  }

  function addMessage(msg) {
    const full = { id: Date.now() + Math.random(), ...msg };
    setMessages((prev) => {
      const next = [...prev, full];
      saveMessages(next);
      return next;
    });
    return full;
  }

  async function sendMessage(userContent) {
    const isInternal = userContent.startsWith("[");
    if (!isInternal) {
      addMessage({ role: "user", visibleText: userContent });
      // Once the user replies, exit clarification mode
      clarificationRef.current = false;
      setClarificationMode(false);
    }

    // Build history for API (only role + content, strip UI fields)
    const history = [
      ...messages.map((m) => ({
        role: m.role,
        content: m.rawContent ?? m.visibleText ?? "",
      })),
      ...(isInternal
        ? [{ role: "user", content: userContent }]
        : [{ role: "user", content: userContent }]),
    ].slice(-MAX_HISTORY);

    setStreaming(true);
    setStreamText("");

    let fullText = "";
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/wednesday/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          boardType,
          formState,
          referenceContext: referenceContext || null,
          clarificationMode,
          taskReference: taskReferenceRef.current || null,
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
          } catch (e) {
            if (e.message !== "Unexpected end of JSON input") throw e;
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      fullText = "Sorry, something went wrong. Try again.";
    }

    setStreaming(false);
    setStreamText("");

    const { visibleText, changes, changeType } = parseResponse(fullText);
    addMessage({
      role: "assistant",
      rawContent: fullText,
      visibleText,
      changes,
      changeType,
      cardStatus: changes ? "pending" : null,
    });
  }

  function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    sendMessage(text);
  }

  function handleConfirm(msgId) {
    setMessages((prev) => {
      const msg = prev.find((m) => m.id === msgId);
      if (!msg?.changes) return prev;

      // Extract flat field values from changes
      const flat = {};
      Object.entries(msg.changes).forEach(([key, val]) => {
        if (msg.changeType === "confirm" && val && typeof val === "object" && "to" in val) {
          flat[key] = val.to;
        } else {
          flat[key] = val;
        }
      });

      // Store previous values for undo
      setLastChanges(
        Object.fromEntries(
          Object.keys(flat).map((k) => [k, formState?.[k] ?? ""])
        )
      );

      // Apply to form — also mark as Claude-assisted since the user just used AI
      onApplyChanges?.({ ...flat, howDidYouMake: formState?.howDidYouMake || "Claude" });

      const updated = prev.map((m) =>
        m.id === msgId ? { ...m, cardStatus: "applied" } : m
      );
      saveMessages(updated);
      return updated;
    });
  }

  function handleCancel(msgId) {
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === msgId ? { ...m, cardStatus: "cancelled" } : m
      );
      saveMessages(updated);
      return updated;
    });
  }

  return (
    <>
      {/* Floating trigger button */}
      {!isOpen && <button
        className="wed-fab"
        onClick={onClose}
        title="Chat with Wednesday"
      >
        <span className="wed-fab-icon">✦</span>
        <span className="wed-fab-label">Wednesday</span>
      </button>}

      {/* Slide-in panel */}
      <div
        className={`wed-panel${isOpen ? " wed-panel--open" : ""}`}
        style={{ top: `${panelTop}px`, height: `calc(100vh - ${panelTop + 8}px)` }}
      >
        <div className="wed-panel-header">
          <div className="wed-panel-title">
            <span className="wed-panel-icon">✦</span>
            Wednesday
          </div>
          <div className="wed-panel-subtitle">{boardLabel}</div>
          {referenceContext && (
            <div className="wed-reference-badge" title="Reference media is loaded — Wednesday is aware of it">
              📎 Reference loaded
            </div>
          )}
          <button className="wed-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="wed-messages">
          {messages.map((msg) => (
            <Message
              key={msg.id}
              msg={msg}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          ))}
          {streaming && streamText && (
            <div className="wed-msg wed-msg--assistant">
              <div className="wed-msg-name">Wednesday</div>
              <div className="wed-msg-text wed-msg-markdown wed-msg-text--streaming">
            <ReactMarkdown>{streamText}</ReactMarkdown>
          </div>
            </div>
          )}
          {streaming && !streamText && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <div className="wed-input-row">
          <textarea
            ref={inputRef}
            className="wed-input"
            value={input}
            rows={2}
            placeholder="Message Wednesday…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            className="wed-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || streaming}
          >
            ↑
          </button>
        </div>
      </div>
    </>
  );
}

