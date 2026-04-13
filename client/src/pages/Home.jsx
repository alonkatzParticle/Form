import { useState, useCallback, useEffect, useRef } from "react";
import axios from "axios";
import { useMonday } from "../hooks/useMonday.js";
import DynamicForm from "../components/forms/DynamicForm.jsx";
import AIPanel from "../components/AIPanel.jsx";
import WednesdayPanel from "../components/WednesdayPanel.jsx";
import HistoryDrawer from "../components/HistoryDrawer.jsx";
import Step1Card, { getStep1Keys, isStep1Complete } from "../components/Step1Card.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";

// Departments that have full AI panel support per board.
// If the selected department is NOT in this list, the AI panel is hidden entirely.
// Empty department (not yet chosen) → panel remains visible.
const AI_SUPPORTED_DEPTS = {
  video:  ["Marketing/Media"],
  design: ["Marketing"],
};

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
  const [taskReference, setTaskReference] = usePersistedState("home_taskReference", null);

  // Step 1 state — persisted per board so users don’t have to re-fill after navigation
  const [step1Values, setStep1Values] = usePersistedState("home_step1Values", {});
  const [initialPrompt, setInitialPrompt] = useState("");
  const urlParamsApplied = useRef(false);

  // On first mount: read URL query params and pre-fill form + AI prompt.
  // Clears params from URL after consuming them so refresh doesn't re-apply.
  useEffect(() => {
    if (urlParamsApplied.current) return;
    urlParamsApplied.current = true;

    const params = new URLSearchParams(window.location.search);
    const board     = params.get("board");
    const dept      = params.get("department");
    const product   = params.get("product");
    const type      = params.get("type");
    const platform  = params.get("platform");
    const prompt    = params.get("prompt");

    if (!board && !dept && !product && !type && !platform && !prompt) return;

    // Switch board if specified
    if (board && boards.find(b => b.id === board)) setActiveBoardId(board);

    // Pre-fill step1 fields
    const prefill = {};
    if (dept)     prefill.department = dept;
    if (product)  prefill.product    = product;
    if (type)     prefill.type       = type;
    if (platform) prefill.platform   = platform;
    if (Object.keys(prefill).length) setStep1Values(prefill);

    // Pre-fill AI prompt box
    if (prompt) setInitialPrompt(prompt);

    // Clear params from URL without triggering a page reload
    window.history.replaceState({}, "", window.location.pathname);
  }, [boards, setActiveBoardId, setStep1Values]);

  // Derive active board early so step1Keys can read field definitions from it
  const activeBoard = boards.find((b) => b.id === activeBoardId);

  const step1Keys = getStep1Keys(activeBoard?.fields ?? []);
  const mergedStep1 = { ...formTask, ...step1Values }; // step1Values wins on conflict

  const handleStep1Change = useCallback((key, val) => {
    setStep1Values((prev) => ({ ...prev, [key]: val }));
  }, [setStep1Values]);

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
  const step1Complete = isStep1Complete(activeBoard?.fields ?? [], mergedStep1);

  // Show the AI panel only if the department is supported (or not yet chosen)
  const dept = mergedStep1.department ?? "";
  const supportedDepts = AI_SUPPORTED_DEPTS[activeBoardId] ?? [];
  const showAIPanel = !dept || supportedDepts.includes(dept);

  const { users, loading, error } = useMonday(activeBoard?.boardId);

  function handleBoardSwitch(id) {
    setActiveBoardId(id);
    setAiResult(null);
    setStep1Values({}); // reset step1 when switching boards
  }

  function handleReview(data) {
    const pendingTaskObj = {
      id: "single-" + Date.now(),
      // Auto-mark as Claude-assisted if the brief was AI-generated
      task: data.briefHtml ? { ...data.task, howDidYouMake: "Claude" } : data.task,
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
            {/* Step 1: context fields — must be filled before AI panel unlocks */}
            <Step1Card
              board={activeBoard}
              users={users}
              formTask={mergedStep1}
              onFieldChange={handleStep1Change}
              frequencyOrder={frequencyOrder[activeBoard.id] ?? {}}
            />

            {showAIPanel && (
              <AIPanel
                boardType={activeBoardId}
                boardFields={activeBoard?.fields ?? []}
                currentTask={formTask}
                onResult={setAiResult}
                taskContext={mergedStep1}
                onReferenceContext={setReferenceContext}
                disabled={!step1Complete}
                department={dept}
                initialPrompt={initialPrompt}
                onPromptConsumed={() => setInitialPrompt("")}
                onNeedsClarification={(msg) => {
                  setWednesdaySeedMessage(msg);
                  setWednesdayOpen(true);
                }}
              />
            )}

            {/* DynamicForm renders Step 2 and Step 3 as their own cards */}
            <DynamicForm
              key={`${activeBoard.id}-${formResetKey}`}
              board={activeBoard}
              users={users}
              aiResult={historyResult ?? aiResult}
              onAIResultApplied={() => { setAiResult(null); setHistoryResult(null); }}
              wednesdayResult={wednesdayResult}
              onWednesdayResultApplied={() => setWednesdayResult(null)}
              step1Values={step1Values}
              hiddenFieldKeys={step1Keys}
              onTaskChange={setFormTask}
              onDraftDiscarded={() => setChatResetKey((k) => k + 1)}
              frequencyOrder={frequencyOrder[activeBoard.id] ?? {}}
              onReview={handleReview}
            />
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
