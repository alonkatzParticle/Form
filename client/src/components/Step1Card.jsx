// Step1Card — context fields that must be filled before the AI panel unlocks.
// Step 1 fields are identified by `step1: true` in settings.json — no hardcoding here.
// Conditional fields (showWhen) are shown only when their condition is met,
// and are only required when visible.

import { Field, renderInput } from "./forms/DynamicForm.jsx";

// Check whether a field's showWhen condition is satisfied.
function meetsCondition(field, formTask) {
  if (!field?.showWhen) return true;
  const val = formTask[field.showWhen.field];
  if (Array.isArray(val)) return val.includes(field.showWhen.includes);
  return val === field.showWhen.includes;
}

// Returns the list of step1 field keys for a given board's field definitions.
export function getStep1Keys(boardFields = []) {
  return boardFields.filter((f) => f.step1).map((f) => f.key);
}

// Returns true when all required Step 1 fields are filled.
// Conditional fields (showWhen) only count when their condition is met.
export function isStep1Complete(boardFields = [], formTask = {}) {
  const step1Fields = boardFields.filter((f) => f.step1);
  if (step1Fields.length === 0) return true;

  return step1Fields.every((field) => {
    // If this field has a showWhen condition that isn't met → skip it
    if (field.showWhen && !meetsCondition(field, formTask)) return true;

    const val = formTask[field.key];
    if (Array.isArray(val)) return val.length > 0;
    return val !== null && val !== undefined && val !== "";
  });
}

export default function Step1Card({ board, users, formTask, onFieldChange, frequencyOrder = {} }) {
  const allStep1Fields = (board.fields ?? []).filter((f) => f.step1);
  if (allStep1Fields.length === 0) return null;

  const visibleStep1Fields = allStep1Fields.filter((f) => meetsCondition(f, formTask));

  // Progress dots: only fields that are currently applicable
  const requiredKeys = visibleStep1Fields.map((f) => f.key);

  const filledCount = requiredKeys.filter((key) => {
    const val = formTask[key];
    if (Array.isArray(val)) return val.length > 0;
    return val !== null && val !== undefined && val !== "";
  }).length;

  const allFilled = filledCount === requiredKeys.length;

  return (
    <div className="card step1-card">
      <div className="step1-card-header">
        <div className="step1-card-title">
          <span className="step1-card-badge">Step 1</span>
          <span className="step1-card-label">Set Context</span>
        </div>
        <div className="step1-progress">
          {requiredKeys.map((key) => {
            const val = formTask[key];
            const filled = Array.isArray(val) ? val.length > 0 : val !== null && val !== undefined && val !== "";
            return (
              <span
                key={key}
                className={`step1-progress-dot${filled ? " step1-progress-dot--filled" : ""}`}
                title={allStep1Fields.find((f) => f.key === key)?.label ?? key}
              />
            );
          })}
          <span className="step1-progress-text">
            {allFilled ? "✓ Ready" : `${filledCount} / ${requiredKeys.length}`}
          </span>
        </div>
      </div>

      <div className="step1-card-body">
        <div className="step1-fields-grid">
          {visibleStep1Fields.map((field) => (
            <div
              key={field.key}
              className={`step1-field${field.type === "people" ? " step1-field--wide" : ""}`}
            >
              <Field label={field.label} required={field.required}>
                {renderInput(
                  field,
                  formTask,
                  (key, val) => onFieldChange(key, val),
                  users,
                  frequencyOrder
                )}
              </Field>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
