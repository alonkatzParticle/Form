// InlineDurationEstimator — appears directly below the Script / Message field.
// Shows: Estimate Duration button | Set video duration input (when script has content)
//        Change duration of Script button (when script + target are both set)
//        Preview card with Apply/Cancel when trim result is ready
import { useState, useEffect } from "react";
import axios from "axios";

export default function InlineDurationEstimator({
  script = "",
  autoResult = null,
  targetDuration = null,
  onTargetChange,
  onScriptChange,
  videoType = "",
}) {
  const [result, setResult]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [trimming, setTrimming]     = useState(false);
  const [trimPreview, setTrimPreview] = useState(null); // { script, estimatedSeconds }
  const [trimError, setTrimError]   = useState(null);

  const hasScript = script.trim().length > 0;

  // When AI has already estimated duration server-side, pre-fill the result
  useEffect(() => {
    if (autoResult !== null) {
      setResult(autoResult);
      setError(null);
    }
  }, [autoResult]);

  // Clear result when script content changes
  useEffect(() => {
    setResult(null);
    setError(null);
    setTrimPreview(null);
    setTrimError(null);
  }, [script]);

  async function handleEstimate() {
    if (!hasScript) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await axios.post("/api/elevenlabs/duration", { script });
      setResult(res.data.estimatedSeconds);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to estimate duration");
    } finally {
      setLoading(false);
    }
  }

  async function handleTrim() {
    if (!hasScript) return;
    setTrimming(true);
    setTrimPreview(null);
    setTrimError(null);
    try {
      const res = await axios.post("/api/ai/trim-script", {
        script,
        targetDuration,
        type: videoType,
      });
      setTrimPreview(res.data);
    } catch (err) {
      setTrimError(err.response?.data?.error || "Failed to adjust script");
    } finally {
      setTrimming(false);
    }
  }

  function applyTrim() {
    onScriptChange?.(trimPreview.script);
    setResult(trimPreview.estimatedSeconds);
    setTrimPreview(null);
  }

  function cancelTrim() {
    setTrimPreview(null);
    setTrimError(null);
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  const onTarget = result !== null && targetDuration
    ? result >= targetDuration - 4 && result <= targetDuration + 4
    : null;

  return (
    <div className="inline-duration">

      {/* ── Row 1: buttons + target input ── */}
      <div className="inline-duration-row">
        <button
          type="button"
          className="btn-estimate"
          onClick={handleEstimate}
          disabled={loading || !hasScript}
        >
          {loading ? "Estimating…" : "Estimate Duration"}
        </button>

        {hasScript && (
          <>
            <div className="duration-target-wrap">
              <span className="duration-target-label">Set video duration</span>
              <input
                type="number"
                className="duration-target-input"
                placeholder="e.g. 45"
                min={5}
                max={300}
                value={targetDuration ?? ""}
                onChange={(e) => onTargetChange?.(e.target.value ? parseInt(e.target.value) : null)}
              />
              <span className="duration-target-unit">sec</span>
            </div>

            {targetDuration && (
              <button
                type="button"
                className="btn-trim"
                onClick={handleTrim}
                disabled={trimming}
              >
                {trimming ? "Adjusting…" : "Change duration of Script"}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Estimate result ── */}
      {result !== null && (
        <div className="duration-result">
          Estimated: <strong>{formatDuration(result)}</strong>
          {onTarget !== null && (
            <span className={`duration-status ${onTarget ? "duration-status--ok" : "duration-status--off"}`}>
              {onTarget ? "✓ on target" : `target ${targetDuration}s`}
            </span>
          )}
        </div>
      )}

      {error && <div className="msg-error">{error}</div>}
      {trimError && <div className="msg-error">{trimError}</div>}

      {/* ── Trim preview card ── */}
      {trimPreview && (
        <div className="trim-preview-card">
          <div className="trim-preview-header">
            <span className="trim-preview-title">Adjusted script</span>
            <span className="duration-status duration-status--ok">{formatDuration(trimPreview.estimatedSeconds)}</span>
          </div>
          <p className="trim-preview-script">{trimPreview.script}</p>
          <div className="trim-preview-actions">
            <button type="button" className="btn-trim-apply" onClick={applyTrim}>Apply</button>
            <button type="button" className="btn-trim-cancel" onClick={cancelTrim}>Cancel</button>
          </div>
        </div>
      )}

    </div>
  );
}
