// Follow-up span sweep (design doc §4.5): reconciles followup_entered /
// followup_left events against current Req Follow Up membership. Idempotent,
// append-only, and spans must close when rows stop qualifying — including by
// deletion (events deliberately outlive the row; no FK).
import { beforeEach, describe, expect, it } from "vitest";
import { deleteRefill, sweepFollowupSpans } from "../src/data/refills";
import { daysAgoIso, eventsFor, freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const WAIT = 5;

function qualifyingRow(): number {
  return seedRefill({
    due: "2026-07-01",
    new_copay: 10,
    new_profit: 85,
    call_note: "LVM+RSL",
    call_note_set_at: daysAgoIso(8),
  });
}

const spanKinds = (id: number) => eventsFor(id).filter((e) => e.kind.startsWith("followup_")).map((e) => e.kind);

describe("sweepFollowupSpans", () => {
  beforeEach(freshDb);

  it("opens a span for a qualifying row — exactly once, however often it runs", async () => {
    const id = qualifyingRow();
    await sweepFollowupSpans(WAIT);
    await sweepFollowupSpans(WAIT);
    await sweepFollowupSpans(WAIT);
    expect(spanKinds(id)).toEqual(["followup_entered"]);
  });

  it("writes nothing for rows that don't qualify", async () => {
    const id = seedRefill({ due: "2026-07-01", new_copay: 10, new_profit: 0, call_note: "LVM+RSL", call_note_set_at: daysAgoIso(8) });
    await sweepFollowupSpans(WAIT);
    expect(spanKinds(id)).toEqual([]);
  });

  it("closes the span when a row stops qualifying, and reopens on re-entry", async () => {
    const id = qualifyingRow();
    await sweepFollowupSpans(WAIT);

    rawDb().prepare("UPDATE refills SET status = 'Checked Out' WHERE id = $1").run({ $1: id });
    await sweepFollowupSpans(WAIT);
    await sweepFollowupSpans(WAIT); // still idempotent after the close
    expect(spanKinds(id)).toEqual(["followup_entered", "followup_left"]);

    rawDb().prepare("UPDATE refills SET status = 'Pending' WHERE id = $1").run({ $1: id });
    await sweepFollowupSpans(WAIT);
    expect(spanKinds(id)).toEqual(["followup_entered", "followup_left", "followup_entered"]);
  });

  it("closes the span of a deleted row — events outlive the row", async () => {
    const id = qualifyingRow();
    await sweepFollowupSpans(WAIT);
    await deleteRefill(id);
    await sweepFollowupSpans(WAIT);
    expect(spanKinds(id)).toEqual(["followup_entered", "followup_left"]);
  });
});
