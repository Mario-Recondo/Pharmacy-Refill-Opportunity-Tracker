// Hover text for the diagnostics panel. Kept out of the component so the table
// markup stays readable, and so there is one obvious place to describe a metric
// when you add one.
//
// Write these for someone who did not write the instrumentation: say what the
// number measures, when it happens, and what a bad value would mean. A tooltip
// that only restates the label is worse than none.

/** Every operation name the app records. Adding instrumentation? Add it here
 *  too — `tests/diagnostics.test.ts` fails if a name has no description. */
export const INSTRUMENTED_OPERATIONS = [
  "db.write-queue-wait",
  "db.transaction",
  "query.month",
  "query.call-list",
  "query.overdue",
  "query.req-follow-up",
  "followup.sweep",
  "refill.update-field",
  "startup.lookups",
] as const;

export type InstrumentedOperation = (typeof INSTRUMENTED_OPERATIONS)[number];

const OPERATIONS: Record<InstrumentedOperation, string> = {
  "db.write-queue-wait":
    "How long a write sat waiting before it even started. Every write in the app runs strictly one at a time, so this is the queue behind them. If it climbs while you work, writes are arriving faster than SQLite is finishing them — and slow typing that feels like a UI problem is really this.",
  "db.transaction":
    "Time to commit one all-or-nothing batch of SQL. The 'statements' detail says how big the batch was, which separates a two-statement cell edit from a thousand-statement import.",
  "query.month":
    "Loading one month of refills for the Month grid. Runs on every month switch and every return to the tab. The 'rows' detail is how many came back.",
  "query.call-list":
    "Loading today's Call List. Runs on each visit to the tab, and covers both the automatic due-date window and manually pinned rows.",
  "query.overdue":
    "Loading the Overdue tab: past-due rows whose insurance has not been run, plus every MISSED row ever. It grows forever by design, so watch this one as the database ages.",
  "query.req-follow-up":
    "Loading the Req Follow Up tab. 'fetched' is how many rows crossed out of the database; 'kept' is how many survived the quiet-days filter, which is applied in JavaScript afterwards. A wide gap means that filter should move into the SQL.",
  "followup.sweep":
    "Reconciles the follow-up span event log. Runs at launch, at midnight, and after EVERY saved change — and re-reads the whole event history each time, so its cost grows with the log rather than with the edit that triggered it.",
  "refill.update-field":
    "Saving one field of one refill — the most frequent write in the app. The 'field' detail is the column name; note and status edits do extra event-log work, plain ones do not.",
  "startup.lookups":
    "Loading insurances, notes and settings. Blocks first paint, and on a cold start also covers opening the database file and running any pending migrations. Runs again after every Settings change.",
};

/** Hover text for an operation, or undefined for a name we know nothing about
 *  (no tooltip beats a meaningless one). */
export function describeOperation(name: string): string | undefined {
  return OPERATIONS[name as InstrumentedOperation];
}

/** Hover text for the fixed labels, table headers and import counters. */
export const LABELS: Record<string, string> = {
  // Session
  Uptime: "How long this app session has been running. Every number here resets when the app restarts — nothing is written to disk.",
  "App version": "Version from tauri.conf.json. Shows 'n/a' if you are running Vite alone, without the Tauri host.",
  "Startup (lookups)": "How long the first load of insurances, notes and settings took. The app shows 'Loading…' until it finishes.",
  "Operations recorded": "Total measurements taken this session, including ones since dropped from the Recent list. The per-operation counts below are also complete.",
  Failures: "Operations that threw an error. The errors themselves are listed at the bottom of this panel.",
  Retention: "Samples kept versus the cap. Older samples are discarded so memory cannot grow without limit; the per-operation totals are unaffected by that.",

  // Operations table
  Operation: "The instrumented operation. Hover any name for what it measures.",
  Count: "How many times it ran this session.",
  Fail: "How many of those runs threw an error.",
  Avg: "Mean duration. Averages hide spikes — read Max alongside it.",
  Max: "Slowest single run this session. A large gap from Avg means something stalls occasionally, and that stall is what you actually feel.",
  Last: "The most recent run, useful right after you do the thing you are investigating.",

  // Slowest / errors tables
  At: "Clock time the operation started.",
  Duration: "Wall-clock time from start to finish, including any time spent waiting.",
  Detail: "Metadata recorded with the call. Counts and durations only — never patient data.",
  Error: "The error message. Stack traces are deliberately not kept; they are too noisy for a table.",

  // Last import counters (these come from the recorded metadata keys)
  planned: "Rows the commit plan intended to write.",
  inserted: "New refill rows created.",
  updated: "Existing rows that had blank fields filled in. Import never overwrites something you typed.",
  skipped: "Rows with nothing to change, or ones you chose to skip during review.",
  errors: "Rows excluded from the commit because they had problems. They are listed for review, never silently dropped.",
  Outcome: "Whether the commit succeeded. A failed import writes nothing at all — the whole batch rolls back.",
  Rate: "Rows per second across the entire commit, including the per-row checks that run before the database batch.",
};

export function describeLabel(label: string): string | undefined {
  return LABELS[label];
}
