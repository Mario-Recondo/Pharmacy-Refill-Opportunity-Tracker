import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { Lookups } from "../data/types";
import {
  applyNameChoice, buildCommitPlan, computeDispositions, normalizeName, parseRows, proposeMapping, resolveNames, unresolvedAttentionCount, validateMapping, validatePlan,
  type ColumnMapping, type Disposition, type ImportSheet, type NameResolution, type ParsedImportRow,
} from "../data/importPlan";
import {
  commitImport, loadAliases, loadExistingForRxNumbers, loadSavedColumnMapping, resolveDrugIds, StaleImportError,
} from "../data/importData";

type Step = "file" | "columns" | "names" | "preview" | "done";

export default function ImportWizard({ lookups, visibleMonth, onClose, onChanged }: {
  lookups: Lookups;
  visibleMonth?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>("file");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<ImportSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [parsed, setParsed] = useState<ParsedImportRow[]>([]);
  const [drugs, setDrugs] = useState<Map<string, number>>(new Map());
  const [resolutions, setResolutions] = useState<NameResolution[]>([]);
  const [namesNeedingDecision, setNamesNeedingDecision] = useState<Set<string>>(new Set());
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [result, setResult] = useState<{ inserted: number; updated: number; skipped: number; errors: number; outsideCurrentMonth?: number } | null>(null);
  const [selectedErrors, setSelectedErrors] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState("");

  const recompute = async (rows = parsed, res = resolutions) => {
    const aliases = await loadAliases();
    const existing = await loadExistingForRxNumbers([...new Set(rows.map((r) => r.rx_number).filter((x): x is string => !!x))]);
    // re-resolve drug ids from the CURRENT row names: a drug-conflict
    // correction adopts a DB drug name that the original file never contained
    const freshDrugs = await resolveDrugIds(rows.map((r) => r.drug_name).filter((x): x is string => !!x));
    setDrugs(freshDrugs);
    // resolver: current in-wizard decisions win, then remembered aliases;
    // null = "leave blank" (nothing to fill), undefined = still unresolved
    const resolveValue = (kind: "insurance" | "secondary", raw: string): number | null | undefined => {
      const decided = res.find((x) => x.kind === kind && normalizeName(x.rawName) === normalizeName(raw));
      if (decided) return decided.choice === "blank" ? null : decided.choice === "unresolved" ? undefined : decided.targetId ?? -1;
      const remembered = `${kind}|${normalizeName(raw)}`;
      return aliases.has(remembered) ? aliases.get(remembered) : undefined;
    };
    setDispositions(computeDispositions(rows, existing, freshDrugs, resolveValue));
    setResolutions((previous) => previous.length ? previous : [
      ...resolveNames(rows.map((r) => r.insurance).filter((x): x is string => !!x), "insurance", aliases, lookups.insurances),
      ...resolveNames(rows.map((r) => r.secondary).filter((x): x is string => !!x), "secondary", aliases, lookups.secondaryCoverages),
    ]);
  };

  const chooseFile = async () => {
    setError(null);
    try {
      const chosen = await open({ filters: [{ name: "Spreadsheets", extensions: ["xlsx", "xls", "csv"] }] });
      const path = Array.isArray(chosen) ? chosen[0] : chosen;
      if (!path) return;
      const loaded = await invoke<ImportSheet>("read_spreadsheet", { path });
      setSheet(loaded);
      setMapping(proposeMapping(loaded.headers, await loadSavedColumnMapping()));
      setStep("columns");
    } catch (e) { setError(String(e)); }
  };

  const makePreview = async () => {
    if (!sheet || !mapping) return;
    if (!mapping.valid) { setError(mapping.issues.join("; ")); return; }
    setBusy(true);
    try {
      const rows = parseRows(sheet, mapping);
      const foundDrugs = await resolveDrugIds(rows.map((r) => r.drug_name).filter((x): x is string => !!x));
      setParsed(rows); setDrugs(foundDrugs); setResolutions([]); await recompute(rows);
      const aliases = await loadAliases();
      const unresolved = [
        ...resolveNames(rows.map((r) => r.insurance).filter((x): x is string => !!x), "insurance", aliases, lookups.insurances),
        ...resolveNames(rows.map((r) => r.secondary).filter((x): x is string => !!x), "secondary", aliases, lookups.secondaryCoverages),
      ];
      setResolutions(unresolved);
      setNamesNeedingDecision(new Set(unresolved.filter((r) => r.choice === "unresolved").map((r) => `${r.kind}|${normalizeName(r.rawName)}`)));
      setStep(unresolved.some((r) => r.choice === "unresolved") ? "names" : "preview");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const unresolved = resolutions.filter((r) => r.choice === "unresolved");
  const namesToShow = resolutions.filter((r) => namesNeedingDecision.has(`${r.kind}|${normalizeName(r.rawName)}`));
  const planErrors = useMemo(() => validatePlan(dispositions), [dispositions]);
  const errorCount = dispositions.filter((d) => d.kind === "error").length;
  const needsAttention = unresolvedAttentionCount(dispositions) + unresolved.length + planErrors.length;

  const setNameChoice = (name: NameResolution, value: string) => {
    setResolutions((all) => applyNameChoice(all, name, value));
  };

  const pendingCreates = (kind: NameResolution["kind"], self: NameResolution) => [...new Map(resolutions.filter((r) => r.kind === kind && r.choice === "create" && r !== self).map((r) => [normalizeName(r.targetName ?? r.rawName), r.targetName ?? r.rawName])).values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const nameChoiceValue = (r: NameResolution) => r.choice === "unresolved" ? "unresolved" : r.choice === "blank" ? "blank" : r.choice === "existing" ? String(r.targetId) : normalizeName(r.targetName ?? r.rawName) === normalizeName(r.rawName) ? "create" : `create:${r.targetName}`;

  const applyAction = (index: number, value: string) => {
    const target = dispositions[index];
    // "Use existing medication" (DB drug-conflict) is a drug correction, not a
    // row-update: adopt the DB's drug name for every file row of this Rx and
    // re-disposition — the row may then become new/update/probable-dup normally.
    if (value === "use-existing" && target?.existing) {
      void chooseFileDrug(target, target.existing.drug_name);
      return;
    }
    setDispositions((all) => all.map((d, i) => {
      if (i !== index) return d;
      // kind is PRESERVED on action choices: buildCommitPlan derives adoption
      // (adopt-the-new-date + target-must-stay-Pending) from probable-duplicate
      // / needs-selection kinds, so rewriting kind would silently drop both.
      if (value === "skip") return { ...d, action: "skip" };
      if (value === "insert") return { ...d, action: "insert", existing: undefined, finalDue: d.row.due_date ?? undefined };
      const candidate = value === "update" ? d.existing : d.candidates?.find((c) => String(c.id) === value);
      return candidate ? { ...d, action: "update", existing: candidate, finalDue: d.row.due_date ?? undefined } : d;
    }));
  };

  const chooseFileDrug = async (disposition: Disposition, value: string) => {
    const rx = disposition.row.rx_number;
    if (!rx) return;
    if (value === "skip") {
      setDispositions((all) => all.map((d) => d.row.rx_number === rx ? { ...d, kind: "skip", action: "skip" } : d));
      return;
    }
    const rows = parsed.map((row) => row.rx_number === rx ? { ...row, drug_name: value } : row);
    setParsed(rows); await recompute(rows);
  };

  const applyBulkDate = () => {
    if (!bulkDate) return;
    const rows = parsed.map((row) => selectedErrors.has(row.rowIndex) ? { ...row, due_date: bulkDate, issues: row.issues.filter((i) => i !== "blank due date") } : row);
    setParsed(rows); void recompute(rows); setSelectedErrors(new Set());
  };

  const commit = async () => {
    if (!sheet || !mapping || needsAttention) return;
    setBusy(true); setError(null);
    try {
      const plan = buildCommitPlan(dispositions, resolutions, Object.fromEntries(sheet.headers.map((h, i) => [h, mapping.targets[i]])), drugs);
      const imported = await commitImport(plan);
      const outsideCurrentMonth = visibleMonth ? plan.rows.filter((r) => (r.finalDue ?? r.row.due_date)?.slice(0, 7) !== visibleMonth).length : 0;
      setResult({ ...imported, outsideCurrentMonth }); setStep("done");
    } catch (e) {
      if (e instanceof StaleImportError || (e as { code?: string })?.code === "stale") {
        setError("Data changed while the preview was open. The preview has been refreshed.");
        await recompute(); setStep("preview");
      } else setError(String(e));
    } finally { setBusy(false); }
  };

  const title = step === "file" ? "Choose file" : step === "columns" ? "Columns" : step === "names" ? "Match names" : step === "preview" ? "Preview" : "Done";
  return <div className="import-scrim">
    <section className="import-wizard" role="dialog" aria-modal="true">
      <header className="import-header"><div><h2>Import spreadsheet</h2><div className="import-progress">Choose file → Columns → Match names → Preview → Done</div></div><button className="drawer-close" onClick={onClose}>×</button></header>
      <h3>{title}</h3>{error && <div className="import-error">{error}</div>}
      {step === "file" && <div><p>Choose an xlsx, xls, or CSV export. Nothing is imported until you review the preview.</p><button className="primary" onClick={chooseFile}>Choose file…</button></div>}
      {step === "columns" && mapping && <div><p>Map each source header once. Rx Number is required.</p>{sheet?.headers.map((h, i) => <label className="import-column" key={`${h}-${i}`}>{h}<select value={mapping.targets[i]} onChange={(e) => { const targets = mapping.targets.map((t, j) => j === i ? e.target.value as never : t); const checked = validateMapping(targets); setMapping({ targets, valid: checked.valid, issues: checked.issues }); }}><option value="ignore">Ignore</option>{["due_date","rx_number","drug_name","insurance","secondary","old_copay","old_profit","refills_left","refills_filled"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>)}{!mapping.valid && mapping.issues.length > 0 && <div className="import-error">{mapping.issues.join("; ")}</div>}<button className="primary" disabled={!mapping.valid || busy} onClick={makePreview}>Continue</button></div>}
      {step === "names" && <div><p>These names were not found. Choose how to remember each one; the same decision will apply on future imports.</p>{namesToShow.map((r) => <label className="import-name" key={`${r.kind}|${r.rawName}`}><span><strong>{r.rawName}</strong><small>{r.kind} · {r.count} row(s)</small></span><select value={nameChoiceValue(r)} onChange={(e) => setNameChoice(r, e.target.value)}><option value="unresolved">Choose…</option><option value="blank">Leave blank</option><option value="create">Create new</option>{pendingCreates(r.kind, r).map((name) => <option key={name} value={`create:${name}`}>Use new: {name}</option>)}{(r.kind === "insurance" ? [...lookups.insurances] : [...lookups.secondaryCoverages]).filter((x) => x.active === 1).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>)}<button className="primary" disabled={unresolved.length > 0} onClick={() => { void recompute().then(() => setStep("preview")); }}>Continue</button></div>}
      {step === "preview" && <div><p className="import-summary">{dispositions.filter((d) => d.action === "insert").length} new · {dispositions.filter((d) => d.action === "update").length} update · {dispositions.filter((d) => d.kind === "no-change").length} no-change · {errorCount} error{errorCount === 1 ? "" : "s"} · {needsAttention} need attention</p>{planErrors.length > 0 && <div className="import-error">{planErrors.map((e) => <div key={e}>{e}</div>)}</div>}<div className="import-table">{dispositions.map((d, i) => <div key={d.row.rowIndex}><span>{d.row.rowIndex + 2}</span><span>{d.row.rx_number ?? "—"}</span><span>{d.kind}</span>{d.kind === "drug-conflict" && !d.existing ? <select defaultValue="" onChange={(e) => void chooseFileDrug(d, e.target.value)}><option value="">Choose medication or skip all…</option>{[...new Set(dispositions.filter((x) => x.row.rx_number === d.row.rx_number && x.row.drug_name).map((x) => x.row.drug_name!))].map((name) => <option key={name} value={name}>{name}</option>)}<option value="skip">Skip all rows for this Rx</option></select> : (d.kind === "probable-duplicate" || d.kind === "needs-selection" || d.kind === "drug-conflict") ? <select value={d.kind === "needs-selection" && d.action === "update" && d.existing ? String(d.existing.id) : d.action ?? ""} onChange={(e) => applyAction(i, e.target.value)}><option value="">Choose action…</option>{d.kind === "drug-conflict" ? <><option value="use-existing">Use existing medication ({d.existing?.drug_name})</option><option value="skip">Skip</option></> : d.kind === "needs-selection" ? <>{d.candidates?.map((c) => <option key={c.id} value={c.id}>Update row due {c.due_date}</option>)}<option value="insert">Insert new</option><option value="skip">Skip</option></> : <><option value="update">Update existing (adopt new date)</option><option value="insert">Insert new</option><option value="skip">Skip</option></>}</select> : <span>{d.reason ?? ""}</span>}</div>)}</div>{(() => { const blankDue = parsed.filter((r) => r.issues.includes("blank due date")); return blankDue.length > 0 && <div className="bulk-fix"><strong>Blank due dates</strong>{blankDue.map((r) => <label key={r.rowIndex}><input type="checkbox" checked={selectedErrors.has(r.rowIndex)} onChange={(e) => setSelectedErrors((old) => { const next = new Set(old); if (e.target.checked) next.add(r.rowIndex); else next.delete(r.rowIndex); return next; })} /> row {r.rowIndex + 2}</label>)}<input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} /><button onClick={applyBulkDate}>Apply to selected</button></div>; })()}<button className="primary" disabled={busy || needsAttention > 0} onClick={commit}>Import {dispositions.filter((d) => d.action === "insert" || d.action === "update").length} rows</button></div>}
      {step === "done" && <div><h3>Import complete</h3><p>Inserted {result?.inserted ?? 0}; updated {result?.updated ?? 0}; skipped {result?.skipped ?? 0}; errors {result?.errors ?? 0}.</p>{result?.outsideCurrentMonth ? <p>{result.outsideCurrentMonth} row(s) landed outside the visible month because imports use their own due dates.</p> : null}<button className="primary" onClick={onChanged}>Close</button></div>}
      {busy && <p>Working…</p>}
    </section>
  </div>;
}
