// InlineDurationEstimator — appears directly below the Script / Message field.
// Shows: Estimate Duration button | Set video duration input (when script has content)
//        Change duration of Script button (when script + target are both set)
//        Preview card with Apply/Cancel when trim result is ready
import { useState, useEffect, useRef } from "react";
import { estimateDuration } from "../utils/durationEstimate.js";

export default function InlineDurationEstimator({
  script = "",
  autoResult = null,
  targetDuration = null,
  onTargetChange,
  onScriptChange,
  onEstimateChange,
  videoType = "",
}) {
  const [result, setResult]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [trimming, setTrimming]     = useState(false);
  const [trimPreview, setTrimPreview] = useState(null); // { script, estimatedSeconds }
  const [trimError, setTrimError]   = useState(null);

  const [lastEstimatedScript, setLastEstimatedScript] = useState("");

  const hasScript = script.trim().length > 0;
  const isStale = hasScript && script !== lastEstimatedScript;

  // Use a ref so useEffect can call the latest onEstimateChange without it being a dependency
  const onEstimateChangeRef = useRef(onEstimateChange);
  useEffect(() => { onEstimateChangeRef.current = onEstimateChange; });

  // Clear result when script is wiped entirely
  useEffect(() => {
    if (!hasScript) {
      setResult(null);
      setError(null);
      setTrimPreview(null);
      setTrimError(null);
      setLastEstimatedScript("");
      onEstimateChangeRef.current?.(null, "");
    }
  }, [hasScript]); // ← only hasScript, not onEstimateChange (which changes every render)

  // When AI has already estimated duration server-side, pre-fill the result (runs after clear)
  useEffect(() => {
    if (autoResult !== null) {
      setResult(autoResult);
      setError(null);
      setLastEstimatedScript(script || "");
    }
  }, [autoResult]); // ← script removed: only re-run when autoResult changes, not on every keystroke


  function handleEstimate() {
    if (!hasScript) return;
    // ELEVENLABS_DISABLED — restore when credits available:
    // setLoading(true);
    // try {
    //   const res = await axios.post("/api/elevenlabs/duration", { script });
    //   const adjustedSeconds = res.data.estimatedSeconds + 3;
    //   setResult(adjustedSeconds);
    //   setLastEstimatedScript(script);
    //   onEstimateChange?.(adjustedSeconds, script);
    // } catch (err) {
    //   setError(err.response?.data?.error || "Failed to estimate duration");
    //   onEstimateChange?.(null, script);
    // } finally { setLoading(false); }

    // Syllable-based instant estimation
    const seconds = estimateDuration(script);
    setResult(seconds);
    setLastEstimatedScript(script);
    onEstimateChange?.(seconds, script);
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
    const lo = Math.max(0, seconds - 2);
    const hi = seconds + 2;
    if (hi < 60) return `${lo}–${hi}s`;
    // format each bound as m:ss if either crosses a minute
    function fmt(s) {
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    }
    return `${fmt(lo)}–${fmt(hi)}`;
  }

  const onTarget = result !== null && targetDuration
    ? result >= targetDuration - 4 && result <= targetDuration + 4
    : null;

  return (
    <div className="inline-duration">

      {/* ── Row 1: buttons + target input ── */}
      <div className="inline-duration-row">
        {isStale ? (
          <button
            type="button"
            className="btn-estimate"
            onClick={handleEstimate}
            disabled={loading}
          >
            {loading ? "Estimating…" : "Estimate Duration"}
          </button>
        ) : result !== null ? (
          <div className="duration-result" style={{ margin: 0 }}>
            Estimated: <strong>{formatDuration(result)}</strong>
            {onTarget !== null && (
              <span className={`duration-status ${onTarget ? "duration-status--ok" : "duration-status--off"}`}>
                {onTarget ? "✓ on target" : `target ${targetDuration}s`}
              </span>
            )}
          </div>
        ) : null}

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

      {/* Removed duplicated local result block below since it is now in the row */}

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
