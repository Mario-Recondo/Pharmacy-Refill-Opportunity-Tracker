// The all-or-nothing write contract (SQL review M1, ADR 0003): a failure in a
// multi-statement batch must persist nothing — updateRefillField's row update
// and its event-log write commit together or not at all. The transaction here
// is the test double's emulation of the Rust execute_batch command (the real
// command's pooling/transaction behavior was verified live); what these tests
// pin is the JS side's contract — which statements are batched together and
// that a rejected edit leaves no partial state behind.
import { beforeEach, describe, expect, it } from "vitest";
import { executeAtomicBatch } from "../src/db";
import { updateRefillField } from "../src/data/refills";
import { eventsFor, freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const drugCount = (name: string): number =>
  (rawDb().prepare("SELECT COUNT(*) AS n FROM drugs WHERE name = $1").get({ $1: name }) as { n: number }).n;

describe("executeAtomicBatch", () => {
  beforeEach(freshDb);

  it("a failing later statement rolls back the earlier ones", async () => {
    await expect(
      executeAtomicBatch([
        { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch Drug"] },
        { sql: "INSERT INTO refills (rx_number) VALUES ($1)", params: ["700300"] }, // NOT NULL violations
      ]),
    ).rejects.toThrow();
    expect(drugCount("Batch Drug")).toBe(0);
  });

  it("a successful multi-statement batch persists everything", async () => {
    await executeAtomicBatch([
      { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch A"] },
      { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch B"] },
    ]);
    expect(drugCount("Batch A")).toBe(1);
    expect(drugCount("Batch B")).toBe(1);
  });

  it("empty batch is a no-op; single statement takes the plugin's own path", async () => {
    await expect(executeAtomicBatch([])).resolves.toBeUndefined();
    await executeAtomicBatch([{ sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Solo"] }]);
    expect(drugCount("Solo")).toBe(1);
  });
});

describe("updateRefillField atomicity", () => {
  beforeEach(freshDb);

  it("a rejected edit persists neither the row change nor its event", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    // 'Bogus' violates the status CHECK constraint; the batch also carries the
    // status event — the claim under test is that BOTH vanish together
    await expect(updateRefillField(id, "status", "Bogus")).rejects.toThrow();
    const row = rawDb().prepare("SELECT status FROM refills WHERE id = $1").get({ $1: id }) as { status: string };
    expect(row.status).toBe("Pending");
    expect(eventsFor(id)).toHaveLength(0);
  });
});
