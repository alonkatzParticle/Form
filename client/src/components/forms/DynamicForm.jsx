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
  // showWhen: can be a single condition object OR an array of conditions (all must pass — AND logic)
  if (field.showWhen) {
    const conditions = Array.isArray(field.showWhen) ? field.showWhen : [field.showWhen];
    return conditions.every((cond) => {
      const val = task[cond.field];
      if (cond.excludes !== undefined) {
        if (Array.isArray(val)) return !val.includes(cond.excludes);
        return val !== cond.excludes;
      }
      if (Array.isArray(val)) return val.includes(cond.includes);
      return val === cond.includes;
    });
  }
  if (!field.show_if) return true;
  return true;
}

// ─── Auto name builder ────────────────────────────────────────────────────────

// Title-case a string: each word capitalised, rest lowercase.
function toTitleCase(str) {
  return str.trim().replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function buildAutoName(board, task) {
  if (!board.autoName) return task.taskName || "";
  return board.autoName.segments
    .map((seg) => {
      // Skip segment entirely if the field is hidden by showWhen conditions
      const fieldDef = board.fields?.find((f) => f.key === seg.field);
      if (fieldDef && !isVisible(fieldDef, task)) return null;
      let val = task[seg.field];
      if (!val && seg.fallback) val = task[seg.fallback];
      if (!val) return null;
      if (seg.onlyWhenField && task[seg.onlyWhenField] !== seg.onlyWhenValue) return null;
      if (seg.onlyValues && !seg.onlyValues.includes(val)) return null;
      if (seg.skipValues && seg.skipValues.includes(val)) return null;
      // requireFieldEmpty: skip this segment when ANY of the listed fields has a non-empty, non-None value.
      // Accepts a single string OR an array of field keys (OR semantics across the array).
      if (seg.requireFieldEmpty) {
        const keys = Array.isArray(seg.requireFieldEmpty) ? seg.requireFieldEmpty : [seg.requireFieldEmpty];
        const blocked = keys.some((k) => { const g = task[k]; return g && g !== "None" && g !== ""; });
        if (blocked) return null;
      }
      // aliasWhenValue: if the field value matches a key, use a different field's text (title-cased)
      if (seg.aliasWhenValue && seg.aliasWhenValue[val]) {
        const aliasVal = task[seg.aliasWhenValue[val]];
        if (aliasVal) return toTitleCase(String(aliasVal));
        return null; // alias key set but text field empty — skip segment
      }
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
    // Preserve newlines for multi-line text fields
    if (field.type === "textarea" || field.type === "text") {
      return String(val).replace(/\n/g, "<br>");
    }
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
      // Add data-field for single-key blocks so callers can locate them post-processing
      const dataAttr = keys.length === 1 ? ` data-field="${keys[0]}"` : "";
      return `<${tag}${attrs}${dataAttr}>${filled}</${tag}>`;
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

// ─── Script color-coder ───────────────────────────────────────────────────────
// Parses a structured production script (SCRIPT (VO) / VISUALS / SOUND blocks)
// and wraps each label in a bold colored element for the brief HTML.
// Uses <font color=""> instead of style="color:..." because Monday strips inline styles.
function colorizeScript(rawText) {
  if (!rawText?.trim()) return "";
  const LABELS = [
    ["SCRIPT (VO)",    "#1d4ed8"],  // blue
    ["ON-SCREEN TEXT", "#c2410c"],  // orange
    ["ON-SCREEN",      "#c2410c"],  // orange
    ["VISUALS",        "#6d28d9"],  // purple
    ["SOUND",          "#0e7490"],  // teal
  ];
  const lines = rawText.split("\n");
  const parts = [];
  let prevWasEmpty = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      // Blank line between sections → visible spacer (works in Monday too)
      if (!prevWasEmpty && parts.length > 0) parts.push("<p><br></p>");
      prevWasEmpty = true;
      continue;
    }
    prevWasEmpty = false;

    // Time-coded section header e.g. "0–4s — THE HOOK"
    if (/^\d+[–—-]\d+s/.test(t)) {
      parts.push(`<p><strong>${t}</strong></p>`);
      continue;
    }

    let matched = false;
    for (const [label, color] of LABELS) {
      if (t.startsWith(label + ":")) {
        const content = t.slice(label.length + 1).trim();
        // <font color=""> is supported by Monday; inline style is stripped
        parts.push(`<p><font color="${color}"><strong>${label}:</strong></font> ${content}</p>`);
        matched = true;
        break;
      }
    }
    if (!matched) parts.push(`<p>${t}</p>`);
  }
  return parts.join("");
}

// ─── Hybrid Brief Generator ───────────────────────────────────────────────────
// Builds the brief as blocks:
//   • Short fields  → single compact pipe-separated metadata line
//   • Textarea/hooks → each gets an <h3> heading + verbatim content
//   • scriptMessage → color-coded SCRIPT (VO) / VISUALS / SOUND blocks

export async function generateBriefHtml(board, task, users) {
  // ── Duration estimate ──────────────────────────────────────────────────────
  const isMarketingMedia = board.id === "video" && task.department === "Marketing/Media" && task.type !== "TV";
  const scriptField = isMarketingMedia ? board.fields.find((f) => f.durationEstimator) : null;
  const currentScript = scriptField ? task[scriptField.key] : null;
  // If the script uses the structured format (SCRIPT (VO): labels), extract only
  // the spoken VO text so the syllable counter isn't inflated by VISUALS/SOUND lines.
  const voOnlyScript = (() => {
    if (!currentScript) return null;
    const voLines = currentScript.split("\n")
      .filter((l) => l.trim().startsWith("SCRIPT (VO):"))
      .map((l) => l.trim().slice("SCRIPT (VO):".length).trim().replace(/^["']|["']$/g, ""));
    return voLines.length > 0 ? voLines.join(" ") : currentScript;
  })();
  const finalEstimate = estimateDuration(voOnlyScript);

  // ── Resolve a field's display value ───────────────────────────────────────
  function resolveValue(f) {
    if (!isVisible(f, task)) return null;
    const val = task[f.key];
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) return null;
    if (f.type === "people") {
      return val.map((id) => users.find((u) => String(u.id) === String(id))?.name ?? id).join(", ");
    }
    if (Array.isArray(val)) return val.join(", ");
    return String(val);
  }

  // ── Split fields into metadata vs creative sections ────────────────────────
  const metaItems = [];      // short fields → compact header line
  const sections  = [];      // textarea/hooks → each gets h3 + content block

  for (const f of board.fields) {
    if (f.type === "file" || f.mondayValueType === "item_name" || f.skipBrief) continue;
    if (!isVisible(f, task)) continue;
    const val = task[f.key];
    if (val === null || val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) continue;

    if (f.type === "textarea") {
      if (f.key === "scriptMessage") {
        // Use structured color-coded rendering for production scripts
        sections.push(`<h3>${f.label}</h3>${colorizeScript(String(val))}`);
      } else {
        const content = String(val).replace(/\n/g, "<br>");
        sections.push(`<h3>${f.label}</h3><p data-field="${f.key}">${content}</p>`);
      }
    } else if (f.type === "hooks") {
      const filled = (Array.isArray(val) ? val : []).filter(Boolean);
      if (filled.length) {
        sections.push(
          `<h3>${f.label}</h3>${filled.map((h, i) => `<p><b>${i + 1}.</b> ${h}</p>`).join("")}`
        );
      }
    } else {
      const display = resolveValue(f);
      if (display) metaItems.push(`<b>${f.label}:</b> ${display}`);
    }
  }

  // ── Assemble brief HTML ────────────────────────────────────────────────────
  const metaLine = metaItems.length
    ? `<p>${metaItems.join(" &nbsp;|&nbsp; ")}</p>`
    : "";

  let html = metaLine + sections.join("");

  // ── Inject duration into the metadata line ─────────────────────────────────
  if (finalEstimate && !isNaN(finalEstimate)) {
    const s = parseInt(finalEstimate, 10);
    const durationText = `${Math.max(0, s - 2)}\u2013${s + 2} sec`;
    if (!html.includes("Duration")) {
      const idx = html.indexOf("</p>");
      if (idx !== -1) {
        html = html.slice(0, idx) + ` &nbsp;|&nbsp; <b>Est. Duration:</b> ${durationText}` + html.slice(idx);
      }
    }
  }


  return { html, finalEstimate };
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
    // Monday dropdown column — single string value sent as a one-element labels array
    case "dropdown":     return { labels: Array.isArray(value) ? value : [value] };
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
    select:           "status",
    creatable_select: "dropdown",
    multiselect:      "multi_select",
    date:             "date",
    number:           "number",
    textarea:         "long_text",
    text:             "long_text",
    url:              "link",
    people:           "people",
    hooks:            "short_text",
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
    // Skip hidden fields — their stale values must not reach Monday
    if (!isVisible(field, buildTask)) continue;
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

// ─── Creatable single-select dropdown ────────────────────────────────────────
// Like CustomSelect but has a '+ Add new…' entry. When the user confirms a new
// value it: (a) calls onChange with that value, (b) POSTs to the server to
// persist the option in settings.json so it appears next session.

function CreatableSelect({ field, value, onChange }) {
  const [adding,       setAdding]      = useState(false);
  const [draft,        setDraft]       = useState("");
  const [open,         setOpen]        = useState(false);
  const [localOptions, setLocalOptions] = useState(field.options || []);
  const inputRef     = useRef(null);
  const containerRef = useRef(null);

  // Keep localOptions in sync if field.options changes (e.g. after a settings reload)
  useEffect(() => { setLocalOptions(field.options || []); }, [field.options]);

  useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  useEffect(() => {
    function onOut(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  async function confirmNew() {
    const val = draft.trim();
    if (!val) return;
    // Immediately add to local options so it's selectable this session
    setLocalOptions((prev) => prev.includes(val) ? prev : [...prev, val]);
    onChange(val);
    setAdding(false); setOpen(false); setDraft("");
    try { await axios.post("/api/monday/add-campaign-option", { fieldKey: field.key, option: val }); }
    catch (e) { console.warn("[CreatableSelect] persist failed:", e.message); }
  }

  const options = localOptions;

  if (adding) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={inputRef} type="text" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmNew(); } if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
          placeholder="Campaign name…"
          style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14 }}
        />
        <button type="button" onClick={confirmNew}
          style={{ padding: "6px 14px", borderRadius: 8, background: "var(--purple)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>
          Add
        </button>
        <button type="button" onClick={() => { setAdding(false); setDraft(""); }}
          style={{ padding: "6px 10px", borderRadius: 8, background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="people-container" style={{ position: "relative" }}>
      <div className="people-input dropdown-search-input" onClick={() => setOpen((o) => !o)}
        style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>{value || <span style={{ color: "var(--text-muted)" }}>Select or add…</span>}</span>
        <span style={{ opacity: 0.5, fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div className="people-dropdown" style={{ maxHeight: 220, overflowY: "auto" }}>
          {options.map((opt) => (
            <div key={opt} className={`people-option${value === opt ? " selected" : ""}`}
              onClick={() => { onChange(opt); setOpen(false); }}>{opt}</div>
          ))}
          <div className="people-option"
            style={{ color: "var(--purple)", fontWeight: 500, borderTop: options.length ? "1px solid var(--border)" : "none", paddingTop: options.length ? 6 : 0 }}
            onClick={() => { setOpen(false); setAdding(true); }}>
            + Add new…
          </div>
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

export function renderInput(field, task, setField, users, frequencyOrder = {}, onRefreshProducts = null, isRefreshingProducts = false) {
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

    case "select": {
      const isProductField = field.key === "product" || field.key === "productBundle";
      const selectEl = (
        <CustomSelect
          options={sortByFrequency(field.options || [], frequencyOrder[field.key])}
          value={value}
          onChange={(v) => setField(field.key, v)}
        />
      );
      if (isProductField && onRefreshProducts) {
        return (
          <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>{selectEl}</div>
            <button
              type="button"
              title="Sync product list from Monday"
              onClick={onRefreshProducts}
              disabled={isRefreshingProducts}
              className="product-refresh-btn"
            >
              {isRefreshingProducts
                ? <span className="product-refresh-spinner" />
                : "↻"}
            </button>
          </div>
        );
      }
      return selectEl;
    }

    case "creatable_select":
      return (
        <CreatableSelect
          field={field}
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

export default function DynamicForm({ board, users = [], aiResult = null, onAIResultApplied, wednesdayResult = null, onWednesdayResultApplied, onTaskChange, onDraftDiscarded, frequencyOrder = {}, onReview, hiddenFieldKeys = [], step1Values = null, onRefreshProducts = null, isRefreshingProducts = false }) {
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

  // Sanitize AI/Wednesday result — ensure multiselect and people fields always stay arrays,
  // and validate dropdown values against the options list.
  // NOTE: step1 protection is handled separately in each caller, not here.
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

  // Collect the keys of all step1 fields for quick lookup
  const step1Keys = board.fields.filter(f => f.step1).map(f => f.key);

  // Returns a copy of `merged` with all step1 fields restored to their values in `prev`.
  // Used after applying AI/Wednesday results to ensure user-chosen values are never clobbered.
  function preserveStep1(merged, prev) {
    const out = { ...merged };
    for (const key of step1Keys) {
      if (prev[key] !== undefined) out[key] = prev[key];
    }
    return out;
  }

  // Merge AI result into form state when it arrives, and autosave it.
  // Step1 fields are explicitly restored after merge so AI can never clobber them.
  useEffect(() => {
    if (aiResult) {
      const { _estimatedDuration, ...fields } = aiResult;
      if (_estimatedDuration !== undefined) setAiDuration(_estimatedDuration);
      setTask((prev) => {
        const updated = preserveStep1({ ...prev, ...sanitizeResult(fields, prev) }, prev);
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
      onAIResultApplied?.();
    }
  }, [aiResult]);

  // Apply Wednesday's field changes — step1 fields are restored after merge.
  useEffect(() => {
    if (wednesdayResult) {
      setTask((prev) => {
        const updated = preserveStep1({ ...prev, ...sanitizeResult(wednesdayResult, prev) }, prev);
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
      onWednesdayResultApplied?.();
    }
  }, [wednesdayResult]);

  // Apply Step 1 context field values whenever they change.
  // Applied directly (no sanitizeResult) — these are always valid user-selected values.
  useEffect(() => {
    if (!step1Values || Object.keys(step1Values).length === 0) return;
    setTask((prev) => {
      const merged = { ...prev, ...step1Values };
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
    // Safety-merge step1Values into the task snapshot so step1 fields are
    // always present even if the state sync had a timing gap.
    const fullTask = step1Values ? { ...task, ...step1Values } : { ...task };

    const missingField = board.fields
      .filter((f) => f.required && isVisible(f, fullTask, hiddenFieldKeys))
      .find((f) => {
        const val = fullTask[f.key];
        if (Array.isArray(val)) return val.length === 0;
        return !val && val !== 0;
      });
    if (missingField) {
      setSubmitError(`${missingField.label} is required`);
      return;
    }
    setSubmitError(null);
    const itemName = buildAutoName(board, fullTask);

    setGeneratingBrief(true);
    try {
      const { html: briefHtml, finalEstimate } = await generateBriefHtml(board, fullTask, users);
      const taskWithEstimate = finalEstimate
        ? { ...fullTask, _elevenLabsEstimate: finalEstimate }
        : fullTask;
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
        onRefreshProducts={onRefreshProducts}
        isRefreshingProducts={isRefreshingProducts}
      />
    </form>
  );
}
