import { useState, useEffect } from "react";
import axios from "axios";
import Home from "./pages/Home.jsx";
import Settings from "./pages/Settings.jsx";
import BatchPage from "./pages/BatchPage.jsx";
import "./App.css";

export default function App() {
  const [page, setPage] = useState("home"); // "home" | "settings" | "batch"
  const [batchBoardId, setBatchBoardId] = useState(null);
  const [boards, setBoards] = useState([]);
  const [frequencyOrder, setFrequencyOrder] = useState({});

  useEffect(() => {
    axios.get("/api/settings").then((res) => {
      setBoards(res.data.boards ?? []);
      setFrequencyOrder(res.data.frequencyOrder ?? {});
    });
  }, []);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(null);
  const [checking, setChecking] = useState(false);

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setChecking(true);
    setPasswordError(null);
    try {
      await axios.post("/api/settings/auth", { password: passwordInput });
      setShowPasswordModal(false);
      setPasswordInput("");
      setPage("settings");
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

  return (
    <>
      {page === "home" && (
        <Home
          onOpenSettings={() => setShowPasswordModal(true)}
          onOpenBatch={(boardId) => { setBatchBoardId(boardId); setPage("batch"); }}
        />
      )}
      {page === "settings" && (
        <Settings onClose={() => setPage("home")} />
      )}
      {page === "batch" && (
        <BatchPage
          onClose={() => setPage("home")}
          initialBoardId={batchBoardId}
          boards={boards}
          frequencyOrder={frequencyOrder}
        />
      )}

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
    </>
  );
}
