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
