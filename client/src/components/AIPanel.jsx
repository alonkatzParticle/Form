// AIPanel — AI assistant with four modes:
//   autofill:  fills fields from a rough description
//   generate:  writes a full brief from a one-liner
//   format:    reformats pasted messy notes into structured fields
//   reference: analyzes a video/image reference with Gemini, then fills the form
import { useState, useRef } from "react";
import axios from "axios";

// Set to true to re-enable the From Reference tab when ready
const SHOW_REFERENCE_TAB = false;

const MODES = [
  { id: "autofill",   label: "Auto-fill",      hint: "Describe your task roughly — AI will fill in the form fields." },
  { id: "generate",   label: "Generate Brief",  hint: "Give a one-liner idea — AI will write a complete brief." },
  { id: "format",     label: "Paste & Format",  hint: "Paste an existing rough brief — AI will reformat it." },
  { id: "reference",  label: "From Reference",  hint: "Upload a video/image or paste a URL — AI will use it to fill the form.", hidden: !SHOW_REFERENCE_TAB },
].filter((m) => !m.hidden);

// ── File drop zone (for the reference tab) ────────────────────────────────────
function ReferenceDropZone({ file, onFile }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files) {
    const f = files[0];
    if (!f) return;
    onFile(f);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="file-input-wrapper">
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div
        className={`file-dropzone${dragging ? " file-dropzone--active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <svg className="file-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <polyline points="16 12 12 8 8 12" />
          <line x1="12" y1="8" x2="12" y2="20" />
        </svg>
        <span className="file-dropzone-text">
          {dragging ? "Drop file here" : (file ? file.name : "Drag & drop video or image")}
        </span>
        <span className="file-dropzone-sub">{file ? formatFileSize(file.size) : "or click to browse (max 15 MB)"}</span>
      </div>

      {file && (
        <button
          type="button"
          className="ref-clear-file"
          onClick={(e) => { e.stopPropagation(); onFile(null); }}
        >
          ✕ Remove file
        </button>
      )}
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AIPanel({ boardType, onResult, taskContext = {}, onReferenceContext, onNeedsClarification }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("autofill");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(""); // for reference tab stages
  const [error, setError] = useState(null);

  // Reference tab state
  const [refFile, setRefFile] = useState(null);
  const [refUrl, setRefUrl] = useState("");
  const [refInputMode, setRefInputMode] = useState("file"); // "file" | "url"
  const [refInstructions, setRefInstructions] = useState("");
  const [refAnalysis, setRefAnalysis] = useState(null); // Gemini analysis text

  const activeMode = MODES.find((m) => m.id === mode);

  // ── Standard modes submit ──────────────────────────────────────────────────
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
      onResult(res.data);
      setInput("");
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || "AI request failed";
      // 422 = AI asked for clarification — open Wednesday with the question instead of showing an error
      if (status === 422 && onNeedsClarification) {
        onNeedsClarification(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Reference tab submit ───────────────────────────────────────────────────
  async function handleReferenceSubmit() {
    if (!refInstructions.trim()) {
      setError("Please enter instructions for how to use this reference.");
      return;
    }
    if (refInputMode === "file" && !refFile) {
      setError("Please upload a video or image file.");
      return;
    }
    if (refInputMode === "url" && !refUrl.trim()) {
      setError("Please enter a video or image URL.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let payload = {
        instructions: refInstructions,
        boardType,
        taskContext,
      };

      if (refInputMode === "file" && refFile) {
        setLoadingStage(refFile.type?.startsWith("video/") ? "Uploading video…" : "Preparing image…");
        const base64 = await fileToBase64(refFile);
        payload.fileData = base64;
        payload.mimeType = refFile.type;
      } else {
        payload.fileUrl = refUrl.trim();
      }

      setLoadingStage("Analyzing with Gemini…");

      const res = await axios.post("/api/ai/analyze-reference", payload, {
        timeout: 120_000, // 2 minutes client-side timeout
      });

      setLoadingStage("Filling form…");

      const { _referenceAnalysis, ...formFields } = res.data;
      if (_referenceAnalysis) {
        setRefAnalysis(_referenceAnalysis);
        onReferenceContext?.(_referenceAnalysis);
      }

      onResult(formFields);
    } catch (err) {
      const msg =
        err.code === "ECONNABORTED"
          ? "Request timed out — try a shorter video clip or a still image."
          : err.response?.data?.error || "Reference analysis failed";
      setError(msg);
    } finally {
      setLoading(false);
      setLoadingStage("");
    }
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setError(null);
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
                onClick={() => handleModeChange(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="hint">{activeMode.hint}</p>

          {/* ── Standard modes ── */}
          {mode !== "reference" && (
            <>
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
            </>
          )}

          {/* ── From Reference tab ── */}
          {mode === "reference" && (
            <div className="ref-panel">
              {/* Toggle: file vs url */}
              <div className="ref-source-toggle">
                <button
                  type="button"
                  className={`ref-source-btn${refInputMode === "file" ? " active" : ""}`}
                  onClick={() => { setRefInputMode("file"); setRefUrl(""); setError(null); }}
                >
                  📁 Upload File
                </button>
                <button
                  type="button"
                  className={`ref-source-btn${refInputMode === "url" ? " active" : ""}`}
                  onClick={() => { setRefInputMode("url"); setRefFile(null); setError(null); }}
                >
                  🔗 Paste URL
                </button>
              </div>

              {refInputMode === "file" ? (
                <ReferenceDropZone file={refFile} onFile={setRefFile} />
              ) : (
                <input
                  type="url"
                  className="ref-url-input"
                  placeholder="YouTube, Vimeo, direct .mp4 or image URL…"
                  value={refUrl}
                  onChange={(e) => setRefUrl(e.target.value)}
                />
              )}

              <label className="ref-instructions-label">
                Instructions <span className="required"> *</span>
              </label>
              <textarea
                className="ref-instructions"
                value={refInstructions}
                onChange={(e) => setRefInstructions(e.target.value)}
                placeholder={`How should AI use this reference?\ne.g. "Match the hook structure", "Use a similar visual style", "Recreate this for our Face Cream"`}
                rows={4}
              />

              {refAnalysis && (
                <div className="ref-analysis-badge">
                  ✅ Reference analyzed — form filled! Wednesday is also aware of it.
                </div>
              )}

              <button
                className="btn-ai"
                onClick={handleReferenceSubmit}
                disabled={loading}
              >
                {loading && <span className="btn-spinner" />}
                {loading ? (loadingStage || "Analyzing…") : "Analyze & Fill Form"}
              </button>
            </div>
          )}

          {error && <div className="msg-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

// Converts a File object to a base64 string (data part only, no prefix)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      // Strip "data:mime/type;base64," prefix
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
