import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, rawDb, seedRefill } from "./helpers/fakeTauri";
import { commitImport, loadAliases, StaleImportError } from "../src/data/importData";
import { deleteLookupIfUnused } from "../src/data/settingsData";
import { batchInvocations, resetBatchInvocations } from "./stubs/api-core";
import { applyNameChoice, buildCommitPlan, computeDispositions, parseRows, proposeMapping, resolveNames, unresolvedAttentionCount, validateMapping, validatePlan, type Disposition, type ImportSheet, type ImportTarget, type ParsedImportRow, type NameResolution } from "../src/data/importPlan";
import { loadRxHistory } from "../src/data/refills";

const headers = ["Days Supply Ends On", "Rx Number", "Dispensed Item Name", "Patient Paid Amount", "Net Profit", "Refills Left", "Primary", "Secondary"];
const mapping = proposeMapping(headers);
const name = (rawName: string, kind: "insurance" | "secondary", choice: NameResolution["choice"], extra: Partial<NameResolution> = {}): NameResolution => ({ rawName, kind, choice, count: 1, ...extra });

describe("spreadsheet import planning", () => {
  beforeEach(() => freshDb());
  it("maps the fixed contract and rejects duplicate targets", () => {
    expect(mapping.valid).toBe(true);
    expect(proposeMapping(["Rx Number", "Other"]).valid).toBe(true);
    expect(proposeMapping(["Rx Number", "Rx Number"]).valid).toBe(false);
    expect(proposeMapping(["Primary", "Primary"]).issues[0]).toContain("duplicate target");
  });

  it("auto-maps every column of the real full PioneerRX export", () => {
    const fullExport = ["Rx Number", "Dispensed Item Name", "Primary", "Secondary", "Patient Paid Amount", "Dispensed Item NDC", "Days Supply Ends On", "Net Profit", "Refills Remaining"];
    const m = proposeMapping(fullExport);
    expect(m.valid).toBe(true);
    expect(m.targets).toEqual(["rx_number", "drug_name", "insurance", "secondary", "old_copay", "ignore", "due_date", "old_profit", "refills_left"]);
  });

  it("parses dates, money, refills, and numeric Rx values safely", () => {
    const sheet: ImportSheet = { headers, rows: [["7/1/2026", 428566, "Test Drug", "$1,234.56", "(12.50)", "3", "Plan", ""]] };
    const row = parseRows(sheet, mapping)[0];
    expect(row.rx_number).toBe("428566"); expect(row.due_date).toBe("2026-07-01"); expect(row.old_copay).toBe(1234.56); expect(row.old_profit).toBe(-12.5); expect(row.refills_left).toBe(3); expect(row.issues).toEqual([]);
    expect(parseRows({ headers, rows: [["2026-02-31", 1, "Drug", 1, 1, "2.5", "", ""]]}, mapping)[0].issues.length).toBeGreaterThan(0);
    expect(parseRows({ headers, rows: [["", 1.5, "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("Rx number");
    expect(parseRows({ headers, rows: [["2026-07-01", "", "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("blank Rx number");
    expect(parseRows({ headers, rows: [["2026-07-01", null, "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("blank Rx number");
    expect(parseRows({ headers, rows: [["13/1/2026", "1", "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("invalid");
    expect(parseRows({ headers, rows: [["1/1/26", "1", "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("invalid");
    expect(parseRows({ headers, rows: [["", "1", "Drug", 1, 1, "", "", ""]]}, mapping)[0].issues.join(" ")).toContain("blank due date");
  });

  it("resolves aliases before active vocab and keeps kinds separate", () => {
    const aliases = new Map([["insurance|PLAN", 9], ["secondary|PLAN", null]]);
    expect(resolveNames(["Plan"], "insurance", aliases, [{ id: 1, name: "Plan", active: 1 }])[0].targetId).toBe(9);
    expect(resolveNames(["Plan"], "secondary", aliases, [{ id: 1, name: "Plan", active: 1 }])[0].choice).toBe("blank");
    expect(resolveNames(["Old"], "insurance", new Map(), [{ id: 1, name: "Old", active: 0 }])[0].choice).toBe("unresolved");
    expect(resolveNames(["New", "new"], "insurance", new Map(), [])[0].count).toBe(2);
  });

  it("applies ordered duplicate and medication rules", () => {
    const parsed = parseRows({ headers, rows: [["2026-07-01", "100", "Drug A", 1, 2, "", "", ""], ["2026-07-01", "100", "Drug A", 1, 2, "", "", ""]] }, mapping);
    const result = computeDispositions(parsed, [], new Map());
    expect(result[0].kind).toBe("new"); expect(result[1].reason).toBe("duplicate in file");
    const conflict = computeDispositions(parseRows({ headers, rows: [["2026-07-01", "101", "Drug B", 1, 2, "", "", ""]] }, mapping), [{ id: 1, rx_number: "101", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug A" }], new Map());
    expect(conflict[0].kind).toBe("drug-conflict");
  });

  it("handles the 21-day boundary and plan-wide target collisions", () => {
    const one = (due: string, rx = "200") => parseRows({ headers, rows: [[due, rx, "Drug", 1, 2, "", "", ""]] }, mapping)[0];
    const existing = [{ id: 4, rx_number: "200", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug" }];
    expect(computeDispositions([one("2026-07-22")], existing, new Map())[0].kind).toBe("probable-duplicate");
    expect(computeDispositions([one("2026-07-23")], existing, new Map())[0].kind).toBe("new");
    const a = computeDispositions([one("2026-07-10"), one("2026-07-11", "201")], [{ ...existing[0], rx_number: "200" }, { ...existing[0], id: 5, rx_number: "201" }], new Map());
    a[1].existing = a[0].existing; a[1].action = "update";
    expect(validatePlan(a).join(" ")).toContain("targeted more than once");
  });

  it("uses migration 007 alias NOCASE uniqueness and stale filtering", async () => {
    const db = rawDb();
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','Express Scripts',NULL)").run();
    expect(() => db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','EXPRESS SCRIPTS',NULL)").run()).toThrow();
    expect((await loadAliases()).get("insurance|EXPRESS SCRIPTS")).toBeNull();
  });

  it("deletes insurance aliases together with an unused lookup", async () => {
    const db = rawDb(); const insurance = db.prepare("SELECT id FROM insurances LIMIT 1").get() as { id: number };
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','To Delete',$1)").run({ $1: insurance.id });
    expect(await deleteLookupIfUnused("insurances", insurance.id)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM import_aliases WHERE target_id=$1").get({ $1: insurance.id }) as any).n).toBe(0);
  });

  it("round-trips both refill counters and preserves non-null human work", () => {
    const db = rawDb(); const id = seedRefill({ rx: "777", due: "2026-07-01", old_profit: 99 });
    db.prepare("UPDATE refills SET refills_filled=1, refills_left=3 WHERE id=$1").run({ $1: id });
    db.prepare("UPDATE refills SET old_copay=COALESCE(old_copay,$1), old_profit=COALESCE(old_profit,$2) WHERE id=$3").run({ $1: 25, $2: 12, $3: id });
    const row = db.prepare("SELECT refills_filled,refills_left,old_copay,old_profit FROM refills WHERE id=$1").get({ $1: id }) as any;
    expect(row).toMatchObject({ refills_filled: 1, refills_left: 3, old_copay: 25, old_profit: 99 });
  });

  it("commits an insert using a drug resolved as existing", async () => {
    const db = rawDb(); seedRefill({ rx: "existing", due: "2026-06-01", drug: "Known Drug" });
    const drug = db.prepare("SELECT id FROM drugs WHERE name='Known Drug'").get() as { id: number };
    await commitImport({ rows: [{ action: "insert", drugId: drug.id, drugName: "Known Drug", finalDue: "2026-07-01", row: { rowIndex: 0, rx_number: "new-1", due_date: "2026-07-01", drug_name: "Known Drug", insurance: null, secondary: null, old_copay: 1, old_profit: 2, refills_left: 3, refills_filled: null, issues: [] } }], aliases: [], columnMapping: { "Rx Number": "rx_number" } });
    const row = db.prepare("SELECT rx_number,refills_left FROM refills WHERE rx_number='new-1'").get() as any;
    expect(row).toMatchObject({ rx_number: "new-1", refills_left: 3 });
  });

  it("blocks a planned insert with no medication in validation", () => {
    const parsed = parseRows({ headers, rows: [["2026-07-01", "300", "", 1, 2, "", "", ""]] }, mapping);
    const d = computeDispositions(parsed, [], new Map());
    expect(d[0].kind).toBe("error"); // missing medication at disposition time
    // and the belt-and-braces check if a per-row override forces an insert anyway:
    expect(validatePlan([{ row: parsed[0], kind: "new", action: "insert" }]).join(" ")).toContain("missing medication");
  });

  it("creates a new insurance and drug inside the batch and resolves both by subselect", async () => {
    const db = rawDb();
    await commitImport({
      rows: [{ action: "insert", drugName: "Brand New Drug", finalDue: "2026-07-05", row: { rowIndex: 0, rx_number: "new-2", due_date: "2026-07-05", drug_name: "Brand New Drug", insurance: "VILLAGE RX LOCAL", secondary: null, old_copay: 250, old_profit: 75, refills_left: 2, refills_filled: null, issues: [] } }],
      aliases: [{ rawName: "VILLAGE RX LOCAL", kind: "insurance", choice: "create", targetName: "Village Rx Local", count: 1 }],
      columnMapping: {},
    });
    const ins = db.prepare("SELECT id, sort_order FROM insurances WHERE name='Village Rx Local'").get() as any;
    const maxBefore = db.prepare("SELECT MAX(sort_order) AS m FROM insurances WHERE id != $1").get({ $1: ins.id }) as any;
    expect(ins.sort_order).toBe(maxBefore.m + 10);
    const row = db.prepare("SELECT r.insurance_id, d.name AS drug FROM refills r JOIN drugs d ON d.id=r.drug_id WHERE r.rx_number='new-2'").get() as any;
    expect(row.insurance_id).toBe(ins.id);
    expect(row.drug).toBe("Brand New Drug");
    const alias = db.prepare("SELECT target_id FROM import_aliases WHERE kind='insurance' AND raw_name='VILLAGE RX LOCAL'").get() as any;
    expect(alias.target_id).toBe(ins.id);
  });

  it("coalesces byte-identical pending secondary creates at commit time", async () => {
    const db = rawDb(); seedRefill({ rx: "dedupe-seed", due: "2026-06-01", drug: "Dedupe Drug" });
    const drug = db.prepare("SELECT id FROM drugs WHERE name='Dedupe Drug'").get() as { id: number };
    const row = (rowIndex: number, rx_number: string, secondary: string) => ({ rowIndex, rx_number, due_date: `2026-07-0${rowIndex + 1}`, drug_name: "Dedupe Drug", insurance: null, secondary, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] as string[] });
    await commitImport({
      rows: [
        { action: "insert", drugId: drug.id, drugName: "Dedupe Drug", finalDue: "2026-07-01", row: row(0, "dedupe-1", "SLYND") },
        { action: "insert", drugId: drug.id, drugName: "Dedupe Drug", finalDue: "2026-07-02", row: row(1, "dedupe-2", "Slynd Copay") },
      ],
      aliases: [
        { rawName: "SLYND", kind: "secondary", choice: "create", targetName: "SLYND", count: 1 },
        { rawName: "Slynd Copay", kind: "secondary", choice: "create", targetName: "SLYND", count: 1 },
      ], columnMapping: {},
    });
    const lookups = db.prepare("SELECT id FROM secondary_coverages WHERE name='SLYND'").all() as { id: number }[];
    expect(lookups).toHaveLength(1);
    const aliases = db.prepare("SELECT kind, target_id FROM import_aliases WHERE raw_name IN ('SLYND','Slynd Copay') ORDER BY raw_name").all() as { kind: string; target_id: number }[];
    expect(aliases).toHaveLength(2); expect(aliases.every((a) => a.kind === "secondary")).toBe(true); expect(aliases.every((a) => a.target_id === lookups[0].id)).toBe(true);
    const refills = db.prepare("SELECT secondary_id FROM refills WHERE rx_number IN ('dedupe-1','dedupe-2') ORDER BY rx_number").all() as { secondary_id: number }[];
    expect(refills).toHaveLength(2); expect(refills.every((r) => r.secondary_id === lookups[0].id)).toBe(true);
  });

  it("applies name-choice transitions without stale fields or dependent drift", () => {
    // Build owner + two dependents through the public grammar itself.
    let all = [name("SLYND", "secondary", "unresolved"), name("Slynd Copay", "secondary", "unresolved"), name("Slynd Other", "secondary", "unresolved")];
    all = applyNameChoice(all, all[0], "create"); // plain "create": self-owned
    expect(all[0]).toMatchObject({ choice: "create", targetName: "SLYND" }); expect(all[0]).not.toHaveProperty("targetId");
    all = applyNameChoice(all, all[1], "create:SLYND"); // reference round-trips onto the selected row
    expect(all[1]).toMatchObject({ choice: "create", targetName: "SLYND" }); expect(all[1]).not.toHaveProperty("targetId");
    all = applyNameChoice(all, all[2], "create:SLYND");

    // Changing a DEPENDENT touches nobody else (owner + sibling keep their choices).
    const afterDepChange = applyNameChoice(all, all[1], "blank");
    expect(afterDepChange[1]).toMatchObject({ choice: "blank" }); expect(afterDepChange[1]).not.toHaveProperty("targetName");
    expect(afterDepChange[0]).toMatchObject({ choice: "create", targetName: "SLYND" });
    expect(afterDepChange[2]).toMatchObject({ choice: "create", targetName: "SLYND" });

    // OWNER → existing: dependents reset to unresolved; owner carries no stale targetName.
    const ownerToExisting = applyNameChoice(all, all[0], "42");
    expect(ownerToExisting[0]).toMatchObject({ choice: "existing", targetId: 42 }); expect(ownerToExisting[0]).not.toHaveProperty("targetName");
    expect(ownerToExisting[1].choice).toBe("unresolved"); expect(ownerToExisting[2].choice).toBe("unresolved");

    // OWNER → unresolved and OWNER → blank: same dependent reset, both fields cleared.
    for (const value of ["unresolved", "blank"] as const) {
      const res = applyNameChoice(all, all[0], value);
      expect(res[0]).toMatchObject({ choice: value }); expect(res[0]).not.toHaveProperty("targetId"); expect(res[0]).not.toHaveProperty("targetName");
      expect(res[1].choice).toBe("unresolved"); expect(res[2].choice).toBe("unresolved");
    }

    // OWNER remapped to another pending creation: abandons its own name, dependents reset.
    const remapped = applyNameChoice(all, all[0], "create:OTHER");
    expect(remapped[0]).toMatchObject({ choice: "create", targetName: "OTHER" }); expect(remapped[0]).not.toHaveProperty("targetId");
    expect(remapped[1].choice).toBe("unresolved"); expect(remapped[2].choice).toBe("unresolved");

    // existing → create clears the stale targetId.
    const fromExisting = applyNameChoice([name("X", "secondary", "existing", { targetId: 42 })], name("X", "secondary", "existing", { targetId: 42 }), "create");
    expect(fromExisting[0]).toMatchObject({ choice: "create", targetName: "X" }); expect(fromExisting[0]).not.toHaveProperty("targetId");

    // Malformed values never mutate state and never produce targetId: NaN.
    expect(applyNameChoice(all, all[0], "not-a-choice")).toEqual(all);
    expect(applyNameChoice(all, all[0], "-3")).toEqual(all);
    expect(applyNameChoice(all, all[0], "create:")).toEqual(all);
  });

  it("rolls back the whole batch: a late failing statement leaves no lookup, drug, or refill", async () => {
    const db = rawDb();
    const before = db.prepare("SELECT COUNT(*) AS n FROM refills").get() as any;
    await expect(commitImport({
      rows: [{ action: "insert", drugName: "Doomed Drug", finalDue: "2026-07-06", row: { rowIndex: 0, rx_number: "doomed-1", due_date: "2026-07-06", drug_name: "Doomed Drug", insurance: "DOOMED PLAN", secondary: null, old_copay: 1, old_profit: 2, refills_left: null, refills_filled: null, issues: [] } }],
      // the alias statement violates import_aliases' kind CHECK -> whole batch must roll back
      aliases: [
        { rawName: "DOOMED PLAN", kind: "insurance", choice: "create", targetName: "Doomed Plan", count: 1 },
        { rawName: "X", kind: "bogus" as never, choice: "blank", count: 1 },
      ],
      columnMapping: {},
    })).rejects.toThrow();
    expect((db.prepare("SELECT COUNT(*) AS n FROM refills").get() as any).n).toBe(before.n);
    expect(db.prepare("SELECT id FROM insurances WHERE name='Doomed Plan'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM drugs WHERE name='Doomed Drug'").get()).toBeUndefined();
    expect(db.prepare("SELECT id FROM import_aliases WHERE raw_name='DOOMED PLAN'").get()).toBeUndefined();
  });

  it("rejects an adoption whose target is no longer Pending, before execute_batch", async () => {
    const db = rawDb(); const id = seedRefill({ rx: "stale-2", due: "2026-07-01", drug: "Adopt Drug" });
    db.prepare("UPDATE refills SET status='Checked Out' WHERE id=$1").run({ $1: id }); resetBatchInvocations();
    const row = { rowIndex: 0, rx_number: "stale-2", due_date: "2026-07-04", drug_name: "Adopt Drug", insurance: null, secondary: null, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] as string[] };
    await expect(commitImport({ rows: [{ action: "update", adoption: true, existingId: id, expectedDue: "2026-07-01", expectedDrugName: "Adopt Drug", finalDue: "2026-07-04", row }], aliases: [], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
    expect((db.prepare("SELECT due_date FROM refills WHERE id=$1").get({ $1: id }) as any).due_date).toBe("2026-07-01");
  });

  it("rejects a create-new whose name now exists, before execute_batch", async () => {
    const db = rawDb(); const existing = db.prepare("SELECT name FROM insurances LIMIT 1").get() as { name: string };
    resetBatchInvocations();
    await expect(commitImport({
      rows: [],
      aliases: [{ rawName: existing.name.toUpperCase(), kind: "insurance", choice: "create", targetName: existing.name.toUpperCase(), count: 1 }],
      columnMapping: {},
    })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("falls back to the saved mapping for renamed headers, case-insensitively for known ones", () => {
    // known headers match regardless of case; unknown ones use the saved mapping
    expect(proposeMapping(["DAYS SUPPLY ENDS ON", "rx number"]).targets).toEqual(["due_date", "rx_number"]);
    const saved = { "Fill Deadline": "due_date", "Script #": "rx_number" };
    expect(proposeMapping(["Fill Deadline", "Script #"], saved).targets).toEqual(["due_date", "rx_number"]);
    expect(proposeMapping(["Fill Deadline", "Script #"], null).targets).toEqual(["ignore", "ignore"]);
  });

  it("computes exact-update fill fields precisely, honoring blank aliases", () => {
    const existing = [{ id: 9, rx_number: "500", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug", insurance_id: null, secondary_id: null, old_copay: 11, old_profit: null, refills_filled: null, refills_left: null }];
    const parsed = parseRows({ headers, rows: [["2026-07-01", "500", "Drug", 99, 42, "2", "SOMEPLAN", ""]] }, mapping);
    const noResolver = computeDispositions(parsed, existing, new Map())[0];
    // old_copay is technician-entered -> never in the fill set; profit/refills/insurance are
    expect(noResolver.kind).toBe("update");
    expect(noResolver.fillFields).toEqual(["insurance_id", "old_profit", "refills_left"]);
    const blankAlias = computeDispositions(parsed, existing, new Map(), () => null)[0];
    expect(blankAlias.fillFields).toEqual(["old_profit", "refills_left"]); // remembered blank: insurance not fillable
    const allBlank = computeDispositions(parseRows({ headers, rows: [["2026-07-01", "500", "Drug", "", "", "", "SOMEPLAN", ""]] }, mapping), existing, new Map(), () => null)[0];
    expect(allBlank.kind).toBe("no-change");
  });

  it("applies the 21-day window on both sides of an existing date", () => {
    const existing = [{ id: 10, rx_number: "600", due_date: "2026-07-22", status: "Pending", drug_id: 1, drug_name: "Drug" }];
    const at = (due: string) => computeDispositions(parseRows({ headers, rows: [[due, "600", "Drug", 1, 2, "", "", ""]] }, mapping), existing, new Map())[0].kind;
    expect(at("2026-07-01")).toBe("probable-duplicate"); // 21 days earlier
    expect(at("2026-06-30")).toBe("new");                // 22 days earlier
    expect(at("2026-08-12")).toBe("probable-duplicate"); // 21 days later
    expect(at("2026-08-13")).toBe("new");                // 22 days later
  });

  it("blocks for explicit selection with multiple nearby candidates; case-only drug diff is no conflict", () => {
    const candidates = [
      { id: 11, rx_number: "700", due_date: "2026-07-05", status: "Pending", drug_id: 1, drug_name: "DRUG MIXED CASE" },
      { id: 12, rx_number: "700", due_date: "2026-07-15", status: "Pending", drug_id: 1, drug_name: "DRUG MIXED CASE" },
    ];
    const d = computeDispositions(parseRows({ headers, rows: [["2026-07-10", "700", "Drug Mixed Case", 1, 2, "", "", ""]] }, mapping), candidates, new Map())[0];
    expect(d.kind).toBe("needs-selection"); // never resolved by query order
    expect(d.candidates).toHaveLength(2);
    expect(unresolvedAttentionCount([d])).toBe(1);
    expect(unresolvedAttentionCount([{ ...d, action: "update", existing: candidates[1] }])).toBe(0); // chosen -> stops blocking
    expect(unresolvedAttentionCount([{ ...d, action: "skip" }])).toBe(0);
  });

  it("flags the full adoption/insert collision matrix", () => {
    const row = (rx: string, due: string, i: number): ParsedImportRow => ({ rowIndex: i, rx_number: rx, due_date: due, drug_name: "Drug", insurance: null, secondary: null, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] });
    const target = { id: 20, rx_number: "800", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug" };
    // two adoptions of the same existing row
    const both: Disposition[] = [
      { row: row("800", "2026-07-10", 0), kind: "probable-duplicate", existing: target, action: "update", finalDue: "2026-07-10" },
      { row: row("800", "2026-07-12", 1), kind: "probable-duplicate", existing: target, action: "update", finalDue: "2026-07-12" },
    ];
    expect(validatePlan(both).join(" ")).toContain("targeted more than once");
    // adoption converging with a planned insert on the same (rx, due)
    const converge: Disposition[] = [
      { row: row("800", "2026-07-10", 0), kind: "probable-duplicate", existing: target, action: "update", finalDue: "2026-07-10" },
      { row: row("800", "2026-07-10", 1), kind: "new", action: "insert", finalDue: "2026-07-10" },
    ];
    expect(validatePlan(converge).join(" ")).toContain("collides");
  });

  it("refuses deleting an in-use insurance and keeps its aliases", async () => {
    const db = rawDb();
    const refillId = seedRefill({ rx: "ins-1", due: "2026-07-01" });
    const ins = db.prepare("SELECT id FROM insurances LIMIT 1").get() as { id: number };
    db.prepare("UPDATE refills SET insurance_id=$1 WHERE id=$2").run({ $1: ins.id, $2: refillId });
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','InUse',$1)").run({ $1: ins.id });
    expect(await deleteLookupIfUnused("insurances", ins.id)).toBe(false);
    expect((db.prepare("SELECT COUNT(*) AS n FROM import_aliases WHERE raw_name='InUse'").get() as any).n).toBe(1);
  });

  it("round-trips refills_left through the data layer's real row SELECT", async () => {
    const db = rawDb();
    const id = seedRefill({ rx: "rt-1", due: "2026-07-01" });
    db.prepare("UPDATE refills SET refills_left=4 WHERE id=$1").run({ $1: id });
    const rows = await loadRxHistory("rt-1");
    expect(rows[0].refills_left).toBe(4);
  });

  it("auto-matches vocabulary case-insensitively without a prior alias", () => {
    const r = resolveNames(["cvs caremark"], "insurance", new Map(), [{ id: 3, name: "CVS Caremark", active: 1 }]);
    expect(r[0].choice).toBe("existing");
    expect(r[0].targetId).toBe(3);
    expect(r[0].targetName).toBe("CVS Caremark");
  });

  it("filters deleted-target aliases out of loadAliases", async () => {
    const db = rawDb();
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','Orphaned',999999)").run();
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','Blanked',NULL)").run();
    const aliases = await loadAliases();
    expect(aliases.has("insurance|ORPHANED")).toBe(false); // stale target -> re-surfaces as unresolved
    expect(aliases.get("insurance|BLANKED")).toBeNull();   // explicit blank survives
  });

  it("fills a NULL refills_filled from the legacy column and reads it back through ROW_SELECT", async () => {
    const db = rawDb();
    const legacyHeaders = [...headers, "Number Of Refills Filled"];
    const legacyMapping = proposeMapping(legacyHeaders);
    const existing = [{ id: 30, rx_number: "rf-1", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug", insurance_id: 1, secondary_id: null, old_copay: 1, old_profit: 1, refills_filled: null, refills_left: 3 }];
    const parsed = parseRows({ headers: legacyHeaders, rows: [["2026-07-01", "rf-1", "Drug", "", "", "", "", "", "2"]] }, legacyMapping);
    expect(parsed[0].refills_filled).toBe(2);
    const d = computeDispositions(parsed, existing, new Map())[0];
    expect(d.fillFields).toEqual(["refills_filled"]);
    const id = seedRefill({ rx: "rf-2", due: "2026-07-02" });
    db.prepare("UPDATE refills SET refills_filled=COALESCE(refills_filled,$1) WHERE id=$2").run({ $1: 2, $2: id });
    expect((await loadRxHistory("rf-2"))[0].refills_filled).toBe(2);
  });

  it("prefers drug-conflict over probable-duplicate and blocks all rows of an in-file contradiction", () => {
    // nearby Pending candidate under a DIFFERENT drug: conflict wins, never probable-dup
    const near = [{ id: 31, rx_number: "902", due_date: "2026-07-05", status: "Pending", drug_id: 1, drug_name: "Other Drug" }];
    const d = computeDispositions(parseRows({ headers, rows: [["2026-07-10", "902", "File Drug", 1, 2, "", "", ""]] }, mapping), near, new Map())[0];
    expect(d.kind).toBe("drug-conflict");
    // in-file contradiction: BOTH rows of the rx blocked
    const both = computeDispositions(parseRows({ headers, rows: [["2026-07-01", "903", "Drug A", 1, 2, "", "", ""], ["2026-07-15", "903", "Drug B", 1, 2, "", "", ""]] }, mapping), [], new Map());
    expect(both.map((x) => x.kind)).toEqual(["drug-conflict", "drug-conflict"]);
  });

  it("lets a drug-less row fill an exact match (existing medication stands)", () => {
    const existing = [{ id: 32, rx_number: "904", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Kept Drug", insurance_id: null, secondary_id: null, old_copay: null, old_profit: null, refills_filled: null, refills_left: null }];
    const d = computeDispositions(parseRows({ headers, rows: [["2026-07-01", "904", "", 5, 6, "", "", ""]] }, mapping), existing, new Map())[0];
    expect(d.kind).toBe("update");
    expect(d.fillFields).toEqual(expect.arrayContaining(["old_copay", "old_profit"]));
  });

  it("flags an adoption landing on another existing row's date and two adoptions converging", () => {
    const row = (due: string, i: number): ParsedImportRow => ({ rowIndex: i, rx_number: "905", due_date: due, drug_name: "Drug", insurance: null, secondary: null, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] });
    const a = { id: 40, rx_number: "905", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug" };
    const b = { id: 41, rx_number: "905", due_date: "2026-07-15", status: "Pending", drug_id: 1, drug_name: "Drug" };
    // adopting A onto B's date while B is present in the plan
    const ontoExisting: Disposition[] = [
      { row: row("2026-07-15", 0), kind: "probable-duplicate", existing: a, action: "update", finalDue: "2026-07-15" },
      { row: row("2026-07-15", 1), kind: "no-change", existing: b, action: "skip", finalDue: "2026-07-15" },
    ];
    expect(validatePlan(ontoExisting).join(" ")).toContain("collides");
    // two adoptions of different targets converging on one final (rx, due)
    const converge: Disposition[] = [
      { row: row("2026-07-20", 0), kind: "probable-duplicate", existing: a, action: "update", finalDue: "2026-07-20" },
      { row: row("2026-07-20", 1), kind: "probable-duplicate", existing: b, action: "update", finalDue: "2026-07-20" },
    ];
    expect(validatePlan(converge).join(" ")).toContain("collides");
  });

  it("rollback also reverts an earlier successful update and the settings write", async () => {
    const db = rawDb();
    const id = seedRefill({ rx: "rb-2", due: "2026-07-01", drug: "RB Drug" });
    db.prepare("DELETE FROM settings WHERE key='import_column_mapping'").run();
    const row: ParsedImportRow = { rowIndex: 0, rx_number: "rb-2", due_date: "2026-07-01", drug_name: "RB Drug", insurance: null, secondary: null, old_copay: null, old_profit: 55, refills_left: null, refills_filled: null, issues: [] };
    await expect(commitImport({
      rows: [{ action: "update", existingId: id, expectedDue: "2026-07-01", finalDue: "2026-07-01", expectedDrugName: "RB Drug", row }],
      aliases: [{ rawName: "X", kind: "bogus" as never, choice: "blank", count: 1 }], // late CHECK failure
      columnMapping: { marker: "should-not-persist" },
    })).rejects.toThrow();
    expect((db.prepare("SELECT old_profit FROM refills WHERE id=$1").get({ $1: id }) as any).old_profit).toBeNull(); // earlier UPDATE reverted
    // the failing alias statement precedes the settings statement in the batch,
    // so this proves the mapping was NEVER WRITTEN (nothing after a failure runs);
    // the settings statement is always last, so no failure can follow it
    expect(db.prepare("SELECT value FROM settings WHERE key='import_column_mapping'").get()).toBeUndefined();
  });

  it("validates the edited mapping directly, not re-proposed defaults", () => {
    // user un-maps Rx Number on a known header: re-proposing would silently restore it
    const targets: ImportTarget[] = ["due_date", "ignore", "drug_name"];
    expect(validateMapping(targets).valid).toBe(false);
    expect(validateMapping(targets).issues.join(" ")).toContain("Rx Number");
    const dup: ImportTarget[] = ["rx_number", "old_copay", "old_copay"];
    expect(validateMapping(dup).issues[0]).toContain("columns 2 and 3");
  });

  it("keeps adoption semantics when a candidate is chosen (kind preserved)", () => {
    const row: ParsedImportRow = { rowIndex: 0, rx_number: "900", due_date: "2026-07-10", drug_name: "Drug", insurance: null, secondary: null, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] };
    const existing = { id: 7, rx_number: "900", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug" };
    const d: Disposition = { row, kind: "needs-selection", candidates: [existing], existing, action: "update", finalDue: "2026-07-10" };
    const plan = buildCommitPlan([d], [], {});
    expect(plan.rows[0].adoption).toBe(true);
    expect(plan.rows[0].expectedStatus).toBe("Pending");
    expect(plan.rows[0].finalDue).toBe("2026-07-10");
  });

  it("lets a drug-less row update a nearby candidate but not insert", () => {
    const parsed = parseRows({ headers, rows: [["2026-07-10", "901", "", 1, 2, "", "", ""]] }, mapping);
    const existing = [{ id: 8, rx_number: "901", due_date: "2026-07-01", status: "Pending", drug_id: 1, drug_name: "Drug" }];
    const d = computeDispositions(parsed, existing, new Map());
    expect(d[0].kind).toBe("probable-duplicate"); // update-existing stays available
    expect(validatePlan([{ ...d[0], action: "insert" }]).join(" ")).toContain("missing medication");
  });

  it("orders two created lookups' sort_order sequentially in one batch", async () => {
    const db = rawDb();
    await commitImport({
      rows: [],
      aliases: [
        { rawName: "FIRST NEW", kind: "insurance", choice: "create", targetName: "First New", count: 1 },
        { rawName: "SECOND NEW", kind: "insurance", choice: "create", targetName: "Second New", count: 1 },
      ],
      columnMapping: {},
    });
    const a = db.prepare("SELECT sort_order FROM insurances WHERE name='First New'").get() as any;
    const b = db.prepare("SELECT sort_order FROM insurances WHERE name='Second New'").get() as any;
    expect(b.sort_order).toBe(a.sort_order + 10);
  });

  it("alias upsert SQL retargets on conflict (case-insensitively)", () => {
    // the statement shape commitImport emits; commitImport itself can never
    // retarget (the stale guard blocks alias drift), so prove the SQL directly
    const db = rawDb();
    const [i1, i2] = db.prepare("SELECT id FROM insurances LIMIT 2").all() as any[];
    const upsert = db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ($1,$2,$3) ON CONFLICT(kind,raw_name) DO UPDATE SET target_id=excluded.target_id");
    upsert.run({ $1: "insurance", $2: "Retarget", $3: i1.id });
    upsert.run({ $1: "insurance", $2: "RETARGET", $3: i2.id });
    const rows = db.prepare("SELECT raw_name, target_id FROM import_aliases WHERE raw_name='Retarget'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(i2.id);
  });

  it("deletes secondary aliases with the lookup and refuses when refills use it", async () => {
    const db = rawDb();
    const sec = db.prepare("SELECT id FROM secondary_coverages LIMIT 1").get() as { id: number };
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('secondary','SecAlias',$1)").run({ $1: sec.id });
    const refillId = seedRefill({ rx: "sec-1", due: "2026-07-01" });
    db.prepare("UPDATE refills SET secondary_id=$1 WHERE id=$2").run({ $1: sec.id, $2: refillId });
    expect(await deleteLookupIfUnused("secondary_coverages", sec.id)).toBe(false); // in use → refused
    expect((db.prepare("SELECT COUNT(*) AS n FROM import_aliases WHERE raw_name='SecAlias'").get() as any).n).toBe(1);
    db.prepare("UPDATE refills SET secondary_id=NULL WHERE id=$1").run({ $1: refillId });
    expect(await deleteLookupIfUnused("secondary_coverages", sec.id)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM import_aliases WHERE raw_name='SecAlias'").get() as any).n).toBe(0);
  });

  it("stale (a): a row now occupies a planned insert's (rx, due)", async () => {
    seedRefill({ rx: "col-1", due: "2026-07-09", drug: "Col Drug" });
    resetBatchInvocations();
    const row: ParsedImportRow = { rowIndex: 0, rx_number: "col-1", due_date: "2026-07-09", drug_name: "Col Drug", insurance: null, secondary: null, old_copay: null, old_profit: null, refills_left: null, refills_filled: null, issues: [] };
    await expect(commitImport({ rows: [{ action: "insert", drugName: "Col Drug", finalDue: "2026-07-09", row }], aliases: [], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("stale (c): the update target row was deleted", async () => {
    const db = rawDb(); const id = seedRefill({ rx: "gone-1", due: "2026-07-01", drug: "Gone Drug" });
    db.prepare("DELETE FROM refills WHERE id=$1").run({ $1: id });
    resetBatchInvocations();
    const row: ParsedImportRow = { rowIndex: 0, rx_number: "gone-1", due_date: "2026-07-01", drug_name: "Gone Drug", insurance: null, secondary: null, old_copay: 1, old_profit: null, refills_left: null, refills_filled: null, issues: [] };
    await expect(commitImport({ rows: [{ action: "update", existingId: id, expectedDue: "2026-07-01", finalDue: "2026-07-01", expectedDrugName: "Gone Drug", row }], aliases: [], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("stale (d): the rx's medication changed since preview", async () => {
    const db = rawDb(); const id = seedRefill({ rx: "swap-1", due: "2026-07-01", drug: "Original Drug" });
    db.prepare("INSERT INTO drugs (name, ndc) VALUES ('Swapped Drug', NULL)").run();
    const newDrug = db.prepare("SELECT id FROM drugs WHERE name='Swapped Drug'").get() as { id: number };
    db.prepare("UPDATE refills SET drug_id=$1 WHERE id=$2").run({ $1: newDrug.id, $2: id });
    resetBatchInvocations();
    const row: ParsedImportRow = { rowIndex: 0, rx_number: "swap-1", due_date: "2026-07-01", drug_name: "Original Drug", insurance: null, secondary: null, old_copay: 1, old_profit: null, refills_left: null, refills_filled: null, issues: [] };
    await expect(commitImport({ rows: [{ action: "update", existingId: id, expectedDue: "2026-07-01", finalDue: "2026-07-01", expectedDrugName: "Original Drug", row }], aliases: [], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("stale (f): a lookup a resolution points at was deleted", async () => {
    const db = rawDb(); const ins = db.prepare("SELECT id, name FROM insurances LIMIT 1").get() as { id: number; name: string };
    db.prepare("DELETE FROM import_aliases WHERE target_id=$1").run({ $1: ins.id });
    db.prepare("DELETE FROM insurances WHERE id=$1").run({ $1: ins.id });
    resetBatchInvocations();
    await expect(commitImport({ rows: [], aliases: [{ rawName: ins.name, kind: "insurance", choice: "existing", targetId: ins.id, targetName: ins.name, count: 1 }], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("stale (h): a remembered alias changed after preview", async () => {
    const db = rawDb();
    const [i1, i2] = db.prepare("SELECT id FROM insurances LIMIT 2").all() as any[];
    // preview believed "Drifted" was blank; someone mapped it meanwhile
    db.prepare("INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ('insurance','Drifted',$1)").run({ $1: i1.id });
    resetBatchInvocations();
    await expect(commitImport({ rows: [], aliases: [{ rawName: "Drifted", kind: "insurance", choice: "blank", count: 1 }], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    // and an existing-choice whose alias now points elsewhere
    await expect(commitImport({ rows: [], aliases: [{ rawName: "Drifted", kind: "insurance", choice: "existing", targetId: i2.id, count: 1 }], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0);
  });

  it("rejects a stale update before execute_batch", async () => {
    const db = rawDb(); const id = seedRefill({ rx: "stale-1", due: "2026-07-01", drug: "Stale Drug" });
    const row = { rowIndex: 0, rx_number: "stale-1", due_date: "2026-07-02", drug_name: "Stale Drug", insurance: null, secondary: null, old_copay: 1, old_profit: 2, refills_left: null, refills_filled: null, issues: [] as string[] };
    db.prepare("UPDATE refills SET due_date='2026-07-03' WHERE id=$1").run({ $1: id }); resetBatchInvocations();
    await expect(commitImport({ rows: [{ action: "update", existingId: id, expectedDue: "2026-07-01", finalDue: "2026-07-02", expectedDrugName: "Stale Drug", expectedStatus: "Pending", row }], aliases: [], columnMapping: {} })).rejects.toBeInstanceOf(StaleImportError);
    expect(batchInvocations).toHaveLength(0); expect((db.prepare("SELECT due_date FROM refills WHERE id=$1").get({ $1: id }) as any).due_date).toBe("2026-07-03");
  });
});
