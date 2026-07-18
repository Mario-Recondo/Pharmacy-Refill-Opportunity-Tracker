# Refill Tracker

Desktop tool for a pharmacy technician at an independent pharmacy: tracks prescription
refills, contact attempts, copays and net profits, and surfaces high-value refills
coming due. Replaces a Google Sheets month-tab workflow. Single-user, all pharmacy
data stays local — the app's only network activity is checking for and downloading
its own updates. Ships as one Windows executable.

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

> Run this from **PowerShell**, not Git Bash. Tauri runs its `beforeBuildCommand`
> (`pnpm build`) through `cmd.exe`, which can't read Git Bash's Unix-style `PATH`
> and fails with `'pnpm' is not recognized`.

The build produces three artifacts:

- **Portable exe** (run directly, no install): `src-tauri\target\release\refill-tracker.exe`
- **NSIS installer** (ship this — see below): `src-tauri\target\release\bundle\nsis\Refill Tracker_<version>_x64-setup.exe`
- **MSI installer** (alternative): `src-tauri\target\release\bundle\msi\Refill Tracker_<version>_x64_en-US.msi`

With updater artifacts enabled, the build also emits `.sig` signature files next
to the installers. Installer builds now require the signing key **and its
password** in the current PowerShell session:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\refill-tracker.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Raw "$env:USERPROFILE\.tauri\refill-tracker.key.password").Trim()
```

Otherwise `pnpm tauri build` fails (or hangs waiting for a password prompt).
`scripts/release.ps1` sets both automatically. The release flow uses the NSIS
`-setup.exe` and its `.sig` pair.

The installers live under `target\release\bundle\nsis\` and `target\release\bundle\msi\`.
Don't confuse the `bundle\nsis` folder with the plain `target\release\nsis\x64\` folder
next to it — that one holds the installer's build *scripts* (`.nsi`/`.nsh`), not the
installer itself.

## Installing on another computer

To put Refill Tracker on the pharmacy computer (or any other Windows PC):

1. **Build the installer** on your machine (above), then copy
   `Refill Tracker_<version>_x64-setup.exe` from `src-tauri\target\release\bundle\nsis\`
   to the target computer — USB drive, a download link, wherever's easiest.
2. **Double-click the setup `.exe`** on that computer. Windows SmartScreen will warn
   *"Windows protected your PC / unknown publisher"* because the app isn't
   code-signed — click **More info → Run anyway**. (A code-signing certificate
   removes this warning but isn't required.)
3. The installer runs **per-user by default — no administrator rights needed** — and
   adds a Start Menu entry. Launch it like any installed app.

What happens on that computer:

- **The database is created automatically on first launch** at
  `%APPDATA%\com.pharmacy.refill-tracker\refills.db`, and all migrations run then —
  there is nothing to set up. WebView2 (the app's rendering engine) is preinstalled
  on Windows 10/11, so there's no separate runtime to install.
- **Updating**: after the first manual install, the app self-updates from GitHub
  Releases. It checks at launch and asks before installing. Manual reinstall stays
  available as a fallback, and updates keep the existing database. (Hard rule for
  updates: never edit a migration that has already shipped; only add a new one, or
  the existing database will reject the new build. Test a new migration against a
  copy of a real database first.)
- **Uninstalling**: via *Settings → Apps* like any program. This removes the app but
  **leaves the database** in `%APPDATA%`, so data survives a reinstall.

> On your own dev machine the installed app shares the same `%APPDATA%` database as
> `pnpm tauri dev` and the portable exe (they all use the same app identifier), so
> don't run two of them at once — SQLite will lock. On a separate computer this is a
> non-issue.

## Releasing an update

See [`Design_docs/releasing.md`](Design_docs/releasing.md) and run
[`scripts/release.ps1`](scripts/release.ps1) from PowerShell.

## Running the tests

From the repo root:

```powershell
pnpm test
```

Runs the whole suite once — about half a second, roughly 70 tests. No app, no
dev server, and no Rust build needed: the tests run the data layer's real SQL
against an **in-memory SQLite** built from the actual migration files in
`src-tauri/migrations/`, so your development database is never touched. The
`ExperimentalWarning: SQLite` lines Node prints are harmless (its built-in
driver is newish).

Useful variations:

```powershell
pnpm vitest                      # watch mode — reruns as you edit files
pnpm test tests/overdue.test.ts  # a single test file
pnpm vitest -t "settling"        # only tests whose name matches, in watch mode
```

The suite covers the business rules (tab membership, the event settling window,
the follow-up sweep, copay tiers, date math). UI rendering and native dialogs
are deliberately not covered here — those are verified in the running app.

## Other useful commands

| Command | What it does |
| --- | --- |
| `npx tsc --noEmit` | Typecheck the frontend and the tests |
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
