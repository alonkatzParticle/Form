import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Home from "./pages/Home.jsx";
import Settings from "./pages/Settings.jsx";
import BatchPage from "./pages/BatchPage.jsx";
import PendingPage from "./pages/PendingPage.jsx";
import ReviewPage from "./pages/ReviewPage.jsx";
import PastTicketsPage from "./pages/PastTicketsPage.jsx";
import Sidebar from "./components/Sidebar.jsx";
import HistoryDrawer from "./components/HistoryDrawer.jsx";
import { usePersistedState } from "./hooks/usePersistedState.js";
import { usePathname } from "./hooks/usePathname.js";
import "./App.css";

export default function App() {
  const pathname = usePathname();
  const navigate = useNavigate();

  const isHome = pathname === "/";
  const isSettings = pathname === "/settings";
  const isBatch = pathname === "/batch";
  const isPending = pathname === "/pending";
  const isReview = pathname === "/review";
  const isPastTickets = pathname === "/past-tickets";

  const [boards, setBoards] = usePersistedState("app_boards", []);
  const [frequencyOrder, setFrequencyOrder] = usePersistedState("app_freqOrder", {});
  const [pendingTasks, setPendingTasks] = usePersistedState("app_pending_tasks", []);
  const [submittedTasks, setSubmittedTasks] = usePersistedState("app_submitted_tasks", []);
  
  // App-level history drawer state
  const [historyOpen, setHistoryOpen] = useState(false);

  // If we already have boards loaded from cache, we skip the loading screen instantly!
  const [boardsLoaded, setBoardsLoaded] = useState(boards.length > 0);

  useEffect(() => {
    // Still fetch in background to keep settings fresh without flickering the UI
    axios.get("/api/settings").then((res) => {
      setBoards(res.data.boards ?? []);
      setFrequencyOrder(res.data.frequencyOrder ?? {});
      if (!boardsLoaded) setBoardsLoaded(true);
    }).catch((err) => {
      console.error("Failed to load settings:", err);
      if (!boardsLoaded) setBoardsLoaded(true);
    });
  }, [boardsLoaded, setBoards, setFrequencyOrder]);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(null);
  const [checking, setChecking] = useState(false);

  // If someone directly types /settings without logging in, we intercept
  // Optional: but for now, we just show password modal if they click settings
  // The password modal sets the URL to /settings when correct
  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setChecking(true);
    setPasswordError(null);
    try {
      await axios.post("/api/settings/auth", { password: passwordInput });
      setShowPasswordModal(false);
      setPasswordInput("");
      navigate("/settings");
    } catch {
      setPasswordError("Incorrect password");
    } finally {
      setChecking(false);
    }
  }

  function handleModalClose() {
    setShowPasswordModal(false);
    setPasswordInput("");
    setPasswordError(null);
  }

  if (!boardsLoaded) {
    if (isBatch) {
      return (
        <div className="batch-page">
          <header className="batch-header">
            <button className="batch-back-btn" onClick={() => navigate("/")}>← Back</button>
            <div className="batch-header-center">
              <span className="batch-header-icon">⚡</span>
              <span className="batch-header-title">Batch Create</span>
            </div>
          </header>
          <div className="batch-input-phase" style={{ textAlign: "center", padding: "40px", color: "white" }}>Loading workspace…</div>
        </div>
      );
    }

    return (
      <div className="home">
        <header className="app-header">
          <h1>Task Creator</h1>
          <p>Create tasks directly on Monday.com</p>
        </header>
        <p className="loading-text">Loading workspace…</p>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar pendingCount={pendingTasks.length} onHistoryClick={() => setHistoryOpen(true)} />
      
      <div className="app-content">
        <div style={{ display: isHome ? "block" : "none" }}>
          <Home
            boards={boards}
            frequencyOrder={frequencyOrder}
            onGenerateSuccess={(task) => {
              setPendingTasks((prev) => [...prev, task]);
              navigate(`/review?ids=${task.id}`);
            }}
          />
        </div>

        <div style={{ display: isSettings ? "block" : "none" }}>
          <Settings onClose={() => navigate("/")} />
        </div>

        <div style={{ display: isBatch ? "block" : "none" }}>
          <BatchPage
            boards={boards}
            frequencyOrder={frequencyOrder}
            setPendingTasks={setPendingTasks}
          />
        </div>

        <div style={{ display: isPending ? "block" : "none" }}>
          <PendingPage
            tasks={pendingTasks}
            setTasks={setPendingTasks}
            boards={boards}
            frequencyOrder={frequencyOrder}
            onTaskSubmitted={(submittedTask) => {
              setSubmittedTasks(prev => [{ ...submittedTask, submittedAt: Date.now() }, ...prev]);
            }}
          />
        </div>

        <div style={{ display: isReview ? "block" : "none" }}>
          <ReviewPage
            tasks={pendingTasks}
            setTasks={setPendingTasks}
            boards={boards}
            frequencyOrder={frequencyOrder}
            onTaskSubmitted={(submittedTask) => {
              setSubmittedTasks(prev => [{ ...submittedTask, submittedAt: Date.now() }, ...prev]);
            }}
          />
        </div>

        <div style={{ display: isPastTickets ? "block" : "none" }}>
          <PastTicketsPage
            submittedTasks={submittedTasks}
            boards={boards}
          />
        </div>
      </div>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        boardType={boards[0]?.id} // Defaults to first board for history, could be dynamic
        boardFields={boards[0]?.fields ?? []}
        // Minimal load handler for History. In a robust system, this could create a new draft.
        onLoad={() => {}} 
      />

      {showPasswordModal && (
        <div className="modal-overlay" onClick={handleModalClose}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-subtitle">Enter the password to continue</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                className="modal-input"
                type="password"
                placeholder="Password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                autoFocus
              />
              {passwordError && <p className="modal-error">{passwordError}</p>}
              <button className="btn-submit" type="submit" disabled={checking}>
                {checking ? "Checking…" : "Enter"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
