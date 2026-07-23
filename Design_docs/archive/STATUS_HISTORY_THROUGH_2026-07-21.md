# Archived Project Status — through 2026-07-21

> Historical record only. This file preserves superseded session handoffs,
> branch states, and release narratives. It is not a source of current
> instructions. See the root `STATUS.md` and `AGENTS.md` instead.

## ⬆ NEWEST: CI + immutable-migration protection pushed (2026-07-21)

- **Active branch:** `feature/ci-migration-protection`, pushed to
  `origin/feature/ci-migration-protection` at commit **`ed3cd6d`**
  (`Add CI and immutable migration guard`). Local and remote branch heads match.
- **Pull request:** not created yet. Next authorized step is to open the PR and
  observe the first hosted GitHub Actions run. Requiring the quality job through
  branch protection remains a separate GitHub-settings change.
- **Migration protection:** `src-tauri/migrations/migration-lock.json` records
  migrations 001–008 by version, exact filename, and raw-byte SHA-256. The Node
  checker validates current file/manifest consistency and compares against an
  exact Git base commit, so changing an old SQL file and updating its checksum
  together still fails. Only higher, sequential migrations may be appended.
- **Bootstrap rule:** the one manifestless trusted base is exact commit
  `9e48dd793b37e44d3d92f56960c7dfce65e34b2a`. Once a base contains the manifest,
  that manifest is validated against its own SQL blobs and becomes the trust
  source. Any other manifestless base fails closed.
- **CI:** `.github/workflows/ci.yml` adds one read-only `windows-latest` quality
  job for pull requests, pushes to `main`, and manual diagnostics. It pins Node
  24.13.0, pnpm 9.15.0, and Rust 1.97.0; runs the migration guard, 138 data tests,
  production build, rustfmt, Rust tests, and strict Clippy; uses
  `permissions: contents: read`; and has no release/signing secrets or deployment
  behavior.
- **Release safety:** `scripts/release.ps1` now runs migration validation before
  reading versions or signing credentials and before build, staging, or publish.
  README and `Design_docs/releasing.md` document the append-only workflow.
- **Tests/validation:** migration guard **18/18**, Vitest **138/138**, production
  build, rustfmt, Rust tests **3/3**, strict Clippy, frozen pnpm install,
  production dependency audit, PowerShell parser check, and `git diff --check`
  all pass. Migrations 001–008 retain their approved hashes and have zero diff.
  The only build note is the existing non-failing Vite large-chunk warning.
- **Review workflow:** Opus CLI planning repeatedly stalled; with user approval,
  a fresh read-only Codex planner (Atlas) replaced it for this run. Luna
  implemented, then Sol reviewed the entire diff and fixed test isolation,
  diagnostics, exact one-byte/current-manifest coverage, and CI manual-run
  reporting before final approval.
- **Preserved local work:** `.gitignore`, the ADR filename change,
  `src-tauri/Cargo.toml`, `.claude/`, this file, the CI seed plan, UI sketches,
  insurance logos, MCP screenshots, and SQL notes remain local and were not
  included in `ed3cd6d`.

## ⬆ NEWEST: v1.2.0 (Call List) PUBLISHED — PRs #18 + #19 merged (2026-07-20)

- **Call List tab shipped to the pharmacy.** PR #18 (feature, `main` ← `call-list`)
  merged; PR #19 (version bump 1.1.0 → **1.2.0**, all four files) merged at `9e48dd7`;
  local branches deleted. `scripts/release.ps1` published **v1.2.0** clean (signed,
  from PowerShell). Endpoint VERIFIED serving 1.2.0 with signature + the Call List
  release notes:
  https://github.com/Mario-Recondo/mr-refill-tracker-releases/releases/download/v1.2.0/refill-tracker_1.2.0_x64-setup.exe
  The technician's installed app is offered 1.2.0 (with the Call List tab) on next
  launch — this is v3 reaching her machine, mid v1.1.0 trial (user chose to release now).
- **Deployment note:** v1.2.0 is now THE current pharmacy build (supersedes v1.1.0).
  1.2.0 = migrations 1–8; a fresh install or update applies 008 automatically.
- Dev app currently STOPPED. Dev DB holds the user's Call List import test (wipe before
  handing anything to the tech).

## Call List tab — PR #18 + #19 merged (2026-07-20; details above)

- **PR #18**: https://github.com/Mario-Recondo/Pharmacy-Refill-Opportunity-Tracker/pull/18
  (`main` ← `call-list`; 2 commits: design-doc `2c6c862` + code `e8ed97b`). User
  tested the fresh-DB import + Call List and approved. Pushed/PR'd directly by the
  Opus 4.8 main thread (session model switched to Opus mid-pipeline — no separate
  Opus agent needed since the main thread already IS Opus).

## Call List tab DONE on branch `call-list` @ `e8ed97b` (2026-07-20; superseded by PR #18 above)

- **v3 Call List tab** built via a full `/sol-luna` run (plan APPROVED in 2 Sol rounds,
  code APPROVED in 2). Preceded by an **Opus 4.8 grill interview** (19 questions) whose
  decision record is the authoritative spec (saved at scratchpad 841c4b1d…/
  callist-decisions.md; folded into design doc v3 section + §8 #1, commit `2c6c862`).
  Resolves Design-doc Open Question #1 (dedicated tab, not a Today filter).
- **What it is:** second tab (Month · **Call List** · Req Follow Up · Overdue · Settings).
  Auto-membership = Pending + new_copay & new_profit set + new_profit >= 0 +
  refills_left >= 1 (NULL/0 excluded) + due today, where **Monday's window also pulls
  the previous Sat+Sun** (pharmacy closed weekends; hardcoded, holidays handled by
  manual pin). Provable inverse of Overdue. Unions **unconditionally-pinned** rows via
  migration **008** (`refills.added_to_call_list_on` DATE; pinned iff = today, falls off
  at rollover). Pin/unpin from the Month-grid right-click menu ("Add to/Remove from
  today's call list"); the Call List's own menu shows Remove only for pinned-and-not-
  auto rows. Rows **stay all day**; called-today (call_note_set_at = today) dims at .45
  (MISSED visual language); pinned rows carry a left-rail accent. **No badge**, sort
  new_profit DESC NULLs-last, month-grid columns, empty state "No refills ready to call
  today". Everything hardcoded. Overlap with Req Follow Up allowed.
- **Tests 138 passing** (new tests/callList.test.ts: membership edges incl. $0/NULL/0
  refills, Monday+Tuesday window boundaries, pin union+dedupe, NULLs-last+id tie-break,
  isCalledToday local-midnight, pin/unpin writes, SQL/client-arm agreement). tsc clean,
  migration 008 byte-verified LF.
- **LIVE-VERIFIED via MCP** on a fresh DB (migrations 1–8): tab position/name; Monday
  window pulled real Sat+Sun rows (today IS a Monday), Friday excluded; $0 row listed;
  unprocessed/zero-refills rows excluded; profit-DESC order; called-today row dimmed;
  pin an unprocessed row from Month ctx menu → appears with rail + NULL-profit last →
  Remove from Call List menu → back to the 4 auto rows. Zero console errors.
  Screenshot: `MCP-screenshots/calllist-verified.png` (untracked).
- **Dev DB** holds the 7-row call-list verification seed (rx 900001–900007). Wipe before
  anything ships. Dev app currently RUNNING (dev-mcp.ps1).
- **Remaining:** user OK → Opus agent push + PR → merge. NOTE this is v3 work on top of
  the shipped v1.1.0; a release only when the user wants v3 in the pharmacy build.

## PR #17 MERGED — main @ `d1e17c2` holds all v2 import work (2026-07-20)

- **PR #17 merged + pulled** (fast-forward; user's first merge click didn't take —
  PR showed OPEN until they confirmed again). Local `v2-import` deleted; migrations
  byte-verified LF post-pull (no CRLF trap); **129/129 tests green on main**.
  User completed the full fresh-DB import walkthrough — "worked well".
- **v1.1.0 PUBLISHED 2026-07-20** by `scripts/release.ps1` (zero workarounds; script
  reads the key + password sidecar itself). Endpoint VERIFIED serving 1.1.0:
  https://github.com/Mario-Recondo/mr-refill-tracker-releases/releases/download/v1.1.0/refill-tracker_1.1.0_x64-setup.exe
  Installed apps (tech's 1.0.3, this machine's dev-DB install) get offered 1.1.0 on
  next launch. v1.1.0 = THE import-capable pharmacy build for Monday.
- **User confirmed the 1.0.x → 1.1.0 auto-update worked on this machine.**
- **Owner-demo prep (2026-07-20 evening):** seeded 19 fake July rows
  (`seed_demo.sql` in session scratchpad 841c4b1d…; drugs/Rx/dollars all invented),
  screenshotted the Month tab → `MCP-screenshots/demo-month-tab.png` (untracked) for the
  user to send the pharmacy owner. Demo DB then WIPED — **dev DB is currently
  deleted/empty**; next launch migrates fresh. User plans a live import demo in
  front of the owner (fresh DB → full wizard flow with July Test Full.xlsx).

## Import-wizard UX fixes on `v2-import` @ `5b9ccf0` (2026-07-20; now pushed, see above)

- Third full `/sol-luna` run (plan APPROVED in 3 rounds, code in 2): four user-found
  issues from the first real-file import fixed. (1) lookups reload after a committed
  import (new insurances/secondaries appear in Settings/dropdowns immediately — they
  always SAVED, the UI was stale); (2) "Blank due dates" panel renders only when rows
  actually lack dates; (3) insurance/secondary dropdowns alphabetized in wizard + all
  grid editors + month filter (Settings keeps manual order; note columns untouched);
  (4) match-names: decided rows stay visible/editable, and a "Create new" name becomes
  a "Use new: X" map-to option for other unresolved names (pure `applyNameChoice`
  helper with ownership/dependent-reset semantics; commit already coalesced
  byte-identical creates via ON CONFLICT). Tests **129 passing** (commit-dedupe +
  transition invariants), tsc clean. Fable fixed one Luna test bug (LIKE matched the
  seed row) and rewrote the transition test for Sol's coverage gaps.
- Live-verified so far: alphabetical month filter via HMR. STILL PENDING: user's
  fresh-DB re-import walkthrough (exercises fixes 1/2/4 end-to-end), then push.
- Dev DB currently holds the user's real 211-row July import (fixes don't touch data).

## Real full-export verified on `v2-import` @ `b38a1d6` (2026-07-20; unpushed)

- The tech sent the TRUE full PioneerRX export shape (`July Test Full.xlsx`, repo root,
  gitignored; 211 rows, 9 columns — the old `JULY2026.xlsx` had only 7 and can be deleted).
  Real fix committed: `dd7f300` — real export says **"Refills Remaining"**, not
  "Refills Left"; added to KNOWN_HEADERS (both recognized) + a test pinning the exact
  9-column real shape (NDC → ignore).
- **False alarm, reverted in `b38a1d6`**: a "shifted-Secondary quirk" (e8defb9) was an
  artifact of a scratch XML-parsing script (its regex swallowed self-closing empty
  cells, attributing the next column's value to Secondary). The REAL Rust reader
  (verified live via invoke) shows the export is perfectly normal: copay in its own
  column, Secondary empty when none. LESSON: validate xlsx claims through the app's
  actual `read_spreadsheet`, not hand-rolled sheet XML parsing.
- **Verified via the wizard's own code in the live app** (Vite module import through
  MCP evaluate): auto-map valid for all 9 headers, 211/211 rows parse with ZERO issues
  (all dates present — dates are serial cells with custom fmt "M/d/yyyy", calamine
  handles them), copay/profit/refills_left populated 211/211, 15 real coupon-program
  secondaries (JOURNAVX + SLYND new vs old file). Tests **127 passing**, tsc clean.
- **User's first live import attempt hit 211 date prompts** — that was the
  probable-duplicate (due-date drift) protection firing because the dev DB still held
  the old-file 468-row July import; NOT a parsing failure. Dev DB since wiped to
  empty (fresh migrations 1–7, no seed, no aliases); app relaunched via dev-mcp.ps1;
  user retrying the import on the clean DB.
- Open decision for user: use `Dispensed Item NDC` to fill drug NDC on import
  (currently ignored; import-created drugs show "no NDC (compound)").

## v2 spreadsheet import DONE on branch `v2-import` @ `2d4c046` (2026-07-18 late night; unpushed, awaiting user OK)

- Built via the second full `/sol-luna` run: plan APPROVED after 4 Sol rounds, code
  APPROVED after 5 rounds; Luna needed 2 passes (first was a skeleton — its turn budget
  truncates big slices; the gap-list relaunch pattern worked). The review loop caught
  **9 real bugs** across rounds (adoption semantics, always-stale drug check, silent
  blank aliases, blocking predicate, refills_filled 0-vs-null parse, edited-mapping
  validation, missing-drug ordering, alias drift, Rust date compile).
- Delivered (version **1.1.0**, migration **007**: refills_left + import_aliases):
  Rust `read_spreadsheet` (calamine/csv, serial→ISO via dependency-free civil-date math,
  Rx-as-string, unit-tested), pure `importPlan.ts` (mapping/parsing/ordered dispositions/
  plan-wide validation), `importData.ts` (single-transaction commit via execute_batch,
  subselect FKs, 8-condition stale-plan guard), ImportWizard (file→columns→match names→
  preview→done; per-row actions; blank-due bulk fix), grid/drawer repoint to refills_left,
  README + design-doc updates (import_aliases is a §4 table). Tests: **126 passing**
  (40 import), cargo 3/3, tsc clean.
- **LIVE-VERIFIED against the real JULY2026.xlsx (468 rows)**: auto-mapped columns; 29
  unresolved names resolved once (5 map-to-existing incl. hyphen variants, 2 create-new
  → VILLAGE RX LOCAL (203 rows!) + MAYNE, 22 blank); 468 inserted atomically; DB
  spot-checks byte-exact; **re-import skipped Match names and previewed 0 new / 0 update /
  468 no-change / Import 0 rows** (idempotent). Zero console errors.
- **Dev DB now contains the real July data** (468 imported rows + the 10-row seed;
  aliases populated). Fine for dev; the pharmacy machine is unaffected. JULY2026.xlsx
  sits at repo root, gitignored via the new `/*.xlsx` rule.
- NOTE: the committed .gitignore also carries the user's pre-existing INTERVIEW_PREP.md
  line (unsplittable from the needed /*.xlsx hunk without index surgery; flagged to user).
- **Remaining:** user OK → Opus agent push + PR → merge → `scripts/release.ps1` publishes
  **v1.1.0** → Monday's link serves the import-capable installer (supersedes v1.0.3).

_Last updated: 2026-07-18 evening (auto-updater IMPLEMENTED + committed on branch `auto-updater` @ `b9e1c89`, sol-luna pipeline, both Sol gates APPROVED; NOT pushed yet — awaiting user confirmation; then releases-repo creation + v1.0.1 publish + e2e update test)_

## Current state: auto-updater done on `auto-updater` branch (unpushed); main at `20770e3` (through M6 / PR #13)

- **Auto-updater implemented 2026-07-18** (branch `auto-updater`, commit `b9e1c89`;
  second run of the `/sol-luna` pipeline: plan APPROVED in 3 rounds, code APPROVED in 2).
  Delivered: version **1.0.1**; `tauri-plugin-updater` + `tauri-plugin-process` wired
  (Cargo/lib.rs/capabilities/`createUpdaterArtifacts`/pubkey+endpoint, NSIS passive mode);
  `src/lib/updater.ts` (silent launch check — DEV-guarded — + loud manual check, native
  ask before install); Settings got a 7th **About** section (version + Check for updates,
  verified live via MCP, zero console errors); `scripts/release.ps1` (version lockstep
  check → signed build → space-free staged assets → BOM-less latest.json via
  ConvertTo-Json → `gh release create`); ADR 0004; `Design_docs/releasing.md` runbook.
  Verified: cargo check clean, tsc clean, **86/86 tests**, signer works via env vars.
- **KEY FACTS — signing keypair (rotated 2026-07-18):** private key
  `%USERPROFILE%\.tauri\refill-tracker.key` + password sidecar
  `%USERPROFILE%\.tauri\refill-tracker.key.password` (BOTH must be backed up off-machine;
  losing either kills updates for installed apps). **Gotcha discovered empirically:** an
  empty-password key can NEVER sign non-interactively on Windows — `$env:X = ""` deletes
  the var (Windows can't hold empty env values) and the tauri CLI hangs on a hidden
  console prompt when `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is absent (it prints "Signing
  without password." then blocks). Hence the passworded key + sidecar. Also: once
  `createUpdaterArtifacts` + pubkey are in tauri.conf.json, plain `pnpm tauri build`
  needs BOTH env vars set or it fails/hangs (README documents the two lines).
- **Updater endpoint (baked into the app):**
  `https://github.com/Mario-Recondo/mr-refill-tracker-releases/releases/latest/download/latest.json`
  — a separate PUBLIC releases-only repo (user decision; app repo stays private; ADR 0004).
  **Repo CREATED 2026-07-18** (public, with README so releases/tags are possible):
  https://github.com/Mario-Recondo/mr-refill-tracker-releases — name is the owner's pick,
  updated everywhere in commit `648609c`.
- **UPDATER ROLLOUT COMPLETE except Monday's trial (all verified 2026-07-18 evening):**
  PR #14 merged (main `1e8ff25`); public repo live; **v1.0.1 published**, then the full
  **e2e update test PASSED**: silent-installed v1.0.1 (`/S` flag works on the NSIS
  setup), published throwaway **v1.0.2**, user launched the installed app → update
  dialog appeared → Install and restart → app relaunched as **v1.0.2** with data intact
  (user-confirmed). Keys backed up to the user's Proton Pass (key file is ONE base64
  line — tauri's wrapped format, normal). Local throwaway 1.0.2 version bumps reverted;
  repo files say 1.0.1.
- **GOTCHA found on first release attempt: `pnpm tauri build` reads
  `TAURI_SIGNING_PRIVATE_KEY` (path OR content) — the `_PATH` variant is honored ONLY by
  `tauri signer sign`.** The build fails with "A public key has been found, but no
  private key" if only `_PATH` is set. Fixed in **PR #15 (OPEN, awaiting merge)**:
  https://github.com/Mario-Recondo/Pharmacy-Refill-Opportunity-Tracker/pull/15
  (branch `fix-release-signing-env`, commit `02628b2`; the fixed script published
  v1.0.2 standalone in a fresh shell, proving the fix). v1.0.1 was published by
  pre-setting the correct var in-session.
- **v1.0.3 = THE PHARMACY RELEASE, published 2026-07-18 evening.** PR #15 (signing env
  fix) and PR #16 (version bump) both merged; main at `aa944d8`; local branches deleted.
  Published by the merged script with zero workarounds; endpoint verified serving 1.0.3;
  download link verified live:
  `https://github.com/Mario-Recondo/mr-refill-tracker-releases/releases/download/v1.0.3/refill-tracker_1.0.3_x64-setup.exe`
  (public, no GitHub account needed — sent to the tech as a LINK, not an attachment).
  Monday: she downloads, SmartScreen "More info → Run anyway", per-user install, no
  admin. The pre-updater 1.0.0 artifacts are obsolete. The installed app on THIS
  machine (currently 1.0.2, shares the dev DB) will offer 1.0.3 on next launch — fine.
  Remaining M6 human items unchanged: her real-day trial + backup/restore native-dialog
  checks. Next build work after the trial: **v2 CSV import** (Epic 5).

- **PR #13 (M6 packaging) merged + pulled 2026-07-18.** First main pull in this
  project that did NOT trigger the CRLF migration trap — all six migrations
  stayed LF (byte-verified), so no dev-DB wipe was needed. The `.gitattributes`
  root-cause fix is confirmed working in practice. Local branch `m6-package` deleted.
- **Deployment plan for the pharmacy (decided/discussed 2026-07-18):** the app
  goes on ONE pharmacy computer, updated remotely by the owner from home.
  Pharmacy machine **has internet** (confirmed); IT constraints (SmartScreen on
  the unsigned app, admin rights, AV, firewall to the update endpoint) still
  unknown — the first manual install doubles as the probe. Path of record:
  **first install is manual** (ship the NSIS `-setup.exe` via USB or a cloud/
  GitHub-Releases download LINK — NOT an email attachment; providers block .exe),
  then a **Tauri auto-updater** takes over (frequent early updates expected).
  Auto-updater = its own follow-on piece: `tauri-plugin-updater` + a signing
  keypair (`tauri signer generate`, private key stays home) + a GitHub Releases
  endpoint (+ optionally CI to publish on tag). Authenticode/SmartScreen signing
  is separate/optional (~$100-400/yr) from the updater's required signature.
  Migration discipline holds: never edit a shipped migration, only add; test new
  migrations against a copy of a real DB before pushing an update.

- **M6 release build + acceptance DONE 2026-07-17** (items 5–6):
  - `pnpm tauri build` succeeds (run from **PowerShell** — from Git Bash the
    `beforeBuildCommand: pnpm build` fails because tauri spawns it via cmd.exe
    which can't read Git Bash's Unix-style PATH). Release compile ~2m10s.
  - Artifacts: portable `src-tauri/target/release/refill-tracker.exe` (12.6 MB,
    FileVersion/ProductVersion **1.0.0**, ProductName "Refill Tracker"), plus
    installers `bundle/msi/Refill Tracker_1.0.0_x64_en-US.msi` (4.7 MB) and
    `bundle/nsis/Refill Tracker_1.0.0_x64-setup.exe` (3.3 MB).
  - **Fresh-install migration verified on the RELEASE exe**: wiped %APPDATA%,
    launched the exe, it created a fresh DB and applied migrations **1–6**
    cleanly (proves the LF/CRLF fix works in a real release artifact, not just
    dev). Note: the app uses **WAL mode** — `refills.db` stays ~4 KB while data
    lives in `refills.db-wal`; don't gauge "DB created" by the main file size.
  - **Default-group gating verified live (dev + MCP)**: a seeded default group
    (Oscar Health) kebab shows only "Pick logo …" (no Delete); a custom empty
    group shows "Pick logo …" + "Delete…". Confirms `is_default` reaches the UI.
  - Dev DB currently reseeded with the 10-row follow-up seed (clean, no leftovers).
- **STILL PENDING for M6**: item 7 the **technician's real-day trial** (human
  only), and the branch is **not pushed / no PR** yet (confirm before push).
  Manual checks left for the user on the release build: backup/restore native
  folder dialogs (not MCP-drivable) and the literal double-click-from-Explorer launch.

- **M6 packaging — implementation slice done 2026-07-17** (branch `m6-package`,
  commit `01603e3`; built via a multi-agent pipeline the user designed:
  Fable planned → Codex `gpt-5.6-sol` reviewed the plan (1 revision round) →
  Codex `gpt-5.6-luna` implemented → Fable reviewed the diff + fixed → sol
  reviewed the code vs plan → **APPROVED**). Delivered:
  - Version 0.1.0 → **1.0.0** in tauri.conf.json, package.json, Cargo.toml, Cargo.lock.
  - **Real app icon** — white serif "Rx" on the ink field (matches header wordmark),
    1024² source at `src-tauri/icon-source.png` → regenerated desktop icon set
    (mobile android/ios outputs removed as unused).
  - **`.gitattributes`** pins `src-tauri/migrations/*.sql` to LF — root-cause fix for
    the recurring CRLF migration-checksum trap. (Repo already stored LF; the fix
    stops the CRLF *checkout*. Dev DB was reset once for the transition.)
  - **Non-deletable default groups** (closes QUESTIONS #5): migration **006** adds
    `insurance_groups.is_default`, flags the 10 seeded brand groups, registered as
    migration v6 in lib.rs. `deleteGroupIfEmpty` refuses defaults (plus empty check);
    Settings hides Delete for defaults (rename/reorder/logo/move still allowed).
  - Tests: **86 passing / 10 files** (new `tests/groups.test.ts` proves the is_default
    guard specifically — empties a seeded default first). `tsc --noEmit` clean.
  - **Codex CLI was upgraded 0.140.0 → 0.144.5** this session (the gpt-5.6-* models
    require it; stale broker pid killed to force the new runtime). Companion `cancel`
    is broken on Git Bash (mangles `taskkill /PID`) — clear stale jobs by editing
    status→cancelled in the companion state.json if it recurs.
  - **Gotcha found:** `grep -c $'\r'` gives FALSE POSITIVES for CR bytes in this
    Git Bash — luna's CRLF "verification" trusted it and was wrong. Use a byte-scan
    (`node -e '...filter(b=>b===13).length'`) to check line endings here.
- **PR #12 (data-layer test suite) merged + pulled 2026-07-17**; local branch
  `test-suite` deleted; CRLF trap did not fire (no migrations touched). Details:
  vitest + in-memory
  `node:sqlite` (no native dep; Node 24's built-in driver) running the REAL
  `src-tauri/migrations/*.sql`, with `@tauri-apps/plugin-sql` and
  `@tauri-apps/api/core` aliased to stubs (vitest.config.ts →
  tests/helpers/fakeTauri.ts) so the data layer's actual SQL strings are what
  is tested. 80 tests / 9 files, ~0.5 s: Overdue + Req Follow Up membership
  (incl. threshold doorway + $0-profit edges), event settling window
  (merge/cancel/rolling + inclusive 2-min edge), sweep idempotency +
  deleted-row span closure, date math (local-calendar semantics),
  drug/natural-key identity + drawer identity edits (updateRefillCore /
  loadRxDrug / updateRxDrug), atomic-batch failure rollback, creation-time
  note clocks, copay tier boundaries + profit shading, behavior-flag rules.
  Mutation canary verified the suite catches a real rule change. **Codex
  review + re-review (2026-07-17) applied over two commits**: first pass
  strengthened two weak assertions and added the missing
  refill_note/boundary/atomicity/drawer coverage; re-review confirmed 8/10
  original findings genuinely fixed and flagged two of the NEW tests as
  under-proving — closed by (a) a batch-level test that rolls back an
  already-succeeded row UPDATE when the following event INSERT fails (the real
  row+event ordering, not just a first-statement failure), and (b) invoke-spy
  routing assertions proving single statements bypass execute_batch while
  multi-statement batches go through it. 82 tests / 9 files. Accepted as
  documented limits: Rust execute_batch internals emulated (verified live,
  ADR 0003) and migration 005's one-time backfill untested. Deliberately NOT
  tested: React/AG Grid rendering, E2E (live MCP verification owns those).
  `pnpm test`; tsc covers tests/ now. New devDeps: vitest, @types/node.

  Ops note: the re-review resume was initially blocked by a stale Codex
  companion job (`task-mrp8mzqo`, a hung duplicate of the completed review)
  whose `cancel` fails on Git Bash (MSYS mangles `taskkill /PID`); its process
  was already dead, so it was cleared by editing status→cancelled in the
  companion's state.json + job json.
- **PR #11 (Overdue narrowing) merged + pulled 2026-07-17**; local branch
  deleted; CRLF trap did not fire (no migrations touched).

- **Overdue redefinition decided + implemented 2026-07-17** (grill interview,
  closing QUESTIONS.md #7 / design doc Open Question #6): Overdue = Pending +
  due date strictly past + **not yet processed** (new_copay OR new_profit
  empty); filling both removes the row whatever the profit's value. MISSED
  rows stay forever as the permanent record but render **greyed
  (`.overdue-missed`, opacity .45 — dims, never recolors)** and are excluded
  from badge/banner/tally. Deliberate gaps accepted: processed rows without a
  follow-up note or inside the wait window sit on neither worklist (month grid
  only); loss rows (profit ≤ $0) leave Overdue and never enter Req Follow Up.
  Tab name stays "Overdue". Touched: loadOverdue/loadOverduePendingCount
  (SQL), OverdueView (banner/tally/empty-state copy + row class), App.css,
  design doc §6.1.5/§8.6, story 1.7, QUESTIONS.md #7 → Answered. **Verified
  live via MCP**: seed gives exactly 700006 + 700010→(only 700006 after its
  leftover values) to process, 700009 MISSED greyed/uncounted; fill-both →
  row leaves + badge clears; partial fill stays; clearing from Month tab
  re-enters; filters intact; zero console errors. No schema change.

- **PR #10 (pre-v2 SQL batch) merged 2026-07-17**; local branch deleted.
  **CRLF trap fired on the post-merge pull** (migration 005's checksum
  mismatched) — routine fix applied same session: DB wiped, relaunch
  re-migrated 1–5 cleanly, reseeded with the followup verification seed
  (10 rows, rx 700001–700010, fresh copy — the 2026-07-16 walkthrough
  leftovers on 700001 are gone). Dev app stopped after. Seed's "today" was
  2026-07-15, so days-quiet values drift +1/day (700004 crosses the 5-day
  threshold ~2026-07-18); still **wipe before handing anything to the tech.**
- **Pre-v2 SQL batch implemented 2026-07-16**: SQL review
  M1+M2 fixed + NULL-NDC drugs gap closed (migration 005). **Key discovery
  (ADR 0003)**: the planned JS-side BEGIN/COMMIT was impossible —
  tauri-plugin-sql pools up to 10 SQLite connections, so transactions must
  run in Rust. New generic `execute_batch` Tauri command (real sqlx
  transaction over the plugin's own pool; also v2 import's primitive) +
  global `serializeWrite` chain in src/db.ts routing ALL data-layer writes
  (refills.ts + settingsData.ts; M4/L2 closed as side effects). Verified
  live via MCP: migration 005 applied to dev DB, call-note walkthrough
  exercised all three event shapes (insert / settle-window merge /
  cancel-delete) through the Rust transaction; zero console errors.
- **PR #9 (SQL hardening) merged 2026-07-16**: restore-failure handle reset,
  ISO timestamps in migration 004, drug upsert. CRLF trap did NOT fire on
  the post-merge pull — dev DB + follow-up seed intact, no wipe needed.
- **PR #8 (drawer-row highlight) merged 2026-07-15**: the open drawer's grid
  row stays highlighted (ink outline + tint, all three grids; opp-hover
  inset-shadow trick + targeted redrawRows). Verified live on all tabs.
- **Process change (user instruction 2026-07-15): pushes and PR writing are
  delegated to a spawned Opus 4.8 agent** (saved to auto-memory).
- **CRLF migration trap struck again post-#7-merge**: pulling main rewrote
  `004_req_followup.sql` line endings → "migration 4 was previously applied
  but has been modified" on the dev DB. Fixed the usual way (wipe + relaunch
  + reseed with scratchpad seed_followup.sql).

- **PR #7 (Req Follow Up tab) merged 2026-07-15** (grill interview + ADR
  0002): the "waiting on the patient" worklist. Membership is a
  **pure filter** — Pending + new_copay set + new_profit > $0 + call note
  flagged `requires_followup` (new call_notes behavior flag, seeded on the six
  +RSL/P/U notes) + more than `followup_wait_days` (Settings, seeded 5) since
  `call_note_set_at` (new refills column, backfilled to migration date).
  **No auto-status change** — auto-MISSED and a fourth status were both
  rejected (ADR 0002); MISSED stays manual. Analytics ride on the new
  append-only `refill_events` log: note/status changes (2-minute settling
  window — rapid corrections merge, anything older is history with time of
  day shown; profit snapshot on Checked Out) + followup_entered/left spans
  written by an idempotent sweep (launch, every data change, day rollover). Drawer got a
  read-only Activity section; Settings got the flag checkbox + wait-days
  threshold. Migration 004. Overdue tab deliberately untouched — "what does
  Overdue mean now" is QUESTIONS.md #7, the tech's next conversation
  (also pending her: #8 Activity list shape, #9 P/U in the follow-up set).

- **PR #5 (M5: Settings + logos) merged 2026-07-14** — stories 4.1–4.3 + 4.5.
  Settings is the third tab (left sidebar, six sections): grouped insurance
  CRUD, flat lists for secondaries/notes, thresholds + full copay tier editor,
  backup/restore. Key model: **brand group + Medicare/Medicaid designation
  flags** (one nullable `group_id` per plan; Ungrouped renders plain),
  **logo-or-nothing** cells (insurance/secondary colors retired), groups are
  data with a **bundled fixed logo set** (`src/assets/insurance-logos/`,
  registry `src/lib/logoAssets.ts`). Rules key off behavior flags
  (`allows_call_note`, `shows_age_counter`) — renames can't break behavior
  (verified live). Backup = persisted folder + one-click `VACUUM INTO`;
  restore = validate → native confirm → auto pre-restore snapshot → file swap
  via Rust `replace_database_and_restart` → relaunch (user-tested manually).
- **window.confirm is banned for destructive actions** — it failed silently in
  real use (a plan got deleted with no warning). Everything destructive goes
  through `confirmDestructive()` in `src/lib/confirmDialog.ts`
  (tauri-plugin-dialog `ask()`, native warning dialog). Native dialogs are NOT
  MCP/Playwright-drivable — always manual-test those flows.
- **PR #6 (visual identity pass) merged 2026-07-15.**
  Chrome-only identity pass, user reviewed and approved in the running app:
  ink token system in `:root` (#1D3557 ink = structure/nav, #C1352B urgent,
  green = money only), dark header band with "Rx" wordmark, white-pill active
  tab, unified ctx/kebab menus + aligned check gutters, app-wide focus rings,
  ink day-break rule (was stray indigo), real Cargo.toml metadata.
  **Hard user constraint: business color coding (copay tiers, note/status
  colors, profit shading) must never change — chrome only.**
- **Visual backlog** (identified in the screenshot critique, user hasn't
  picked yet): (a) logo rendering — UnitedHealth wordmark illegible at
  16×42px, needs per-logo sizing + fixed logo gutter + smaller/greyer
  designation suffix; (b) insurance pill dropdown is a bare white list since
  colors retired; (c) Settings dead right column (max-width 760 + floating
  scrollbar). Screenshots: `polish-*.png` (before), `polish-after-*.png`
  (after), repo root untracked.

## Next steps (fresh session)

**Resume here (handoff 2026-07-18 evening):** the auto-updater is DONE and committed on
branch `auto-updater` (`b9e1c89`), both Sol reviews APPROVED — see "Remaining to finish
the updater rollout" up top for the 6-step tail (push/PR needs user confirmation first).
Dev DB clean-seeded (10 rows rx 700001–700010, migrations 1–6; reseed from
`seed_followup.sql` in scratchpad 66a80940… via `C:\msys64\ucrt64\bin\sqlite3.exe`).
The 1.0.0 artifacts at `src-tauri/target/release/` are now OBSOLETE (pre-updater; they
can never self-update) — the pharmacy must get a build produced by `scripts/release.ps1`.

Environment facts a fresh session needs: **build from PowerShell, not Git Bash**
(Git Bash breaks tauri's beforeBuildCommand). The **CRLF migration trap is now fixed**
by `.gitattributes` (verify with a Node byte-scan, NOT `grep` — grep false-positives on
CR here). Codex CLI was upgraded to **0.144.5**; the `/sol-luna` skill lives at
`~/.claude/skills/sol-luna/` and drives Codex models `gpt-5.6-sol` (reviewer) /
`gpt-5.6-luna` (implementer). Push/PR still goes through a spawned Opus agent, and
**confirm with the user before any push**.

1. **Technician's real-day trial** of the v1 release build (M6 item 7 — the
   milestone's human exit criterion). Deliver the NSIS installer to her machine
   (first install is manual; see deployment plan up top). Also two manual checks
   on the release exe: double-click-from-Explorer launch, and backup/restore via
   the native folder dialogs. Consider visual-backlog item (a) logo legibility
   before she sees smudge logos.
2. **Auto-updater** (follow-on, now that internet is confirmed): `tauri-plugin-updater`
   + signing keypair + GitHub Releases endpoint, so updates push from home. Good
   candidate for the `/sol-luna` pipeline. See deployment plan up top.
3. Then **v2 = CSV import** (Epic 5), **v3 = Call List + analytics**.

Done earlier this cycle: PR #9 (SQL hardening) merged + pulled 2026-07-16;
SQL review follow-up finished as PR #10 (atomic writes, ADR 0003), merged +
pulled 2026-07-17 — only L1 (membership computed 3×) remains, parked until
v3 analytics. Dev DB: fresh followup verification seed (10 rows, rx
700001–700010; seed at scratchpad 66a80940…/seed_followup.sql) on
migrations 1–5. (#7's Req Follow Up verification was done 2026-07-15:
fresh-DB migration, seeded MCP walkthrough — membership + near-misses,
badge, newest-first order, row exits, 2-min settling window both paths,
Settings flag + threshold live-shift, Overdue unchanged.)

## Waiting on the user / technician

1. Opportunities inclusion-rule sanity check (QUESTIONS.md #3).
2. Aet - UMIA / Wausau group placement (QUESTIONS.md #2) — both sit Ungrouped
   (guess: Aet - UMIA → CVS Health; tech's call).
3. Independent PBMs group logo (QUESTIONS.md #4) — its 7 plans render plain.
4. Call List page vs "Today" filter (v3, QUESTIONS.md #1).

## Dev environment notes

- **CRLF migration checksum trap — FIXED as of PR #13 (2026-07-18).**
  `.gitattributes` now pins `src-tauri/migrations/*.sql` to LF, so a Windows
  checkout/pull no longer rewrites their line endings and breaks the
  tauri-plugin-sql checksum. Confirmed: the post-#13 pull did NOT trip it. The
  historical symptom was "migration N previously applied but has been modified"
  on launch; the old fix was to delete
  `%APPDATA%/com.pharmacy.refill-tracker/refills.db`, relaunch, reseed. If it
  ever recurs, verify line endings with a **Node byte-scan**
  (`node -e '…filter(b=>b===13).length'`), NOT `grep` (false-positives here).
- Dev DB currently (2026-07-18): freshly recreated by the release exe (migrations
  1–6) then reseeded clean with the **Req Follow Up verification seed** (10 rows,
  rx 700001–700010: 3 qualifying, 5 near-misses, 1 MISSED, 1 unworked past-due).
  No walkthrough leftovers this time. Note the seed's internal "today" is
  2026-07-15, so quiet-day counts read a few days higher than the seed comments.
  Reseed: `seed_followup.sql` in session scratchpad 66a80940… via
  `C:\msys64\ucrt64\bin\sqlite3.exe` (older 18-row `seed_sample.sql` copies in
  scratchpads d629f3cc… and f94af8a7…). Avoid sqlite3 writes while the app
  runs; **wipe before handing anything to the tech.**
- Opening http://localhost:1420 in a plain browser shows "Database error:
  …reading 'invoke'" — harmless (no Tauri runtime outside the app window);
  user knows, declined a friendlier message.
- Run: `pnpm tauri dev`, or `powershell -File scripts/dev-mcp.ps1` for MCP
  testing (unsandboxed shell; poll tasklist for `refill-tracker.exe`; kill the
  exe before relaunching or MCP attaches to a dead CDP session).
- MCP gotchas: use `[row-id]`/`[col-id]` locators (NOT `.ag-center-cols-*` —
  returns empty); columns horizontally virtualized (scroll first); React
  inputs need the native value setter + `input` event, and **onBlur needs
  `FocusEvent('focusout')`** — a plain `blur` event does nothing; native
  dialogs (confirmDestructive, file pickers) can't be driven at all.
- **Never round-trip source files through PowerShell**
  (`Get-Content -Raw`/`Set-Content` mangles UTF-8 → mojibake); use Edit/Write.
- gh PR bodies with embedded quotes break PS arg parsing — use `--body-file`.

## Milestones to complete v1 (acceptance criteria in Design_docs/user_stories.md)

### M4 — Overdue tab  ✅ merged (PR #4)
### M5 — Settings + insurance logos  ✅ merged 2026-07-14 (PR #5)
### Visual identity pass  ✅ merged 2026-07-15 (PR #6)
### Req Follow Up tab + event log  ✅ merged 2026-07-15 (PR #7, ADR 0002)
### Drawer-row highlight  ✅ merged 2026-07-15 (PR #8)
### SQL hardening + pre-v2 atomic-writes batch  ✅ merged 2026-07-16/17 (PRs #9–#10, ADR 0003)
### Data-layer test suite (vitest)  ✅ merged 2026-07-17 (PR #12)

### M6 — Package & acceptance  ✅ merged 2026-07-18 (PR #13)
Version 1.0.0, real "Rx" app icon, `.gitattributes` CRLF fix, non-deletable
default groups (migration 006). Release build produced (`refill-tracker.exe`
+ NSIS/MSI installers) and accepted: fresh-install migration verified on the
real release exe, default-group gating verified live. **Remaining:** the
technician's real-day trial (item 7, human) + delivering the installer to her
machine. Build from **PowerShell** (Git Bash breaks the beforeBuildCommand).

Then auto-updater (follow-on), then v2 = CSV import (Epic 5), v3 = Call List + analytics.

## Quick orientation

- Spec: `Design_docs/refill-tracker-design.md` (+ stories, flows), summarized in CLAUDE.md
- Typecheck: `npx tsc --noEmit`
- Statuses: Pending / Checked Out / MISSED; loss = Checked Out + negative New Profit
- History (per Rx) is strictly by rx_number; one Rx # = one medication (§5)
- Grill interviews (`/grill-me`) worked well for M4 columns + M5 Settings —
  consider one for M6 packaging decisions.
