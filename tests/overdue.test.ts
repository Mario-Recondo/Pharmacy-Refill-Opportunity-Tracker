// Overdue tab membership (story 1.7, narrowed 2026-07-17): Pending + due date
// strictly past + not yet processed (new_copay OR new_profit empty), plus every
// MISSED row. Exercises the real SQL in loadOverdue / loadOverduePendingCount.
import { beforeEach, describe, expect, it } from "vitest";
import { loadOverdue, loadOverduePendingCount } from "../src/data/refills";
import { freshDb, seedRefill } from "./helpers/fakeTauri";

const TODAY = "2026-07-17";

describe("loadOverdue", () => {
  beforeEach(freshDb);

  it("lists past-due Pending rows that are unprocessed, oldest first", async () => {
    const bothEmpty = seedRefill({ due: "2026-07-10" });
    const copayOnly = seedRefill({ due: "2026-07-05", new_copay: 15 });
    const profitOnly = seedRefill({ due: "2026-07-12", new_profit: 40 });
    const rows = await loadOverdue(TODAY);
    expect(rows.map((r) => r.id)).toEqual([copayOnly, bothEmpty, profitOnly]);
  });

  it("excludes processed rows whatever the profit's value — positive, zero, or loss", async () => {
    seedRefill({ due: "2026-07-10", new_copay: 10, new_profit: 85 });
    seedRefill({ due: "2026-07-10", new_copay: 5, new_profit: 0 });
    seedRefill({ due: "2026-07-10", new_copay: 5, new_profit: -12.5 });
    expect(await loadOverdue(TODAY)).toEqual([]);
  });

  it("treats due TODAY as not yet overdue; strictly past only", async () => {
    seedRefill({ due: TODAY });
    seedRefill({ due: "2026-07-18" });
    const yesterday = seedRefill({ due: "2026-07-16" });
    expect((await loadOverdue(TODAY)).map((r) => r.id)).toEqual([yesterday]);
  });

  it("always includes MISSED rows — the permanent record, regardless of date or fields", async () => {
    const oldMissed = seedRefill({ due: "2026-06-20", status: "MISSED" });
    const processedMissed = seedRefill({ due: "2026-07-30", status: "MISSED", new_copay: 8, new_profit: 70 });
    const rows = await loadOverdue(TODAY);
    expect(rows.map((r) => r.id).sort()).toEqual([oldMissed, processedMissed].sort());
  });

  it("never lists Checked Out rows", async () => {
    seedRefill({ due: "2026-07-01", status: "Checked Out" });
    seedRefill({ due: "2026-07-01", status: "Checked Out", new_copay: 8, new_profit: 70 });
    expect(await loadOverdue(TODAY)).toEqual([]);
  });
});

describe("loadOverduePendingCount (tab badge)", () => {
  beforeEach(freshDb);

  it("counts only unprocessed past-due Pending rows — MISSED and processed rows excluded", async () => {
    seedRefill({ due: "2026-07-10" }); // counts
    seedRefill({ due: "2026-07-05", new_copay: 15 }); // counts (half-processed)
    seedRefill({ due: "2026-07-10", new_copay: 10, new_profit: 85 }); // processed
    seedRefill({ due: "2026-06-20", status: "MISSED" }); // permanent record
    seedRefill({ due: TODAY }); // not yet overdue
    expect(await loadOverduePendingCount(TODAY)).toBe(2);
  });

  it("badge and tab agree on the independently-known count — not just on each other", async () => {
    seedRefill({ due: "2026-07-01" }); // unprocessed → counts
    seedRefill({ due: "2026-07-02", new_profit: 30 }); // half-processed → counts
    seedRefill({ due: "2026-07-03", status: "MISSED" }); // permanent record → uncounted
    // both asserted against the fixture-derived constant, so a shared drift
    // in the two queries can't hide behind their consistency
    expect(await loadOverduePendingCount(TODAY)).toBe(2);
    expect((await loadOverdue(TODAY)).filter((r) => r.status === "Pending")).toHaveLength(2);
  });
});
