import { useNavigate } from "react-router-dom";
import { usePathname } from "../hooks/usePathname.js";
import { PenLine, Zap, Upload, History, Settings, ClipboardList, UserCircle, Megaphone } from "lucide-react";
import { useState, useEffect } from "react";
import LogoSvg from "/logo.svg";

export default function Sidebar({ pendingCount, onHistoryClick, onProfileClick, onSettingsClick }) {
  const pathname = usePathname();
  const navigate = useNavigate();
  const [hasApiKey, setHasApiKey] = useState(!!localStorage.getItem("user_monday_api_key"));

  // Re-check key status whenever panel closes (profile saves/clears)
  useEffect(() => {
    function syncKey() { setHasApiKey(!!localStorage.getItem("user_monday_api_key")); }
    window.addEventListener("focus", syncKey);
    return () => window.removeEventListener("focus", syncKey);
  }, []);


  const isHome = pathname === "/";
  const isBatch = pathname === "/batch";
  const isPending = pathname === "/pending";
  const isSettings = pathname === "/settings";
  const isPastTickets = pathname === "/past-tickets";
  const isCampaign = pathname === "/campaign";

  return (
    <aside className="app-sidebar">
      <div className="sidebar-header">
        <img src={LogoSvg} alt="Particle" className="sidebar-logo-full" />
      </div>

      <nav className="sidebar-nav">
        <button onClick={() => navigate("/")} className={`sidebar-btn-link sidebar-link ${isHome ? "active" : ""}`}>
          <PenLine size={16} className="sidebar-icon" />
          Single Task
        </button>

        <button onClick={() => navigate("/batch")} className={`sidebar-btn-link sidebar-link ${isBatch ? "active" : ""}`}>
          <Zap size={16} className="sidebar-icon" />
          Batch Create
        </button>

        <button onClick={() => navigate("/campaign")} className={`sidebar-btn-link sidebar-link ${isCampaign ? "active" : ""}`}>
          <Megaphone size={16} className="sidebar-icon" />
          Campaign
        </button>

        <button onClick={() => navigate("/pending")} className={`sidebar-btn-link sidebar-link ${isPending ? "active" : ""}`}>
          <Upload size={16} className="sidebar-icon" />
          Pending Queue
          {pendingCount > 0 && <span className="sidebar-badge">{pendingCount}</span>}
        </button>
      </nav>

      <div className="sidebar-footer">
        <button onClick={() => navigate("/past-tickets")} className={`sidebar-btn-link sidebar-link ${isPastTickets ? "active" : ""}`}>
          <ClipboardList size={16} className="sidebar-icon" />
          Past Tickets
        </button>
        <button onClick={onHistoryClick} className="sidebar-btn-link">
          <History size={16} className="sidebar-icon" />
          History
        </button>
        <button onClick={onSettingsClick} className="sidebar-btn-link sidebar-link">
          <Settings size={16} className="sidebar-icon" />
          Settings
        </button>
        <button onClick={onProfileClick} className="sidebar-btn-link" title="Your API Key">
          <span style={{ position: "relative", display: "inline-flex" }}>
            <UserCircle size={16} className="sidebar-icon" />
            {hasApiKey && (
              <span style={{
                position: "absolute", top: -2, right: -2, width: 6, height: 6,
                borderRadius: "50%", background: "#63d99e", border: "1px solid var(--surface)"
              }} />
            )}
          </span>
          Profile
        </button>
      </div>
    </aside>
  );
}
