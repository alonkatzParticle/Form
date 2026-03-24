// DynamicForm — renders any board's form from its field config in settings.json.
// Field order, visibility, and grouping are all controlled by the settings file.
// To reorder fields: edit the "fields" array for the board in server/settings.json.
// To add a field: add an entry to that array and map it to a Monday column ID.
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import InlineDurationEstimator from "../InlineDurationEstimator.jsx";
import { DEFAULT_UPDATE_TEMPLATES } from "../../updateTemplateDefaults.js";

// ─── Field helpers ────────────────────────────────────────────────────────────

function Field({ label, required, hint, children }) {
  return (
    <div className="field">
      <label>
        {label}
        {required && <span className="required"> *</span>}
      </label>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}

// ─── Value visibility check ───────────────────────────────────────────────────

function isVisible(field, task) {
  if (field.hidden) return false;
  if (!field.showWhen) return true;
  const val = task[field.showWhen.field];
  if (Array.isArray(val)) return val.includes(field.showWhen.includes);
  return val === field.showWhen.includes;
}

// ─── Auto name builder ────────────────────────────────────────────────────────

function buildAutoName(board, task) {
  if (!board.autoName) return task.taskName || "";
  return board.autoName.segments
    .map((seg) => {
      let val = task[seg.field];
      if (!val && seg.fallback) val = task[seg.fallback];
      if (!val) return null;
      if (seg.onlyValues && !seg.onlyValues.includes(val)) return null;
      if (seg.valueMap && seg.valueMap[val]) val = seg.valueMap[val];
      return val;
    })
    .filter(Boolean)
    .join(" | ");
}

// ─── Update body builder ──────────────────────────────────────────────────────
// Renders an HTML update body from a template (stored in board.updateTemplate).
// Falls back to the default template for the board id, or plain auto-generation.
// Block-level elements whose {{field}} refs ALL resolve to empty are dropped.

function buildUpdateBody(fields, task, users, updateTemplate, fileUrl = null) {
  function getVal(key) {
    const field = fields.find((f) => f.key === key);
    if (!field || !isVisible(field, task)) return null;
    const val = task[key];
    if (val === null || val === undefined || val === "") return null;
    if (Array.isArray(val) && val.length === 0) return null;
    if (field.type === "people") {
      return val
        .map((id) => users.find((u) => String(u.id) === String(id))?.name ?? id)
        .join(", ");
    }
    if (Array.isArray(val)) return val.join(", ");
    return String(val);
  }

  if (!updateTemplate) {
    // Plain auto-generation fallback (no template configured)
    const lines = [];
    for (const field of fields) {
      if (!isVisible(field, task)) continue;
      if (field.type === "file") continue;
      if (field.mondayValueType === "item_name") continue;
      const display = getVal(field.key);
      if (!display) continue;
      lines.push(`<b>${field.label}:</b> ${display}`);
    }
    return lines.length ? `<b>📋 Task Brief</b><br><br>${lines.join("<br>")}` : "";
  }

  // ── Step 1: Mark blocks whose field refs all resolve to empty ─────────────────
  // We mark instead of immediately deleting so Step 2 can detect "label orphans"
  // (e.g. a <p><b>Script:</b></p> on its own line right before a removed <p>{{script}}</p>).
  let result = updateTemplate.replace(
    /<(p|h2|h3|h4|li)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_block, tag, attrs, inner) => {
      const keys = [...inner.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      if (keys.length > 0 && keys.every((k) => !getVal(k))) {
        return `<${tag}${attrs} data-rm="1"></${tag}>`;   // marked, not yet deleted
      }
      const filled = inner.replace(/\{\{(\w+)\}\}/g, (_, k) => getVal(k) ?? "");
      return `<${tag}${attrs}>${filled}</${tag}>`;
    }
  );
  result = result.replace(/\{\{(\w+)\}\}/g, (_, k) => getVal(k) ?? "");

  // ── Step 2: DOM cleanup ────────────────────────────────────────────────────
  const scratch = document.createElement("div");
  scratch.innerHTML = result;

  // Strip editor-injected inline styles (font-size, font-family etc.)
  scratch.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));

  // Helper: true for elements that are purely visual spacing (no real content)
  function isSpacer(el) {
    if (!el) return false;
    if (el.tagName === "BR") return true;
    if (el.tagName === "P") return el.textContent.replace(/\u00a0/g, "").trim() === "";
    return false;
  }

  // a) For each marked-for-removal block, also mark any immediately preceding
  //    label-only <p> (a standalone label whose value paragraph was just removed).
  //    Heuristic: the preceding <p> contains only inline formatting (b/i/strong/em/u/span)
  //    and its text looks like a label (ends with ":" or is very short).
  scratch.querySelectorAll("[data-rm]").forEach((removed) => {
    const prev = removed.previousElementSibling;
    if (!prev || prev.tagName !== "P" || prev.dataset.rm) return;
    const onlyInline = [...prev.childNodes].every((n) => {
      if (n.nodeType === Node.TEXT_NODE) return n.textContent.replace(/\u00a0/g, "").trim() === "";
      return ["B", "I", "STRONG", "EM", "U", "SPAN"].includes(n.tagName);
    });
    const text = prev.textContent.replace(/\u00a0/g, "").trim();
    if (onlyInline && (text.endsWith(":") || text.length < 40)) {
      prev.dataset.rm = "1";
    }
  });

  // b) Delete all marked elements
  scratch.querySelectorAll("[data-rm]").forEach((el) => el.remove());

  // c) Remove orphaned headings: H2/H3 with no real content before the next heading
  Array.from(scratch.children).forEach((el) => {
    if (el.tagName !== "H2" && el.tagName !== "H3") return;
    let next = el.nextElementSibling;
    while (next && isSpacer(next)) next = next.nextElementSibling;
    if (!next || next.tagName === "H2" || next.tagName === "H3") el.remove();
  });

  // d) Collapse consecutive spacers (BR / empty P) down to at most one
  let prevWasSpacer = false;
  for (const el of Array.from(scratch.children)) {
    if (isSpacer(el)) {
      if (prevWasSpacer) el.remove();
      else prevWasSpacer = true;
    } else {
      prevWasSpacer = false;
    }
  }

  // e) Remove leading and trailing spacers
  while (scratch.firstElementChild && isSpacer(scratch.firstElementChild))
    scratch.firstElementChild.remove();
  while (scratch.lastElementChild && isSpacer(scratch.lastElementChild))
    scratch.lastElementChild.remove();

  // f) Append the file link (always after cleanup so it sits right at the end)
  if (fileUrl) {
    const sep = document.createElement("p");
    sep.innerHTML = `📎 <a href="${fileUrl}">View attached files</a>`;
    scratch.appendChild(sep);
  }

  return scratch.innerHTML;
}

// ─── Monday value serializer ──────────────────────────────────────────────────

function toMondayValue(field, value) {
  const empty =
    value === null ||
    value === "" ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return null;

  const type = field.mondayValueType ?? defaultMondayType(field.type);

  switch (type) {
    case "item_name": return null;
    case "file":      return null; // uploaded separately after item creation
    case "status":    return { label: value };
    case "multi_select": return { labels: value };
    case "date":      return { date: value };
    case "number":    return String(value);
    case "long_text": return { text: value };
    case "short_text": return value;
    case "link":      return { url: value, text: field.linkText || "Link" };
    case "people":    return { personsAndTeams: value.map((id) => ({ id: parseInt(id), kind: "person" })) };
    default:          return null;
  }
}

function defaultMondayType(fieldType) {
  const map = {
    select:      "status",
    multiselect: "multi_select",
    date:        "date",
    number:      "number",
    textarea:    "long_text",
    text:        "long_text",
    url:         "link",
    people:      "people",
  };
  return map[fieldType] ?? null;
}

// ─── Column value builder ─────────────────────────────────────────────────────

function buildColumnValues(fields, task) {
  const vals = {};
  for (const field of fields) {
    if (!field.mondayColumnId) continue;
    const mondayVal = toMondayValue(field, task[field.key]);
    if (mondayVal !== null && mondayVal !== undefined) {
      vals[field.mondayColumnId] = mondayVal;
    }
  }
  return vals;
}

// ─── Initial task state ───────────────────────────────────────────────────────

function initTask(fields) {
  const task = {};
  for (const field of fields) {
    if (field.type === "multiselect" || field.type === "people") {
      task[field.key] = [];
    } else if (field.type === "number") {
      task[field.key] = null;
    } else if (field.type === "file") {
      task[field.key] = null; // FileList or null
    } else {
      task[field.key] = "";
    }
  }
  return task;
}

// ─── Custom single-select dropdown ───────────────────────────────────────────

function CustomSelect({ options, value, onChange, placeholder = "Select…" }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(option) {
    onChange(option);
    setIsOpen(false);
    setSearch("");
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange("");
    setSearch("");
  }

  return (
    <div className="people-search" ref={containerRef}>
      <div className="people-search-box custom-select-box" onClick={() => { setIsOpen((o) => !o); }}>
        {value ? (
          <>
            <span className="custom-select-value">{value}</span>
            <button type="button" className="people-tag-remove custom-select-clear" onMouseDown={handleClear}>×</button>
          </>
        ) : (
          <input
            className="people-input"
            placeholder={isOpen ? "Search…" : placeholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
            onFocus={() => setIsOpen(true)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span className="custom-select-chevron">{isOpen ? "▲" : "▼"}</span>
      </div>
      {isOpen && (
        <div className="people-dropdown">
          {value && (
            <input
              className="people-input dropdown-search-input"
              placeholder="Search…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          )}
          {filtered.length === 0 ? (
            <div className="people-option muted">No results</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o}
                className={`people-option${value === o ? " selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(o); }}
              >
                <span className="people-option-check">{value === o ? "✓" : ""}</span>
                {o}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Custom multi-select dropdown ────────────────────────────────────────────

function CustomMultiSelect({ options, value, onChange }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggle(option) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }

  return (
    <div className="people-search" ref={containerRef}>
      <div className="people-search-box" onClick={() => setIsOpen(true)}>
        {value.map((o) => (
          <span key={o} className="people-tag">
            {o}
            <button
              type="button"
              className="people-tag-remove"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggle(o); }}
            >×</button>
          </span>
        ))}
        <input
          className="people-input"
          placeholder={value.length ? "" : "Select options…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />
      </div>
      {isOpen && (
        <div className="people-dropdown">
          {filtered.length === 0 ? (
            <div className="people-option muted">No results</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o}
                className={`people-option${value.includes(o) ? " selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
              >
                <span className="people-option-check">{value.includes(o) ? "✓" : ""}</span>
                {o}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Searchable people multi-select ──────────────────────────────────────────

function PeopleSearchSelect({ field, value, users, onChange }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const displayUsers = field.allowedPeople
    ? users.filter((u) =>
        field.allowedPeople.some((name) =>
          u.name.toLowerCase().startsWith(name.toLowerCase())
        )
      )
    : users;

  const filtered = displayUsers.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedUsers = users.filter((u) => value.includes(u.id));

  function toggle(id) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    setSearch("");
  }

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="people-search" ref={containerRef}>
      <div className="people-search-box" onClick={() => setIsOpen(true)}>
        {selectedUsers.map((u) => (
          <span key={u.id} className="people-tag">
            {u.name}
            <button
              type="button"
              className="people-tag-remove"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggle(u.id); }}
            >×</button>
          </span>
        ))}
        <input
          className="people-input"
          placeholder={selectedUsers.length ? "" : "Search people…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setIsOpen(true)}
        />
      </div>
      {isOpen && filtered.length > 0 && (
        <div className="people-dropdown">
          {filtered.map((u) => (
            <div
              key={u.id}
              className={`people-option${value.includes(u.id) ? " selected" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); toggle(u.id); }}
            >
              <span className="people-option-check">{value.includes(u.id) ? "✓" : ""}</span>
              {u.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Frequency sort helper ────────────────────────────────────────────────────
// Sorts an options array so the most-used values appear first.
// Items not in freqArray stay at the end in their original relative order.

function sortByFrequency(options, freqArray) {
  if (!freqArray || freqArray.length === 0) return options;
  return [...options].sort((a, b) => {
    const ia = freqArray.indexOf(a);
    const ib = freqArray.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
}

function sortUsersByFrequency(users, freqArray) {
  if (!freqArray || freqArray.length === 0) return users;
  return [...users].sort((a, b) => {
    const ia = freqArray.indexOf(a.name);
    const ib = freqArray.indexOf(b.name);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
}

// ─── Single field renderer ────────────────────────────────────────────────────

function renderInput(field, task, setField, users, frequencyOrder = {}) {
  const value = task[field.key];

  switch (field.type) {
    case "text":
    case "url":
      return (
        <input
          type={field.type}
          value={value}
          onChange={(e) => setField(field.key, e.target.value)}
          placeholder={field.placeholder || ""}
        />
      );

    case "number":
      return (
        <input
          type="number"
          min={field.min}
          value={value ?? ""}
          onChange={(e) => setField(field.key, e.target.value ? parseInt(e.target.value) : null)}
          placeholder={field.placeholder || ""}
        />
      );

    case "date":
      return (
        <input
          type="date"
          value={value || ""}
          onChange={(e) => setField(field.key, e.target.value || null)}
        />
      );

    case "textarea":
      return (
        <textarea
          value={value}
          onChange={(e) => setField(field.key, e.target.value)}
          rows={field.rows || 4}
          placeholder={field.placeholder || ""}
        />
      );

    case "select":
      return (
        <CustomSelect
          options={sortByFrequency(field.options || [], frequencyOrder[field.key])}
          value={value}
          onChange={(v) => setField(field.key, v)}
        />
      );

    case "multiselect":
      return (
        <CustomMultiSelect
          options={sortByFrequency(field.options || [], frequencyOrder[field.key])}
          value={value}
          onChange={(v) => setField(field.key, v)}
        />
      );

    case "people": {
      const sortedUsers = sortUsersByFrequency(users, frequencyOrder[field.key]);
      if (!sortedUsers.length) return <p className="hint">Loading team members…</p>;

      if (field.searchable) {
        return (
          <PeopleSearchSelect
            field={field}
            value={value}
            users={sortedUsers}
            onChange={(v) => setField(field.key, v)}
          />
        );
      }

      {
        const displayUsers = field.allowedPeople
          ? sortedUsers.filter((u) =>
              field.allowedPeople.some((name) =>
                u.name.toLowerCase().startsWith(name.toLowerCase())
              )
            )
          : sortedUsers;
        return (
          <div className="multi-select">
            {displayUsers.map((u) => (
              <label key={u.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={value.includes(u.id)}
                  onChange={() => {
                    setField(field.key, value.includes(u.id) ? value.filter((v) => v !== u.id) : [...value, u.id]);
                  }}
                />
                {u.name}
              </label>
            ))}
          </div>
        );
      }
    }

    case "file":
      return (
        <FileInput
          value={value}
          onChange={(files) => setField(field.key, files)}
        />
      );

    default:
      return null;
  }
}

// ─── File input component ─────────────────────────────────────────────────────

function FileInput({ value, onChange }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const files = value ? Array.from(value) : [];

  function mergeFiles(incoming) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    Array.from(incoming).forEach((f) => dt.items.add(f));
    onChange(dt.files);
  }

  function removeFile(idx) {
    const dt = new DataTransfer();
    files.filter((_, i) => i !== idx).forEach((f) => dt.items.add(f));
    onChange(dt.files.length > 0 ? dt.files : null);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) mergeFiles(e.dataTransfer.files);
  }

  return (
    <div className="file-input-wrapper">
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files.length > 0) mergeFiles(e.target.files); }}
      />

      {/* Drop zone */}
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
          {dragging ? "Drop files here" : "Drag & drop files here"}
        </span>
        <span className="file-dropzone-sub">or click to browse</span>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={i} className="file-chip">
              <span className="file-chip-name">{f.name}</span>
              <span className="file-chip-size">
                {f.size < 1024 * 1024
                  ? `${(f.size / 1024).toFixed(0)} KB`
                  : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
              </span>
              <button type="button" className="file-chip-remove" onClick={() => removeFile(i)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function SuccessScreen({ taskName, boardLabel, taskUrl, onReset }) {
  return (
    <div className="success-screen">
      <div className="success-icon">✓</div>
      <h2 className="success-title">Task Created!</h2>
      <p className="success-task-name">"{taskName}"</p>
      <p className="success-subtitle">Your task has been added to the <strong>{boardLabel}</strong> board on Monday.com</p>
      {taskUrl && (
        <a className="btn-monday-link" href={taskUrl} target="_blank" rel="noreferrer">
          View on Monday.com
        </a>
      )}
      <button className="btn-submit" onClick={onReset}>
        Submit Another Task
      </button>
    </div>
  );
}

export default function DynamicForm({ board, users = [], aiResult = null, onAIResultApplied, frequencyOrder = {} }) {
  const DRAFT_KEY = `task_draft_${board.id}`;

  const [task, setTask] = useState(() => initTask(board.fields));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [createdTaskName, setCreatedTaskName] = useState(null);
  const [createdTaskUrl, setCreatedTaskUrl] = useState(null);

  // Draft recovery — check localStorage on mount
  const [hasDraft, setHasDraft] = useState(() => {
    try { return !!localStorage.getItem(`task_draft_${board.id}`); } catch { return false; }
  });
  // Skip autosave on the next task change (used after resets to avoid overwriting with empty state)
  const skipNextSave = useRef(false);

  // Re-init form state when the board changes (tab switch)
  useEffect(() => {
    skipNextSave.current = true;
    setTask(initTask(board.fields));
    setSubmitError(null);
    setCreatedTaskName(null);
    try { setHasDraft(!!localStorage.getItem(`task_draft_${board.id}`)); } catch {}
  }, [board.id]);

  // Autosave draft to localStorage on every meaningful change
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(task)); } catch {}
  }, [task]);

  // Merge AI result into form state when it arrives
  useEffect(() => {
    if (aiResult) {
      setTask((prev) => ({ ...prev, ...aiResult }));
      onAIResultApplied?.();
    }
  }, [aiResult]);

  function setField(key, value) {
    setTask((prev) => ({ ...prev, [key]: value }));
  }

  function restoreDraft() {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setTask(JSON.parse(saved));
    } catch {}
    setHasDraft(false);
  }

  function discardDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setHasDraft(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const missingField = board.fields
      .filter((f) => f.required && isVisible(f, task))
      .find((f) => {
        const val = task[f.key];
        if (Array.isArray(val)) return val.length === 0;
        return !val && val !== 0;
      });
    if (missingField) {
      setSubmitError(`${missingField.label} is required`);
      return;
    }
    const generatedName = buildAutoName(board, task);
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Step 1 — create the item (no update yet; we need the item URL first)
      const { data } = await axios.post("/api/monday/create-item", {
        boardId: board.boardId,
        itemName: generatedName,
        columnValues: buildColumnValues(board.fields, task),
      });
      const itemId  = data?.create_item?.id;
      const itemUrl = data?.create_item?.url ?? null;
      setCreatedTaskUrl(itemUrl);

      // Step 2 — upload files and count how many were attached
      let filesUploaded = 0;
      if (itemId) {
        const fileFields = board.fields.filter(
          (f) => f.type === "file" && f.mondayColumnId && task[f.key]
        );
        for (const field of fileFields) {
          for (const file of Array.from(task[field.key])) {
            const fd = new FormData();
            fd.append("itemId", itemId);
            fd.append("columnId", field.mondayColumnId);
            fd.append("file", file);
            await axios.post("/api/monday/upload-file", fd);
            filesUploaded++;
          }
        }
      }

      // Step 3 — post the update, including a file link when files were uploaded
      if (itemId) {
        const updateBody = buildUpdateBody(
          board.fields,
          task,
          users,
          board.updateTemplate ?? DEFAULT_UPDATE_TEMPLATES[board.id] ?? null,
          filesUploaded > 0 ? itemUrl : null,
        );
        if (updateBody) {
          await axios
            .post("/api/monday/create-update", { itemId, body: updateBody })
            .catch((err) => console.warn("Update post failed (item still created):", err.message));
        }
      }

      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setCreatedTaskName(generatedName);
      skipNextSave.current = true;
      setTask(initTask(board.fields));
    } catch (err) {
      setSubmitError(err.response?.data?.error || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    skipNextSave.current = true;
    setCreatedTaskName(null);
    setCreatedTaskUrl(null);
    setSubmitError(null);
    setTask(initTask(board.fields));
  }

  // ─── Success screen ──────────────────────────────────────────────────────────
  if (createdTaskName) {
    return <SuccessScreen taskName={createdTaskName} boardLabel={board.label} taskUrl={createdTaskUrl} onReset={handleReset} />;
  }

  // ─── Layout pass ─────────────────────────────────────────────────────────────
  const visibleFields = board.fields.filter((f) => isVisible(f, task));
  const renderGroups = visibleFields.map((f) => ({ type: "single", field: f }));

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {hasDraft && (
        <div className="draft-banner">
          <span>You have an unsaved draft for this form.</span>
          <button type="button" className="draft-banner-btn draft-banner-btn--restore" onClick={restoreDraft}>Restore</button>
          <button type="button" className="draft-banner-btn draft-banner-btn--dismiss" onClick={discardDraft}>Discard</button>
        </div>
      )}

      {renderGroups.map((group, idx) => {
        if (group.type === "row") {
          return (
            <div key={idx} className="field-row">
              {group.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
                  {renderInput(f, task, setField, users, frequencyOrder)}
                </Field>
              ))}
            </div>
          );
        }
        return (
          <div key={idx}>
            <Field label={group.field.label} required={group.field.required} hint={group.field.hint}>
              {renderInput(group.field, task, setField, users, frequencyOrder)}
            </Field>
            {group.field.durationEstimator && (
              <InlineDurationEstimator script={task[group.field.key]} />
            )}
          </div>
        );
      })}

      {submitError && <div className="msg-error">{submitError}</div>}

      <button type="submit" className="btn-submit" disabled={submitting}>
        {submitting ? "Creating Task…" : "Create Task on Monday"}
      </button>
    </form>
  );
}
