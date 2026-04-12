// DynamicForm — renders any board's form from its field config in settings.json.
// Field order, visibility, and grouping are all controlled by the settings file.
// To reorder fields: edit the "fields" array for the board in server/settings.json.
// To add a field: add an entry to that array and map it to a Monday column ID.
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import InlineDurationEstimator from "../InlineDurationEstimator.jsx";
import TaskFormSections from "./TaskFormSections.jsx";
import { DEFAULT_UPDATE_TEMPLATES } from "../../updateTemplateDefaults.js";
import { estimateDuration, formatDurationRange } from "../../utils/durationEstimate.js";


// ─── Field helpers ────────────────────────────────────────────────────────────

export function Field({ label, required, hint, children }) {
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

export function isVisible(field, task, hiddenKeys = []) {
  if (field.hidden) return false;  // hidden fields never render — but still submit to Monday
  if (hiddenKeys.includes(field.key)) return false;
  // showWhen: only display this field when another field has the specified value
  if (field.showWhen) {
    const val = task[field.showWhen.field];
    if (Array.isArray(val)) return val.includes(field.showWhen.includes);
    return val === field.showWhen.includes;
  }
  if (!field.show_if) return true;
  return true;
}

// ─── Auto name builder ────────────────────────────────────────────────────────

export function buildAutoName(board, task) {
  if (!board.autoName) return task.taskName || "";
  return board.autoName.segments
    .map((seg) => {
      let val = task[seg.field];
      if (!val && seg.fallback) val = task[seg.fallback];
      if (!val) return null;
      if (seg.onlyWhenField && task[seg.onlyWhenField] !== seg.onlyWhenValue) return null;
      if (seg.onlyValues && !seg.onlyValues.includes(val)) return null;
      if (seg.skipValues && seg.skipValues.includes(val)) return null;
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

export function buildUpdateBody(fields, task, users, updateTemplate, fileUrl = null) {
  function getVal(key) {
    const field = fields.find((f) => f.key === key);
    if (!field || !isVisible(field, task)) return null;
    const val = task[key];
    if (val === null || val === undefined || val === "") return null;
    if (Array.isArray(val) && val.length === 0) return null;
    // hooks: render as numbered list HTML
    if (field.type === "hooks") {
      return val.filter(Boolean).map((h, i) => `<p><b>${i + 1}.</b> ${h}</p>`).join("");
    }
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

// ─── AI Brief Generator Utility ───────────────────────────────────────────────

export async function generateBriefHtml(board, task, users) {
  const formValues = board.fields
    .filter((f) => isVisible(f, task) && f.type !== "file" && f.mondayValueType !== "item_name")
    .map((f) => {
      const val = task[f.key];
      if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) return null;
      let display;
      if (f.type === "people") {
        display = val.map((id) => users.find((u) => String(u.id) === String(id))?.name ?? id).join(", ");
      } else if (f.type === "hooks" && Array.isArray(val)) {
        const filled = val.filter(Boolean);
        if (filled.length === 0) return null;
        display = filled.map((h, i) => `${i + 1}. ${h}`).join("\n");
      } else if (Array.isArray(val)) {
        display = val.join(", ");
      } else {
        display = String(val);
      }
      return { label: f.label, value: display };
    })
    .filter(Boolean);

  // ── Duration Estimation (syllable-based) ──
  // ELEVENLABS_DISABLED: ElevenLabs call commented out — restore when credits are available.
  // To re-enable: uncomment the axios block below and remove the estimateDuration() call.
  const scriptField = board.fields.find((f) => f.durationEstimator);
  const currentScript = scriptField ? task[scriptField.key] : null;

  // ELEVENLABS_DISABLED — uncomment to restore TTS-based estimation:
  // let finalEstimate = task._elevenLabsEstimate;
  // if (currentScript && currentScript.trim().length > 0) {
  //   if (!finalEstimate || task._estimatedScript !== currentScript) {
  //     try {
  //       const { data } = await axios.post("/api/elevenlabs/duration", { script: currentScript });
  //       finalEstimate = data.estimatedSeconds + 3;
  //     } catch { finalEstimate = null; }
  //   }
  // }

  // Syllable-based math estimation (always runs, instant, no API needed)
  const finalEstimate = estimateDuration(currentScript);

  // Push the estimate into formValues so the AI brief receives it
  if (finalEstimate && !isNaN(finalEstimate)) {
    const s = parseInt(finalEstimate, 10);
    formValues.push({
      label: "Estimated Duration",
      value: `${Math.max(0, s - 2)}\u2013${s + 2} seconds`
    });
  }

  // Safety net: inject duration directly into HTML even if AI skips the field
  function injectDurationIntoHtml(html, estimateSeconds) {
    if (!estimateSeconds || isNaN(estimateSeconds)) return html;
    const s = parseInt(estimateSeconds, 10);
    const durationText = `${Math.max(0, s - 2)}\u2013${s + 2} sec`;
    if (html.includes("Duration")) return html; // already present in any form — skip injection
    const idx = html.indexOf("</p>");
    if (idx === -1) return html + `<p><b>Est. Duration:</b> ${durationText}</p>`;
    return html.slice(0, idx) + ` &nbsp;|&nbsp; <b>Est. Duration:</b> ${durationText}` + html.slice(idx);
  }

  try {
    const { data } = await axios.post("/api/ai/brief", { formValues, boardType: board.id });
    const html = injectDurationIntoHtml(data.html, finalEstimate);
    return { html, finalEstimate };
  } catch {
    const html = injectDurationIntoHtml(
      buildUpdateBody(board.fields, task, users, board.updateTemplate ?? DEFAULT_UPDATE_TEMPLATES[board.id] ?? null),
      finalEstimate
    );
    return { html, finalEstimate };
  }
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
    case "file":      return null;
    case "status": {
      if (field.options && !field.options.includes(value)) return null;
      // If the field stores explicit Monday indices, send by index to avoid
      // deactivated-label collisions (e.g. two "TV" entries where one is archived).
      if (field.mondayOptionIndices && field.mondayOptionIndices[value] !== undefined) {
        return { index: field.mondayOptionIndices[value] };
      }
      return { label: value };
    }
    case "multi_select": return { labels: value };
    case "date":      return { date: value };
    case "number":    return String(value);
    case "long_text": return { text: value };
    // hooks: send only the first hook to Monday's short_text column
    case "short_text": {
      if (field.type === "hooks") {
        const first = Array.isArray(value) ? value.filter(Boolean)[0] : null;
        return first || null;
      }
      return value;
    }
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
    hooks:       "short_text",
  };
  return map[fieldType] ?? null;
}

// ─── Column value builder ─────────────────────────────────────────────────────

export function buildColumnValues(fields, task) {
  const vals = {};
  
  // Inject the duration estimate cleanly so it maps to the hidden Monday column 
  const buildTask = { ...task };
  if (buildTask._elevenLabsEstimate && !isNaN(buildTask._elevenLabsEstimate)) {
    buildTask.targetDuration = Math.round(buildTask._elevenLabsEstimate);
  }

  for (const field of fields) {
    if (!field.mondayColumnId) continue;
    const mondayVal = toMondayValue(field, buildTask[field.key]);
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
    if (field.type === "multiselect" || field.type === "people" || field.type === "hooks") {
      task[field.key] = [];
    } else if (field.type === "number") {
      task[field.key] = null;
    } else if (field.type === "file") {
      task[field.key] = null;
    } else {
      task[field.key] = field.defaultValue ?? "";
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

function CustomMultiSelect({ options, value = [], onChange }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const safeValue = Array.isArray(value) ? value : [];

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
    onChange(safeValue.includes(option) ? safeValue.filter((v) => v !== option) : [...safeValue, option]);
  }

  return (
    <div className="people-search" ref={containerRef}>
      <div className="people-search-box" onClick={() => setIsOpen(true)}>
        {safeValue.map((o) => (
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
          placeholder={safeValue.length ? "" : "Select options…"}
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
                className={`people-option${safeValue.includes(o) ? " selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
              >
                <span className="people-option-check">{safeValue.includes(o) ? "✓" : ""}</span>
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

function PeopleSearchSelect({ field, value = [], users, onChange }) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const safeValue = Array.isArray(value) ? value : [];

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

  const selectedUsers = users.filter((u) => safeValue.includes(u.id));

  function toggle(id) {
    onChange(safeValue.includes(id) ? safeValue.filter((v) => v !== id) : [...safeValue, id]);
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

export function renderInput(field, task, setField, users, frequencyOrder = {}) {
  let value = task[field.key];
  if (value === undefined && ["multiselect", "people", "file", "hooks"].includes(field.type)) {
    value = [];
  }

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

    case "hooks":
      return (
        <HooksInput
          value={Array.isArray(value) ? value : []}
          onChange={(v) => setField(field.key, v)}
        />
      );

    default:
      return null;
  }
}

// ─── Hooks input component ────────────────────────────────────────────────────
// Renders one text input per hook, with add/remove controls.
// Starts with 1 empty row; "Add another hook" reveals the next (max 5).

const MAX_HOOKS = 5;

function HooksInput({ value, onChange }) {
  // Ensure we always have at least one slot to type into
  const hooks = value.length > 0 ? value : [""];

  function setHook(idx, text) {
    const next = [...hooks];
    next[idx] = text;
    onChange(next);
  }

  function addHook() {
    if (hooks.length < MAX_HOOKS) onChange([...hooks, ""]);
  }

  function removeHook(idx) {
    const next = hooks.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : [""]);
  }

  return (
    <div className="hooks-input">
      {hooks.map((hook, idx) => (
        <div key={idx} className="hook-row">
          <span className="hook-number">{idx + 1}.</span>
          <input
            type="text"
            className="hook-text-input"
            value={hook}
            onChange={(e) => setHook(idx, e.target.value)}
            placeholder={`Hook ${idx + 1} — opening line…`}
          />
          {hooks.length > 1 && (
            <button
              type="button"
              className="hook-remove-btn"
              onClick={() => removeHook(idx)}
              aria-label="Remove hook"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {hooks.length < MAX_HOOKS && (
        <button type="button" className="hook-add-btn" onClick={addHook}>
          + Add another hook
        </button>
      )}
    </div>
  );
}

// ─── File input component ─────────────────────────────────────────────────────

function FileInput({ value, onChange }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const files = value ? Array.from(value) : [];

  // Nano Banana 2 image generation state
  const [genOpen, setGenOpen] = useState(false);
  const [genPrompt, setGenPrompt] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genPreview, setGenPreview] = useState(null); // { base64, mimeType, name }

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

  // Convert base64 → File object and add to the list
  function addGeneratedImage(base64, mimeType, name) {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: mimeType });
    const ext = mimeType.split("/")[1] || "png";
    const file = new File([blob], name || `generated-image.${ext}`, { type: mimeType });
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    dt.items.add(file);
    onChange(dt.files);
  }

  async function handleGenerate(e) {
    if (e?.preventDefault) e.preventDefault();
    if (!genPrompt.trim()) return;
    setGenLoading(true);
    setGenError(null);
    setGenPreview(null);
    try {
      const res = await fetch("/api/ai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: genPrompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      const ext = data.mimeType?.split("/")[1] || "png";
      setGenPreview({ base64: data.base64, mimeType: data.mimeType, name: `generated-${Date.now()}.${ext}` });
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  }

  function handleAddToFiles() {
    if (!genPreview) return;
    addGeneratedImage(genPreview.base64, genPreview.mimeType, genPreview.name);
    setGenOpen(false);
    setGenPrompt("");
    setGenPreview(null);
    setGenError(null);
  }

  function handleCancelGen() {
    setGenOpen(false);
    setGenPrompt("");
    setGenPreview(null);
    setGenError(null);
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

      {/* Nano Banana 2 generate button */}
      {!genOpen && (
        <button
          type="button"
          className="nb2-trigger-btn"
          onClick={() => setGenOpen(true)}
        >
          <span className="nb2-trigger-icon">✨</span>
          Generate Image with Nano Banana 2
        </button>
      )}

      {/* Inline generator panel */}
      {genOpen && (
        <div className="nb2-panel">
          <div className="nb2-panel-header">
            <span className="nb2-panel-title">
              <span className="nb2-sparkle">✨</span> Nano Banana 2
            </span>
            <button type="button" className="nb2-close-btn" onClick={handleCancelGen}>✕</button>
          </div>

          <div className="nb2-form">
            <textarea
              className="nb2-prompt-input"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !genLoading && genPrompt.trim()) {
                  handleGenerate(e);
                }
              }}
              placeholder="Describe the image you want to generate… (⌘↵ to generate)"
              rows={3}
              disabled={genLoading}
            />
            <button
              type="button"
              className="nb2-generate-btn"
              disabled={genLoading || !genPrompt.trim()}
              onClick={handleGenerate}
            >
              {genLoading
                ? <><span className="nb2-spinner" /> Generating…</>
                : "Generate →"}
            </button>
          </div>


          {genError && <p className="nb2-error">{genError}</p>}

          {genPreview && (
            <div className="nb2-preview">
              <img
                src={`data:${genPreview.mimeType};base64,${genPreview.base64}`}
                alt="Generated"
                className="nb2-preview-img"
              />
              <div className="nb2-preview-actions">
                <button type="button" className="nb2-add-btn" onClick={handleAddToFiles}>
                  ＋ Add to Files
                </button>
                <button type="button" className="nb2-regen-btn" onClick={handleGenerate} disabled={genLoading}>
                  ↩ Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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

export default function DynamicForm({ board, users = [], aiResult = null, onAIResultApplied, wednesdayResult = null, onWednesdayResultApplied, onTaskChange, onDraftDiscarded, frequencyOrder = {}, onReview, hiddenFieldKeys = [], step1Values = null }) {
  const DRAFT_KEY = `task_draft_${board.id}`;

  // On mount: immediately restore from localStorage draft if one exists.
  // This ensures a page refresh re-populates the form automatically.
  const [task, setTask] = useState(() => {
    try {
      const saved = localStorage.getItem(`task_draft_${board.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge saved values onto blank defaults so any new fields added since saving
        // still get their proper defaults rather than being undefined.
        return { ...initTask(board.fields), ...parsed };
      }
    } catch {}
    return initTask(board.fields);
  });
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [aiDuration, setAiDuration] = useState(null);

  // Draft banner: shown only if a draft exists BUT the form initialised with empty defaults
  // (i.e. the saved JSON failed to parse). In normal operation the form auto-restores above.
  const [hasDraft, setHasDraft] = useState(false);

  // Re-init form state when the board changes (tab switch)
  // Uses a ref to track board.id so we can skip the initial mount run
  const prevBoardId = useRef(board.id);
  useEffect(() => {
    if (prevBoardId.current === board.id) return;
    prevBoardId.current = board.id;
    // Try restoring a draft for the newly selected board, else start fresh
    try {
      const saved = localStorage.getItem(`task_draft_${board.id}`);
      if (saved) {
        setTask({ ...initTask(board.fields), ...JSON.parse(saved) });
        return;
      }
    } catch {}
    setTask(initTask(board.fields));
    setSubmitError(null);
  }, [board.id]);

  // Sanitize AI/Wednesday result — ensure multiselect and people fields always stay arrays.
  // The AI can return null, "", or a string for these fields, which would crash .map() in the UI.
  function sanitizeResult(result, prev) {
    const sanitized = { ...result };
    for (const field of board.fields) {
      // Arrays must stay arrays
      if (field.type === "multiselect" || field.type === "people" || field.type === "hooks") {
        if (!Array.isArray(sanitized[field.key])) {
          sanitized[field.key] = prev[field.key];
        }
      }
      // Dropdown fields: validate against options, strip "Particle " prefix if needed
      if (field.options && sanitized[field.key] !== undefined) {
        const raw = sanitized[field.key];
        if (raw && typeof raw === "string" && !field.options.includes(raw)) {
          const stripped = raw.replace(/^Particle\s+/i, "");
          sanitized[field.key] = field.options.includes(stripped) ? stripped : "";
        }
      }
    }
    return sanitized;
  }

  // Merge AI result into form state when it arrives, and autosave it
  useEffect(() => {
    if (aiResult) {
      // Extract and clear the server-side duration estimate before merging into form state
      const { _estimatedDuration, ...fields } = aiResult;
      if (_estimatedDuration !== undefined) setAiDuration(_estimatedDuration);
      setTask((prev) => {
        const updated = { ...prev, ...sanitizeResult(fields, prev) };
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
      onAIResultApplied?.();
    }
  }, [aiResult]);

  // Apply Wednesday's field changes (selective update)
  useEffect(() => {
    if (wednesdayResult) {
      setTask((prev) => {
        const updated = { ...prev, ...sanitizeResult(wednesdayResult, prev) };
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
      onWednesdayResultApplied?.();
    }
  }, [wednesdayResult]);

  // Apply Step 1 context field values whenever they change
  useEffect(() => {
    if (!step1Values || Object.keys(step1Values).length === 0) return;
    setTask((prev) => {
      const merged = { ...prev, ...sanitizeResult(step1Values, prev) };
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, [step1Values]);

  // Notify Wednesday of form state changes
  useEffect(() => {
    onTaskChange?.(task);
  }, [task]);

  // Autosave happens directly in setField — no effect needed, no timing issues
  function setField(key, value) {
    const newTask = (prev) => {
      const updated = { ...prev, [key]: value };
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    };
    setTask(newTask);
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
    onDraftDiscarded?.();
  }

  async function handleReview(e) {
    e.preventDefault();
    const missingField = board.fields
      .filter((f) => f.required && isVisible(f, task, hiddenFieldKeys))
      .find((f) => {
        const val = task[f.key];
        if (Array.isArray(val)) return val.length === 0;
        return !val && val !== 0;
      });
    if (missingField) {
      setSubmitError(`${missingField.label} is required`);
      return;
    }
    setSubmitError(null);
    const itemName = buildAutoName(board, task);

    setGeneratingBrief(true);
    try {
      const { html: briefHtml, finalEstimate } = await generateBriefHtml(board, task, users);
      const taskWithEstimate = finalEstimate
        ? { ...task, _elevenLabsEstimate: finalEstimate }
        : task;
      const columnValues = buildColumnValues(board.fields, taskWithEstimate);
      onReview({ task: taskWithEstimate, itemName, columnValues, briefHtml });
    } finally {
      setGeneratingBrief(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  const footer = (
    <>
      {submitError && <div className="msg-error">{submitError}</div>}
      {onReview && (
        <button type="submit" className="btn-submit" disabled={generatingBrief}>
          {generatingBrief && <span className="btn-spinner" style={{ borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#fff" }} />}
          {generatingBrief ? "Generating Brief…" : "Review Brief →"}
        </button>
      )}
    </>
  );

  return (
    <form onSubmit={handleReview}>
      {hasDraft && (
        <div className="draft-banner">
          <span>You have an unsaved draft for this form.</span>
          <button type="button" className="draft-banner-btn draft-banner-btn--restore" onClick={restoreDraft}>Restore</button>
          <button type="button" className="draft-banner-btn draft-banner-btn--dismiss" onClick={discardDraft}>Discard</button>
        </div>
      )}
      <TaskFormSections
        boardFields={board.fields}
        task={task}
        onChange={setField}
        users={users}
        frequencyOrder={frequencyOrder}
        hiddenFieldKeys={hiddenFieldKeys}
        aiDuration={aiDuration}
        footer={footer}
      />
    </form>
  );
}
