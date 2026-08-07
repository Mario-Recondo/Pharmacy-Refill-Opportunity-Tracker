# Refill Tracker

Desktop tool (single-user, offline) for a pharmacy technician at an independent pharmacy: tracks prescription refills, contact attempts, copays/net profits, and surfaces high-value refills coming due. Replaces a Google Sheets month-tab workflow. Ships as a single Windows .exe.

## Read first

- `Design_docs/refill-tracker-design.md` — the authoritative spec: data model, business rules, features by version (v1 grid, v2 CSV import, v3 call list/analytics)
- `Design_docs/user_stories.md` — acceptance criteria per story
- `Design_docs/user_flows.md` — how the technician actually moves through the tool; Flow 2 is the core loop
- Screenshots in `Design_docs/` are ground truth for vocabularies and colors (taken from the real sheet and real PioneerRX exports)
- `QUESTIONS.md` (gitignored, repo root) — open questions for the technician; when answered, fold the decision into Design_docs

## Stack

- Tauri 2 + React + TypeScript + Vite
- SQLite via `tauri-plugin-sql` — migrations live in `src-tauri/migrations/*.sql`, registered in `src-tauri/src/lib.rs`, applied automatically on first `Database.load`
- Database file: `%APPDATA%/com.pharmacy.refill-tracker/refills.db`
- Grid: **AG Grid Community** (decided after spike; free MIT tier covers all v1 needs). Gotchas: call `redrawRows()` on sort change (row classes don't auto-refresh); drag-fill/range-paste are Enterprise-only — use checkbox selection + apply-to-selected for bulk edits

## Commands

- `pnpm tauri dev` — run the app (compiles Rust on first run; needs `~/.cargo/bin` on PATH)
- `powershell -File scripts/dev-mcp.ps1` — run the app with the WebView2 CDP port (9223) open; the `app-webview` MCP in `.mcp.json` attaches to it so the agent can inspect/click/screenshot the live app. GUI launches die silently in sandboxed shells — launch unsandboxed
- `pnpm tauri build` — release build; standalone exe at `src-tauri/target/release/`, installers under `bundle/`
- `npx tsc --noEmit` — frontend typecheck (covers `tests/` too)
- `pnpm test` — vitest suite over the data layer's real SQL: an in-memory `node:sqlite` DB runs the actual `src-tauri/migrations/*.sql`, with the Tauri modules aliased to stubs (`tests/helpers/fakeTauri.ts`). Business rules (tab membership, event settling window, sweep, tiers) are the targets; UI rendering and the Rust `execute_batch` internals stay covered by live MCP verification instead

## Rules that shape everything

- Months are data, not structure: one `refills` table, views filter by `due_date`
- `(rx_number, due_date)` is the natural key; import upserts fill NULL fields only and never overwrite technician-entered values
- Profit is verified, never predicted: `old_profit` = last verified profit (what Opportunities shows); `new_profit` is manual-only
- Lookup vocabularies (insurances, refill/call notes) are data, editable in Settings — never hardcode them in components
- All edits persist immediately; no Save buttons. Confirmations only for destructive actions
- Preserve pre-existing working-tree changes. Do not commit, push, merge, publish, create a release, or open a PR without explicit user authorization for that action. When authorized to commit, use a feature branch and never commit directly to `main`. Commit messages and PR text carry no AI-attribution lines (no "Co-Authored-By: Claude" or similar). Docs and decisions are folded into Design_docs as they're made
- PR descriptions use three headed sections in this order — **What** (what the change does), **Why** (the reason for it), **Where** (which parts of the code changed) — written in plain language a non-engineer can follow on first read. In Where, name each file and say what it does and why it had to change, rather than listing paths. Close with a short Checks line giving test results. Reference PR: [#34](https://github.com/Mario-Recondo/Pharmacy-Refill-Opportunity-Tracker/pull/34)
- Never test migrations, automated UI flows, restore behavior, or seed data against the normal development or pharmacy database. Use an isolated temporary database or disposable copy; never delete, replace, restore, seed, or directly edit the normal database without explicit user authorization
- Build releases from PowerShell. Run `scripts/release.ps1` only with explicit release authorization, from clean `main` after the intended changes are merged; never expose the signing key or password file
- A decision that is costly to reverse, surprising to a future reader, AND a genuine trade-off gets an ADR in `Design_docs/adr/` (template + criteria in its README), written in the same PR as the decision. The design doc stays the spec of what is; ADRs record why

## Agent skills

### Issue tracker

GitHub Issues on `Mario-Recondo/Pharmacy-Refill-Opportunity-Tracker` (private), via the `gh` CLI. Native sub-issues and issue dependencies are available. Creating, closing, or labelling an issue is an external action and needs explicit authorization, same as a commit or PR. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context. `Design_docs/refill-tracker-design.md` is the domain model and ADRs live in `Design_docs/adr/` — **not** `docs/adr/`. See `docs/agents/domain.md`.
