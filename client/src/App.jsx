import { useState, useEffect, useCallback } from "react";
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
import UserProfile from "./components/UserProfile.jsx";
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
  // localStorage is the instant cache; background sync merges shared DB tickets on load
  const [submittedTasks, setSubmittedTasks] = usePersistedState("app_submitted_tasks", []);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Background sync: pull shared tickets from server and merge (dedupe by id)
  useEffect(() => {
    axios.get("/api/tickets").then(({ data }) => {
      if (!Array.isArray(data)) return;
      setSubmittedTasks(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const newOnes = data.filter(t => !existingIds.has(t.id));
        return newOnes.length ? [...newOnes, ...prev].sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)) : prev;
      });
    }).catch(() => {}); // silently ignore if DB not configured
  }, [setSubmittedTasks]);

  const handleTaskSubmitted = useCallback((submittedTask) => {
    const entry = {
      ...submittedTask,
      submittedAt: Date.now(),
      createdBy: localStorage.getItem("user_monday_name") || null,
    };
    setSubmittedTasks(prev => [entry, ...prev]);
    axios.post("/api/tickets", entry).catch(() => {}); // fire-and-forget to shared DB
  }, [setSubmittedTasks]);

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
  // Tracks whether the user has authenticated for Settings in this session
  const [isSettingsAuth, setIsSettingsAuth] = useState(false);

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
      setIsSettingsAuth(true);
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

  // Block direct URL access to /settings without authentication
  useEffect(() => {
    if (isSettings && !isSettingsAuth) {
      navigate("/");
      setShowPasswordModal(true);
    }
  }, [isSettings, isSettingsAuth, navigate]);

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
      <Sidebar
        pendingCount={pendingTasks.length}
        onHistoryClick={() => setHistoryOpen(true)}
        onProfileClick={() => setProfileOpen(true)}
        onSettingsClick={() => setShowPasswordModal(true)}
      />
      
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
            onTaskSubmitted={handleTaskSubmitted}
          />
        </div>

        <div style={{ display: isReview ? "block" : "none" }}>
          <ReviewPage
            tasks={pendingTasks}
            setTasks={setPendingTasks}
            boards={boards}
            frequencyOrder={frequencyOrder}
            onTaskSubmitted={handleTaskSubmitted}
          />
        </div>

        <div style={{ display: isPastTickets ? "block" : "none" }}>
          <PastTicketsPage
            submittedTasks={submittedTasks}
            boards={boards}
            onRequeue={(ticket) => {
              const requeuedTask = { ...ticket, id: `task-${Date.now()}`, mondayUrl: null, submittedAt: null };
              setPendingTasks(prev => [requeuedTask, ...prev]);
              navigate("/pending");
            }}
          />
        </div>
      </div>

      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        boardType={boards[0]?.id}
        boardFields={boards[0]?.fields ?? []}
        onLoad={() => {}}
      />

      <UserProfile isOpen={profileOpen} onClose={() => setProfileOpen(false)} />

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
