// InlineDurationEstimator — appears directly below the Script / Message field.
// Receives the current script value from the form so it's always in sync.
import { useState, useEffect } from "react";
import axios from "axios";

export default function InlineDurationEstimator({ script = "", autoResult = null }) {
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
    if (seconds < 60) return `${seconds} seconds`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m} minutes`;
  }

  return (
    <div className="inline-duration">
      <button
        type="button"
        className="btn-estimate"
        onClick={handleEstimate}
        disabled={loading || !script.trim()}
      >
        {loading ? "Estimating…" : "Estimate Duration"}
      </button>
      {result !== null && (
        <div className="duration-result">
          Estimated duration: <strong>{formatDuration(result)}</strong>
        </div>
      )}
      {error && <div className="msg-error">{error}</div>}
    </div>
  );
}
