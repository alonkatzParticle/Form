// Home — main page. Board list and form config come from /api/settings.
// To add a new board: add it to server/settings.json — no code changes needed here.
import { useState, useEffect } from "react";
import axios from "axios";
import { useMonday } from "../hooks/useMonday.js";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import AIPanel from "../components/AIPanel.jsx";
import BriefPreview from "./BriefPreview.jsx";
import WednesdayPanel from "../components/WednesdayPanel.jsx";
import HistoryDrawer from "../components/HistoryDrawer.jsx";

export default function Home({ onOpenSettings }) {
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [frequencyOrder, setFrequencyOrder] = useState({});
  const [aiResult, setAiResult] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const [formResetKey, setFormResetKey] = useState(0);
  const [wednesdayOpen, setWednesdayOpen]       = useState(false);
  const [wednesdayResult, setWednesdayResult]   = useState(null);
  const [formTask, setFormTask]                 = useState({});
  const [chatResetKey, setChatResetKey]         = useState(0);
  const [referenceContext, setReferenceContext] = useState(null);
  const [wednesdaySeedMessage, setWednesdaySeedMessage] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyResult, setHistoryResult] = useState(null);
  const [taskReference, setTaskReference] = useState(null); // { name, brief } for Wednesday remix

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

  useEffect(() => {
    axios
      .get("/api/settings")
      .then((res) => {
        setBoards(res.data.boards);
        setActiveBoardId(res.data.boards[0]?.id ?? null);
        setFrequencyOrder(res.data.frequencyOrder ?? {});
      })
      .catch((err) => {
        const e = err.response?.data?.error;
        setSettingsError(typeof e === "string" ? e : e?.message || err.message || "Failed to load settings");
      })
      .finally(() => setSettingsLoading(false));
  }, []);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const { users, loading, error } = useMonday(activeBoard?.boardId);

  function handleBoardSwitch(id) {
    setActiveBoardId(id);
    setAiResult(null);
    setPendingReview(null);
  }

  function handleReview(data) {
    setPendingReview(data);
  }

  function handleBackFromPreview() {
    setPendingReview(null);
  }

  function handleSuccess() {
    setPendingReview(null);
    setFormResetKey((k) => k + 1);
    setChatResetKey((k) => k + 1);
  }

  if (settingsLoading) {
    return (
      <div className="home">
        <header className="app-header">
          <h1>Task Creator</h1>
          <p>Create tasks directly on Monday.com</p>
        </header>
        <p className="loading-text">Loading…</p>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="home">
        <header className="app-header">
          <h1>Task Creator</h1>
          <p>Create tasks directly on Monday.com</p>
        </header>
        <p className="banner-error">Could not load settings: {settingsError}</p>
      </div>
    );
  }

  return (
    <div className={`home${wednesdayOpen ? " home--wednesday-open" : ""}`}>
      <header className="app-header">
        <h1>Task Creator</h1>
        <p>Create tasks directly on Monday.com</p>
        <button className="settings-btn" onClick={onOpenSettings} title="Settings">⚙</button>
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

      {activeBoard && pendingReview && (
        <BriefPreview
          board={activeBoard}
          task={pendingReview.task}
          itemName={pendingReview.itemName}
          columnValues={pendingReview.columnValues}
          briefHtml={pendingReview.briefHtml}
          onBack={handleBackFromPreview}
          onSuccess={handleSuccess}
        />
      )}

      {activeBoard && (
        <div
          className={`layout${wednesdayOpen ? " layout--wednesday" : ""}`}
          style={{ display: pendingReview ? "none" : "flex" }}
        >
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
                <button
                  className="history-open-btn"
                  onClick={() => setHistoryOpen(true)}
                  title="View task history"
                >
                  🕐 History
                </button>
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
