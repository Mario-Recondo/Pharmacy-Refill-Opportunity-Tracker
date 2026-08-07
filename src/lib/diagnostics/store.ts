// Bounded, in-memory diagnostics store. Deliberately pure: it never reads a
// clock, never touches the environment, and never talks to the database — the
// caller passes in already-measured durations. That keeps duration maths and
// the retention limits unit-testable without fake timers, and keeps the store
// usable from both the browser and vitest unchanged.
//
// Everything here resets when the app restarts. That is intentional for a
// first observability layer: no persistence, no schema, nothing to migrate.

/** One completed operation. Metadata is counts and durations only — never PHI. */
export interface OperationSample {
  /** Monotonic per-session id, so the dashboard can key rows without a clock. */
  id: number;
  name: string;
  /** Wall-clock epoch ms, for display only. */
  startedAt: number;
  durationMs: number;
  ok: boolean;
  meta?: Record<string, number | string | boolean>;
  /** Error message when ok === false. Never the stack — too noisy for a table. */
  error?: string;
}

/** Rolling totals per operation name. Fixed size, so this cannot grow with traffic. */
export interface OperationAggregate {
  name: string;
  count: number;
  failures: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  avgMs: number;
}

export interface DiagnosticsSnapshot {
  /** Epoch ms the session started — the dashboard derives uptime from this. */
  sessionStartedAt: number;
  /** Every sample ever recorded, including ones since evicted. */
  totalRecorded: number;
  operations: OperationAggregate[];
  /** Newest first, capped at MAX_SAMPLES. */
  recent: OperationSample[];
  /** Slowest retained samples, slowest first. */
  slowest: OperationSample[];
  /** Newest-first failures, capped at MAX_ERRORS. */
  errors: OperationSample[];
  /** Samples dropped by the retention limit — proves the cap is doing its job. */
  evictedSamples: number;
  /** Names dropped by MAX_OPERATION_NAMES. Non-zero means someone is generating
   *  dynamic operation names, which is a bug in the calling code. */
  droppedNames: number;
}

/**
 * Retention limits. Chosen so the whole store stays well under a megabyte even
 * in a long development session, while keeping enough history to spot a
 * pattern by eye.
 *
 * MAX_SAMPLES 200      — a few minutes of active use; the aggregates carry the
 *                        long-run totals, so old samples are not a loss.
 * MAX_ERRORS 50        — failures are rare and worth keeping longer than a
 *                        normal sample, so they get their own buffer.
 * MAX_OPERATION_NAMES 64 — a guard, not a budget. The app has well under 20
 *                        instrumentation sites; hitting this means a caller is
 *                        building names dynamically (e.g. per Rx number), which
 *                        would leak memory. The store refuses instead.
 */
export const MAX_SAMPLES = 200;
export const MAX_ERRORS = 50;
export const MAX_OPERATION_NAMES = 64;

export interface DiagnosticsStore {
  record(sample: Omit<OperationSample, "id">): void;
  snapshot(): DiagnosticsSnapshot;
  reset(): void;
}

export function createDiagnosticsStore(sessionStartedAt: number): DiagnosticsStore {
  let nextId = 1;
  let totalRecorded = 0;
  let evictedSamples = 0;
  let droppedNames = 0;
  let samples: OperationSample[] = [];
  let errors: OperationSample[] = [];
  const aggregates = new Map<string, OperationAggregate>();

  function aggregateFor(name: string): OperationAggregate | null {
    const existing = aggregates.get(name);
    if (existing) return existing;
    if (aggregates.size >= MAX_OPERATION_NAMES) {
      droppedNames += 1;
      return null;
    }
    const created: OperationAggregate = {
      name,
      count: 0,
      failures: 0,
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      lastMs: 0,
      avgMs: 0,
    };
    aggregates.set(name, created);
    return created;
  }

  return {
    record(sample) {
      const stored: OperationSample = { ...sample, id: nextId++ };
      totalRecorded += 1;

      samples.push(stored);
      if (samples.length > MAX_SAMPLES) {
        samples.shift();
        evictedSamples += 1;
      }

      if (!stored.ok) {
        errors.push(stored);
        if (errors.length > MAX_ERRORS) errors.shift();
      }

      const agg = aggregateFor(stored.name);
      if (!agg) return;
      agg.count += 1;
      if (!stored.ok) agg.failures += 1;
      agg.totalMs += stored.durationMs;
      agg.minMs = Math.min(agg.minMs, stored.durationMs);
      agg.maxMs = Math.max(agg.maxMs, stored.durationMs);
      agg.lastMs = stored.durationMs;
      agg.avgMs = agg.totalMs / agg.count;
    },

    snapshot() {
      return {
        sessionStartedAt,
        totalRecorded,
        // slowest first — the whole point of the table is "what is costing me time"
        operations: [...aggregates.values()].sort((a, b) => b.avgMs - a.avgMs),
        recent: [...samples].reverse(),
        slowest: [...samples].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
        errors: [...errors].reverse(),
        evictedSamples,
        droppedNames,
      };
    },

    reset() {
      nextId = 1;
      totalRecorded = 0;
      evictedSamples = 0;
      droppedNames = 0;
      samples = [];
      errors = [];
      aggregates.clear();
    },
  };
}
