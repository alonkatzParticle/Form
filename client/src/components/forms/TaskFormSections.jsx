// TaskFormSections — shared field-rendering component.
// Used by DynamicForm (home form), PendingPage, and ReviewPage so the
// sectionHeader multi-card layout, showWhen visibility, and InlineDurationEstimator
// are identical everywhere without duplication.
//
// Props:
//   boardFields     — full field definition array from settings.json
//   task            — current task state object
//   onChange(k, v)  — called with (fieldKey, newValue) on any change
//   users           — array of Monday users for people fields
//   frequencyOrder  — optional people-sort map
//   hiddenFieldKeys — keys hidden from rendering (e.g. step1 context fields)
//   skipTypes       — field.type values to skip (e.g. ['file'] in review/pending)
//   skipMondayTypes — field.mondayValueType values to skip (e.g. ['item_name'])
//   aiDuration      — autoResult passed to InlineDurationEstimator
//   footer          — optional ReactNode rendered at the bottom of the last card

import { Field, renderInput, isVisible } from "./DynamicForm.jsx";
import InlineDurationEstimator from "../InlineDurationEstimator.jsx";

export default function TaskFormSections({
  boardFields = [],
  task = {},
  onChange,
  users = [],
  frequencyOrder = {},
  hiddenFieldKeys = [],
  skipTypes = [],
  skipMondayTypes = [],
  aiDuration = null,
  footer = null,
}) {
  function setField(key, val) { onChange(key, val); }

  // ── Visibility filter ────────────────────────────────────────────────────────
  const visibleFields = boardFields.filter((f) =>
    isVisible(f, task, hiddenFieldKeys) &&
    !skipTypes.includes(f.type) &&
    !skipMondayTypes.includes(f.mondayValueType)
  );

  // ── Layout pass: rows + section headers ──────────────────────────────────────
  const renderGroups = visibleFields.reduce((acc, f) => {
    if (f.sectionHeader) {
      acc.push({ type: "section", label: f.sectionHeader });
    }
    if (f.half) {
      const last = acc[acc.length - 1];
      if (last && last.type === "row" && last.fields.length === 1) {
        last.fields.push(f);
        return acc;
      }
      acc.push({ type: "row", fields: [f] });
      return acc;
    }
    acc.push({ type: "single", field: f });
    return acc;
  }, []);

  // ── Group into card sections ─────────────────────────────────────────────────
  const hasSections = renderGroups.some((g) => g.type === "section");

  const cardSections = hasSections
    ? renderGroups.reduce((acc, group) => {
        if (group.type === "section") {
          acc.push({ header: group.label, groups: [] });
        } else {
          if (acc.length === 0) acc.push({ header: null, groups: [] });
          acc[acc.length - 1].groups.push(group);
        }
        return acc;
      }, [])
    : [{ header: null, groups: renderGroups }];

  // ── Render one field group ───────────────────────────────────────────────────
  function renderGroup(group, idx) {
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
          <InlineDurationEstimator
            script={task[group.field.key]}
            autoResult={aiDuration}
            targetDuration={task.targetDuration}
            onTargetChange={(val) => setField("targetDuration", val)}
            onScriptChange={(val) => setField(group.field.key, val)}
            onEstimateChange={(val, scr) => {
              setField("_elevenLabsEstimate", val);
              setField("_estimatedScript", scr);
            }}
            videoType={task.type || ""}
          />
        )}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`task-form${hasSections ? " task-form--multi-card" : ""}`}>
      {cardSections.map((section, si) => {
        const isLastSection = si === cardSections.length - 1;
        return (
          <div key={si} className={hasSections ? "card step-form-card" : ""}>
            {section.header && (
              <div className="step-form-card-header">
                <span className="step-form-card-badge">{section.header}</span>
              </div>
            )}
            <div className={hasSections ? "card-body" : ""}>
              {section.groups.map((group, idx) => renderGroup(group, idx))}
              {isLastSection && footer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
