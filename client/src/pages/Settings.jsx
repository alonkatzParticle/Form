// Settings — full admin shell.
// Layout: [Left nav] [Field list] [Form preview]
// The left nav switches between pages (Edit Form, Task Rename, Naming Rules).
// Edit Form is the only active page; the others show "Coming soon" in the field-list panel.

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { DEFAULT_UPDATE_TEMPLATES } from "../updateTemplateDefaults.js";

// ── Monday column type → form field type map ─────────────────────────────────
const MONDAY_TYPE_MAP = {
  status:    "select",
  dropdown:  "multiselect",
  text:      "text",
  long_text: "textarea",
  date:      "date",
  numbers:   "number",
  people:    "people",
  link:      "url",
};
const SKIP_COLUMN_TYPES = new Set(["name","subtasks","last_updated","time_tracking","timeline"]);

// ── Nav page definitions ──────────────────────────────────────────────────────
const NAV_PAGES = [
  { id: "edit-form",      label: "Edit Form",       icon: "⊞" },
  { id: "update-format",  label: "Brief Template",   icon: "✉" },
  { id: "task-rename",    label: "Task Rename",      icon: "✎" },
  { id: "auto-rename",    label: "Auto Rename",      icon: "↻" },
  { id: "naming-rules",   label: "Naming Rules",     icon: "≡" },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function Settings({ onClose }) {
  const [activePage, setActivePage] = useState("edit-form");

  // ── Edit Form state ─────────────────────────────────────────────────────────
  const [boards, setBoards]               = useState([]);
  const [activeBoardIdx, setActiveBoardIdx] = useState(0);
  const [drafts, setDrafts]               = useState({});
  const [selectedKey, setSelectedKey]     = useState(null);
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState(null);
  const [addFieldModal, setAddFieldModal] = useState(false);
  const [availableCols, setAvailableCols] = useState([]);
  const [colsLoading, setColsLoading]     = useState(false);
  const [loading, setLoading]             = useState(true);
  const [loadError, setLoadError]         = useState(null);

  // ── Update Format state ─────────────────────────────────────────────────────
  // Saved templates keyed by board.id — undefined means use the built-in default
  const [updateTemplates, setUpdateTemplates] = useState({});

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragSrcIdx, setDragSrcIdx]   = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Load settings once
  useEffect(() => {
    axios.get("/api/settings")
      .then((res) => {
        const b = res.data.boards || [];
        setBoards(b);
        const fieldDrafts = {};
        const tmplDrafts  = {};
        b.forEach((board) => {
          fieldDrafts[board.id] = JSON.parse(JSON.stringify(board.fields));
          if (board.updateTemplate) tmplDrafts[board.id] = board.updateTemplate;
        });
        setDrafts(fieldDrafts);
        setUpdateTemplates(tmplDrafts);
      })
      .catch(() => setLoadError("Failed to load settings."))
      .finally(() => setLoading(false));
  }, []);

  const board        = boards[activeBoardIdx];
  const fields       = board ? (drafts[board.id] ?? board.fields) : [];
  const selectedField    = fields.find((f) => f.key === selectedKey) ?? null;
  const selectedFieldIdx = fields.findIndex((f) => f.key === selectedKey);

  // ── Draft helpers ───────────────────────────────────────────────────────────
  function setFields(boardId, newFields) {
    setDrafts((prev) => ({ ...prev, [boardId]: newFields }));
  }
  function updateField(key, patch) {
    setFields(board.id, fields.map((f) => f.key === key ? { ...f, ...patch } : f));
  }
  function removeField(key) {
    setFields(board.id, fields.filter((f) => f.key !== key));
    if (selectedKey === key) setSelectedKey(null);
  }

  // ── Drag ────────────────────────────────────────────────────────────────────
  function handleDrop(dropIdx) {
    if (dragSrcIdx === null || dragSrcIdx === dropIdx) {
      setDragSrcIdx(null); setDragOverIdx(null); return;
    }
    const arr = [...fields];
    const [moved] = arr.splice(dragSrcIdx, 1);
    arr.splice(dropIdx, 0, moved);
    setFields(board.id, arr);
    setDragSrcIdx(null); setDragOverIdx(null);
  }

  // ── Add field ───────────────────────────────────────────────────────────────
  async function openAddField() {
    setColsLoading(true); setAddFieldModal(true);
    try {
      const res = await axios.get(`/api/monday/columns?boardId=${board.boardId}`);
      const usedIds = new Set(fields.filter((f) => f.mondayColumnId).map((f) => f.mondayColumnId));
      setAvailableCols(res.data.filter((c) => !usedIds.has(c.id) && !SKIP_COLUMN_TYPES.has(c.type)));
    } catch { setAvailableCols([]); }
    finally { setColsLoading(false); }
  }
  function addColumn(col) {
    const fieldType = MONDAY_TYPE_MAP[col.type] ?? "text";
    const newField = {
      key: col.id.replace(/[^a-zA-Z0-9_]/g, "_"),
      label: col.title, type: fieldType,
      mondayColumnId: col.id, required: false,
      ...(fieldType === "select" || fieldType === "multiselect" ? { options: [] } : {}),
    };
    setFields(board.id, [...fields, newField]);
    setAddFieldModal(false); setSelectedKey(newField.key);
  }

  // ── Save form fields ────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setSaveMsg(null);
    try {
      await axios.put("/api/settings", { boardId: board.id, fields });
      setSaveMsg("Saved!"); setTimeout(() => setSaveMsg(null), 3000);
    } catch { setSaveMsg("Error — try again."); }
    finally { setSaving(false); }
  }

  // ── Save update template ─────────────────────────────────────────────────
  async function handleTemplateSave(boardId, updateTemplate) {
    await axios.put("/api/settings", { boardId, updateTemplate });
    setUpdateTemplates((prev) => ({ ...prev, [boardId]: updateTemplate }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="settings-shell">
      {/* Top header */}
      <header className="app-header">
        <h1>Settings</h1>
        <p>Admin panel</p>
        <button className="settings-close-btn" onClick={onClose}>← Back to app</button>
      </header>

      {/* 3-column workspace */}
      <div className="settings-workspace">

        {/* ── COL 1: Left nav ─────────────────────────────────────────────── */}
        <nav className="settings-nav">
          {NAV_PAGES.map((p) => (
            <button
              key={p.id}
              className={`sn-item${activePage === p.id ? " sn-item--active" : ""}`}
              onClick={() => { setActivePage(p.id); setSelectedKey(null); }}
            >
              <span className="sn-icon">{p.icon}</span>
              <span className="sn-label">{p.label}</span>
            </button>
          ))}
        </nav>

        {/* ── COL 2 + 3: Page content ──────────────────────────────────────── */}
        {activePage === "task-rename" ? (
          <TaskRenameEditor />
        ) : activePage === "auto-rename" ? (
          <AutoRenameEditor />
        ) : activePage === "update-format" ? (
          <UpdateTemplateEditor
            boards={boards}
            activeIdx={activeBoardIdx}
            setActiveIdx={(i) => setActiveBoardIdx(i)}
            templates={updateTemplates}
            setTemplates={setUpdateTemplates}
            onSave={handleTemplateSave}
          />
        ) : activePage === "edit-form" ? (
          <>
            {/* ── COL 2: Field list (sidebar) ──────────────────────────────── */}
            <aside className="ef-sidebar">
              {/* Board selector tabs */}
              <div className="ef-board-tabs">
                {boards.map((b, i) => (
                  <button
                    key={b.id}
                    className={`ef-board-tab${activeBoardIdx === i ? " ef-board-tab--active" : ""}`}
                    onClick={() => { setActiveBoardIdx(i); setSelectedKey(null); }}
                  >{b.label}</button>
                ))}
              </div>

              {/* Toolbar */}
              <div className="ef-sidebar-toolbar">
                <button className="ef-add-btn" onClick={openAddField} disabled={!board}>＋ Add Field</button>
                <button className="ef-save-btn" onClick={handleSave} disabled={saving || !board}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              {saveMsg && (
                <div className={`ef-save-msg${saveMsg.startsWith("Error") ? " ef-save-msg--err" : ""}`}>
                  {saveMsg}
                </div>
              )}

              {/* Field list */}
              {loading  && <div className="ef-loading">Loading…</div>}
              {loadError && <div className="ef-loading ef-error">{loadError}</div>}
              {!loading && !loadError && (
                <div className="ef-list">
                  {fields.map((field, idx) => (
                    <div
                      key={field.key}
                      className={[
                        "ef-list-row",
                        dragSrcIdx === idx               ? "ef-list-row--dragging"  : "",
                        dragOverIdx === idx && dragSrcIdx !== idx ? "ef-list-row--drag-over" : "",
                        selectedKey === field.key        ? "ef-list-row--active"    : "",
                      ].filter(Boolean).join(" ")}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                      onDrop={(e) => { e.preventDefault(); handleDrop(idx); }}
                      onDragEnd={() => { setDragSrcIdx(null); setDragOverIdx(null); }}
                    >
                      <span
                        className="ef-drag-handle"
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragSrcIdx(idx); }}
                        title="Drag to reorder"
                      >⠿</span>

                      <div className="ef-list-info">
                        <span className="ef-list-label">{field.label || <em>Untitled</em>}</span>
                        <div className="ef-list-badges">
                          {field.required && <span className="ef-badge ef-badge--req">Required</span>}
                          {field.hidden   && <span className="ef-badge ef-badge--hidden">Hidden</span>}
                          {field.showWhen && <span className="ef-badge ef-badge--cond">Conditional</span>}
                        </div>
                      </div>

                      <button
                        className={`ef-dots-btn${selectedKey === field.key ? " ef-dots-btn--active" : ""}`}
                        onClick={() => setSelectedKey(selectedKey === field.key ? null : field.key)}
                        title="Field settings"
                      >⋮</button>
                    </div>
                  ))}
                </div>
              )}
            </aside>

            {/* ── COL 3: Form preview + settings drawer ────────────────────── */}
            <div className="ef-preview-pane">
              <FormPreview fields={fields} highlightKey={selectedKey} />

              {selectedKey && (
                <div className="ef-drawer-backdrop" onClick={() => setSelectedKey(null)} />
              )}

              <div className={`ef-drawer${selectedKey ? " ef-drawer--open" : ""}`}>
                {selectedField && (
                  <FieldEditor
                    field={selectedField}
                    fieldIdx={selectedFieldIdx}
                    allFields={fields}
                    onChange={(patch) => updateField(selectedField.key, patch)}
                    onRemove={() => removeField(selectedField.key)}
                    onClose={() => setSelectedKey(null)}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── Coming soon for other pages ────────────────────────────────── */
          <div className="settings-coming-soon-page">
            <div className="settings-coming-soon-inner">
              <span className="settings-coming-soon-icon">
                {NAV_PAGES.find((p) => p.id === activePage)?.icon}
              </span>
              <h2>{NAV_PAGES.find((p) => p.id === activePage)?.label}</h2>
              <p>This feature is coming soon.</p>
            </div>
          </div>
        )}
      </div>

      {/* Add Field modal */}
      {addFieldModal && (
        <div className="modal-overlay" onClick={() => setAddFieldModal(false)}>
          <div className="modal-box ef-col-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Add Field from Monday</h2>
            <p className="modal-subtitle">Columns not yet on this form:</p>
            {colsLoading && <p className="ef-col-loading">Fetching columns…</p>}
            {!colsLoading && availableCols.length === 0 && (
              <p className="ef-col-loading">All board columns are already on the form.</p>
            )}
            {!colsLoading && availableCols.map((col) => (
              <button key={col.id} className="ef-col-row" onClick={() => addColumn(col)}>
                <span className="ef-col-title">{col.title}</span>
                <span className="ef-col-type">{MONDAY_TYPE_MAP[col.type] ?? col.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FormPreview ───────────────────────────────────────────────────────────────

function FormPreview({ fields, highlightKey }) {
  return (
    <div className="ef-preview">
      <div className="ef-preview-label">Form Preview</div>
      <div className="ef-preview-form">
        {fields.map((field) => {
          if (field.hidden) return null;
          const isHighlighted  = field.key === highlightKey;
          const isConditional  = !!field.showWhen;
          return (
            <div
              key={field.key}
              className={[
                "ef-preview-field",
                isHighlighted ? "ef-preview-field--highlight"   : "",
                isConditional ? "ef-preview-field--conditional" : "",
              ].filter(Boolean).join(" ")}
            >
              <label className="ef-preview-field-label">
                {field.label || <em>Untitled</em>}
                {field.required && <span className="ef-preview-required"> *</span>}
                {isConditional  && <span className="ef-preview-cond-tag">conditional</span>}
              </label>
              {field.hint && <p className="ef-preview-hint">{field.hint}</p>}
              <PreviewInput field={field} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewInput({ field }) {
  const cls = "ef-preview-input";
  switch (field.type) {
    case "textarea":
      return <textarea className={cls} disabled rows={3} placeholder={field.placeholder || ""} />;
    case "select":
      return (
        <select className={cls} disabled>
          <option>{field.placeholder || `Select ${field.label}…`}</option>
          {(field.options ?? []).map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    case "multiselect":
      return (
        <div className={`${cls} ef-preview-multi`}>
          {(field.options ?? []).slice(0, 3).map((o) => (
            <span key={o} className="ef-preview-chip">{o}</span>
          ))}
          {(field.options ?? []).length > 3 && (
            <span className="ef-preview-chip ef-preview-chip--more">
              +{(field.options ?? []).length - 3} more
            </span>
          )}
          {(field.options ?? []).length === 0 && (
            <span className="ef-preview-placeholder">No options yet</span>
          )}
        </div>
      );
    case "date":   return <input className={cls} type="date"   disabled />;
    case "number": return <input className={cls} type="number" disabled placeholder={field.placeholder || "0"} />;
    case "people": return <div className={`${cls} ef-preview-people`}>People selector</div>;
    case "url":    return <input className={cls} type="url"    disabled placeholder={field.placeholder || "https://…"} />;
    default:       return <input className={cls} type="text"   disabled placeholder={field.placeholder || ""} />;
  }
}

// ── FieldEditor (drawer content) ──────────────────────────────────────────────

function FieldEditor({ field, fieldIdx, allFields, onChange, onRemove, onClose }) {
  const isSelect   = field.type === "select" || field.type === "multiselect";
  const fieldsAbove = allFields.slice(0, fieldIdx);

  const [optionsText, setOptionsText] = useState((field.options ?? []).join("\n"));
  useEffect(() => { setOptionsText((field.options ?? []).join("\n")); }, [field.key, field.options]);

  function commitOptions() {
    onChange({ options: optionsText.split("\n").map((s) => s.trim()).filter(Boolean) });
  }

  const sw         = field.showWhen ?? {};
  const swFieldDef = allFields.find((f) => f.key === sw.field);
  const swOptions  = swFieldDef?.options ?? [];
  const swInvalid  = sw.field && !fieldsAbove.find((f) => f.key === sw.field);

  function setSwField(key) {
    if (!key) { onChange({ showWhen: undefined }); return; }
    onChange({ showWhen: { field: key, includes: "" } });
  }

  return (
    <div className="ef-drawer-inner">
      <div className="ef-drawer-header">
        <span className="ef-drawer-title">
          {field.label || "Untitled"}
          <span className="ef-drawer-type">{field.type}</span>
        </span>
        <button className="ef-drawer-close" onClick={onClose}>✕</button>
      </div>

      <div className="ef-drawer-body">
        {/* Label */}
        <div className="ef-drow">
          <label className="ef-label">Label</label>
          <input
            className="ef-input"
            value={field.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Field label"
          />
        </div>

        {/* Subtitle / instructions */}
        <div className="ef-drow ef-drow--col">
          <label className="ef-label">
            Subtitle <span className="ef-label-hint">(shown below the label)</span>
          </label>
          <input
            className="ef-input"
            value={field.hint ?? ""}
            onChange={(e) => onChange({ hint: e.target.value || undefined })}
            placeholder="Optional instructions for this field…"
          />
        </div>

        {/* Toggles */}
        <div className="ef-drow ef-drow--toggles">
          <Toggle label="Required" checked={!!field.required} onChange={(v) => onChange({ required: v })} />
          <Toggle label="Hidden"   checked={!!field.hidden}   onChange={(v) => onChange({ hidden: v })} />
        </div>

        {/* Options */}
        {isSelect && (
          <div className="ef-drow ef-drow--col">
            <label className="ef-label">
              Options <span className="ef-label-hint">(one per line)</span>
            </label>
            <textarea
              className="ef-textarea ef-options-ta"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              onBlur={commitOptions}
              rows={Math.max(3, (field.options ?? []).length + 1)}
              placeholder={"Option A\nOption B\nOption C"}
            />
          </div>
        )}

        {/* Conditional visibility */}
        <div className="ef-drow ef-drow--col">
          <label className="ef-label">Conditional visibility</label>
          {fieldsAbove.length === 0 ? (
            <span className="ef-showwhen-empty">No fields above this one.</span>
          ) : (
            <div className="ef-showwhen">
              <div className="ef-showwhen-row">
                <span className="ef-showwhen-label">Show when</span>
                <select
                  className="ef-select"
                  value={sw.field ?? ""}
                  onChange={(e) => setSwField(e.target.value)}
                >
                  <option value="">— always visible —</option>
                  {fieldsAbove.map((f) => (
                    <option key={f.key} value={f.key}>{f.label || f.key}</option>
                  ))}
                </select>
              </div>
              {sw.field && (
                <div className="ef-showwhen-row">
                  <span className="ef-showwhen-label">includes</span>
                  {swOptions.length > 0 ? (
                    <select
                      className="ef-select"
                      value={sw.includes ?? ""}
                      onChange={(e) => onChange({ showWhen: { ...sw, includes: e.target.value } })}
                    >
                      <option value="">— pick a value —</option>
                      {swOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="ef-input ef-input--sm"
                      value={sw.includes ?? ""}
                      onChange={(e) => onChange({ showWhen: { ...sw, includes: e.target.value } })}
                      placeholder="value"
                    />
                  )}
                  <button className="ef-clear-cond" onClick={() => onChange({ showWhen: undefined })}>✕</button>
                </div>
              )}
              {swInvalid && <p className="ef-warn">⚠ Trigger field is no longer above this one.</p>}
            </div>
          )}
        </div>

        {/* Remove */}
        <div className="ef-drow">
          <button className="ef-action-btn ef-action-btn--remove" onClick={onRemove}>
            🗑 Remove field
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AutoRenameEditor ──────────────────────────────────────────────────────────

function AutoRenameEditor() {
  const [state,   setState]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMsg,  setRunMsg]  = useState(null);

  useEffect(() => {
    axios.get("/api/auto-rename/status")
      .then((r) => setState(r.data))
      .catch(() => setState({ enabled: false, lastRun: null, seenIds: [], log: [] }))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(val) {
    try {
      const { data } = await axios.post("/api/auto-rename/toggle", { enabled: val });
      setState(data);
    } catch { /* ignore */ }
  }

  async function handleRunNow() {
    setRunning(true); setRunMsg(null);
    try {
      const { data } = await axios.post("/api/auto-rename/run");
      setState(data);
      setRunMsg("Done!");
      setTimeout(() => setRunMsg(null), 3000);
    } catch (err) {
      setRunMsg("Error: " + (err.response?.data?.error || "run failed."));
    } finally {
      setRunning(false);
    }
  }

  const STATUS_LABEL = { renamed: "Renamed", formatted: "Already formatted", error: "Error" };

  if (loading) return <div className="tr-page"><p className="ut-hint">Loading…</p></div>;

  return (
    <div className="tr-page">
      <div className="tr-header">
        <div className="ut-section-title">Auto Rename</div>
        <p className="ut-hint">
          Checks tasks in <strong>Form Requests</strong> and <strong>Ready For Assignment</strong> on
          both boards every 5 minutes. Tasks without proper naming (2+ segments) are renamed
          automatically. Already-formatted tasks are tracked and skipped on future runs.
        </p>
      </div>

      <div className="ar-controls">
        <Toggle
          label={state?.enabled ? "Auto Rename: ON" : "Auto Rename: OFF"}
          checked={state?.enabled ?? false}
          onChange={handleToggle}
        />
        <div className="ar-run-row">
          <button className="ef-save-btn" onClick={handleRunNow} disabled={running}>
            {running ? "Running…" : "Run Now"}
          </button>
          {runMsg && (
            <span className={`ef-save-msg${runMsg.startsWith("Error") ? " ef-save-msg--err" : ""}`}>
              {runMsg}
            </span>
          )}
        </div>
      </div>

      {state?.lastRun && (
        <p className="ar-last-run">Last run: {new Date(state.lastRun).toLocaleString()}</p>
      )}

      {state?.log?.length > 0 ? (
        <div className="ar-log">
          {state.log.map((entry, i) => (
            <div key={i} className={`ar-entry ar-entry--${entry.status}`}>
              <span className="ar-entry-board">{entry.boardLabel}</span>
              <span className="ar-entry-name">
                {entry.status === "renamed"
                  ? <>{entry.oldName} <span className="ar-arrow">→</span> {entry.newName}</>
                  : entry.name}
              </span>
              {entry.status === "error" && (
                <span className="ar-entry-error">{entry.error}</span>
              )}
              <span className={`ar-badge ar-badge--${entry.status}`}>
                {STATUS_LABEL[entry.status]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="ar-empty">No tasks processed yet. Hit <strong>Run Now</strong> to start.</p>
      )}
    </div>
  );
}

// ── TaskRenameEditor ──────────────────────────────────────────────────────────

function TaskRenameEditor() {
  const [url,        setUrl]        = useState("");
  const [loading,    setLoading]    = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [result,     setResult]     = useState(null);   // { itemId, boardId, boardLabel, currentName, suggestedName }
  const [editedName, setEditedName] = useState("");
  const [renaming,   setRenaming]   = useState(false);
  const [renameMsg,  setRenameMsg]  = useState(null);

  async function handleFetch() {
    setLoading(true); setFetchError(null); setResult(null); setRenameMsg(null);
    try {
      const { data } = await axios.post("/api/monday/suggest-rename", { itemUrl: url.trim() });
      setResult(data);
      setEditedName(data.suggestedName);
    } catch (err) {
      setFetchError(err.response?.data?.error || "Failed to fetch task.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRename() {
    setRenaming(true); setRenameMsg(null);
    try {
      await axios.post("/api/monday/rename-item", {
        itemId:  result.itemId,
        boardId: result.boardId,
        newName: editedName.trim(),
      });
      setRenameMsg("Renamed successfully!");
      setResult((prev) => ({ ...prev, currentName: editedName.trim() }));
    } catch (err) {
      setRenameMsg("Error: " + (err.response?.data?.error || "rename failed."));
    } finally {
      setRenaming(false);
    }
  }

  const unchanged = result && editedName.trim() === result.currentName;

  return (
    <div className="tr-page">
      <div className="tr-header">
        <div className="ut-section-title">Task Rename</div>
        <p className="ut-hint">
          Paste a Monday task URL — Task Creator will generate the correct name based on
          the board's naming rules. Review and edit the suggestion before applying it.
        </p>
      </div>

      {/* URL input */}
      <div className="tr-input-row">
        <input
          className="tr-url-input"
          type="url"
          placeholder="https://your-company.monday.com/boards/…/pulses/…"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setResult(null); setRenameMsg(null); }}
          onKeyDown={(e) => e.key === "Enter" && !loading && url.trim() && handleFetch()}
        />
        <button
          className="ef-save-btn"
          onClick={handleFetch}
          disabled={loading || !url.trim()}
        >
          {loading ? "Fetching…" : "Fetch Task"}
        </button>
      </div>

      {fetchError && <div className="tr-error">{fetchError}</div>}

      {/* Result card */}
      {result && (
        <div className="tr-card">
          <div className="tr-card-board">{result.boardLabel}</div>

          <div className="tr-row">
            <span className="tr-row-label">Current name</span>
            <span className="tr-row-value tr-row-value--old">{result.currentName}</span>
          </div>

          <div className="tr-row tr-row--new">
            <span className="tr-row-label">New name</span>
            <input
              className="tr-name-input"
              value={editedName}
              onChange={(e) => { setEditedName(e.target.value); setRenameMsg(null); }}
            />
          </div>

          {unchanged && (
            <p className="tr-same-note">The suggested name matches the current name — nothing to change.</p>
          )}

          <div className="tr-actions">
            <button
              className="ef-save-btn"
              onClick={handleRename}
              disabled={renaming || !editedName.trim() || unchanged}
            >
              {renaming ? "Renaming…" : "Rename on Monday"}
            </button>
            {renameMsg && (
              <span className={`ef-save-msg${renameMsg.startsWith("Error") ? " ef-save-msg--err" : ""}`}>
                {renameMsg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UpdateTemplateEditor ──────────────────────────────────────────────────────
// contenteditable rich-text editor for the Monday update template.
// Field values are inserted as non-editable chips ({{key}} in storage).

function buildPreviewHtml(template, fields) {
  function sampleVal(f) {
    if (f.type === "select")      return f.options?.[0] ?? `[${f.label}]`;
    if (f.type === "multiselect") return (f.options?.slice(0, 2) ?? []).join(", ") || `[${f.label}]`;
    if (f.type === "people")      return "John Smith";
    if (f.type === "number")      return "3";
    if (f.type === "date")        return "Apr 1, 2026";
    if (f.type === "url")         return f.placeholder ?? "https://example.com";
    return f.placeholder ?? `[${f.label}]`;
  }
  // Same block-drop logic as buildUpdateBody
  let result = template.replace(
    /<(p|h2|h3|h4|li)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (block, tag, attrs, inner) => {
      const filled = inner.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const f = fields.find((f) => f.key === key);
        return f ? sampleVal(f) : `[${key}]`;
      });
      return `<${tag}${attrs}>${filled}</${tag}>`;
    }
  );
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const f = fields.find((f) => f.key === key);
    return f ? sampleVal(f) : `[${key}]`;
  });
  return result;
}

function deserializeTemplate(template, fields) {
  // Replace {{key}} with visual chips for the editor
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const f = fields.find((f) => f.key === key);
    const label = f?.label ?? key;
    return `<span contenteditable="false" data-field="${key}" class="ut-chip">${label}</span>`;
  });
}

function serializeEditorEl(el) {
  // Clone so we don't mutate the live DOM
  const temp = document.createElement("div");
  temp.innerHTML = el.innerHTML;
  // Replace each chip span with the {{key}} placeholder text node
  temp.querySelectorAll("[data-field]").forEach((chip) => {
    chip.replaceWith(document.createTextNode(`{{${chip.dataset.field}}}`));
  });
  // Normalize browser-inserted <div> wrappers → <p>
  let html = temp.innerHTML;
  html = html.replace(/<div>/gi, "<p>").replace(/<\/div>/gi, "</p>");
  return html;
}

function UpdateTemplateEditor({ boards, activeIdx, setActiveIdx, templates, setTemplates, onSave }) {
  const editorRef      = useRef(null);
  const savedRangeRef  = useRef(null);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [previewHtml,   setPreviewHtml]   = useState("");
  const [saving,        setSaving]        = useState(false);
  const [saveMsg,       setSaveMsg]       = useState(null);

  const board  = boards[activeIdx];
  const fields = board?.fields ?? [];

  // Insertable fields: skip file + item_name (they have no meaningful text value)
  const insertableFields = fields.filter(
    (f) => f.type !== "file" && f.mondayValueType !== "item_name"
  );

  // Load template into editor whenever the active board changes
  useEffect(() => {
    if (!editorRef.current || !board) return;
    const tmpl = templates[board.id] ?? DEFAULT_UPDATE_TEMPLATES[board.id] ?? "";
    editorRef.current.innerHTML = deserializeTemplate(tmpl, fields);
    document.execCommand("defaultParagraphSeparator", false, "p");
    setPreviewHtml(buildPreviewHtml(tmpl, fields));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id]);

  // Rebuild preview whenever editor content changes
  function handleInput() {
    const tmpl = serializeEditorEl(editorRef.current);
    setPreviewHtml(buildPreviewHtml(tmpl, fields));
  }

  // Save cursor position before focus leaves the editor (e.g. clicking toolbar)
  function saveSelection() {
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount > 0 &&
      editorRef.current?.contains(sel.getRangeAt(0).startContainer)
    ) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    if (!savedRangeRef.current) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRangeRef.current);
  }

  // Toolbar helpers — use onMouseDown + e.preventDefault() so editor keeps focus
  function execCmd(cmd, value = null) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  }

  function insertFieldChip(key, label) {
    setFieldMenuOpen(false);
    editorRef.current?.focus();
    restoreSelection();

    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.field   = key;
    chip.className       = "ut-chip";
    chip.textContent     = label;

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      const after = document.createRange();
      after.setStartAfter(chip);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    // Trigger preview update
    handleInput();
  }

  async function handleSave() {
    setSaving(true); setSaveMsg(null);
    const tmpl = serializeEditorEl(editorRef.current);
    try {
      await onSave(board.id, tmpl);
      setTemplates((prev) => ({ ...prev, [board.id]: tmpl }));
      setSaveMsg("Saved!");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch {
      setSaveMsg("Error — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ut-page">
      {/* Board selector tabs */}
      <div className="ef-board-tabs ut-board-tabs">
        {boards.map((b, i) => (
          <button
            key={b.id}
            className={`ef-board-tab${activeIdx === i ? " ef-board-tab--active" : ""}`}
            onClick={() => setActiveIdx(i)}
          >{b.label}</button>
        ))}
      </div>

      <div className="ut-split">

        {/* ── Left: editor ───────────────────────────────────────────────── */}
        <div className="ut-editor-side">
          <div className="ut-section-title">Template</div>
          <p className="ut-hint">
            Write the update posted to Monday when a task is created.
            Use the toolbar to format text and insert field values as chips.
          </p>

          {/* Toolbar */}
          <div className="ut-toolbar">
            <button
              className="ut-btn ut-btn--bold"
              title="Bold"
              onMouseDown={(e) => { e.preventDefault(); execCmd("bold"); }}
            ><b>B</b></button>

            <button
              className="ut-btn"
              title="Large heading"
              onMouseDown={(e) => { e.preventDefault(); execCmd("formatBlock", "h2"); }}
            >H2</button>

            <button
              className="ut-btn"
              title="Small heading"
              onMouseDown={(e) => { e.preventDefault(); execCmd("formatBlock", "h3"); }}
            >H3</button>

            <button
              className="ut-btn"
              title="Normal paragraph"
              onMouseDown={(e) => { e.preventDefault(); execCmd("formatBlock", "p"); }}
            >¶</button>

            <div className="ut-insert-wrap">
              <button
                className="ut-btn ut-btn--insert"
                onMouseDown={(e) => {
                  e.preventDefault();
                  saveSelection();
                  setFieldMenuOpen((v) => !v);
                }}
              >+ Field ▾</button>

              {fieldMenuOpen && (
                <div className="ut-field-menu">
                  {insertableFields.map((f) => (
                    <button
                      key={f.key}
                      className="ut-field-option"
                      onMouseDown={(e) => { e.preventDefault(); insertFieldChip(f.key, f.label); }}
                    >{f.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Contenteditable area */}
          <div
            ref={editorRef}
            className="ut-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onBlur={saveSelection}
            onClick={() => setFieldMenuOpen(false)}
          />

          <div className="ut-actions">
            <button className="ef-save-btn" onClick={handleSave} disabled={saving || !board}>
              {saving ? "Saving…" : "Save Template"}
            </button>
            {saveMsg && (
              <span className={`ef-save-msg${saveMsg.startsWith("Error") ? " ef-save-msg--err" : ""}`}>
                {saveMsg}
              </span>
            )}
          </div>

          <div className="ut-auto-note">
            📎 <strong>Relevant Files</strong> is not a template field — when files are attached
            to a task, a <em>View attached files</em> link is automatically added to the bottom
            of the update.
          </div>
        </div>

        {/* ── Right: live preview ─────────────────────────────────────────── */}
        <div className="ut-preview-side">
          <div className="ut-section-title">Preview</div>
          <p className="ut-hint">How the update looks in Monday (sample field values shown).</p>
          <div
            className="ut-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          <div className="ut-auto-note">
            📎 When files are attached, <em>View attached files</em> is automatically appended here.
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange }) {
  return (
    <label className="ef-toggle">
      <span className="ef-toggle-label">{label}</span>
      <div
        className={`ef-toggle-track${checked ? " ef-toggle-track--on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <div className="ef-toggle-thumb" />
      </div>
    </label>
  );
}
