// The all-or-nothing write contract (SQL review M1, ADR 0003): a failure in a
// multi-statement batch must persist nothing — updateRefillField's row update
// and its event-log write commit together or not at all. The transaction here
// is the test double's emulation of the Rust execute_batch command (the real
// command's pooling/transaction behavior was verified live); what these tests
// pin is the JS side's contract — which statements are batched together, that a
// row write already applied is rolled back when the following event write
// fails, and that single statements bypass the batch command entirely.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// same specifier the data layer imports; vitest.config aliases it to the stub,
// so spying here observes the exact binding src/db.ts calls
import * as apiCore from "@tauri-apps/api/core";
import { executeAtomicBatch } from "../src/db";
import { updateRefillField } from "../src/data/refills";
import { eventsFor, freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";

const drugCount = (name: string): number =>
  (rawDb().prepare("SELECT COUNT(*) AS n FROM drugs WHERE name = $1").get({ $1: name }) as { n: number }).n;

describe("executeAtomicBatch", () => {
  beforeEach(freshDb);
  afterEach(() => vi.restoreAllMocks());

  it("a failing later statement rolls back the earlier ones", async () => {
    await expect(
      executeAtomicBatch([
        { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch Drug"] },
        { sql: "INSERT INTO refills (rx_number) VALUES ($1)", params: ["700300"] }, // NOT NULL violations
      ]),
    ).rejects.toThrow();
    expect(drugCount("Batch Drug")).toBe(0);
  });

  it("rolls back a row update that already succeeded when the FOLLOWING event write fails", async () => {
    // exactly updateRefillField's batch shape — [UPDATE refills, INSERT
    // refill_events] — with the event insert failing on the kind CHECK. The
    // UPDATE runs first and succeeds; the row+event atomicity claim is that it
    // must still be reverted.
    const id = seedRefill({ due: "2026-07-20", new_copay: 10 });
    await expect(
      executeAtomicBatch([
        { sql: "UPDATE refills SET new_copay = 99 WHERE id = $1", params: [id] },
        {
          sql: "INSERT INTO refill_events (refill_id, at, kind) VALUES ($1, $2, 'not_a_valid_kind')",
          params: [id, new Date().toISOString()],
        },
      ]),
    ).rejects.toThrow();
    const row = rawDb().prepare("SELECT new_copay FROM refills WHERE id = $1").get({ $1: id }) as { new_copay: number };
    expect(row.new_copay).toBe(10); // the successful update was undone
    expect(eventsFor(id)).toHaveLength(0);
  });

  it("a successful multi-statement batch persists everything, via the execute_batch command", async () => {
    const invokeSpy = vi.spyOn(apiCore, "invoke");
    await executeAtomicBatch([
      { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch A"] },
      { sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Batch B"] },
    ]);
    expect(drugCount("Batch A")).toBe(1);
    expect(drugCount("Batch B")).toBe(1);
    expect(invokeSpy).toHaveBeenCalledWith("execute_batch", expect.anything());
  });

  it("a single statement bypasses the batch command and takes the plugin's own path", async () => {
    const invokeSpy = vi.spyOn(apiCore, "invoke");
    await executeAtomicBatch([{ sql: "INSERT INTO drugs (name, ndc) VALUES ($1, NULL)", params: ["Solo"] }]);
    expect(drugCount("Solo")).toBe(1);
    expect(invokeSpy).not.toHaveBeenCalled(); // routed through conn.execute, not invoke
  });

  it("an empty batch is a no-op and never reaches the command", async () => {
    const invokeSpy = vi.spyOn(apiCore, "invoke");
    await expect(executeAtomicBatch([])).resolves.toBeUndefined();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});

describe("updateRefillField atomicity", () => {
  beforeEach(freshDb);

  it("a rejected edit persists neither the row change nor its event", async () => {
    const id = seedRefill({ due: "2026-07-20" });
    // 'Bogus' fails the status CHECK on the row UPDATE itself, so the whole
    // edit is refused through the real API surface. (The complementary case —
    // a row update that succeeds and is then rolled back by a failing event
    // write — is pinned directly on executeAtomicBatch above.)
    await expect(updateRefillField(id, "status", "Bogus")).rejects.toThrow();
    const row = rawDb().prepare("SELECT status FROM refills WHERE id = $1").get({ $1: id }) as { status: string };
    expect(row.status).toBe("Pending");
    expect(eventsFor(id)).toHaveLength(0);
  });
});
