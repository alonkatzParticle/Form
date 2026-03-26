// InlineDurationEstimator — appears directly below the Script / Message field.
// Receives the current script value from the form so it's always in sync.
// Also shows a small "Set Video Duration" input so the AI trim loop knows the target.
import { useState, useEffect } from "react";
import axios from "axios";

export default function InlineDurationEstimator({ script = "", autoResult = null, targetDuration = null, onTargetChange }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // When AI has already estimated duration server-side, pre-fill the result
  useEffect(() => {
    if (autoResult !== null) {
      setResult(autoResult);
      setError(null);
    }
  }, [autoResult]);

  // Clear result when script content changes significantly
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [script]);

  async function handleEstimate() {
    if (!script.trim()) return;
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

  function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  return (
    <div className="inline-duration">
      <div className="inline-duration-row">
        <button
          type="button"
          className="btn-estimate"
          onClick={handleEstimate}
          disabled={loading || !script.trim()}
        >
          {loading ? "Estimating…" : "Estimate Duration"}
        </button>

        <label className="duration-target-label">
          Set video duration
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
        </label>
      </div>

      {result !== null && (
        <div className="duration-result">
          Estimated: <strong>{formatDuration(result)}</strong>
          {targetDuration && (
            <span className={`duration-status ${result >= targetDuration - 4 && result <= targetDuration + 4 ? "duration-status--ok" : "duration-status--off"}`}>
              {result >= targetDuration - 4 && result <= targetDuration + 4 ? "✓ on target" : `target ${targetDuration}s`}
            </span>
          )}
        </div>
      )}
      {error && <div className="msg-error">{error}</div>}
    </div>
  );
}
