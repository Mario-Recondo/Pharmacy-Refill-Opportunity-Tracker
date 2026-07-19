export type ImportCell = string | number | boolean | null | { __overflow: boolean };
export interface ImportSheet { headers: string[]; rows: ImportCell[][]; }
export type ImportTarget = "due_date" | "rx_number" | "drug_name" | "insurance" | "secondary" | "old_copay" | "old_profit" | "refills_left" | "refills_filled" | "ignore";
export interface ColumnMapping { targets: ImportTarget[]; valid: boolean; issues: string[]; }
export interface ParsedImportRow {
  rowIndex: number; rx_number: string | null; due_date: string | null; drug_name: string | null;
  insurance: string | null; secondary: string | null; old_copay: number | null; old_profit: number | null;
  refills_left: number | null; refills_filled: number | null; issues: string[];
}
export type RowDisposition = "new" | "update" | "no-change" | "probable-duplicate" | "needs-selection" | "drug-conflict" | "error" | "skip";
export interface ExistingRefill { id: number; rx_number: string; due_date: string; status: string; drug_id: number; drug_name: string; insurance_id?: number|null; secondary_id?: number|null; old_copay?: number|null; old_profit?: number|null; refills_filled?: number|null; refills_left?: number|null; }
export interface NameResolution { rawName: string; kind: "insurance" | "secondary"; choice: "existing" | "create" | "blank" | "unresolved"; targetId?: number; targetName?: string; count: number; }
export interface Disposition {
  row: ParsedImportRow; kind: RowDisposition; reason?: string; existing?: ExistingRefill; candidates?: ExistingRefill[];
  action?: "update" | "insert" | "skip"; fillFields?: string[]; finalDue?: string;
}
export interface ImportCommitPlan { rows: Array<{ row: ParsedImportRow; action: "insert" | "update"; existingId?: number; finalDue?: string; expectedDue?: string; expectedDrugName?: string; expectedStatus?: string; adoption?: boolean; drugId?: number; drugName?: string; insuranceId?: number|null; secondaryId?: number|null }>; aliases: NameResolution[]; columnMapping: Record<string,string>; counts?: { skipped: number; errors: number }; }

export const KNOWN_HEADERS: Record<string, ImportTarget> = {
  "days supply ends on": "due_date", "rx number": "rx_number", "dispensed item name": "drug_name",
  "patient paid amount": "old_copay", "net profit": "old_profit", "refills left": "refills_left",
  "number of refills filled": "refills_filled", primary: "insurance", secondary: "secondary", "dispensed item ndc": "ignore",
};
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
export const normalizeName = norm;

/** Validate a target assignment as-is — used for USER-EDITED mappings, where
 * re-proposing would silently override the edits for known headers. */
export function validateMapping(targets: ImportTarget[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const used = new Map<string, number[]>();
  targets.forEach((t, i) => { if (t !== "ignore") used.set(t, [...(used.get(t) ?? []), i]); });
  for (const [target, indexes] of used) if (indexes.length > 1) issues.push(`duplicate target ${target}: columns ${indexes.map((i) => i + 1).join(" and ")}`);
  if (!targets.includes("rx_number")) issues.push("Rx Number is required");
  return { valid: issues.length === 0, issues };
}

export function proposeMapping(headers: string[], saved?: Record<string,string> | null): ColumnMapping {
  const targets = headers.map((header) => KNOWN_HEADERS[header.trim().toLowerCase()] ?? (saved?.[header] as ImportTarget | undefined) ?? "ignore");
  const { valid, issues } = validateMapping(targets);
  return { targets, valid, issues };
}

function cell(row: ImportCell[], mapping: ColumnMapping, target: ImportTarget): ImportCell | null {
  const i = mapping.targets.indexOf(target); return i < 0 ? null : row[i] ?? null;
}
function text(v: ImportCell | null): string | null { if (v == null || typeof v === "object") return null; const s = String(v).trim(); return s || null; }
function dateValue(v: ImportCell | null): { value: string|null; issue?: string } {
  const s = text(v); if (!s) return { value: null, issue: "blank due date" };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return validateDate(s, +m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return validateDate(s, +m[3], +m[1], +m[2]);
  return { value: null, issue: "invalid date (use yyyy-mm-dd or M/D/YYYY)" };
}
function validateDate(s: string, y: number, m: number, d: number) {
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? { value: `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` } : { value: null, issue: `invalid calendar date: ${s}` };
}
function money(v: ImportCell | null): { value: number|null; issue?: string } {
  if (v == null || (typeof v === "string" && !v.trim())) return { value: null };
  if (typeof v === "number") return Number.isFinite(v) ? { value: v } : { value: null, issue: "invalid money" };
  const s = String(v).trim().replace(/^\$|\$$/g, "").replace(/,/g, ""); const neg = /^\(.*\)$/.test(s); const n = Number(neg ? s.slice(1,-1) : s);
  return Number.isFinite(n) ? { value: neg ? -n : n } : { value: null, issue: "invalid money" };
}

export function parseRows(sheet: ImportSheet, mapping: ColumnMapping): ParsedImportRow[] {
  return sheet.rows.map((raw, rowIndex) => {
    const issues: string[] = []; const rxRaw = cell(raw, mapping, "rx_number");
    let rx: string | null = null;
    if (typeof rxRaw === "number") rx = Number.isInteger(rxRaw) ? String(rxRaw) : null;
    else rx = text(rxRaw);
    if (!rx) issues.push(Number.isFinite(rxRaw as number) && !Number.isInteger(rxRaw as number) ? "Rx number must be an integer" : "blank Rx number");
    const due = dateValue(cell(raw, mapping, "due_date")); if (due.issue) issues.push(due.issue);
    const copay = money(cell(raw, mapping, "old_copay")); if (copay.issue) issues.push(copay.issue);
    const profit = money(cell(raw, mapping, "old_profit")); if (profit.issue) issues.push(profit.issue);
    const leftRaw = cell(raw, mapping, "refills_left"); let left: number|null = null;
    if (leftRaw != null && text(leftRaw) !== null) { left = Number(leftRaw); if (!Number.isInteger(left) || left < 0) { left = null; issues.push("Refills left must be an integer >= 0"); } }
    if (raw.some((v) => typeof v === "object" && v && "__overflow" in v)) issues.push("row has more cells than headers");
    return { rowIndex, rx_number: rx, due_date: due.value, drug_name: text(cell(raw,mapping,"drug_name")), insurance: text(cell(raw,mapping,"insurance")), secondary: text(cell(raw,mapping,"secondary")), old_copay: copay.value, old_profit: profit.value, refills_left: left, refills_filled: (() => { const v = cell(raw,mapping,"refills_filled"); if (v == null || text(v) === null) return null; const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; })(), issues };
  });
}

export function resolveNames(rawNames: string[], kind: "insurance"|"secondary", aliases: Map<string, number|null>, vocab: Array<{id:number;name:string;active:number}>): NameResolution[] {
  const counts = new Map<string, number>(); rawNames.forEach((n) => { const k = norm(n); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); });
  return [...counts].map(([key,count]) => { const rawName = rawNames.find((n) => norm(n) === key)!; const alias = aliases.get(`${kind}|${key}`); if (aliases.has(`${kind}|${key}`)) return { rawName, kind, choice: alias == null ? "blank" : "existing", targetId: alias ?? undefined, count };
    const found = vocab.find((v) => v.active === 1 && norm(v.name) === key); return found ? { rawName, kind, choice: "existing", targetId: found.id, targetName: found.name, count } : { rawName, kind, choice: "unresolved", count };
  });
}

const days = (a:string,b:string) => Math.abs(Date.UTC(+a.slice(0,4),+a.slice(5,7)-1,+a.slice(8))-Date.UTC(+b.slice(0,4),+b.slice(5,7)-1,+b.slice(8))) / 86400000;
/**
 * `resolveValue` maps a raw insurance/secondary export name to its resolved
 * target: a number fills, null (an explicit "leave blank" decision) does not,
 * undefined (not yet resolved) is assumed to fill. Without it, any non-empty
 * raw name counts as fillable — wrong once blank aliases exist, since a
 * re-import would then label idempotent rows "update".
 */
export function computeDispositions(rows: ParsedImportRow[], existing: ExistingRefill[], resolvedDrugs: Map<string, number>, resolveValue?: (kind: "insurance" | "secondary", raw: string) => number | null | undefined): Disposition[] {
  void resolvedDrugs;
  const byRx = new Map<string, ExistingRefill[]>(); existing.forEach((e) => byRx.set(e.rx_number, [...(byRx.get(e.rx_number) ?? []), e]));
  const seen = new Set<string>(); const fileDrugs = new Map<string, Set<string>>(); rows.forEach((r) => { if (r.rx_number && r.drug_name) fileDrugs.set(r.rx_number, new Set([...(fileDrugs.get(r.rx_number) ?? []), norm(r.drug_name)])); });
  return rows.map((row) => {
    if (!row.rx_number || row.issues.length) return { row, kind: "error", reason: row.issues.join(", ") };
    const pair = `${row.rx_number}|${row.due_date ?? ""}`; if (seen.has(pair)) return { row, kind: "error", reason: "duplicate in file" }; seen.add(pair);
    if ((fileDrugs.get(row.rx_number)?.size ?? 0) > 1) return { row, kind: "drug-conflict", reason: "the file contains different medications for this Rx" };
    const siblings = byRx.get(row.rx_number) ?? []; const existingDrug = siblings[0];
    if (existingDrug && row.drug_name && norm(row.drug_name) !== norm(existingDrug.drug_name)) return { row, kind: "drug-conflict", reason: "Rx already belongs to a different medication", existing: existingDrug };
    const exact = siblings.find((e) => e.due_date === row.due_date);
    const fill = exact ? ["insurance_id","secondary_id","old_copay","old_profit","refills_filled","refills_left"].filter((f) => {
      if ((exact as any)[f] != null) return false;
      if (f === "insurance_id" || f === "secondary_id") {
        const kind = f === "insurance_id" ? "insurance" as const : "secondary" as const;
        const raw = kind === "insurance" ? row.insurance : row.secondary;
        if (raw == null) return false;
        if (!resolveValue) return true;
        return resolveValue(kind, raw) !== null; // null = remembered "leave blank": nothing to fill
      }
      return (row as any)[f] != null;
    }) : [];
    if (exact) return { row, kind: fill.length ? "update" : "no-change", existing: exact, fillFields: fill, action: fill.length ? "update" : "skip", finalDue: exact.due_date };
    // a drug-less row may still UPDATE a nearby candidate (existing medication
    // stands); only a would-be NEW row needs a medication (drug_id NOT NULL) —
    // an "insert new" override on a candidate row is caught by validatePlan
    const near = siblings.filter((e) => e.status === "Pending" && row.due_date && days(e.due_date,row.due_date) <= 21);
    if (near.length > 1) return { row, kind: "needs-selection", candidates: near, action: undefined };
    if (near.length === 1) return { row, kind: "probable-duplicate", candidates: near, existing: near[0], action: "update", finalDue: row.due_date ?? undefined };
    if (!row.drug_name) return { row, kind: "error", reason: "missing medication" };
    return { row, kind: "new", action: "insert", finalDue: row.due_date ?? undefined };
  });
}

export function validatePlan(dispositions: Disposition[]): string[] {
  const errors: string[] = []; const ids = new Map<number, number>(); const pairs = new Map<string, number>(); const occupied = new Map<string, number>();
  // refills.drug_id is NOT NULL: an insert without a medication (possible via a
  // per-row "insert new" override on a drug-less row) must fail validation, not the batch
  for (const d of dispositions) if (d.action === "insert" && !d.row.drug_name) errors.push(`row ${d.row.rowIndex + 2}: missing medication`);
  dispositions.forEach((d) => { if (d.existing && d.finalDue) occupied.set(`${d.row.rx_number}|${d.finalDue}`, d.existing.id); });
  dispositions.forEach((d) => { if (!d.existing || !["update","probable-duplicate","needs-selection"].includes(d.kind) || d.action !== "update") return; ids.set(d.existing.id, (ids.get(d.existing.id) ?? 0)+1); const p = `${d.row.rx_number}|${d.finalDue}`; pairs.set(p,(pairs.get(p)??0)+1); });
  for (const [id,n] of ids) if(n>1) errors.push(`existing row ${id} targeted more than once`); for(const [p,n] of pairs) if(n>1) errors.push(`target pair ${p} collides`);
  for (const d of dispositions) if (d.action === "insert" && d.finalDue) { const p=`${d.row.rx_number}|${d.finalDue}`; if(occupied.has(p) || (pairs.get(p)??0)>0) errors.push(`planned insert ${p} collides`); }
  for (const [p,n] of pairs) if(n === 1 && occupied.has(p) && [...dispositions].filter(d=>d.action === "update" && `${d.row.rx_number}|${d.finalDue}`===p).some(d=>d.existing?.id !== occupied.get(p))) errors.push(`adoption ${p} collides`);
  return errors;
}

/**
 * Dispositions that still block the commit: a needs-selection or drug-conflict
 * row the technician has not acted on yet. Once an action is chosen (a
 * candidate, insert, or skip) the row is resolved and must stop blocking.
 * Error rows do NOT block — they are excluded from the commit and shown in the
 * reviewable error list (spec: never silently dropped, import still works).
 */
export function unresolvedAttentionCount(dispositions: Disposition[]): number {
  return dispositions.filter((d) => (d.kind === "needs-selection" || d.kind === "drug-conflict") && !d.action).length;
}

export function buildCommitPlan(dispositions: Disposition[], aliases: NameResolution[], columnMapping: Record<string,string>, resolvedDrugs?: Map<string, number>): ImportCommitPlan {
  const invalid = validatePlan(dispositions); if (invalid.length) throw new Error(invalid.join("; "));
  if (aliases.some((a) => a.choice === "unresolved")) throw new Error("Resolve all unmatched insurance and secondary names before importing");
  const resolution = (kind: "insurance"|"secondary", raw: string|null) => aliases.find(a => a.kind === kind && raw && norm(a.rawName) === norm(raw));
  const idFor = (kind: "insurance"|"secondary", raw: string|null) => resolution(kind, raw)?.choice === "existing" ? resolution(kind, raw)?.targetId ?? null : null;
  return {
    rows: dispositions.filter((d) => d.action === "insert" || d.action === "update").map((d) => ({ row:d.row, action:d.action === "insert" ? "insert" : "update", existingId:d.existing?.id, finalDue:d.finalDue, expectedDue:d.existing?.due_date, expectedDrugName:d.existing?.drug_name, expectedStatus:d.existing?.status, adoption:(d.kind === "probable-duplicate" || d.kind === "needs-selection") && d.action === "update", drugId:d.row.drug_name ? resolvedDrugs?.get(norm(d.row.drug_name)) : undefined, drugName:d.row.drug_name ?? undefined, insuranceId:idFor("insurance",d.row.insurance), secondaryId:idFor("secondary",d.row.secondary) })),
    aliases, columnMapping,
    counts: {
      skipped: dispositions.filter((d) => d.action === "skip" || d.kind === "skip" || d.kind === "no-change").length,
      errors: dispositions.filter((d) => d.kind === "error").length,
    },
  };
}
