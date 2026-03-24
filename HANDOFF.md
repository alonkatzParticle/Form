# Handoff Prompt — Task Creator

Paste this into the new Claude Code session to get up to speed.

---

## What this project is

**Task Creator** is an internal web app for a creative marketing team to create task briefs directly on Monday.com boards. It's a React + Node.js app.

- **Frontend**: React (Vite) at `client/`
- **Backend**: Node.js + Express at `server/`
- **Live at**: `http://localhost:5173` (run `npm run dev` from the root)

---

## Current state

The app is working and running. Key things already done:

- The form is **dynamic** — driven by `server/settings.json`, not hardcoded components. One `DynamicForm.jsx` renders any board's fields from config.
- Two boards configured: **Video Projects** (board ID: 5433027071) and **Design Projects** (board ID: 8036329818)
- Real Monday.com column IDs are already mapped in `settings.json`
- All API keys are in `.env` (Monday, Anthropic/Claude, ElevenLabs) — **never commit this file**
- A startup sync-check runs on boot and logs any Monday columns not yet in settings.json

---

## API keys in `.env`

All keys are already filled in. The variables are:
- `MONDAY_API_KEY` — Monday.com GraphQL API
- `MONDAY_BOARD_ID_VIDEO` — 5433027071
- `MONDAY_BOARD_ID_DESIGN` — 8036329818
- `ANTHROPIC_API_KEY` — Claude AI (for brief assistant)
- `ELEVENLABS_API_KEY` — Script duration estimator

---

## Features built so far

1. **Dynamic form** — reads field config from `server/settings.json`, renders the right inputs per board
2. **Board selector** — tabs to switch between Video and Design boards
3. **AI Panel** — 3 modes: Auto-fill, Generate Brief, Paste & Format (uses Claude)
4. **Script Duration Estimator** — uses ElevenLabs to estimate video length from a script (Video board only)
5. **Monday.com integration** — creates items, fetches users (for Requestor/Editor dropdowns), fetches example tasks for AI context
6. **Sync-check** — on startup, logs any Monday columns not yet wired up in settings.json

---

## Things still to work on

- **UI polish** — the layout and styling needs improvement (user flagged it looks rough)
- **Requestor / Editor-Designer fields** — multi-select people dropdowns (Monday users) — need to be added to settings.json for both boards
- **Relevant Files upload** — exists as a Monday column but not yet in the form
- **Missing columns** — the sync-check on startup listed ~20 columns per board not yet in settings.json; decide which ones should be in the form
- **Submit wiring** — verify that submitting the form actually creates an item in Monday and shows a success/error message
- **AI brief quality** — the system prompt in `server/services/aiService.js` can be improved with more examples from the real boards

---

## How to add a field to the form

Edit `server/settings.json`. Find the board (video or design) and add an entry to the `fields` array:

```json
{
  "key": "myField",
  "label": "My Field Label",
  "type": "text",              // text, textarea, select, multiselect, date, number, link, people
  "required": false,
  "mondayColumnId": "column_id_here",
  "mondayValueType": "short_text"
}
```

Column IDs can be found by calling `GET /api/monday/columns?boardId=5433027071` or reading the startup sync-check log.

---

## How to run

```
npm run dev        # starts both server (port 3001) and client (port 5173)
```

Or separately:
```
cd server && npm run dev   # backend only
cd client && npm run dev   # frontend only
```
