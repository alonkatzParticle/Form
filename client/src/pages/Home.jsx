// Home — main page. Board list and form config come from /api/settings.
// To add a new board: add it to server/settings.json — no code changes needed here.
import { useState, useEffect } from "react";
import axios from "axios";
import { useMonday } from "../hooks/useMonday.js";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import AIPanel from "../components/AIPanel.jsx";
import BriefPreview from "./BriefPreview.jsx";
import WednesdayPanel from "../components/WednesdayPanel.jsx";

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

  // Fetch board config from server on mount
  useEffect(() => {
    axios
      .get("/api/settings")
      .then((res) => {
        setBoards(res.data.boards);
        setActiveBoardId(res.data.boards[0]?.id ?? null);
        setFrequencyOrder(res.data.frequencyOrder ?? {});
      })
      .catch((err) => setSettingsError(err.response?.data?.error || err.message))
      .finally(() => setSettingsLoading(false));
  }, []);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const { users, exampleItems, loading, error } = useMonday(activeBoard?.boardId);

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
              exampleItems={exampleItems}
              onResult={setAiResult}
            />
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>{activeBoard.label}</h2>
                  <p className="card-subtitle">Fill in the details below to create a task on Monday.com</p>
                </div>
              </div>
              <div className="card-body">
                <DynamicForm
                  key={`${activeBoard.id}-${formResetKey}`}
                  board={activeBoard}
                  users={users}
                  aiResult={aiResult}
                  onAIResultApplied={() => setAiResult(null)}
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
          />
        </div>
      )}

    </div>
  );
}
