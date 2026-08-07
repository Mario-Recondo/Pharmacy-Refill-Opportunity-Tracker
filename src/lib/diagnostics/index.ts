// Public face of the diagnostics layer. Application code imports only from
// here — never from ./store — so the storage strategy can change without
// touching a single instrumented call site.
//
// PRODUCTION BEHAVIOUR
// `import.meta.env.DEV` is not a runtime lookup: Vite substitutes the literal
// `true` or `false` at build time (same mechanism already used by
// src/lib/updater.ts). In a production build `enabled` is a `const false`, the
// store is never constructed, and `measure()` collapses to "just call the
// function". The minifier then removes the dead branches outright.
//
// PHI RULE
// `meta` exists for counts, durations and flags. Never put an Rx number, drug
// name, patient identifier or any exported spreadsheet cell in it. Diagnostics
// are a debugging aid, not a place data quietly escapes to.

import { createDiagnosticsStore, type DiagnosticsSnapshot } from "./store";

export type { DiagnosticsSnapshot, OperationAggregate, OperationSample } from "./store";
export { MAX_ERRORS, MAX_OPERATION_NAMES, MAX_SAMPLES } from "./store";

/** True only in development builds. Guard any dev-only UI with this. */
export const DIAGNOSTICS_ENABLED: boolean = import.meta.env.DEV;

export type OperationMeta = Record<string, number | string | boolean>;

const store = DIAGNOSTICS_ENABLED ? createDiagnosticsStore(Date.now()) : null;

/** Monotonic clock where available; Date.now() is the fallback for odd hosts. */
function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Time an async operation. Returns whatever the operation returns, and rethrows
 * whatever it throws — instrumentation must never change behaviour.
 *
 *   const rows = await measure("query.month", () => db.select(...), { ym });
 *
 * `meta` may also be a function, so metadata that is only knowable *after* the
 * work finishes (row counts, for example) costs nothing when disabled:
 *
 *   await measure("import.commit", run, (result) => ({ rows: result.inserted }));
 */
export async function measure<T>(
  name: string,
  run: () => Promise<T>,
  meta?: OperationMeta | ((result: T) => OperationMeta),
): Promise<T> {
  if (!store) return run();
  const startedAt = Date.now();
  const start = now();
  try {
    const result = await run();
    store.record({
      name,
      startedAt,
      durationMs: now() - start,
      ok: true,
      meta: typeof meta === "function" ? meta(result) : meta,
    });
    return result;
  } catch (error) {
    store.record({
      name,
      startedAt,
      durationMs: now() - start,
      ok: false,
      meta: typeof meta === "function" ? undefined : meta,
      error: errorMessage(error),
    });
    throw error;
  }
}

/** Synchronous sibling of `measure`, for expensive pure computation. */
export function measureSync<T>(name: string, run: () => T, meta?: OperationMeta): T {
  if (!store) return run();
  const startedAt = Date.now();
  const start = now();
  try {
    const result = run();
    store.record({ name, startedAt, durationMs: now() - start, ok: true, meta });
    return result;
  } catch (error) {
    store.record({
      name,
      startedAt,
      durationMs: now() - start,
      ok: false,
      meta,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Record an already-measured duration. For things `measure()` cannot wrap —
 * the write-chain queue wait, where the interesting number is how long the
 * operation sat waiting before its function was ever called.
 */
export function recordDuration(
  name: string,
  durationMs: number,
  meta?: OperationMeta,
  ok = true,
): void {
  if (!store) return;
  store.record({ name, startedAt: Date.now(), durationMs, ok, meta });
}

/** Snapshot for the dashboard. Null in production, where nothing is collected. */
export function getDiagnosticsSnapshot(): DiagnosticsSnapshot | null {
  return store ? store.snapshot() : null;
}

export function resetDiagnostics(): void {
  store?.reset();
}
