import { executeAtomicBatch, getDb, serializeWrite, type SqlStatement } from "../db";
import { measure } from "../lib/diagnostics";
import type { ImportCommitPlan, ExistingRefill } from "./importPlan";

export interface ImportResult { inserted: number; updated: number; skipped: number; errors: number; outsideCurrentMonth?: number; }
export class StaleImportError extends Error { readonly code = "stale"; constructor(message = "Data changed while the preview was open") { super(message); } }
const key = (kind: string, raw: string) => `${kind}|${raw.trim().replace(/\s+/g, " ").toUpperCase()}`;

export async function loadAliases(): Promise<Map<string, number | null>> {
  const db = await getDb(); const rows = await db.select<{kind:string;raw_name:string;target_id:number|null}[]>(
    `SELECT a.kind, a.raw_name, a.target_id FROM import_aliases a
     LEFT JOIN insurances i ON a.kind='insurance' AND i.id=a.target_id
     LEFT JOIN secondary_coverages s ON a.kind='secondary' AND s.id=a.target_id
     WHERE a.target_id IS NULL OR (a.kind='insurance' AND i.id IS NOT NULL) OR (a.kind='secondary' AND s.id IS NOT NULL)`,
  );
  return new Map(rows.map((r) => [key(r.kind, r.raw_name), r.target_id]));
}

export async function loadExistingForRxNumbers(rxNumbers: string[]): Promise<ExistingRefill[]> {
  const db = await getDb(); const out: ExistingRefill[] = [];
  for (let i=0;i<rxNumbers.length;i+=500) { const chunk = rxNumbers.slice(i,i+500); if (!chunk.length) continue;
    const marks = chunk.map((_,n)=>`$${n+1}`).join(","); out.push(...await db.select<ExistingRefill[]>(
      `SELECT r.id,r.rx_number,r.due_date,r.status,r.drug_id,d.name AS drug_name,r.insurance_id,r.secondary_id,r.old_copay,r.old_profit,r.refills_filled,r.refills_left
       FROM refills r JOIN drugs d ON d.id=r.drug_id WHERE r.rx_number IN (${marks})`, chunk));
  } return out;
}

export async function resolveDrugIds(names: string[]): Promise<Map<string, number>> {
  const db = await getDb(); const result = new Map<string,number>();
  for (const name of [...new Set(names.map((n)=>n.trim()).filter(Boolean))]) { const rows = await db.select<{id:number}[]>("SELECT id FROM drugs WHERE name = $1 COLLATE NOCASE AND ndc IS NULL",[name]); if(rows[0]) result.set(name.toUpperCase(),rows[0].id); }
  return result;
}

export async function loadSavedColumnMapping(): Promise<Record<string,string>|null> {
  const db=await getDb(); const rows=await db.select<{value:string}[]>("SELECT value FROM settings WHERE key='import_column_mapping'"); if(!rows[0]) return null; try{return JSON.parse(rows[0].value);}catch{return null;}
}

export async function commitImport(plan: ImportCommitPlan): Promise<ImportResult> {
  // The largest single operation in the app, and the one most likely to feel
  // slow. Note it runs a per-row staleness check (a query per row, plus one per
  // alias and per new drug) BEFORE the single atomic batch — so comparing this
  // duration against the db.transaction it contains tells you how much of the
  // wall time is the batch versus the checks that precede it.
  return measure(
    "import.commit",
    () => commitImportPlan(plan),
    (result) => ({
      planned: plan.rows.length,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    }),
  );
}

async function commitImportPlan(plan: ImportCommitPlan): Promise<ImportResult> {
  return serializeWrite(async () => {
    const db=await getDb();
    const rx=[...new Set(plan.rows.map((r)=>r.row.rx_number).filter((x):x is string=>!!x))];
    const current=await loadExistingForRxNumbers(rx); const byId=new Map(current.map((r)=>[r.id,r]));
    for(const r of plan.rows) {
      if(r.action === "insert" && current.some((e)=>e.rx_number===r.row.rx_number && e.due_date===r.finalDue)) throw new StaleImportError();
      if (r.action === "insert" && r.row.rx_number && current.filter(e => e.rx_number === r.row.rx_number).some(e => r.row.drug_name && e.drug_name.toUpperCase() !== r.row.drug_name.toUpperCase())) throw new StaleImportError();
      if(r.action !== "insert") {
        const old=byId.get(r.existingId!);
        if(!old || old.due_date !== r.expectedDue) throw new StaleImportError();
        if(r.adoption && old.status !== "Pending") throw new StaleImportError();
        if(r.expectedDrugName && old.drug_name.toUpperCase() !== r.expectedDrugName.toUpperCase()) throw new StaleImportError();
        if (r.expectedDrugName && current.filter(e => e.rx_number === r.row.rx_number).some(e => e.drug_name.toUpperCase() !== r.expectedDrugName!.toUpperCase())) throw new StaleImportError();
      }
      if (r.drugId) {
        const drug = await db.select<{id:number;name:string}[]>("SELECT id,name FROM drugs WHERE id=$1 AND ndc IS NULL", [r.drugId]);
        if (!drug[0] || (r.drugName && drug[0].name.toUpperCase() !== r.drugName.toUpperCase())) throw new StaleImportError();
      }
    }
    const aliases=plan.aliases; const insuranceCreates=aliases.filter(a=>a.kind==="insurance"&&a.choice==="create"); const secondaryCreates=aliases.filter(a=>a.kind==="secondary"&&a.choice==="create");
    for(const a of [...insuranceCreates,...secondaryCreates]) { const table=a.kind === "insurance" ? "insurances" : "secondary_coverages"; const exists=await db.select<{id:number}[]>(`SELECT id FROM ${table} WHERE name = $1 COLLATE NOCASE`,[a.targetName ?? a.rawName]); if(exists[0]) throw new StaleImportError(); }
    const drugNames=[...new Set(plan.rows.filter(r=>r.action==="insert" && !r.drugId).map(r=>r.drugName).filter((x):x is string=>!!x))];
    for(const name of drugNames) { const exists=await db.select<{id:number}[]>("SELECT id FROM drugs WHERE name = $1 COLLATE NOCASE AND ndc IS NULL",[name]); if(exists[0]) throw new StaleImportError(); }
    for (const a of aliases.filter((x) => x.choice === "existing")) {
      const table = a.kind === "insurance" ? "insurances" : "secondary_coverages";
      const rows = await db.select<{id:number;name:string}[]>(`SELECT id,name FROM ${table} WHERE id=$1`, [a.targetId]);
      if (!rows[0] || (a.targetName && rows[0].name.toUpperCase() !== a.targetName.toUpperCase())) throw new StaleImportError();
    }
    // remembered-alias drift: if an alias for one of this plan's names changed
    // (or appeared) since preview, the preview's resolutions are stale — the
    // Match names step would have shown something different
    const currentAliases = await loadAliases();
    for (const a of aliases) {
      const now = currentAliases.get(key(a.kind, a.rawName));
      if (now === undefined) continue; // no remembered alias — nothing to disagree with
      if (a.choice === "blank" && now !== null) throw new StaleImportError();
      if (a.choice === "existing" && now !== a.targetId) throw new StaleImportError();
      if (a.choice === "create" && now !== null) throw new StaleImportError();
    }
    const statements: SqlStatement[]=[];
    for(const a of insuranceCreates) statements.push({sql:"INSERT INTO insurances (name, sort_order) VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+10 FROM insurances)) ON CONFLICT (name) DO NOTHING",params:[a.targetName ?? a.rawName]});
    for(const a of secondaryCreates) statements.push({sql:"INSERT INTO secondary_coverages (name, sort_order) VALUES ($1, (SELECT COALESCE(MAX(sort_order),0)+10 FROM secondary_coverages)) ON CONFLICT (name) DO NOTHING",params:[a.targetName ?? a.rawName]});
    for(const name of drugNames) statements.push({sql:"INSERT INTO drugs (name, ndc) VALUES ($1,NULL) ON CONFLICT DO NOTHING",params:[name]});
    const resolution=(kind:"insurance"|"secondary",name:string|null) => { if(!name)return {sql:"?",params:[]}; const a=aliases.find(x=>x.kind===kind&&key(kind,x.rawName)===key(kind,name)); if(!a||a.choice==="blank")return {sql:"NULL",params:[]}; if(a.choice==="existing")return {sql:"$1",params:[a.targetId!]}; const table=kind==="insurance"?"insurances":"secondary_coverages"; return {sql:`(SELECT id FROM ${table} WHERE name = $1 COLLATE NOCASE)`,params:[a.targetName??a.rawName]}; };
    for(const item of plan.rows.filter(r=>r.action==="insert")) {
      const params: unknown[]=[item.row.rx_number]; const expr=(sql:string, values:unknown[])=>{ const start=params.length+1; params.push(...values); return sql.replace(/\$1/g,`$${start}`); };
      const drugSql=item.drugId ? expr("$1",[item.drugId]) : expr("(SELECT id FROM drugs WHERE name = $1 COLLATE NOCASE AND ndc IS NULL)",[item.drugName]);
      const dueSql=expr("$1",[item.finalDue ?? item.row.due_date]);
      const ins=resolution("insurance",item.row.insurance); const sec=resolution("secondary",item.row.secondary);
      const insSql=ins.sql === "?" ? "NULL" : expr(ins.sql, ins.params); const secSql=sec.sql === "?" ? "NULL" : expr(sec.sql, sec.params);
      const copay=expr("$1",[item.row.old_copay]); const profit=expr("$1",[item.row.old_profit]); const filled=expr("$1",[item.row.refills_filled]); const left=expr("$1",[item.row.refills_left]);
      statements.push({sql:`INSERT INTO refills (rx_number,drug_id,due_date,insurance_id,secondary_id,old_copay,old_profit,refills_filled,refills_left,status,source) VALUES ($1,${drugSql},${dueSql},${insSql},${secSql},${copay},${profit},${filled},${left},'Pending','import')`,params});
    }
    for(const item of plan.rows.filter(r=>r.action!=="insert")) {
      const params: unknown[]=[]; const expr=(sql:string, values:unknown[])=>{const n=params.length+1;params.push(...values);return sql.replace(/\$1/g,`$${n}`);};
      const ins=resolution("insurance",item.row.insurance); const sec=resolution("secondary",item.row.secondary);
      const insSql=item.insuranceId ? expr("$1",[item.insuranceId]) : ins.sql === "?" ? "NULL" : expr(ins.sql,ins.params);
      const secSql=item.secondaryId ? expr("$1",[item.secondaryId]) : sec.sql === "?" ? "NULL" : expr(sec.sql,sec.params);
      const due=expr("$1",[item.adoption ? item.finalDue : null]); const copay=expr("$1",[item.row.old_copay]); const profit=expr("$1",[item.row.old_profit]); const filled=expr("$1",[item.row.refills_filled]); const left=expr("$1",[item.row.refills_left]); const id=expr("$1",[item.existingId]);
      statements.push({sql:`UPDATE refills SET due_date=COALESCE(${due},due_date), insurance_id=COALESCE(insurance_id,${insSql}), secondary_id=COALESCE(secondary_id,${secSql}), old_copay=COALESCE(old_copay,${copay}), old_profit=COALESCE(old_profit,${profit}), refills_filled=COALESCE(refills_filled,${filled}), refills_left=COALESCE(refills_left,${left}), updated_at=datetime('now') WHERE id=${id}`,params});
    }
    for(const a of aliases) {
      if (a.choice === "unresolved") throw new Error("Unresolved import name");
      const target=a.choice==="blank"?"NULL":a.choice==="existing"?"$3":`(SELECT id FROM ${a.kind === "insurance" ? "insurances" : "secondary_coverages"} WHERE name=$3 COLLATE NOCASE)`;
      statements.push({sql:`INSERT INTO import_aliases (kind,raw_name,target_id) VALUES ($1,$2,${target}) ON CONFLICT(kind,raw_name) DO UPDATE SET target_id=excluded.target_id`,params:a.choice === "blank" ? [a.kind,a.rawName] : [a.kind,a.rawName,a.choice === "existing" ? a.targetId : a.targetName ?? a.rawName]});
    }
    statements.push({sql:"INSERT INTO settings (key,value) VALUES ('import_column_mapping',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params:[JSON.stringify(plan.columnMapping)]});
    await executeAtomicBatch(statements); return {inserted:plan.rows.filter(r=>r.action==="insert").length,updated:plan.rows.filter(r=>r.action!=="insert").length,skipped:plan.counts?.skipped ?? 0,errors:plan.counts?.errors ?? 0};
  });
}
