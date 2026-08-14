import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefill, loadMonthProfit, localYm, updateRefillField } from "../src/data/refills";
import { freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const MIGRATIONS_DIR = join(process.cwd(), "src-tauri", "migrations");

function newRefillInput(drugId: number, status: "Pending" | "Checked Out") {
  return {
    rx_number: `manual-${Math.random()}`,
    drug_id: drugId,
    due_date: "2026-08-01",
    insurance_id: null,
    secondary_id: null,
    old_copay: null,
    new_copay: null,
    old_profit: null,
    new_profit: null,
    refills_filled: null,
    refills_left: null,
    refill_note_id: null,
    call_note_id: null,
    status,
    notes: null,
  } as const;
}

describe("monthly profit total", () => {
  beforeEach(freshDb);
  afterEach(() => vi.useRealTimers());

  it("stamps checked_out_at on a real transition into Checked Out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T15:00:00.000Z"));
    const id = seedRefill({ due: "2026-08-01" });

    await updateRefillField(id, "status", "Checked Out");

    expect((rawDb().prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: id }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-08-13T15:00:00.000Z");
  });

  it("restamps after a revert and preserves the stamp while Pending", async () => {
    vi.useFakeTimers();
    const id = seedRefill({ due: "2026-08-01" });
    vi.setSystemTime(new Date("2026-08-13T15:00:00.000Z"));
    await updateRefillField(id, "status", "Checked Out");
    await updateRefillField(id, "status", "Pending");
    vi.setSystemTime(new Date("2026-08-14T16:00:00.000Z"));
    await updateRefillField(id, "status", "Checked Out");

    expect((rawDb().prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: id }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-08-14T16:00:00.000Z");
    await updateRefillField(id, "status", "Pending");
    expect((rawDb().prepare("SELECT status, checked_out_at FROM refills WHERE id = $1").get({ $1: id }) as { status: string; checked_out_at: string }).checked_out_at)
      .toBe("2026-08-14T16:00:00.000Z");
  });

  it("does not restamp or append an event for Checked Out to Checked Out", async () => {
    vi.useFakeTimers();
    const id = seedRefill({ due: "2026-08-01" });
    vi.setSystemTime(new Date("2026-08-13T15:00:00.000Z"));
    await updateRefillField(id, "status", "Checked Out");
    vi.setSystemTime(new Date("2026-08-14T16:00:00.000Z"));
    await updateRefillField(id, "status", "Checked Out");

    expect((rawDb().prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: id }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-08-13T15:00:00.000Z");
    expect((rawDb().prepare("SELECT COUNT(*) AS n FROM refill_events WHERE refill_id = $1").get({ $1: id }) as { n: number }).n).toBe(1);
  });

  it("stamps checked_out_at on create only for Checked Out rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T15:00:00.000Z"));
    const source = seedRefill({ due: "2026-08-01" });
    const drugId = (rawDb().prepare("SELECT drug_id FROM refills WHERE id = $1").get({ $1: source }) as { drug_id: number }).drug_id;

    const checkedOutId = await createRefill({ ...newRefillInput(drugId, "Checked Out"), rx_number: "created-out" });
    const pendingId = await createRefill({ ...newRefillInput(drugId, "Pending"), rx_number: "created-pending" });
    expect((rawDb().prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: checkedOutId }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-08-13T15:00:00.000Z");
    expect((rawDb().prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: pendingId }) as { checked_out_at: string | null }).checked_out_at)
      .toBeNull();
  });

  it("sums live checked-out profit by local sold month", async () => {
    const inMonth = new Date(2026, 7, 15, 12, 0).toISOString();
    const dueInAnotherMonth = seedRefill({ due: "2026-07-01", status: "Checked Out", checked_out_at: inMonth, new_profit: 25 });
    seedRefill({ due: "2026-08-02", status: "Checked Out", checked_out_at: inMonth, new_profit: -10 });
    seedRefill({ due: "2026-08-03", status: "Checked Out", checked_out_at: inMonth, new_profit: null });
    seedRefill({ due: "2026-08-04", status: "Pending", checked_out_at: inMonth, new_profit: 100 });
    seedRefill({ due: "2026-08-05", status: "MISSED", checked_out_at: inMonth, new_profit: 100 });
    const otherMonth = new Date(2026, 8, 1, 12, 0).toISOString();
    seedRefill({ due: "2026-08-06", status: "Checked Out", checked_out_at: otherMonth, new_profit: 200 });

    expect(await loadMonthProfit("2026-08")).toBe(15);
    expect(await loadMonthProfit("2026-09")).toBe(200);
    expect(await loadMonthProfit("2026-10")).toBe(0);
    expect((rawDb().prepare("SELECT due_date FROM refills WHERE id = $1").get({ $1: dueInAnotherMonth }) as { due_date: string }).due_date)
      .toBe("2026-07-01");
  });

  it("produces a negative total when losses outweigh gains in the month", async () => {
    const inMonth = new Date(2026, 7, 20, 12, 0).toISOString();
    seedRefill({ due: "2026-08-10", status: "Checked Out", checked_out_at: inMonth, new_profit: 30 });
    seedRefill({ due: "2026-08-11", status: "Checked Out", checked_out_at: inMonth, new_profit: -90 });

    expect(await loadMonthProfit("2026-08")).toBe(-60);
  });

  it("localYm reads local calendar components", () => {
    const year = 2026;
    const monthIndex = 7;
    const iso = new Date(year, monthIndex, 31, 23, 59).toISOString();
    const expected = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    expect(localYm(iso)).toBe(expected);
  });

  it("backfills from the latest checkout event, then falls back to due-date noon", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const filename of readdirSync(MIGRATIONS_DIR).filter((f) => /^00[1-8]_.*\.sql$/.test(f)).sort()) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, filename), "utf8"));
    }

    db.exec("INSERT INTO drugs (name, ndc) VALUES ('Backfill Drug', NULL)");
    const drugId = Number((db.prepare("SELECT id FROM drugs WHERE name = 'Backfill Drug'").get() as { id: number }).id);
    const withEvent = Number(db.prepare("INSERT INTO refills (rx_number, drug_id, due_date, status, source) VALUES ('backfill-event', $1, '2026-08-10', 'Checked Out', 'manual')").run({ $1: drugId }).lastInsertRowid);
    const fallback = Number(db.prepare("INSERT INTO refills (rx_number, drug_id, due_date, status, source) VALUES ('backfill-fallback', $1, '2026-09-11', 'Checked Out', 'manual')").run({ $1: drugId }).lastInsertRowid);
    const pending = Number(db.prepare("INSERT INTO refills (rx_number, drug_id, due_date, status, source) VALUES ('backfill-pending', $1, '2026-10-12', 'Pending', 'manual')").run({ $1: drugId }).lastInsertRowid);
    db.prepare("INSERT INTO refill_events (refill_id, at, kind, old_value, new_value, profit) VALUES ($1, $2, 'status', 'Pending', 'Checked Out', 8)").run({ $1: withEvent, $2: "2026-08-12T14:30:00.000Z" });

    db.exec(readFileSync(join(MIGRATIONS_DIR, "009_checked_out_at.sql"), "utf8"));
    expect((db.prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: withEvent }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-08-12T14:30:00.000Z");
    expect((db.prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: fallback }) as { checked_out_at: string }).checked_out_at)
      .toBe("2026-09-11T12:00:00.000Z");
    expect((db.prepare("SELECT checked_out_at FROM refills WHERE id = $1").get({ $1: pending }) as { checked_out_at: string | null }).checked_out_at)
      .toBeNull();
    db.close();
  });
});
