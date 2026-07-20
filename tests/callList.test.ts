import { beforeEach, describe, expect, it } from "vitest";
import { autoQualifiesForCallList, callListWindow, isCalledToday, loadCallList, setCallListPin } from "../src/data/refills";
import { freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const TODAY = "2026-07-17";

describe("Call List", () => {
  beforeEach(freshDb);

  it("includes a fully qualifying break-even row", async () => {
    const id = seedRefill({ due: TODAY, new_copay: 10, new_profit: 0, refills_left: 1 });
    expect((await loadCallList(TODAY)).map((r) => r.id)).toEqual([id]);
  });

  it("excludes failures of each auto criterion", async () => {
    seedRefill({ due: TODAY, new_copay: 10, new_profit: -0.01, refills_left: 1 });
    seedRefill({ due: TODAY, new_copay: 10, new_profit: 1, refills_left: 0 });
    seedRefill({ due: TODAY, new_copay: 10, new_profit: 1, refills_left: null });
    seedRefill({ due: TODAY, new_profit: 1, refills_left: 1 });
    seedRefill({ due: TODAY, new_copay: 10, refills_left: 1 });
    seedRefill({ due: TODAY, status: "Checked Out", new_copay: 10, new_profit: 1, refills_left: 1 });
    seedRefill({ due: TODAY, status: "MISSED", new_copay: 10, new_profit: 1, refills_left: 1 });
    seedRefill({ due: "2026-07-18", new_copay: 10, new_profit: 1, refills_left: 1 });
    seedRefill({ due: "2026-07-16", new_copay: 10, new_profit: 1, refills_left: 1 });
    expect(await loadCallList(TODAY)).toEqual([]);
  });

  it("rolls Monday back through Saturday and Sunday only", async () => {
    const sat = seedRefill({ due: "2026-07-18", new_copay: 1, new_profit: 1, refills_left: 1 });
    const sun = seedRefill({ due: "2026-07-19", new_copay: 1, new_profit: 1, refills_left: 1 });
    const mon = seedRefill({ due: "2026-07-20", new_copay: 1, new_profit: 1, refills_left: 1 });
    const fri = seedRefill({ due: "2026-07-17", new_copay: 1, new_profit: 1, refills_left: 1 });
    expect(fri).toBeGreaterThan(mon); // seeded last; keeps the id-ordered expectation honest
    // Monday pulls Sat+Sun+Mon (all equal profit, so id order), never Friday
    expect((await loadCallList("2026-07-20")).map((r) => r.id)).toEqual([sat, sun, mon]);
    // Tuesday is a plain today=only window: none of Sat/Sun/Mon carry over
    expect((await loadCallList("2026-07-21")).map((r) => r.id)).toEqual([]);
  });

  it("computes pure local window boundaries", () => {
    expect(callListWindow("2026-07-20")).toEqual({ from: "2026-07-18", to: "2026-07-20" });
    expect(callListWindow("2026-07-21")).toEqual({ from: "2026-07-21", to: "2026-07-21" });
  });

  it("unions an unconditional pin and returns overlap once", async () => {
    const pinned = seedRefill({ due: "2026-06-01", status: "MISSED", added_to_call_list_on: TODAY });
    const both = seedRefill({ due: TODAY, new_copay: 1, new_profit: 2, refills_left: 1, added_to_call_list_on: TODAY });
    const ids = (await loadCallList(TODAY)).map((r) => r.id);
    expect(ids).toEqual([both, pinned]);
    expect(ids.filter((id) => id === both)).toHaveLength(1);
  });

  it("sorts profit descending, nulls last, then id", async () => {
    const high = seedRefill({ due: TODAY, new_copay: 1, new_profit: 300, refills_left: 1 });
    // two rows at equal profit ($50) prove the id tie-break, not accidental insert order
    const tieA = seedRefill({ due: TODAY, new_copay: 1, new_profit: 50, refills_left: 1 });
    const tieB = seedRefill({ due: TODAY, new_copay: 1, new_profit: 50, refills_left: 1 });
    const zero = seedRefill({ due: TODAY, new_copay: 1, new_profit: 0, refills_left: 1 });
    const nil = seedRefill({ due: "2026-01-01", added_to_call_list_on: TODAY });
    expect(tieB).toBeGreaterThan(tieA); // equal profit → ascending id
    expect((await loadCallList(TODAY)).map((r) => r.id)).toEqual([high, tieA, tieB, zero, nil]);
  });

  it("uses the local date of call-note timestamps", () => {
    // local-midnight-adjacent stamps: in a negative-offset timezone, yesterday
    // 23:55 local lands on TODAY's UTC date — a UTC substring compare would lie
    expect(isCalledToday(new Date(2026, 6, 17, 0, 5).toISOString(), TODAY)).toBe(true);
    expect(isCalledToday(new Date(2026, 6, 17, 23, 55).toISOString(), TODAY)).toBe(true);
    expect(isCalledToday(new Date(2026, 6, 16, 23, 55).toISOString(), TODAY)).toBe(false);
    expect(isCalledToday(new Date(2026, 6, 18, 0, 5).toISOString(), TODAY)).toBe(false);
    expect(isCalledToday(null, TODAY)).toBe(false);
  });

  it("pins, clears, and re-pins through the immediate write", async () => {
    const id = seedRefill({ due: "2026-01-01" });
    await setCallListPin(id, TODAY);
    expect((rawDb().prepare("SELECT added_to_call_list_on FROM refills WHERE id = $1").get({ $1: id }) as { added_to_call_list_on: string }).added_to_call_list_on).toBe(TODAY);
    await setCallListPin(id, null);
    expect((rawDb().prepare("SELECT added_to_call_list_on FROM refills WHERE id = $1").get({ $1: id }) as { added_to_call_list_on: string | null }).added_to_call_list_on).toBeNull();
    await setCallListPin(id, TODAY);
    expect((await loadCallList(TODAY)).map((r) => r.id)).toEqual([id]);
  });

  it("matches the SQL auto arm on shared fixtures, included and excluded alike", async () => {
    seedRefill({ due: TODAY, new_copay: 1, new_profit: 0, refills_left: 1 }); // in
    seedRefill({ due: TODAY, new_copay: 1, new_profit: -1, refills_left: 1 }); // out: loss
    seedRefill({ due: "2026-07-18", new_copay: 1, new_profit: 3, refills_left: 1 }); // out: tomorrow
    seedRefill({ due: TODAY, new_copay: 1, new_profit: 3, refills_left: null }); // out: unknown refills
    seedRefill({ due: TODAY, status: "Checked Out", new_copay: 1, new_profit: 3, refills_left: 2 }); // out: done
    const all = rawDb()
      .prepare("SELECT id, status, due_date, new_copay, new_profit, refills_left, added_to_call_list_on FROM refills")
      .all() as unknown as import("../src/data/types").RefillRow[];
    const expected = all.filter((r) => autoQualifiesForCallList(r, TODAY)).map((r) => r.id).sort();
    const actual = (await loadCallList(TODAY)).map((r) => r.id).sort();
    expect(actual).toEqual(expected);
    expect(expected).toHaveLength(1); // exactly the break-even qualifier — both arms agree on every fixture
  });
});
