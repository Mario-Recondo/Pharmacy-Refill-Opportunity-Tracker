// Req Follow Up membership (design doc §5, ADR 0002): Pending + new_copay set
// + new_profit > 0 + call note flagged requires_followup + quiet strictly more
// than followup_wait_days. The flag set and the wait threshold come from the
// real migrations; the quiet clock is JS-side, so tests pin the system time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadReqFollowUp, loadReqFollowUpCount } from "../src/data/refills";
import { daysAgoIso, freshDb, seedRefill, unflaggedCallNoteId } from "./helpers/fakeTauri";

const WAIT = 5;

// a qualifying row, before the overrides applied per test
function qualifying(overrides: Partial<Parameters<typeof seedRefill>[0]> = {}): number {
  return seedRefill({
    due: "2026-07-08",
    new_copay: 10,
    new_profit: 85,
    call_note: "LVM+RSL", // seeded requires_followup = 1 (migration 004)
    call_note_set_at: daysAgoIso(7),
    ...overrides,
  });
}

describe("loadReqFollowUp", () => {
  beforeEach(() => {
    // fixed local noon: quiet-day math must not depend on when the suite runs
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 17, 12, 0, 0));
    freshDb();
  });
  afterEach(() => vi.useRealTimers());

  it("lists a Pending row with copay + positive profit, flagged note, quiet past the threshold", async () => {
    const id = qualifying();
    expect((await loadReqFollowUp(WAIT)).map((r) => r.id)).toEqual([id]);
    expect(await loadReqFollowUpCount(WAIT)).toBe(1);
  });

  it("threshold is a strict doorway: exactly N days quiet stays off, N+1 surfaces", async () => {
    qualifying({ call_note_set_at: daysAgoIso(WAIT) });
    expect(await loadReqFollowUp(WAIT)).toEqual([]);
    const over = qualifying({ call_note_set_at: daysAgoIso(WAIT + 1) });
    expect((await loadReqFollowUp(WAIT)).map((r) => r.id)).toEqual([over]);
  });

  it("profit must be strictly positive — $0 and losses never enter (ADR 0002)", async () => {
    qualifying({ new_profit: 0 });
    qualifying({ new_profit: -20 });
    qualifying({ new_profit: null });
    expect(await loadReqFollowUp(WAIT)).toEqual([]);
  });

  it("requires new_copay entered", async () => {
    qualifying({ new_copay: null });
    expect(await loadReqFollowUp(WAIT)).toEqual([]);
  });

  it("keys off the requires_followup FLAG, not the note name; no call note = no membership", async () => {
    qualifying({ call_note: undefined, call_note_id: unflaggedCallNoteId() });
    qualifying({ call_note: undefined, call_note_set_at: undefined });
    expect(await loadReqFollowUp(WAIT)).toEqual([]);
  });

  it("only Pending rows qualify", async () => {
    qualifying({ status: "Checked Out" });
    qualifying({ status: "MISSED" });
    expect(await loadReqFollowUp(WAIT)).toEqual([]);
  });

  it("orders newest arrivals first (freshly surfaced rows lead)", async () => {
    const oldest = qualifying({ call_note_set_at: daysAgoIso(12) });
    const newest = qualifying({ call_note_set_at: daysAgoIso(6) });
    const middle = qualifying({ call_note_set_at: daysAgoIso(9) });
    expect((await loadReqFollowUp(WAIT)).map((r) => r.id)).toEqual([newest, middle, oldest]);
  });
});
