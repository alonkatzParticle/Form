// Home — main page. Board list and form config come from /api/settings.
// To add a new board: add it to server/settings.json — no code changes needed here.
import { useState } from "react";
import axios from "axios";
import { useMonday } from "../hooks/useMonday.js";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import AIPanel from "../components/AIPanel.jsx";
import WednesdayPanel from "../components/WednesdayPanel.jsx";
import HistoryDrawer from "../components/HistoryDrawer.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";

export default function Home({ boards, frequencyOrder, onOpenSettings, onOpenBatch, onGenerateSuccess }) {
  const [activeBoardId, setActiveBoardId] = usePersistedState("home_activeBoardId", boards?.[0]?.id ?? null);
  const [aiResult, setAiResult] = usePersistedState("home_aiResult", null);
  const [formResetKey, setFormResetKey] = useState(0);
  const [wednesdayOpen, setWednesdayOpen]       = usePersistedState("home_wednesdayOpen", false);
  const [wednesdayResult, setWednesdayResult]   = usePersistedState("home_wednesdayResult", null);
  const [formTask, setFormTask]                 = usePersistedState("home_formTask", {});
  const [chatResetKey, setChatResetKey]         = useState(0);
  const [referenceContext, setReferenceContext] = usePersistedState("home_referenceContext", null);
  const [wednesdaySeedMessage, setWednesdaySeedMessage] = usePersistedState("home_wednesdaySeedMessage", null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyResult, setHistoryResult] = useState(null);
  const [taskReference, setTaskReference] = usePersistedState("home_taskReference", null); // { name, brief } for Wednesday remix

  // Load an existing Monday task as reference:
  // 1. Fetch its brief HTML
  // 2. Run through Haiku to fill the form
  // 3. Open Wednesday with the task context + seed greeting
  async function handleUseAsReference(item) {
    try {
      // Fetch the Monday brief
      const updateRes = await axios.get(`/api/monday/item-update?itemId=${item.id}`);
      const briefHtml = updateRes.data?.body || "";

      // Fill the form via Haiku if we have a brief
      if (briefHtml) {
        try {
          const aiRes = await axios.post("/api/ai/assist", {
            mode: "historyLoad",
            boardType: activeBoardId,
            input: briefHtml,
          });
          const aiTask = aiRes.data?.task ?? aiRes.data ?? null;
          if (aiTask) setHistoryResult(aiTask);
        } catch (e) {
          console.warn("[Reference] AI fill failed:", e.message);
        }
      }

      // Set task reference context for Wednesday
      setTaskReference({ name: item.name, brief: briefHtml });

      // Open Wednesday with a greeting about the reference
      const shortName = item.name.length > 50 ? item.name.slice(0, 47) + "…" : item.name;
      setWednesdaySeedMessage(`I’ve loaded **${shortName}** as your starting point and pre-filled the form. What would you like to do differently?`);
      setWednesdayOpen(true);
      setHistoryOpen(false);
    } catch (err) {
      console.error("[Reference] Failed to load reference task:", err.message);
    }
  }

  // Hook to fetch team members based on the active board
  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const { users, loading, error } = useMonday(activeBoard?.boardId);

  function handleBoardSwitch(id) {
    setActiveBoardId(id);
    setAiResult(null);
  }

  function handleReview(data) {
    const pendingTaskObj = {
      id: "single-" + Date.now(),
      task: data.task,
      brief: data.briefHtml,
      status: "idle",
      boardType: activeBoardId,
      createdAt: Date.now()
    };
    
    // Clear local single task form state and its draft so the banner doesn't reappear
    try { localStorage.removeItem(`task_draft_${activeBoardId}`); } catch {}
    setFormTask({}); 
    setFormResetKey((k) => k + 1);
    setChatResetKey((k) => k + 1);
    
    // Send to global queue & navigate
    onGenerateSuccess(pendingTaskObj);
  }

  // No loading/error screens here anymore since App.jsx manages it now.

  return (
    <div className={`home${wednesdayOpen ? " home--wednesday-open" : ""}`}>
      <header className="app-header">
        <h1>Task Creator</h1>
        <p>Create tasks directly on Monday.com</p>
      </header>

      {/* Board selector — boards come from settings.json */}
      <div className="board-tabs-bar">
        <div className="board-tabs-pill">
          {boards.map((b) => (
            <button
              key={b.id}
              className={`board-tab ${activeBoardId === b.id ? "active" : ""}`}
              onClick={() => handleBoardSwitch(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="loading-text">Loading board data…</p>}
      {error && <p className="banner-error">Could not load board data: {error}</p>}

      {activeBoard && (
        <div className={`layout${wednesdayOpen ? " layout--wednesday" : ""}`}>
          <div className="layout-main">
            <AIPanel
              boardType={activeBoardId}
              onResult={setAiResult}
              taskContext={formTask}
              onReferenceContext={setReferenceContext}
              onNeedsClarification={(msg) => {
                setWednesdaySeedMessage(msg);
                setWednesdayOpen(true);
              }}
            />
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>{activeBoard.label}</h2>
                  <p className="card-subtitle">Fill in the details below to create a task on Monday.com</p>
                </div>
              <div className="card-header-actions">
                  <button
                    className="batch-open-btn"
                    onClick={() => onOpenBatch?.(activeBoardId)}
                    title="Create multiple tasks at once"
                  >
                    ⚡ Batch
                  </button>
                  <button
                    className="history-open-btn"
                    onClick={() => setHistoryOpen(true)}
                    title="View task history"
                  >
                    🕐 History
                  </button>
              </div>
              </div>
              <div className="card-body">
                <DynamicForm
                  key={`${activeBoard.id}-${formResetKey}`}
                  board={activeBoard}
                  users={users}
                  aiResult={historyResult ?? aiResult}
                  onAIResultApplied={() => { setAiResult(null); setHistoryResult(null); }}
                  wednesdayResult={wednesdayResult}
                  onWednesdayResultApplied={() => setWednesdayResult(null)}
                  onTaskChange={setFormTask}
                  onDraftDiscarded={() => setChatResetKey((k) => k + 1)}
                  frequencyOrder={frequencyOrder[activeBoard.id] ?? {}}
                  onReview={handleReview}
                />
              </div>
            </div>
          </div>

          <WednesdayPanel
            isOpen={wednesdayOpen}
            onClose={() => setWednesdayOpen((o) => !o)}
            boardType={activeBoardId}
            boardLabel={activeBoard.label}
            formState={formTask}
            onApplyChanges={(changes) => setWednesdayResult(changes)}
            chatResetKey={chatResetKey}
            referenceContext={referenceContext}
            seedMessage={wednesdaySeedMessage}
            onSeedConsumed={() => setWednesdaySeedMessage(null)}
            taskReference={taskReference}
            onClearTaskReference={() => setTaskReference(null)}
          />

          <HistoryDrawer
            isOpen={historyOpen}
            onClose={() => setHistoryOpen(false)}
            boardType={activeBoardId}
            boardFields={activeBoard.fields}
            onLoad={(task) => { setHistoryResult(task); setHistoryOpen(false); }}
            onUseAsReference={handleUseAsReference}
          />
        </div>
      )}

    </div>
  );
}
