import { useNavigate } from "react-router-dom";
import { usePathname } from "../hooks/usePathname.js";
import { PenLine, Zap, Upload, History, Settings, ClipboardList } from "lucide-react";
import LogoSvg from "/logo.svg";

export default function Sidebar({ pendingCount, onHistoryClick }) {
  const pathname = usePathname();
  const navigate = useNavigate();

  const isHome = pathname === "/";
  const isBatch = pathname === "/batch";
  const isPending = pathname === "/pending";
  const isSettings = pathname === "/settings";
  const isPastTickets = pathname === "/past-tickets";

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
        <button onClick={() => navigate("/settings")} className={`sidebar-btn-link sidebar-link ${isSettings ? "active" : ""}`}>
          <Settings size={16} className="sidebar-icon" />
          Settings
        </button>
      </div>
    </aside>
  );
}
