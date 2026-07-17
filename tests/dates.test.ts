// Date math: due dates are LOCAL calendar dates (design decision — UTC would
// flip the day near midnight), and the quiet clock counts whole local calendar
// days. Classic timezone-bug territory, so the edges get pinned here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daysQuiet, loadMonth, todayIso } from "../src/data/refills";
import { freshDb, seedRefill } from "./helpers/fakeTauri";

describe("todayIso", () => {
  afterEach(() => vi.useRealTimers());

  it("is the LOCAL calendar date, even late at night when UTC has moved on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30, 0)); // local Jan 5, 23:30
    expect(todayIso()).toBe("2026-01-05");
  });

  it("zero-pads month and day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 7, 12, 0, 0));
    expect(todayIso()).toBe("2026-03-07");
  });
});

describe("daysQuiet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 17, 12, 0, 0)); // local noon
  });
  afterEach(() => vi.useRealTimers());

  it("same local day = 0, however many hours ago", () => {
    expect(daysQuiet(new Date(2026, 6, 17, 0, 5, 0).toISOString())).toBe(0);
  });

  it("counts calendar days, not 24-hour spans: 23:59 yesterday is 1 day quiet at 00:01", () => {
    vi.setSystemTime(new Date(2026, 6, 17, 0, 1, 0));
    expect(daysQuiet(new Date(2026, 6, 16, 23, 59, 0).toISOString())).toBe(1);
  });

  it("a whole week is 7", () => {
    expect(daysQuiet(new Date(2026, 6, 10, 12, 0, 0).toISOString())).toBe(7);
  });

  it("clamps a future timestamp to 0 rather than going negative", () => {
    expect(daysQuiet(new Date(2026, 6, 20, 12, 0, 0).toISOString())).toBe(0);
  });
});

describe("loadMonth boundaries", () => {
  beforeEach(freshDb);

  it("December stops at New Year's Eve; January picks up New Year's Day", async () => {
    const dec = seedRefill({ due: "2026-12-31" });
    const jan = seedRefill({ due: "2027-01-01" });
    expect((await loadMonth("2026-12")).map((r) => r.id)).toEqual([dec]);
    expect((await loadMonth("2027-01")).map((r) => r.id)).toEqual([jan]);
  });

  it("first and last day of an ordinary month are both inside it", async () => {
    const first = seedRefill({ due: "2026-07-01" });
    const last = seedRefill({ due: "2026-07-31" });
    seedRefill({ due: "2026-08-01" });
    expect((await loadMonth("2026-07")).map((r) => r.id)).toEqual([first, last]);
  });
});
