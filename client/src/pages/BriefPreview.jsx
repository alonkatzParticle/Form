// BriefPreview — step 2 of the task creation flow.
// Shows an editable brief (contentEditable), then submits to Monday on confirm.
import { useState, useRef, useEffect } from "react";
import axios from "axios";

function SuccessScreen({ taskName, boardLabel, taskUrl, onReset }) {
  return (
    <div className="success-screen">
      <div className="success-icon">✓</div>
      <h2 className="success-title">Task Created!</h2>
      <p className="success-task-name">"{taskName}"</p>
      <p className="success-subtitle">
        Your task has been added to the <strong>{boardLabel}</strong> board on Monday.com
      </p>
      {taskUrl && (
        <a className="btn-monday-link" href={taskUrl} target="_blank" rel="noreferrer">
          View on Monday.com
        </a>
      )}
      <button className="btn-submit" onClick={onReset}>
        Submit Another Task
      </button>
    </div>
  );
}

export default function BriefPreview({ board, task, itemName, columnValues, briefHtml, onBack, onSuccess }) {
  const editorRef = useRef(null);
  const [editableItemName, setEditableItemName] = useState(itemName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [createdTaskName, setCreatedTaskName] = useState(null);
  const [createdTaskUrl, setCreatedTaskUrl] = useState(null);

  // Set initial HTML once on mount — using useEffect avoids React re-renders
  // resetting the user's edits via dangerouslySetInnerHTML.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML =
        briefHtml || "<p>No brief content was generated. Write your brief here.</p>";
    }
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      // Step 1 — create the item
      const { data } = await axios.post("/api/monday/create-item", {
        boardId: board.boardId,
        itemName: editableItemName || itemName,
        columnValues,
      });
      const itemId = data?.create_item?.id;
      const itemUrl = data?.create_item?.url ?? null;
      setCreatedTaskUrl(itemUrl);

      // Step 2 — upload any attached files
      let filesUploaded = 0;
      if (itemId) {
        const fileFields = board.fields.filter(
          (f) => f.type === "file" && f.mondayColumnId && task[f.key]
        );
        for (const field of fileFields) {
          for (const file of Array.from(task[field.key])) {
            const fd = new FormData();
            fd.append("itemId", itemId);
            fd.append("columnId", field.mondayColumnId);
            fd.append("file", file);
            await axios.post("/api/monday/upload-file", fd);
            filesUploaded++;
          }
        }
      }

      // Step 3 — post the brief as a Monday update using whatever is in the editor
      if (itemId) {
        let body = editorRef.current?.innerHTML || "";
        if (filesUploaded > 0 && itemUrl) {
          body += `<p>📎 <a href="${itemUrl}">View attached files</a></p>`;
        }
        if (body.trim()) {
          await axios
            .post("/api/monday/create-update", { itemId, body })
            .catch((err) => console.warn("Update post failed (item still created):", err.message));
        }
      }

      // Clear the autosaved draft for this board
      try { localStorage.removeItem(`task_draft_${board.id}`); } catch {}

      setCreatedTaskName(editableItemName || itemName);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdTaskName) {
    return (
      <div className="brief-preview-wrap">
        <SuccessScreen
          taskName={createdTaskName}
          boardLabel={board.label}
          taskUrl={createdTaskUrl}
          onReset={onSuccess ?? onBack}
        />
      </div>
    );
  }

  return (
    <div className="brief-preview-wrap">
      <div className="brief-preview-header">
        <button className="brief-back-btn" type="button" onClick={onBack}>
          ← Back to Form
        </button>
        <h2 className="brief-preview-title">Review Brief</h2>
      </div>

      <div className="brief-title-row">
        <label className="brief-title-label">Task Title</label>
        <input
          className="brief-title-input"
          type="text"
          value={editableItemName}
          onChange={(e) => setEditableItemName(e.target.value)}
          placeholder="Task title…"
        />
      </div>

      <div className="card">
        <div className="card-body">
          <div
            ref={editorRef}
            className="brief-editor"
            contentEditable="true"
            suppressContentEditableWarning
          />
        </div>
      </div>

      {error && <div className="msg-error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="brief-preview-footer">
        <button className="btn-secondary" type="button" onClick={onBack} disabled={submitting}>
          ← Back
        </button>
        <button className="btn-submit" type="button" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating Task…" : "Create Task on Monday →"}
        </button>
      </div>
    </div>
  );
}
