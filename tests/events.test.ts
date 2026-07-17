// Workflow event log (design doc §4.5): updateRefillField appends note/status
// events with a rolling 2-minute settling window — corrections inside the
// window merge in place, a full revert cancels out, anything older is real
// history. Time is faked (Date only) so the window edges are exact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateRefillField } from "../src/data/refills";
import { eventsFor, freshDb, noteId, rawDb, seedRefill } from "./helpers/fakeTauri";

const MIN = 60_000;

describe("event settling window", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 17, 10, 0, 0));
    freshDb();
  });
  afterEach(() => vi.useRealTimers());

  it("a first change appends one event carrying display names, and stamps the quiet clock", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    const res = await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    expect(res.call_note_set_at).toBe(new Date().toISOString());
    const evs = eventsFor(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "call_note", old_value: null, new_value: "LVM+RSL" });
  });

  it("a correction inside the window merges into the existing event", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    vi.advanceTimersByTime(1 * MIN);
    await updateRefillField(id, "call_note_id", noteId("call_notes", "P/U"));
    const evs = eventsFor(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ old_value: null, new_value: "P/U" });
  });

  it("a full revert inside the window leaves no trace", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    vi.advanceTimersByTime(1 * MIN);
    await updateRefillField(id, "call_note_id", null);
    expect(eventsFor(id)).toHaveLength(0);
  });

  it("the window ROLLS: each merged edit restarts it", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    vi.advanceTimersByTime(1.5 * MIN);
    await updateRefillField(id, "call_note_id", noteId("call_notes", "P/U")); // merges, restarts window
    vi.advanceTimersByTime(1.5 * MIN); // 3 min after the first edit, 1.5 after the merge
    await updateRefillField(id, "call_note_id", noteId("call_notes", "D/S+RSL"));
    const evs = eventsFor(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ old_value: null, new_value: "D/S+RSL" });
  });

  it("a change that outlives the window is real history — the sequence keeps both steps", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    vi.advanceTimersByTime(3 * MIN); // patient called back later
    await updateRefillField(id, "call_note_id", noteId("call_notes", "P/U"));
    const evs = eventsFor(id);
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ old_value: null, new_value: "LVM+RSL" });
    expect(evs[1]).toMatchObject({ old_value: "LVM+RSL", new_value: "P/U" });
  });

  it("renaming a lookup later never rewrites recorded history", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    await updateRefillField(id, "call_note_id", noteId("call_notes", "LVM+RSL"));
    vi.advanceTimersByTime(3 * MIN);
    rawDb().prepare("UPDATE call_notes SET name = 'Left VM + resend link' WHERE name = 'LVM+RSL'").run();
    expect(eventsFor(id)[0].new_value).toBe("LVM+RSL");
  });

  it("status → Checked Out snapshots new_profit onto the event; other statuses don't", async () => {
    const sold = seedRefill({ due: "2026-07-20", new_copay: 10, new_profit: 85 });
    await updateRefillField(sold, "status", "Checked Out");
    expect(eventsFor(sold)[0]).toMatchObject({
      kind: "status",
      old_value: "Pending",
      new_value: "Checked Out",
      profit: 85,
    });

    const missed = seedRefill({ due: "2026-07-20", new_copay: 10, new_profit: 85 });
    await updateRefillField(missed, "status", "MISSED");
    expect(eventsFor(missed)[0]).toMatchObject({ new_value: "MISSED", profit: null });
  });

  it("clearing a call note nulls the quiet clock", async () => {
    const id = seedRefill({ due: "2026-07-20", call_note: "LVM+RSL", call_note_set_at: new Date().toISOString() });
    vi.advanceTimersByTime(3 * MIN);
    const res = await updateRefillField(id, "call_note_id", null);
    expect(res.call_note_set_at).toBeNull();
    const row = rawDb().prepare("SELECT call_note_set_at FROM refills WHERE id = $1").get({ $1: id }) as { call_note_set_at: string | null };
    expect(row.call_note_set_at).toBeNull();
  });
});
