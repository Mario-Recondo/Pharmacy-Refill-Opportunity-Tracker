# Refill Tracker

Desktop tool for a pharmacy technician at an independent pharmacy: tracks prescription
refills, contact attempts, copays and net profits, and surfaces high-value refills
coming due. Replaces a Google Sheets month-tab workflow. Single-user, fully offline,
ships as one Windows executable.

Built with **Tauri 2 + React + TypeScript + Vite**, data in **SQLite**, grid on
**AG Grid Community**. The full spec lives in [`Design_docs/refill-tracker-design.md`](Design_docs/refill-tracker-design.md)
(with per-story acceptance criteria in [`Design_docs/user_stories.md`](Design_docs/user_stories.md)).

## Prerequisites (one-time setup)

All commands below are for **PowerShell** on Windows.

1. **Node.js** (LTS) — https://nodejs.org
2. **pnpm** — after Node is installed:
   ```powershell
   npm install -g pnpm
   ```
3. **Rust toolchain** (Tauri's backend compiles with Cargo) — https://rustup.rs, then
   make sure Cargo is on your PATH for the current session if it isn't already:
   ```powershell
   $env:Path += ";$env:USERPROFILE\.cargo\bin"
   ```
4. **WebView2 runtime** — preinstalled on Windows 10/11; nothing to do normally.
5. Install the project's JS dependencies (from the repo root):
   ```powershell
   pnpm install
   ```

## Launching the app (development)

From the repo root:

```powershell
pnpm tauri dev
```

- The **first run compiles the Rust backend and takes a few minutes**; later runs
  start in seconds.
- The app window opens by itself when ready. Frontend edits hot-reload into the
  running window.
- The database is created and migrated automatically on first launch at
  `%APPDATA%\com.pharmacy.refill-tracker\refills.db`. Deleting that file resets
  the app to a blank state on next launch.

### Launching with the test harness attached (agent-driven UI testing)

```powershell
powershell -File scripts/dev-mcp.ps1
```

Same app, but with the WebView2 remote-debugging port (9223) open so the
`app-webview` Playwright MCP configured in `.mcp.json` can inspect, click, and
screenshot the live app. Only needed when an agent should drive the UI;
day-to-day development uses plain `pnpm tauri dev`.

## Building the standalone executable

```powershell
pnpm tauri build
```

- Portable exe: `src-tauri\target\release\refill-tracker.exe`
- Installers (MSI/NSIS): `src-tauri\target\release\bundle\`

## Other useful commands

| Command | What it does |
| --- | --- |
| `npx tsc --noEmit` | Typecheck the frontend |
| `pnpm dev` | Vite dev server only (browser, no Tauri shell — rarely needed) |

## Repository map

- `src/` — React frontend (grid, detail drawer, opportunities panel)
- `src-tauri/` — Tauri shell config and SQLite migrations (`src-tauri/migrations/*.sql`)
- `Design_docs/` — the authoritative spec, user stories, user flows, and reference screenshots
- `scripts/` — development helpers (`dev-mcp.ps1`)

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) with the
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) and
[rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
extensions.

## Contributing workflow

New work goes on a feature branch → push → pull request; `main` is never committed
to directly. Design decisions are folded into `Design_docs/` as they are made.
