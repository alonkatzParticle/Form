import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { uploadFileToMonday } from "../utils/mondayUpload.js";
import { Field, renderInput, isVisible, buildAutoName, buildColumnValues } from "../components/forms/DynamicForm.jsx";
import FilePreview from "../components/FilePreview.jsx";
import TaskFormSections from "../components/forms/TaskFormSections.jsx";
import InlineDurationEstimator from "../components/InlineDurationEstimator.jsx";
import SubmissionProgress from "../components/SubmissionProgress.jsx";

import WednesdayPanel from "../components/WednesdayPanel.jsx";
import { useMonday } from "../hooks/useMonday.js";
import { useNavigate } from "react-router-dom";
import { usePathname } from "../hooks/usePathname.js";
import { CheckCircle, ExternalLink, Plus, RefreshCw, Trash2, MessageSquare, ChevronRight } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Best display name: put the unique concept/angle FIRST, then generic labels as subtitle
function getSidebarLabel(t, board) {
  const task = t.task;
  if (!task) return { title: "Generating…", sub: "" };

  // Try the concept / script title as primary differentiator
  const concept = task.conceptIdea || task.videoConceptLabel || task.manualName || "";
  const autoName = buildAutoName(board, task) || "";

  // If we have a concept, use it as the title and pull product+type as sub
  if (concept && concept !== autoName) {
    const sub = [task.product, task.type].filter(Boolean).join(" · ");
    return { title: concept, sub };
  }

  // Auto name: last segment (concept) is most unique — put it first
  const segments = autoName.split(" | ");
  if (segments.length > 1) {
    const unique = segments[segments.length - 1]; // e.g. "Mirror Effect Hook"
    const prefix = segments.slice(0, -1).join(" · ");
    return { title: unique, sub: prefix };
  }

  return { title: autoName || `Task`, sub: [task.product, task.type].filter(Boolean).join(" · ") };
}

// ─── Task Form ────────────────────────────────────────────────────────────────


function StatusDot({ status }) {
  const icons = { idle: "○", done: "●", generating: "⟳", error: "!" };
  const cls   = { idle: "batch-dot--idle", done: "batch-dot--selected", generating: "batch-dot--generating", error: "batch-dot--error" };
  return <span className={`batch-dot ${cls[status] ?? "batch-dot--idle"}`}>{icons[status] ?? "○"}</span>;
}

// ─── Success State ────────────────────────────────────────────────────────────

function SuccessCard({ itemUrl, isBatch, onCreateAnother, onGoHome }) {
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
        <h2 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontWeight: 700, color: "var(--text)" }}>
          {isBatch ? "All Tasks Submitted!" : "Task Submitted!"}
        </h2>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem" }}>
          {isBatch ? "Your tasks have been created on Monday.com" : "Your task has been created on Monday.com"}
        </p>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        {itemUrl && (
          <a
            href={itemUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              padding: "12px 20px", borderRadius: "var(--radius-sm)",
              background: "var(--purple)", color: "#fff",
              textDecoration: "none", fontWeight: 600, fontSize: "0.95rem",
              transition: "opacity 0.15s"
            }}
            onMouseOver={e => e.currentTarget.style.opacity = "0.85"}
            onMouseOut={e => e.currentTarget.style.opacity = "1"}
          >
            <ExternalLink size={16} />
            Open in Monday.com
          </a>
        )}
        <button
          onClick={onCreateAnother}
          style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            padding: "12px 20px", borderRadius: "var(--radius-sm)",
            background: "var(--surface)", border: "1.5px solid var(--border)",
            color: "var(--text)", fontWeight: 600, fontSize: "0.95rem", cursor: "pointer",
            transition: "border-color 0.15s"
          }}
          onMouseOver={e => e.currentTarget.style.borderColor = "var(--purple)"}
          onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <Plus size={16} />
          Create Another Task
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReviewPage({ tasks, setTasks, boards, frequencyOrder, onTaskSubmitted, taskFiles, onFilesUploaded, onFileChange }) {
  const navigate = useNavigate();
  const pathname = usePathname();
  
  const queryIds = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ids")?.split(",").filter(Boolean) || [];
  }, [pathname]);

  const reviewTasks = useMemo(() => {
    // Show newest first within the isolated review
    return tasks
      .filter(t => queryIds.includes(t.id))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [tasks, queryIds]);

  const isBatchMode = queryIds.length > 1;

  const [selectedId, setSelectedId] = useState(null);
  const [editingBrief, setEditingBrief] = useState(null); // null = not yet loaded
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [wednesdayOpen, setWednesdayOpen] = useState(false);
  const [fileUploadWarning, setFileUploadWarning] = useState(null);
  const [submitProgress, setSubmitProgress] = useState(null);
  // null | { step: 'creating'|'brief'|'files', fileIndex, fileTotal, fileName }
  // Success state: null = not submitted yet, { url, isBatch } = done
  const [successState, setSuccessState] = useState(null);

  // Auto-select first task when review initializes or changes
  useEffect(() => {
    if (reviewTasks.length === 0 && queryIds.length > 0) {
      // All tasks gone — handled by success state, don't auto-nav
      return;
    }
    if (!selectedId && reviewTasks.length > 0) {
      const first = reviewTasks.find(t => t.status !== "generating") ?? reviewTasks[0];
      setSelectedId(first.id);
      setEditingBrief(first.editedBrief ?? first.brief ?? null);
    }
  }, [queryIds, reviewTasks]);

  // Sync editingBrief when selected task changes or brief arrives (e.g. from SSE)
  const selected = reviewTasks.find((t) => t.id === selectedId) ?? tasks.find(t => t.id === selectedId);

  useEffect(() => {
    if (!selected) return;
    const freshBrief = selected.editedBrief ?? selected.brief ?? null;
    setEditingBrief(freshBrief);
  }, [selectedId, selected?.brief]);  // re-run when selected ID changes or brief populates

  const activeBoard = boards?.find((b) => b.id === selected?.boardType) ?? boards?.[0];
  const { users } = useMonday(activeBoard?.boardId);

  function selectTask(id) {
    // Save current editing state before switching
    if (selectedId && editingBrief !== null) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const next = tasks.find((t) => t.id === id);
    setSelectedId(id);
    setEditingBrief(next?.editedBrief ?? next?.brief ?? null);
    setWednesdayOpen(false);
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
      setTasks(prev => prev.map(t => t.id === selectedId ? { ...t, brief: newBriefHtml, editedBrief: newBriefHtml, task: { ...t.task, ...taskPatch } } : t));
    } catch (err) {
      console.error("[Review] Regenerate error:", err);
    } finally {
      setIsRegenerating(false);
    }
  }

  function handleDelete(id) {
    const nextReview = reviewTasks.filter(t => t.id !== id);
    if (id === selectedId) {
      if (nextReview.length > 0) {
        selectTask(nextReview[0].id);
      } else {
        setSelectedId(null);
        setEditingBrief(null);
      }
    }
    setTasks(prev => prev.filter(t => t.id !== id));
    const nextIds = queryIds.filter(q => q !== id);
    if (nextIds.length > 0) {
      window.history.replaceState(null, "", `/review?ids=${nextIds.join(",")}`);
    }
  }

  async function handleSubmitOne(id) {
    const entry = tasks.find((t) => t.id === id);
    if (!entry || entry.status === "submitting" || !entry.task) return;
    
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "submitting" } : t));
    setSubmitProgress({ step: "creating", fileIndex: 0, fileTotal: 0, fileName: "" });
    
    // Robustly resolve the brief — never submit empty
    const briefToSubmit = id === selectedId
      ? (editingBrief || entry.editedBrief || entry.brief || "")
      : (entry.editedBrief || entry.brief || "");
    
    try {
      const entryBoard = boards?.find((b) => b.id === entry.boardType);
      if (!entryBoard) throw new Error("Board config missing for type: " + entry.boardType);

      // Find whichever field is the item name (mondayValueType: "item_name") — differs per board.
      // Video board uses "manualName", Design board uses "taskName".
      const nameField = entryBoard.fields.find((f) => f.mondayValueType === "item_name");
      const itemName = (nameField && entry.task[nameField.key]) || buildAutoName(entryBoard, entry.task) || "Unnamed Task";
      const columnValues = buildColumnValues(entryBoard.fields, entry.task);

      const createRes = await axios.post("/api/monday/create-item", {
        boardId: entryBoard.boardId,
        itemName,
        columnValues
      });
      const itemId = createRes.data?.itemId;
      if (!itemId) throw new Error("Monday returned no item ID — task kept in queue");
      const itemUrl = createRes.data?.url ?? null;
      const submitWarning = createRes.data?.warning ?? null;

      // ── Step: posting brief ─────────────────────────────────────────────────
      setSubmitProgress({ step: "brief", fileIndex: 0, fileTotal: 0, fileName: "" });
      if (itemId && briefToSubmit) {
        try {
          const entryFiles = taskFiles?.[entry.id] ?? {};
          const hasFiles = entryBoard.fields
            .filter((f) => f.type === "file" && f.mondayColumnId)
            .some((f) => entryFiles[f.key]?.length > 0);

          const finalBrief = hasFiles
            ? briefToSubmit + "\n\n📎 <strong>Reference files are attached</strong> — check the <strong>Files</strong> tab on this task."
            : briefToSubmit;

          await axios.post("/api/monday/create-update", { itemId, body: finalBrief });
        } catch (e) {
          console.warn("[Review] Brief upload failed (item was created):", e.message);
        }
      }

      // ── Step: uploading files ────────────────────────────────────────────────
      let submittedFileCount = 0;
      let filesActuallyFailed = false;
      if (itemId && taskFiles) {
        const entryFiles = taskFiles[entry.id] ?? {};
        const fileFields = entryBoard.fields.filter((f) => f.type === "file" && f.mondayColumnId);
        // Flatten all files across all file fields
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
              console.error("[Review] File upload failed:", e.message);
              failedFiles.push(file.name);
            }
          }
          if (failedFiles.length > 0) {
            filesActuallyFailed = true;
            setFileUploadWarning(
              `⚠️ Task created in Monday, but ${failedFiles.length} file(s) failed to upload: ${failedFiles.join(", ")}. Please attach them manually in Monday.`
            );
          }
        }
        onFilesUploaded?.(entry.id);
      }

      // Show all-done state briefly (X on files step if any failed)
      setSubmitProgress({ step: "done", fileIndex: 0, fileTotal: submittedFileCount, fileName: "", filesFailed: filesActuallyFailed });
      await new Promise((r) => setTimeout(r, filesActuallyFailed ? 2000 : 1000));
      setSubmitProgress(null);

      // Archive to submitted history before removing from pending
      if (onTaskSubmitted) {
        onTaskSubmitted({ ...entry, brief: briefToSubmit, mondayUrl: itemUrl });
      }

      // Remove from outbox
      setTasks((prev) => prev.filter((t) => t.id !== id));

      // Show success card for single-task flow
      if (!isBatchMode) {
        setSuccessState({ url: itemUrl, warning: fileUploadWarning ?? submitWarning });
      }

      // In batch mode: update query params but don't show success yet until submitAll is done
      const nextIds = queryIds.filter(q => q !== id);
      if (nextIds.length > 0) {
        window.history.replaceState(null, "", `/review?ids=${nextIds.join(",")}`);
        if (id === selectedId && nextIds.length > 0) {
          const nextTask = reviewTasks.find(t => nextIds.includes(t.id));
          if (nextTask) selectTask(nextTask.id);
        }
      }

      return itemUrl;
    } catch (err) {
      // Only reaches here if create-item itself failed (no item created yet)
      const msg = err.response?.data?.error || err.message || "Submission failed";
      console.error("[Review] Submit error:", msg);
      setSubmitProgress(null);
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: "error", errorMsg: msg } : t));
      return null;
    }
  }

  async function handleSubmitAll() {
    if (selectedId && editingBrief !== null) {
      setTasks((prev) => prev.map((t) => t.id === selectedId ? { ...t, editedBrief: editingBrief } : t));
    }
    const safeReview = [...reviewTasks].filter((t) => t.status !== "submitting");
    let lastUrl = null;
    for (const t of safeReview) {
      const url = await handleSubmitOne(t.id);
      if (url) lastUrl = url;
    }
    setSuccessState({ url: lastUrl, isBatch: true });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (successState) {
    return (
      <div className="batch-page">
        <header className="batch-header" style={{ justifyContent: "space-between", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div className="batch-header-center">
            <CheckCircle size={18} color="var(--purple)" style={{ marginRight: 8 }} />
            <span className="batch-header-title">Submitted</span>
          </div>
        </header>
        <SuccessCard
          itemUrl={successState.url}
          isBatch={successState.isBatch}
          onCreateAnother={() => navigate("/")}
          onGoHome={() => navigate("/")}
        />
        {successState.warning && (
          <div style={{ margin: "0 auto", maxWidth: 520, padding: "0 24px 24px" }}>
            <div style={{ background: "#78350f22", border: "1px solid #92400e", borderRadius: 10, padding: "12px 16px", color: "#fbbf24", fontSize: 13, lineHeight: 1.5 }}>
              ⚠️ {successState.warning}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="batch-page">
      <header className="batch-header" style={{ justifyContent: "space-between", background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
        <div className="batch-header-center">
          <span className="batch-header-title">{isBatchMode ? "Batch Review" : "Review & Submit"}</span>
        </div>
      </header>

      {reviewTasks.length === 0 ? (
        <div className="batch-input-phase" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-muted)" }}>Initializing review session…</p>
        </div>
      ) : (
        <div className="batch-review">
          {/* Sidebar only visible in batch mode */}
          {isBatchMode && (
            <aside className="batch-sidebar">
              <div className="batch-sidebar-label">This Session ({reviewTasks.length})</div>
              <ul className="batch-task-list">
                {reviewTasks.map((t, i) => {
                  const board = boards?.find(b => b.id === t.boardType);
                  const { title, sub } = getSidebarLabel(t, board);
                  return (
                    <li
                      key={t.id}
                      className={`batch-task-item ${selectedId === t.id ? "batch-task-item--active" : ""} batch-task-item--${t.status}`}
                      onClick={() => t.status !== "generating" && selectTask(t.id)}
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
                                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", opacity: 0.7 }}>
                                  {formatTimeAgo(t.createdAt)}
                                </span>
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
                  );
                })}
              </ul>
            </aside>
          )}

          <main className="batch-main">
          {selected ? (
            <>
              <div className="batch-main-header">
                <div style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
                  <input
                    className="batch-main-title-input"
                    value={selected.task?.manualName ?? buildAutoName(activeBoard, selected.task) ?? ""}
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
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  <button
                    className="batch-back-btn"
                    onClick={() => setWednesdayOpen(true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--purple)", fontWeight: 600 }}
                    title="Chat with Wednesday to tweak this task"
                  >
                    <MessageSquare size={15} /> Ask Wednesday
                  </button>
                  <button
                    className="batch-back-btn"
                    onClick={() => handleDelete(selected.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--red)" }}
                  >
                    <Trash2 size={15} /> Discard
                  </button>
                  <button
                    className="batch-submit-one-btn"
                    onClick={() => handleSubmitOne(selected.id)}
                    disabled={selected.status === "submitting"}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    {selected.status === "submitting" ? "Submitting…" :
                     selected.status === "error"      ? "⟳ Retry" : <>Submit <ChevronRight size={16} /></>}
                  </button>
                </div>
              </div>

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
                            setTasks((prev) => prev.map((t) => t.id === selected.id ? { ...t, task: { ...t.task, [key]: val } } : t));
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
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", flexShrink: 0, padding: "8px 16px", fontSize: "0.85rem", opacity: isRegenerating ? 0.7 : 1 }}
                    >
                      <RefreshCw size={14} />
                      {isRegenerating ? "Generating..." : "Regenerate"}
                    </button>
                  </div>
                  
                  <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
                    {editingBrief ? (
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

                  {/* File attachment preview */}
                  {(() => {
                    const fileFields = activeBoard?.fields?.filter(f => f.type === "file" && f.mondayColumnId) ?? [];
                    const entryFiles = taskFiles?.[selected.id] ?? {};
                    return <FilePreview fileFields={fileFields} entryFiles={entryFiles} />;
                  })()}

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
