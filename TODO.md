# TODO — Task Creator Feature Backlog

Features to add after the MVP is shipped. Add new items here as they come up.

---

## High Priority

- [ ] **Additional board forms** — Add forms for other Monday boards (Social, Amazon, Email, etc.)
      Each one follows the same pattern as VideoForm.jsx (see CLAUDE.md for instructions)

- [ ] **Column ID mapping** — Map each form field to the actual Monday column IDs so submitted
      tasks land in the right columns. Requires running `/api/monday/columns?boardId=XXX` once
      per board and updating the `buildColumnValues` function in each form.

- [ ] **Form validation** — Show inline error messages for required fields before submitting.
      Currently the form submits even if required fields are empty.

---

## Medium Priority

- [ ] **Draft saving** — Save a partially-filled form to `localStorage` so users don't lose
      their work if they accidentally close the tab.

- [ ] **AI feedback loop** — Add thumbs up / thumbs down buttons after AI fills the form.
      Log feedback to improve prompts over time.

- [ ] **Success screen** — After submitting, show the Monday task URL so the user can jump
      directly to the newly created task.

- [ ] **Paste-from-clipboard button** — One-click button to paste clipboard content into the
      AI "Paste & Format" input field.

- [ ] **File upload to Dropbox** — Upload attached files directly to Dropbox and auto-fill
      the Dropbox link field. (Already have Dropbox credentials in another project.)

---

## Low Priority / Nice to Have

- [ ] **User authentication** — Simple login so each task knows who submitted it.
      Options: shared team password, or Google SSO via NextAuth.

- [ ] **Task history** — Show a list of recently submitted tasks with links back to Monday.

- [ ] **Bulk task creation** — Upload a spreadsheet and create multiple tasks at once.

- [ ] **Slack/email notification on submit** — Notify the relevant editor or designer
      when a new task is created for them.

- [ ] **Admin panel** — Let non-technical team members configure board names, column mappings,
      and dropdown options without editing code.

- [ ] **Dark mode** — Add a dark theme toggle.

- [ ] **Mobile-friendly layout** — Improve form layout for phones and tablets.

- [ ] **Duplicate task** — Add a "Duplicate" button to pre-fill the form with a previous task's
      values, useful for recurring task types.

---

## AI Learning System

- [ ] **Feedback capture** — Add a "brief was good / needed major edits" signal on the brief preview page after submission. Store approved briefs (input fields + final HTML) in a lightweight JSON file or database.

- [ ] **Golden examples library** — A curated set of the best real input → output pairs, injected into the AI prompt as "gold standard" examples. Replace weak examples with better ones over time. Lives in `server/goldenExamples.json`.

- [ ] **Prompt versioning** — Track which version of a prompt produced which outputs so you can compare results and roll back if a change makes things worse.

- [ ] **Auto-promote good examples** — When a brief is submitted with zero or minimal edits in the contentEditable, automatically flag it as a candidate for the golden examples library.

> **Why this matters:** Claude doesn't learn from usage — each call is stateless. "Learning" here means enriching the context (examples, rules) given to the AI on each call. The richer and more accurate the examples, the more repeatable the outputs.

---

## Wednesday (AI Chat Assistant)

- [ ] **Quick reply chips** — Add shortcut chips above the input box for common actions: "Fill the whole form", "Review what I have", "Start over", "Just the script". Tapping a chip sends it as a message.

- [ ] **Brand knowledge document** — Create a monthly-updated file Wednesday reads alongside the skill files. Should include: hero products this month, active promotions, top-performing angles, angles to avoid, upcoming campaigns, concepts with creative fatigue.

- [ ] **Undo last changes** — If the user says "go back" or "undo that", Wednesday should be able to revert the last batch of field changes she made.

---

## AI Improvements

- [ ] **Inline LLM per field** — Add a small AI button directly inside individual form fields
      (e.g. a ✦ icon at the right edge of a textarea). Clicking it sends just that field's
      context to the LLM and fills only that field — more surgical than the full-form AI panel.
      Could also support field-specific prompts like "rewrite this hook to be punchier" or
      "suggest a target audience based on the product selected."


- [ ] **Custom system prompt editor** — Let admins edit the AI instructions from the UI
      without touching code.

- [ ] **Per-board AI examples** — Currently AI uses examples from one board. Separate
      example sets per board type for better output.

- [ ] **AI confidence scores** — Show which fields the AI is confident about vs. guessing,
      so users know what to double-check.

---

## Bugs / Known Issues

_(Add known bugs here as they're discovered)_
