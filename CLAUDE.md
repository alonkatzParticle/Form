# CLAUDE.md — Developer Guide for Task Creator

This file explains how this project is structured and how to extend it.
It's written for someone who isn't a professional programmer — plain language, step by step.

---

## What this app does

Task Creator is a web form app that lets the marketing team create tasks directly on Monday.com boards.
It has AI assistance (powered by Claude) to help write task briefs, and uses ElevenLabs to estimate
how long a script will take to record (for planning video length).

---

## How the project is organized

```
Task Creator/
├── client/          ← Everything the user sees in the browser (React)
│   └── src/
│       ├── components/
│       │   ├── forms/        ← One file per Monday board form
│       │   ├── AIPanel.jsx   ← The AI assistant panel
│       │   └── DurationEstimator.jsx
│       ├── pages/
│       │   └── Home.jsx      ← Main page: board selector + form
│       └── hooks/
│           └── useMonday.js  ← Reusable Monday API helpers
├── server/          ← The backend that talks to Monday, Claude, and ElevenLabs
│   ├── routes/      ← One file per API endpoint group
│   └── services/    ← One file per external API (Monday, Claude, ElevenLabs)
├── shared/
│   └── taskTypes.js ← The data shapes (VideoTask, DesignTask) used everywhere
├── .env             ← Secret API keys — never share or commit this file
└── .env.example     ← Template showing what keys are needed (safe to share)
```

**Golden rule:** Each feature lives in its own file. If you're adding something new, add a new file
rather than putting it inside an existing one. This makes it easy to find and change things later.

---

## How to add a new board form

Follow these steps in order:

1. **Add the data model** — Open `shared/taskTypes.js` and add:
   - An `emptyXxxTask` object with all the fields set to empty values
   - An `xxxOptions` object with all the dropdown choices

2. **Create the form component** — Copy `client/src/components/forms/VideoForm.jsx` as a starting
   point. Save it as `XxxForm.jsx` in the same folder. Update the fields to match the new board.

3. **Add it to the board selector** — Open `client/src/pages/Home.jsx` and add the new board
   to the `BOARDS` array at the top of the file.

4. **Add the board ID to `.env`** — Add `MONDAY_BOARD_ID_XXX=your_board_id_here` to `.env`
   and `.env.example`.

5. **Map the columns** — You need to know each column's ID in Monday. Run this in your browser
   console or use the Monday API explorer:
   `GET /api/monday/columns?boardId=YOUR_BOARD_ID`
   Update the `buildColumnValues` function in `VideoForm.jsx` (or your new form) to map
   your form fields to the right column IDs.

---

## How the AI works

The AI (Claude) reads existing tasks from your Monday board to learn the style and tone your team uses.
It also has a system prompt in `server/services/aiService.js` that explains the fields and rules.

To improve AI output:
- Edit the system prompt in `aiService.js` — the `buildSystemPrompt` function
- The more real tasks exist on the board, the better the AI gets (it reads up to 50 recent tasks)

---

## How the ElevenLabs duration estimator works

When a user pastes a script and clicks "Estimate Duration":
1. The script is sent to our server
2. The server calls ElevenLabs to generate a speech audio clip
3. We measure how long the audio is (in seconds) and return that number
4. The audio itself is never stored or played — we only use the duration

---

## API keys

All API keys live in the `.env` file in the root folder. Never commit this file to git.
If you need to add a key, also add a placeholder line to `.env.example`.

| Key | What it's for |
|-----|---------------|
| `MONDAY_API_KEY` | Creates tasks and reads board data from Monday.com |
| `ANTHROPIC_API_KEY` | Powers the AI brief assistant |
| `ELEVENLABS_API_KEY` | Estimates script reading duration |
| `MONDAY_BOARD_ID_VIDEO` | The ID of the Video Projects board |
| `MONDAY_BOARD_ID_DESIGN` | The ID of the Design Projects board |

---

## Running the app locally

You need two terminal windows open at the same time:

**Terminal 1 — Start the backend server:**
```
cd server
npm install
npm run dev
```

**Terminal 2 — Start the frontend:**
```
cd client
npm install
npm run dev
```

Then open your browser to `http://localhost:5173`

---

## Making changes safely

- **Test after every change.** If something breaks, undo the last thing you changed.
- **Never edit `.env`** — if you mess it up, the app will stop working. Keep a backup.
- **Ask Claude Code** if you're unsure what a file does — it can read any file and explain it.
- **One change at a time.** Don't try to add multiple features at once.
