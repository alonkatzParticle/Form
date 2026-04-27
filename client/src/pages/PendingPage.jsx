import { useState, useEffect } from "react";
import axios from "axios";
import { uploadFileToMonday } from "../utils/mondayUpload.js";
import { Field, renderInput, isVisible, buildAutoName, buildColumnValues } from "../components/forms/DynamicForm.jsx";
import TaskFormSections from "../components/forms/TaskFormSections.jsx";
import InlineDurationEstimator from "../components/InlineDurationEstimator.jsx";
import SubmissionProgress from "../components/SubmissionProgress.jsx";

import WednesdayPanel from "../components/WednesdayPanel.jsx";
import { useMonday } from "../hooks/useMonday.js";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle, ExternalLink, Plus, RefreshCw, Trash2, MessageSquare, ChevronRight } from "lucide-react";

function formatTimeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

function getSidebarLabel(t, board) {
  const task = t.task;
  if (!task) return { title: "Generating…", sub: "" };
  const concept = task.conceptIdea || task.videoConceptLabel || task.manualName || "";
  const autoName = buildAutoName(board, task) || "";
  if (concept && concept !== autoName) {
    return { title: concept, sub: [task.product, task.type].filter(Boolean).join(" · ") };
  }
  const segments = autoName.split(" | ");
  if (segments.length > 1) {
    const unique = segments[segments.length - 1];
    const prefix = segments.slice(0, -1).join(" · ");
    return { title: unique, sub: prefix };
  }
  return { title: autoName || "Task", sub: [task.product, task.type].filter(Boolean).join(" · ") };
}


function StatusDot({ status }) {
  const icons = { idle: "○", done: "●", generating: "⟳", error: "!" };
  const cls   = { idle: "batch-dot--idle", done: "batch-dot--selected", generating: "batch-dot--generating", error: "batch-dot--error" };
  return <span className={`batch-dot ${cls[status] ?? "batch-dot--idle"}`}>{icons[status] ?? "○"}</span>;
}

function SuccessCard({ itemUrl, onCreateAnother }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      flex: 1, padding: "48px 32px", textAlign: "center", gap: "20px"
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 8px 32px rgba(34,197,94,0.3)"
      }}>
        <CheckCircle size={32} color="white" strokeWidth={2.5} />
      </div>
      <div>
        <h2 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontWeight: 700, color: "var(--text)" }}>Task Submitted!</h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>Your task has been created on Monday.com</p>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        {itemUrl && (
          <a href={itemUrl} target="_blank" rel="noreferrer" style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "12px 20px", borderRadius: "var(--radius-sm)",
            background: "var(--purple)", color: "#fff",
            textDecoration: "none", fontWeight: 600, fontSize: "0.95rem", transition: "opacity 0.15s"
          }}
            onMouseOver={e => e.currentTarget.style.opacity = "0.85"}
            onMouseOut={e => e.currentTarget.style.opacity = "1"}
          >
            <ExternalLink size={16} /> Open in Monday.com
          </a>
        )}
        <button onClick={onCreateAnother} style={{
          display: "inline-flex", alignItems: "center", gap: "8px",
          padding: "12px 20px", borderRadius: "var(--radius-sm)",
          background: "var(--surface)", border: "1.5px solid var(--border)",
          color: "var(--text)", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer",
          transition: "border-color 0.15s"
        }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--purple)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <Plus size={16} /> Create Another Task
        </button>
      </div>
    </div>
  );
}

export default function PendingPage({ tasks, setTasks, boards, frequencyOrder, onTaskSubmitted, taskFiles, onFilesUploaded, onFileChange }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(null);
  const [editingBrief, setEditingBrief] = usePersistedState("pending_editingBrief", "");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [wednesdayOpen, setWednesdayOpen] = useState(false);
  const [successState, setSuccessState] = useState(null);
  const [submitProgress, setSubmitProgress] = useState(null);
  // null | { step: 'creating'|'brief'|'files', fileIndex, fileTotal, fileName }

  // Stale brief tracking
  const [briefTaskSnapshot, setBriefTaskSnapshot] = useState(null);
  const [briefIsStale, setBriefIsStale]           = useState(false);
  const [showStaleBriefWarning, setShowStaleBriefWarning] = useState(false);

  // PendingPage is always mounted (display:none/block), so successState persists
  // across navigations. Clear it whenever the user navigates back to /pending.
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname === "/pending") {
      setSuccessState(null);
      setSubmitProgress(null);
      setBriefTaskSnapshot(null);
      setBriefIsStale(false);
      setShowStaleBriefWarning(false);
    }
  }, [pathname]);
  
  // Board isolation for Queue. Auto-selects the first board that has tasks.
  // Falls back to first available board if no tasks are queued yet.
  const [activeBoardId, setActiveBoardId] = usePersistedState("pending_board_filter", "");
  useEffect(() => {
    if (!boards?.length) return;
    const boardsWithTasks = boards.filter(b => tasks.some(t => t.boardType === b.id));
    const target = boardsWithTasks.length > 0 ? boardsWithTasks[0] : boards[0];
    // Only switch if the current selection has no tasks (or is unset)
    if (!activeBoardId || !tasks.some(t => t.boardType === activeBoardId)) {
      setActiveBoardId(target.id);
    }
  }, [boards, tasks, activeBoardId, setActiveBoardId]);

  const visibleTasks = tasks
    .filter(t => t.boardType === activeBoardId)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // newest first

  const selected = tasks.find((t) => t.id === selectedId);
  
  // Track if we are actively generating so we can auto-sweep dead skeletons
  // For now, let's assume if it's in the outbox, it shouldn't be "generating" unless it just arrived.
  // We'll trust the provider to set it to idle/error, but let's sweep if they load the page fresh.
  useEffect(() => {
    if (tasks.some(t => t.status === "generating")) {
      // In a robust system, we would check if a stream is alive.
      // Here, we just assume any 'generating' on mount is a dead skeleton.
      setTasks(prev => prev.map(t => t.status === "generating" ? { ...t, status: "error", brief: "<p><em>Generation interrupted.</em></p>" } : t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const activeBoard = boards?.find((b) => b.id === selected?.boardType) ?? boards?.[0];
  const { users } = useMonday(activeBoard?.boardId);

  function selectTask(id) {
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const next = tasks.find((t) => t.id === id);
    setSelectedId(id);
    setEditingBrief(next?.editedBrief ?? next?.brief ?? "");
    setWednesdayOpen(false);
    // Snapshot the task for staleness detection
    if (next?.task) {
      setBriefTaskSnapshot(JSON.stringify(next.task));
      setBriefIsStale(false);
      setShowStaleBriefWarning(false);
    }
  }

  async function handleRegenerateBrief() {
    if (!selectedId || !selected || !activeBoard) return;
    setIsRegenerating(true);
    try {
      const { generateBriefHtml } = await import("../components/forms/DynamicForm.jsx");
      const { html, finalEstimate } = await generateBriefHtml(activeBoard, selected.task, users);
      const entryFiles = taskFiles?.[selected.id] ?? {};
      const hasFiles = Object.values(entryFiles).some(f => f?.length > 0);
      const newBriefHtml = hasFiles
        ? html + '\n\n\ud83d\udcce <strong>Reference files are attached</strong> \u2014 check the <strong>Files</strong> tab on this task.'
        : html;
      setEditingBrief(newBriefHtml);
      const taskPatch = finalEstimate ? { _elevenLabsEstimate: finalEstimate } : {};
      setTasks(prev => prev.map(t => t.id === selectedId
        ? { ...t, brief: newBriefHtml, editedBrief: newBriefHtml, task: { ...t.task, ...taskPatch } }
        : t
      ));
      // Snapshot fresh task — clears staleness
      setBriefTaskSnapshot(JSON.stringify({ ...selected.task, ...taskPatch }));
      setBriefIsStale(false);
      setShowStaleBriefWarning(false);
    } catch (err) {
      console.error("[Pending] Regenerate error:", err);
    } finally {
      setIsRegenerating(false);
    }
  }

  function handleDelete(id) {
    if (id === selectedId) {
      setSelectedId(null);
      setEditingBrief("");
    }
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  async function handleSubmitOne(id, force = false) {
    const entry = tasks.find((t) => t.id === id);
    if (!entry || entry.status === "submitting" || !entry.task) return;

    // Stale brief gate
    if (id === selectedId && briefIsStale && !force) {
      setShowStaleBriefWarning(true);
      return;
    }
    
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitting" } : t));
    setSubmitProgress({ step: "creating", fileIndex: 0, fileTotal: 0, fileName: "" });
    const briefToSubmit = id === selectedId ? editingBrief : (entry.editedBrief ?? entry.brief);
    
    try {
      const entryBoard = boards?.find((b) => b.id === entry.boardType);
      if (!entryBoard) throw new Error("Board configuration not found for task type: " + entry.boardType);

      // Generate the expected Monday API payload format from the working task dict
      // Find whichever field is the item name (mondayValueType: "item_name") — differs per board.
      const nameField = entryBoard.fields.find((f) => f.mondayValueType === "item_name");
      const itemName = (entryBoard.autoName ? buildAutoName(entryBoard, entry.task) : null)
        || (nameField && entry.task[nameField.key])
        || buildAutoName(entryBoard, entry.task)
        || "Unnamed Task";
      const columnValues = buildColumnValues(entryBoard.fields, entry.task);

      const createRes = await axios.post("/api/monday/create-item", {
        boardId: entryBoard.boardId,
        itemName,
        columnValues
      });
      const itemId = createRes.data?.itemId;
      if (!itemId) throw new Error("Monday returned no item ID — task kept in queue");
      const itemUrl = createRes.data?.url ?? null;

      // ── Step: posting brief
      setSubmitProgress({ step: "brief", fileIndex: 0, fileTotal: 0, fileName: "" });
      // Non-fatal: item is already created — don't block task removal on these
      if (itemId && briefToSubmit) {
        try {
          await axios.post("/api/monday/create-update", { itemId, body: briefToSubmit });
        } catch (e) {
          console.warn("[Pending] Brief upload failed (item was created):", e.message);
        }
      }

      // ── Step: uploading files
      let submittedFileCount = 0;
      let filesActuallyFailed = false;
      if (itemId && taskFiles) {
        const entryFiles = taskFiles[entry.id] ?? {};
        const fileFields = entryBoard.fields.filter((f) => f.type === "file" && f.mondayColumnId);
        const allFiles = [];
        for (const field of fileFields) {
          for (const file of Array.from(entryFiles[field.key] ?? [])) {
            allFiles.push({ file, field });
          }
        }
        if (allFiles.length > 0) {
          submittedFileCount = allFiles.length;
          setSubmitProgress({ step: "files", fileIndex: 0, fileTotal: allFiles.length, fileName: "" });
          const failedFiles = [];
          for (let i = 0; i < allFiles.length; i++) {
            const { file, field } = allFiles[i];
            setSubmitProgress({ step: "files", fileIndex: i + 1, fileTotal: allFiles.length, fileName: file.name });
            try {
              await uploadFileToMonday(itemId, field.mondayColumnId, file);
            } catch (e) {
              console.error("[Pending] File upload failed:", e.message);
              failedFiles.push(file.name);
            }
          }
          if (failedFiles.length > 0) {
            filesActuallyFailed = true;
            alert(`⚠️ Task created in Monday, but ${failedFiles.length} file(s) failed to upload: ${failedFiles.join(", ")}. Please attach them manually in Monday.`);
          }
        }
        onFilesUploaded?.(entry.id);
      }

      // Show all-done state briefly (X on files step if any failed)
      setSubmitProgress({ step: "done", fileIndex: 0, fileTotal: submittedFileCount, fileName: "", filesFailed: filesActuallyFailed });
      await new Promise((r) => setTimeout(r, filesActuallyFailed ? 2000 : 1000));
      setSubmitProgress(null);

      // Archive to submitted history
      if (onTaskSubmitted) {
        onTaskSubmitted({ ...entry, brief: briefToSubmit, mondayUrl: itemUrl });
      }

      // Remove from outbox and show confirmation
      if (id === selectedId) {
        setSelectedId(null);
        setEditingBrief("");
      }
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setSuccessState({ url: itemUrl });
    } catch (err) {
      // Only reaches here if create-item itself failed (no item created yet)
      const msg = err.response?.data?.error || err.message || "Submission failed";
      console.error("[Pending] Submit error:", msg);
      setSubmitProgress(null);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "error", errorMsg: msg } : t));
    }
  }

  async function handleSubmitAll() {
    if (selectedId) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const pending = visibleTasks.filter((t) => t.status !== "submitting");
    for (const t of pending) {
      await handleSubmitOne(t.id);
    }
  }

  // Deselect task if you switch boards and the selected task isn't in it
  useEffect(() => {
    if (selected && selected.boardType !== activeBoardId) {
      selectTask(null);
    }
  }, [activeBoardId, selected]);

  return (
    <div className="batch-page">
      <header className="batch-header" style={{ justifyContent: "space-between" }}>
        <div className="batch-header-center">
          <span className="batch-header-title">Pending Queue</span>
        </div>
        
        {boards && boards.length > 0 && (
          <div className="board-tabs-pill" style={{ margin: "0" }}>
            {boards.map((b) => (
              <button
                key={b.id}
                className={`board-tab ${activeBoardId === b.id ? "active" : ""}`}
                onClick={() => setActiveBoardId(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

      </header>

      {successState ? (
        <SuccessCard
          itemUrl={successState.url}
          onCreateAnother={() => { setSuccessState(null); navigate("/"); }}
        />
      ) : (!tasks || tasks.length === 0) ? (
        <div className="batch-input-phase" style={{ textAlign: "center", padding: "40px" }}>
          <span style={{ fontSize: "2rem", opacity: 0.5, display: "block", marginBottom: 16 }}>📭</span>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem" }}>Your queue is empty.<br/>Tasks generated from the Single Task or Batch Create forms will appear here.</p>
        </div>
      ) : (
        <div className="batch-review">
          <aside className="batch-sidebar">
            <div className="batch-sidebar-label">Queued Tasks ({visibleTasks.length})</div>
            {visibleTasks.length === 0 ? (
              <div style={{ padding: "0 16px", color: "var(--text-muted)", fontSize: "0.85rem" }}>No pending tasks for this board.</div>
            ) : (
              <ul className="batch-task-list">
                {visibleTasks.map((t, i) => {
                  const board = boards?.find(b => b.id === t.boardType);
                  const { title, sub } = getSidebarLabel(t, board);
                  return (
                  <li
                    key={t.id}
                    className={`batch-task-item ${selectedId === t.id ? "batch-task-item--active" : ""} batch-task-item--${t.status}`}
                    onClick={() => selectTask(t.id)}
                  >
                    {t.status === "generating" || t.status === "submitting"
                      ? <span className="batch-dot"><span className="batch-ref-spinner" /></span>
                      : <StatusDot status={selectedId === t.id && t.status === "idle" ? "done" : t.status} />}
                    <div className="batch-task-meta" style={{ flex: 1, minWidth: 0 }}>
                      {t.status === "generating"
                        ? <span className="batch-task-name batch-skeleton-text">Generating…</span>
                        : <>
                            <span className="batch-task-name" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                            <span className="batch-task-sub" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
                            {t.createdAt && (
                              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", opacity: 0.7 }}>{formatTimeAgo(t.createdAt)}</span>
                            )}
                          </>}
                    </div>
                    {t.status === "error" && <span className="batch-status-badge batch-status-badge--err">!</span>}
                    <button 
                      className="batch-task-discard" 
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      title="Discard task"
                    >
                      ×
                    </button>
                  </li>
                )})}
              </ul>
            )}
          </aside>

          <main className="batch-main">
          {selected ? (
            <>
              <div className="batch-main-header">
                <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
                  <input
                    className="batch-main-title-input"
                    value={selected.task?.manualName ?? buildAutoName(activeBoard, selected.task)}
                    onChange={(e) => {
                      setTasks(prev => prev.map(t => t.id === selected.id ? { ...t, task: { ...t.task, manualName: e.target.value } } : t));
                    }}
                    placeholder="Task Name"
                    style={{
                      width: "100%", fontSize: "1.05rem", fontWeight: 600, color: "var(--text)",
                      border: "1px solid var(--border)", background: "var(--bg)", padding: "10px 14px",
                      margin: "0 0 6px", outline: "none", borderRadius: "var(--radius-sm)", fontFamily: "inherit",
                      transition: "border-color 0.15s"
                    }}
                    onFocus={(e) => e.target.style.borderColor = "var(--purple)"}
                    onBlur={(e) => e.target.style.borderColor = "var(--border)"}
                  />
                  <p className="batch-main-sub" style={{ paddingLeft: "4px" }}>
                    {[selected.task?.product, selected.task?.platform, selected.task?.type].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    className="batch-back-btn"
                    onClick={() => setWednesdayOpen(true)}
                    style={{ color: "var(--purple)", fontWeight: 600 }}
                    title="Chat with Wednesday to tweak this task"
                  >
                    💬 Ask Wednesday
                  </button>
                  <button
                    className="batch-back-btn"
                    onClick={() => handleDelete(selected.id)}
                    style={{ color: "var(--red)" }}
                  >
                    Discard
                  </button>
                  <button
                    className="batch-submit-one-btn"
                    onClick={() => handleSubmitOne(selected.id)}
                    disabled={selected.status === "submitting"}
                  >
                    {selected.status === "submitting" ? "Submitting…" :
                     selected.status === "error"      ? "⟳ Retry" : "Submit →"}
                  </button>
                </div>
              </div>

              {/* Stale brief warning */}
              {showStaleBriefWarning && (
                <div style={{
                  margin: "0 0 12px",
                  padding: "10px 16px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(234,179,8,0.08)",
                  border: "1px solid rgba(234,179,8,0.35)",
                  fontSize: "0.82rem",
                  color: "#ca8a04",
                  lineHeight: 1.5,
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  flexWrap: "wrap",
                }}>
                  <span style={{ flex: 1 }}>⚠️ You edited the form but haven't regenerated the brief — it may be out of date.</span>
                  <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                    <button
                      onClick={() => { setShowStaleBriefWarning(false); handleRegenerateBrief(); }}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ca8a04", background: "transparent", color: "#ca8a04", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem" }}
                    >
                      Regenerate first
                    </button>
                    <button
                      onClick={() => { setShowStaleBriefWarning(false); setBriefIsStale(false); handleSubmitOne(selected.id, true); }}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "#ca8a04", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem" }}
                    >
                      Submit anyway
                    </button>
                  </div>
                </div>
              )}

              {selected.status === "error" && selected.errorMsg && (
                <div style={{
                  margin: "0 0 12px",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,80,80,0.08)",
                  border: "1px solid rgba(255,80,80,0.25)",
                  fontSize: "0.82rem",
                  color: "#ff8080",
                  lineHeight: 1.5,
                }}>
                  <strong>Submission failed:</strong> {selected.errorMsg}
                </div>
              )}

              <div className="batch-split-view" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
                <div className="batch-split-left" style={{ flex: 1, overflowY: "auto", borderRight: "1px solid var(--border)" }}>
                  {selected.task && selected.status === "submitting" && submitProgress && (
                    <SubmissionProgress
                      step={submitProgress.step}
                      fileIndex={submitProgress.fileIndex}
                      fileTotal={submitProgress.fileTotal}
                      fileName={submitProgress.fileName}
                      filesFailed={submitProgress.filesFailed ?? false}
                    />
                  )}
                  {selected.task && selected.status !== "submitting" && (
                    <div key={selected.id} className="batch-form-wrapper" style={{ padding: "24px", maxWidth: "800px", margin: "0 auto" }}>
                      <TaskFormSections
                        boardFields={activeBoard?.fields ?? []}
                        task={{ ...selected.task, ...(taskFiles?.[selected.id] ?? {}) }}
                        users={users}
                        frequencyOrder={frequencyOrder}
                        skipMondayTypes={[]}
                        onChange={(key, val) => {
                          const field = activeBoard?.fields?.find(f => f.key === key);
                          if (field?.type === "file") {
                            onFileChange?.(selected.id, key, val);
                          } else {
                            setTasks((prev) => prev.map((t) => {
                              if (t.id !== selected.id) return t;
                              const updatedTask = { ...t.task, [key]: val };
                              if (briefTaskSnapshot && JSON.stringify(updatedTask) !== briefTaskSnapshot) {
                                setBriefIsStale(true);
                              }
                              return { ...t, task: updatedTask };
                            }));
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="batch-split-right" style={{ width: "45%", display: "flex", flexDirection: "column", background: "var(--surface)", overflow: "hidden" }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg)" }}>
                    <h4 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Brief Preview</h4>
                    <button 
                      className="batch-generate-btn" 
                      onClick={handleRegenerateBrief} 
                      disabled={isRegenerating || selected.status === "submitting"}
                      style={{ flexShrink: 0, padding: "8px 16px", fontSize: "0.85rem", opacity: isRegenerating ? 0.7 : 1 }}
                    >
                      {isRegenerating ? "Generating..." : "✨ Regenerate Preview"}
                    </button>
                  </div>
                  
                  <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
                    {selected.brief ? (
                      <div
                        className="batch-brief-content"
                        contentEditable={selected.status !== "submitting" && !isRegenerating}
                        suppressContentEditableWarning
                        onInput={(e) => setEditingBrief(e.currentTarget.innerHTML)}
                        dangerouslySetInnerHTML={{ __html: editingBrief }}
                        style={{ opacity: isRegenerating ? 0.5 : 1, transition: "opacity 0.2s", border: "none", padding: 0, minHeight: "100%", background: "transparent" }}
                      />
                    ) : (
                      <div className="batch-empty-state batch-generating-state">
                        <span className="batch-gen-spinner" />
                        <p>Generating your brief — hold tight…</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="batch-empty-state">Select a task from the list to preview and submit it.</div>
          )}
        </main>
      </div>
      )}

      {selected && activeBoard && (
        <WednesdayPanel
          isOpen={wednesdayOpen}
          onClose={() => setWednesdayOpen(false)}
          boardType={selected.boardType}
          boardLabel={activeBoard.label}
          formState={selected.task}
          onApplyChanges={(changes) => {
            setTasks((prev) => prev.map((t) => t.id === selected.id ? { ...t, task: { ...t.task, ...changes } } : t));
          }}
          chatResetKey={selected.id}
          referenceContext={null}
          seedMessage={null}
          onSeedConsumed={() => {}}
          taskReference={null}
          onClearTaskReference={() => {}}
        />
      )}

    </div>
  );
}
