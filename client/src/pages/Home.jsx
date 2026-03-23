// Home — main page. Board list and form config come from /api/settings.
// To add a new board: add it to server/settings.json — no code changes needed here.
import { useState, useEffect } from "react";
import axios from "axios";
import { useMonday } from "../hooks/useMonday.js";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import AIPanel from "../components/AIPanel.jsx";

export default function Home() {
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState(null);

  // Fetch board config from server on mount
  useEffect(() => {
    axios
      .get("/api/settings")
      .then((res) => {
        setBoards(res.data.boards);
        setActiveBoardId(res.data.boards[0]?.id ?? null);
      })
      .catch((err) => setSettingsError(err.response?.data?.error || err.message))
      .finally(() => setSettingsLoading(false));
  }, []);

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const { users, exampleItems, loading, error } = useMonday(activeBoard?.boardId);

  function handleBoardSwitch(id) {
    setActiveBoardId(id);
    setAiResult(null);
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
    <div className="home">
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
        <div className="layout">
          {/* Left: form driven by this board's field config in settings.json */}
          <div className="form-column">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2>{activeBoard.label}</h2>
                  <p className="card-subtitle">Fill in the details below to create a task on Monday.com</p>
                </div>
              </div>
              <div className="card-body">
                <DynamicForm
                  key={activeBoard.id}
                  board={activeBoard}
                  users={users}
                  aiResult={aiResult}
                  onAIResultApplied={() => setAiResult(null)}
                />
              </div>
            </div>
          </div>

          {/* Right: AI assistant */}
          <div className="side-column">
            <AIPanel
              boardType={activeBoardId}
              exampleItems={exampleItems}
              onResult={setAiResult}
            />
          </div>
        </div>
      )}
    </div>
  );
}
