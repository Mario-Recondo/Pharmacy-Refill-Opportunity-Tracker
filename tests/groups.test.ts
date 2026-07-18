import { beforeEach, describe, expect, it } from "vitest";
import { addInsuranceGroup, deleteGroupIfEmpty } from "../src/data/settingsData";
import { freshDb, rawDb } from "./helpers/fakeTauri";

describe("insurance group defaults and deletion", () => {
  beforeEach(freshDb);

  it("refuses to delete an empty seeded default group and keeps the row", async () => {
    rawDb().prepare("UPDATE insurances SET group_id = NULL WHERE group_id = 1").run();

    expect(await deleteGroupIfEmpty(1)).toBe(false);
    expect(rawDb().prepare("SELECT id FROM insurance_groups WHERE id = 1").get()).toBeTruthy();
  });

  it("marks every seeded group from id 1 through 10 as default", () => {
    const rows = rawDb()
      .prepare("SELECT id, is_default FROM insurance_groups WHERE id BETWEEN 1 AND 10 ORDER BY id")
      .all() as { id: number; is_default: number }[];

    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.is_default === 1)).toBe(true);
  });

  it("gives a new group is_default 0 and deletes it while empty", async () => {
    await addInsuranceGroup("Custom Empty Group");
    const group = rawDb()
      .prepare("SELECT id, is_default FROM insurance_groups WHERE name = 'Custom Empty Group'")
      .get() as { id: number; is_default: number };

    expect(group.is_default).toBe(0);
    expect(await deleteGroupIfEmpty(group.id)).toBe(true);
    expect(rawDb().prepare("SELECT id FROM insurance_groups WHERE id = $1").get({ $1: group.id })).toBeUndefined();
  });

  it("still refuses to delete a non-empty custom group", async () => {
    await addInsuranceGroup("Custom Used Group");
    const group = rawDb().prepare("SELECT id FROM insurance_groups WHERE name = 'Custom Used Group'").get() as {
      id: number;
    };
    rawDb()
      .prepare("INSERT INTO insurances (name, group_id, sort_order) VALUES ('Custom Plan', $1, 999)")
      .run({ $1: group.id });

    expect(await deleteGroupIfEmpty(group.id)).toBe(false);
    expect(rawDb().prepare("SELECT id FROM insurance_groups WHERE id = $1").get({ $1: group.id })).toBeTruthy();
  });
});
