import { useState } from "react";
import axios from "axios";
import Home from "./pages/Home.jsx";
import Settings from "./pages/Settings.jsx";
import "./App.css";

export default function App() {
  const [page, setPage] = useState("home"); // "home" | "settings"
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
        <Home onOpenSettings={() => setShowPasswordModal(true)} />
      )}
      {page === "settings" && (
        <Settings onClose={() => setPage("home")} />
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
