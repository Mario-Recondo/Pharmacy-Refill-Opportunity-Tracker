// Row and drug identity invariants: the (rx_number, due_date) natural key,
// drug get-or-create against both unique indexes (UNIQUE(name, ndc) plus the
// migration-005 partial index guarding NULL-NDC compounds), and events
// surviving row deletion.
import { beforeEach, describe, expect, it } from "vitest";
import { createRefill, deleteRefill, findOrCreateDrug, findRefillByRxDue, type NewRefill } from "../src/data/refills";
import { eventsFor, freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const blank: Omit<NewRefill, "rx_number" | "due_date" | "drug_id"> = {
  insurance_id: null, secondary_id: null,
  old_copay: null, new_copay: null, old_profit: null, new_profit: null,
  refills_filled: null, refill_note_id: null, call_note_id: null,
  status: "Pending", notes: null,
};

describe("findOrCreateDrug", () => {
  beforeEach(freshDb);

  it("creates once and returns the same id on every later call", async () => {
    const a = await findOrCreateDrug("Atorvastatin 20mg", "00071015523");
    const b = await findOrCreateDrug("Atorvastatin 20mg", "00071015523");
    expect(b).toBe(a);
  });

  it("NULL-NDC compounds dedupe by name (migration 005 partial index)", async () => {
    const a = await findOrCreateDrug("TRIMIX 30", null);
    const b = await findOrCreateDrug("TRIMIX 30", null);
    expect(b).toBe(a);
  });

  it("adopts a row another writer already inserted instead of failing", async () => {
    rawDb().prepare("INSERT INTO drugs (name, ndc) VALUES ('Eliquis 5mg', '00003089421')").run();
    const id = await findOrCreateDrug("Eliquis 5mg", "00003089421");
    const n = rawDb().prepare("SELECT COUNT(*) AS n FROM drugs WHERE name = 'Eliquis 5mg'").get() as { n: number };
    expect(id).toBeGreaterThan(0);
    expect(n.n).toBe(1);
  });

  it("same name under a different NDC is a different drug", async () => {
    const withNdc = await findOrCreateDrug("Metformin 500mg", "00093104801");
    const otherNdc = await findOrCreateDrug("Metformin 500mg", "00093104802");
    expect(otherNdc).not.toBe(withNdc);
  });
});

describe("(rx_number, due_date) natural key", () => {
  beforeEach(freshDb);

  it("a second row in the same slot is rejected by the unique index", async () => {
    const drugId = await findOrCreateDrug("Jardiance 25mg", null);
    await createRefill({ ...blank, rx_number: "700123", due_date: "2026-07-20", drug_id: drugId });
    await expect(
      createRefill({ ...blank, rx_number: "700123", due_date: "2026-07-20", drug_id: drugId }),
    ).rejects.toThrow();
  });

  it("findRefillByRxDue sees the occupant of a slot, and nothing else", async () => {
    const id = seedRefill({ rx: "700123", due: "2026-07-20" });
    expect(await findRefillByRxDue("700123", "2026-07-20")).toEqual({ id });
    expect(await findRefillByRxDue("700123", "2026-07-21")).toBeNull();
    expect(await findRefillByRxDue("700999", "2026-07-20")).toBeNull();
  });

  it("same Rx on a different due date is a normal refill cycle, not a duplicate", async () => {
    const drugId = await findOrCreateDrug("Jardiance 25mg", null);
    await createRefill({ ...blank, rx_number: "700123", due_date: "2026-07-20", drug_id: drugId });
    await expect(
      createRefill({ ...blank, rx_number: "700123", due_date: "2026-08-19", drug_id: drugId }),
    ).resolves.toBeGreaterThan(0);
  });
});

describe("deleteRefill", () => {
  beforeEach(freshDb);

  it("events outlive the deleted row — the permanent analytics record", async () => {
    const id = seedRefill({ due: "2026-07-01" });
    rawDb()
      .prepare("INSERT INTO refill_events (refill_id, at, kind, old_value, new_value) VALUES ($1, $2, 'call_note', NULL, 'LVM+RSL')")
      .run({ $1: id, $2: new Date().toISOString() });
    await deleteRefill(id);
    expect(rawDb().prepare("SELECT COUNT(*) AS n FROM refills WHERE id = $1").get({ $1: id })).toMatchObject({ n: 0 });
    expect(eventsFor(id)).toHaveLength(1);
  });
});
