// Diagnostics store + instrumentation wrapper. The store is pure (durations are
// passed in, never measured internally), so these assertions are exact rather
// than timing-dependent. The `measure` tests use a controllable promise instead
// of sleeping, so they stay fast and deterministic.

import { beforeEach, describe, expect, it } from "vitest";
import {
  createDiagnosticsStore,
  MAX_ERRORS,
  MAX_OPERATION_NAMES,
  MAX_SAMPLES,
  type DiagnosticsStore,
} from "../src/lib/diagnostics/store";
import { measure, measureSync, recordDuration, getDiagnosticsSnapshot, resetDiagnostics } from "../src/lib/diagnostics";
import { loadMonth, updateRefillField } from "../src/data/refills";
import {
  INSTRUMENTED_OPERATIONS,
  describeLabel,
  describeOperation,
} from "../src/components/dev/metricDescriptions";
import { freshDb, seedRefill } from "./helpers/fakeTauri";

function ok(store: DiagnosticsStore, name: string, durationMs: number) {
  store.record({ name, startedAt: 0, durationMs, ok: true });
}

describe("diagnostics store", () => {
  it("records a sample and exposes it in the snapshot", () => {
    const store = createDiagnosticsStore(1000);
    store.record({ name: "query.month", startedAt: 1500, durationMs: 12.5, ok: true, meta: { rows: 40 } });

    const snapshot = store.snapshot();
    expect(snapshot.totalRecorded).toBe(1);
    expect(snapshot.recent).toHaveLength(1);
    expect(snapshot.recent[0]).toMatchObject({
      name: "query.month",
      durationMs: 12.5,
      ok: true,
      meta: { rows: 40 },
    });
    expect(snapshot.sessionStartedAt).toBe(1000);
  });

  it("computes count, average, min and max per operation", () => {
    const store = createDiagnosticsStore(0);
    ok(store, "db.transaction", 10);
    ok(store, "db.transaction", 20);
    ok(store, "db.transaction", 60);

    const [agg] = store.snapshot().operations;
    expect(agg.name).toBe("db.transaction");
    expect(agg.count).toBe(3);
    expect(agg.totalMs).toBe(90);
    expect(agg.avgMs).toBe(30);
    expect(agg.minMs).toBe(10);
    expect(agg.maxMs).toBe(60);
    expect(agg.lastMs).toBe(60);
  });

  it("keeps aggregates separate per operation name, slowest average first", () => {
    const store = createDiagnosticsStore(0);
    ok(store, "fast", 1);
    ok(store, "slow", 500);

    const names = store.snapshot().operations.map((o) => o.name);
    expect(names).toEqual(["slow", "fast"]);
  });

  it("represents a failed operation with its error, and counts it", () => {
    const store = createDiagnosticsStore(0);
    store.record({ name: "import.commit", startedAt: 0, durationMs: 5, ok: false, error: "database is locked" });

    const snapshot = store.snapshot();
    expect(snapshot.errors).toHaveLength(1);
    expect(snapshot.errors[0]).toMatchObject({ name: "import.commit", ok: false, error: "database is locked" });
    expect(snapshot.operations[0].failures).toBe(1);
    // a failure still counts as an occurrence, so averages stay honest
    expect(snapshot.operations[0].count).toBe(1);
  });

  it("bounds retained samples and reports how many were evicted", () => {
    const store = createDiagnosticsStore(0);
    const overshoot = 60;
    for (let i = 0; i < MAX_SAMPLES + overshoot; i += 1) ok(store, "spam", i);

    const snapshot = store.snapshot();
    expect(snapshot.recent).toHaveLength(MAX_SAMPLES);
    expect(snapshot.evictedSamples).toBe(overshoot);
    // aggregates are unaffected by eviction — they carry the full history
    expect(snapshot.operations[0].count).toBe(MAX_SAMPLES + overshoot);
    // newest first: the final sample recorded leads the list
    expect(snapshot.recent[0].durationMs).toBe(MAX_SAMPLES + overshoot - 1);
  });

  it("bounds the error buffer independently of the sample buffer", () => {
    const store = createDiagnosticsStore(0);
    for (let i = 0; i < MAX_ERRORS + 25; i += 1) {
      store.record({ name: "boom", startedAt: 0, durationMs: 1, ok: false, error: `e${i}` });
    }
    expect(store.snapshot().errors).toHaveLength(MAX_ERRORS);
  });

  it("refuses new operation names past the cap instead of growing forever", () => {
    const store = createDiagnosticsStore(0);
    for (let i = 0; i < MAX_OPERATION_NAMES + 10; i += 1) ok(store, `dynamic.name.${i}`, 1);

    const snapshot = store.snapshot();
    expect(snapshot.operations).toHaveLength(MAX_OPERATION_NAMES);
    expect(snapshot.droppedNames).toBe(10);
    // the samples themselves are still retained (bounded), only aggregation stops
    expect(snapshot.totalRecorded).toBe(MAX_OPERATION_NAMES + 10);
  });

  it("lists the slowest retained calls, slowest first", () => {
    const store = createDiagnosticsStore(0);
    ok(store, "a", 5);
    ok(store, "b", 900);
    ok(store, "c", 50);

    expect(store.snapshot().slowest.map((s) => s.durationMs)).toEqual([900, 50, 5]);
  });

  it("reset clears everything", () => {
    const store = createDiagnosticsStore(0);
    ok(store, "a", 5);
    store.reset();

    const snapshot = store.snapshot();
    expect(snapshot.totalRecorded).toBe(0);
    expect(snapshot.recent).toHaveLength(0);
    expect(snapshot.operations).toHaveLength(0);
  });
});

describe("measure()", () => {
  it("returns the operation's value and records a successful sample", async () => {
    resetDiagnostics();
    const value = await measure("test.op", async () => "result");

    expect(value).toBe("result");
    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot?.recent[0]).toMatchObject({ name: "test.op", ok: true });
  });

  it("derives metadata from the result when meta is a function", async () => {
    resetDiagnostics();
    await measure("test.rows", async () => [1, 2, 3], (rows) => ({ rows: rows.length }));

    expect(getDiagnosticsSnapshot()?.recent[0].meta).toEqual({ rows: 3 });
  });

  it("rethrows the original error and records the failure", async () => {
    resetDiagnostics();
    const boom = new Error("nope");

    await expect(measure("test.fail", async () => { throw boom; })).rejects.toBe(boom);

    const snapshot = getDiagnosticsSnapshot();
    expect(snapshot?.errors[0]).toMatchObject({ name: "test.fail", ok: false, error: "nope" });
  });

  it("measures a real elapsed duration greater than zero", async () => {
    resetDiagnostics();
    await measure("test.slow", () => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(getDiagnosticsSnapshot()!.recent[0].durationMs).toBeGreaterThan(5);
  });

  it("measureSync records synchronous work and rethrows", () => {
    resetDiagnostics();
    expect(measureSync("test.sync", () => 21 * 2)).toBe(42);
    expect(() => measureSync("test.sync-fail", () => { throw new Error("x"); })).toThrow("x");

    const names = getDiagnosticsSnapshot()!.recent.map((s) => s.name);
    expect(names).toContain("test.sync");
    expect(names).toContain("test.sync-fail");
  });

  it("recordDuration stores an already-measured span", () => {
    resetDiagnostics();
    recordDuration("db.write-queue-wait", 7.5, { depth: 2 });

    expect(getDiagnosticsSnapshot()?.recent[0]).toMatchObject({
      name: "db.write-queue-wait",
      durationMs: 7.5,
      meta: { depth: 2 },
    });
  });
});

describe("metric descriptions", () => {
  it("describes every instrumented operation", () => {
    const missing = INSTRUMENTED_OPERATIONS.filter((name) => !describeOperation(name));
    expect(missing).toEqual([]);
  });

  it("writes descriptions that explain rather than restate the name", () => {
    for (const name of INSTRUMENTED_OPERATIONS) {
      const text = describeOperation(name)!;
      // a tooltip shorter than this is almost certainly just the label again
      expect(text.length, `${name} description is too thin`).toBeGreaterThan(40);
    }
  });

  it("describes the dashboard's fixed labels and table headers", () => {
    const shown = ["Uptime", "Retention", "Operation", "Count", "Avg", "Max", "Detail", "Rate"];
    for (const label of shown) {
      expect(describeLabel(label), `no hover text for "${label}"`).toBeTruthy();
    }
  });

  it("returns undefined for unknown names, so no empty tooltip renders", () => {
    expect(describeOperation("something.not.instrumented")).toBeUndefined();
    expect(describeLabel("Nonexistent")).toBeUndefined();
  });
});

// These run the REAL data layer against the in-memory database, so they prove
// the instrumentation is wired into actual application code rather than
// asserting against numbers a test invented.
describe("instrumented application workflows", () => {
  beforeEach(() => {
    freshDb();
    resetDiagnostics();
  });

  it("records a month query with its row count", async () => {
    seedRefill({ due: "2026-07-06" });
    seedRefill({ due: "2026-07-14" });

    await loadMonth("2026-07");

    const sample = getDiagnosticsSnapshot()!.recent.find((s) => s.name === "query.month");
    expect(sample).toBeDefined();
    expect(sample!.ok).toBe(true);
    expect(sample!.meta).toEqual({ rows: 2 });
  });

  it("records a field edit and the write-queue wait behind it", async () => {
    const id = seedRefill({ due: "2026-07-06" });

    await updateRefillField(id, "new_copay", 12.5);

    const names = getDiagnosticsSnapshot()!.recent.map((s) => s.name);
    expect(names).toContain("refill.update-field");
    expect(names).toContain("db.write-queue-wait");

    const edit = getDiagnosticsSnapshot()!.recent.find((s) => s.name === "refill.update-field");
    // the column name is safe to record; the value it was set to is not recorded
    expect(edit!.meta).toEqual({ field: "new_copay" });
  });

  it("records a failed operation without breaking the caller's error", async () => {
    const id = seedRefill({ due: "2026-07-06" });

    await expect(updateRefillField(id, "drug_id" as never, 1)).rejects.toThrow(/not editable/);

    const failure = getDiagnosticsSnapshot()!.errors.find((s) => s.name === "refill.update-field");
    expect(failure).toBeDefined();
    expect(failure!.ok).toBe(false);
  });
});
