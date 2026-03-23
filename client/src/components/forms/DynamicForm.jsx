// DynamicForm — renders any board's form from its field config in settings.json.
// Field order, visibility, and grouping are all controlled by the settings file.
// To reorder fields: edit the "fields" array for the board in server/settings.json.
// To add a field: add an entry to that array and map it to a Monday column ID.
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import InlineDurationEstimator from "../InlineDurationEstimator.jsx";

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
  if (!field.showWhen) return true;
  const val = task[field.showWhen.field];
  if (Array.isArray(val)) return val.includes(field.showWhen.includes);
  return val === field.showWhen.includes;
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

// ─── Single field renderer ────────────────────────────────────────────────────

function renderInput(field, task, setField, users) {
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
          options={field.options || []}
          value={value}
          onChange={(v) => setField(field.key, v)}
        />
      );

    case "multiselect":
      return (
        <CustomMultiSelect
          options={field.options || []}
          value={value}
          onChange={(v) => setField(field.key, v)}
        />
      );

    case "people":
      if (!users.length) return <p className="hint">Loading team members…</p>;

      if (field.searchable) {
        return (
          <PeopleSearchSelect
            field={field}
            value={value}
            users={users}
            onChange={(v) => setField(field.key, v)}
          />
        );
      }

      {
        const displayUsers = field.allowedPeople
          ? users.filter((u) =>
              field.allowedPeople.some((name) =>
                u.name.toLowerCase().startsWith(name.toLowerCase())
              )
            )
          : users;
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

    default:
      return null;
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

function SuccessScreen({ taskName, boardLabel, onReset }) {
  return (
    <div className="success-screen">
      <div className="success-icon">✓</div>
      <h2 className="success-title">Task Created!</h2>
      <p className="success-task-name">"{taskName}"</p>
      <p className="success-subtitle">Your task has been added to the <strong>{boardLabel}</strong> board on Monday.com</p>
      <button className="btn-submit" onClick={onReset}>
        Submit Another Task
      </button>
    </div>
  );
}

export default function DynamicForm({ board, users = [], aiResult = null, onAIResultApplied }) {
  const [task, setTask] = useState(() => initTask(board.fields));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [createdTaskName, setCreatedTaskName] = useState(null);

  // Re-init form state when the board changes (tab switch)
  useEffect(() => {
    setTask(initTask(board.fields));
    setSubmitError(null);
    setCreatedTaskName(null);
  }, [board.id]);

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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!task.taskName?.trim()) {
      setSubmitError("Task Name is required");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const submittedName = task.taskName;
    try {
      await axios.post("/api/monday/create-item", {
        boardId: board.boardId,
        itemName: task.taskName,
        columnValues: buildColumnValues(board.fields, task),
      });
      setCreatedTaskName(submittedName);
      setTask(initTask(board.fields));
    } catch (err) {
      setSubmitError(err.response?.data?.error || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setCreatedTaskName(null);
    setSubmitError(null);
    setTask(initTask(board.fields));
  }

  // ─── Success screen ──────────────────────────────────────────────────────────
  if (createdTaskName) {
    return <SuccessScreen taskName={createdTaskName} boardLabel={board.label} onReset={handleReset} />;
  }

  // ─── Layout pass: group consecutive half-width fields into rows ─────────────
  // Each entry is either { type: "single", field } or { type: "row", fields: [a, b] }
  // Section dividers are attached to the first field of a new section.
  const visibleFields = board.fields.filter((f) => isVisible(f, task));

  const renderGroups = visibleFields.map((f) => ({ type: "single", field: f, section: f.section }));

  // ─── Render ─────────────────────────────────────────────────────────────────
  let currentSection = null;

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      {renderGroups.map((group, idx) => {
        const newSection = group.section && group.section !== currentSection;
        if (newSection) currentSection = group.section;

        return (
          <div key={idx}>
            {newSection && (
              <div className="form-section">
                <p className="form-section-label">{group.section}</p>
              </div>
            )}

            <>
              <Field label={group.field.label} required={group.field.required} hint={group.field.hint}>
                {renderInput(group.field, task, setField, users)}
              </Field>
              {group.field.durationEstimator && (
                <InlineDurationEstimator script={task[group.field.key]} />
              )}
            </>
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
