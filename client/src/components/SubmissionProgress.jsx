/**
 * SubmissionProgress — animated multi-step progress indicator shown
 * in place of the task form while a task is being submitted to Monday.
 *
 * Props:
 *   step      — 'creating' | 'brief' | 'files' | null
 *   fileIndex — which file is currently uploading (1-based)
 *   fileTotal — total number of files to upload
 *   fileName  — name of the file currently uploading
 */

import { Check } from "lucide-react";

const STEPS = [
  { key: "creating", label: "Creating task in Monday" },
  { key: "brief",    label: "Posting brief"           },
  { key: "files",    label: "Uploading files"         },
];

const STEP_ORDER = STEPS.map((s) => s.key);

export default function SubmissionProgress({ step, fileIndex = 0, fileTotal = 0, fileName = "" }) {
  const currentIdx = STEP_ORDER.indexOf(step ?? "");

  // Hide the files step entirely when there are no files
  const visibleSteps = fileTotal > 0 ? STEPS : STEPS.slice(0, 2);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      padding: "40px 24px",
    }}>
      {/* Title */}
      <div style={{ marginBottom: 36, textAlign: "center" }}>
        <div style={{
          width: 48, height: 48,
          borderRadius: "50%",
          background: "var(--purple-dim, rgba(139,92,246,0.12))",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 14px",
        }}>
          <span className="batch-gen-spinner" style={{ width: 22, height: 22, borderWidth: 2.5 }} />
        </div>
        <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>
          Submitting to Monday.com
        </p>
        <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Please don't close this tab
        </p>
      </div>

      {/* Steps */}
      <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 0 }}>
        {visibleSteps.map((s, i) => {
          const sIdx = STEP_ORDER.indexOf(s.key);
          const isDone    = sIdx < currentIdx;
          const isActive  = sIdx === currentIdx;
          const isPending = sIdx > currentIdx;
          const isLast    = i === visibleSteps.length - 1;

          // Build the label — files step shows progress details
          let label = s.label;
          let sublabel = null;
          if (s.key === "files" && isActive) {
            label = fileTotal > 1
              ? `Uploading files (${fileIndex} of ${fileTotal})`
              : "Uploading file";
            if (fileName) sublabel = fileName;
          }

          return (
            <div key={s.key}>
              <div style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
              }}>
                {/* Icon */}
                <div style={{
                  width: 28, height: 28,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: isDone
                    ? "var(--purple)"
                    : isActive
                      ? "rgba(139,92,246,0.12)"
                      : "var(--surface)",
                  border: isDone
                    ? "2px solid var(--purple)"
                    : isActive
                      ? "2px solid var(--purple)"
                      : "2px solid var(--border)",
                  transition: "all 0.3s ease",
                }}>
                  {isDone && <Check size={14} color="#fff" strokeWidth={2.5} />}
                  {isActive && (
                    <span style={{
                      width: 12, height: 12,
                      border: "2px solid var(--purple)",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.75s linear infinite",
                    }} />
                  )}
                </div>

                {/* Text */}
                <div style={{ paddingTop: 4, flex: 1 }}>
                  <p style={{
                    margin: 0,
                    fontSize: "0.875rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isPending ? "var(--text-muted)" : "var(--text)",
                    transition: "color 0.2s",
                  }}>
                    {label}
                  </p>
                  {isActive && sublabel && (
                    <p style={{
                      margin: "2px 0 0",
                      fontSize: "0.72rem",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}>
                      {sublabel}
                    </p>
                  )}
                </div>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div style={{
                  width: 2, height: 20,
                  background: isDone ? "var(--purple)" : "var(--border)",
                  marginLeft: 13,
                  marginTop: 2,
                  marginBottom: 2,
                  borderRadius: 1,
                  transition: "background 0.3s ease",
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
