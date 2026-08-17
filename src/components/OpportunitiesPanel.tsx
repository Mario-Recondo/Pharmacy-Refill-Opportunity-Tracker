import { useEffect, useMemo, useRef, useState } from "react";
import { loadOpportunities } from "../data/refills";
import type { Lookups, RefillRow } from "../data/types";
import { formatMoney, textColorFor } from "../lib/colors";

// Collapsible right-hand sidebar (story 3.3): the technician's "work these first"
// list. Profit shown is old_profit — verified on the LAST fill, so every card
// carries the "last fill / unverified" label (profit is never predicted).

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${m}/${d}`;
}

function dueWord(iso: string, today: string): string {
  const days = Math.round((new Date(iso).getTime() - new Date(today).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function OppCard({
  row,
  today,
  lookups,
  onOpen,
  onHover,
  onGoTo,
}: {
  row: RefillRow;
  today: string;
  lookups: Lookups;
  onOpen: (id: number, dueDate: string) => void;
  /** hover highlights the matching grid row; null on leave */
  onHover: (id: number | null) => void;
  /** scroll the grid to the row (no drawer) — for rows out of sight */
  onGoTo: (id: number, dueDate: string) => void;
}) {
  const note = lookups.refillNotes.find((n) => n.id === row.refill_note_id);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyRx = async (e: React.MouseEvent) => {
    e.stopPropagation(); // copy without opening the drawer
    try {
      await navigator.clipboard.writeText(row.rx_number);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 900);
    } catch {
      /* clipboard unavailable — nothing to confirm */
    }
  };

  return (
    <div
      className="opp-card"
      onClick={() => onOpen(row.id, row.due_date)}
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      title="Open in the detail drawer"
    >
      <div className="opp-top">
        <span className="opp-drug">{row.drug_name}</span>
        <span className="opp-profit">{formatMoney(row.old_profit)}</span>
      </div>
      <div className="opp-sub">
        <span className={`opp-rx${copied ? " copied" : ""}`} onClick={copyRx} title="Click to copy">
          {copied ? "Copied ✓" : `Rx ${row.rx_number}`}
        </span>
        <span className="opp-label">last fill / unverified</span>
      </div>
      <div className="opp-bottom">
        <span className="opp-due">
          {shortDate(row.due_date)} · {dueWord(row.due_date, today)}
        </span>
        {note?.color && (
          <span className="opp-note" style={{ backgroundColor: note.color, color: textColorFor(note.color) }}>
            {note.name}
          </span>
        )}
      </div>
      <div className="opp-actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // locate only — card click is what opens the drawer
            onGoTo(row.id, row.due_date);
          }}
        >
          ↧ Go to row
        </button>
      </div>
    </div>
  );
}

export default function OpportunitiesPanel({
  lookups,
  rows,
  onOpenRefill,
  onHoverRow,
  onGoToRow,
}: {
  lookups: Lookups;
  /** the month view's rows — identity changes on every edit/create/delete, which re-queries the panel */
  rows: RefillRow[];
  onOpenRefill: (id: number, dueDate: string) => void;
  onHoverRow: (id: number | null) => void;
  onGoToRow: (id: number, dueDate: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [opps, setOpps] = useState<RefillRow[]>([]);
  const [maxDue, setMaxDue] = useState<string | null>(null);

  const days = lookups.settings.alertLookaheadDays;
  const minProfit = lookups.settings.alertMinProfit;
  const today = useMemo(() => todayIso(), []);
  const horizon = useMemo(() => addDaysIso(today, days), [today, days]);

  useEffect(() => {
    loadOpportunities(today, horizon, minProfit)
      .then((s) => {
        setOpps(s.rows);
        setMaxDue(s.maxDue);
      })
      .catch(console.error);
  }, [rows, today, horizon, minProfit]);

  // look-ahead window reaching past the last populated date must say so, not sit silently empty
  const horizonShort = maxDue !== null && maxDue < horizon;

  if (collapsed) {
    return (
      <aside className="opps collapsed">
        <button className="opps-rail" onClick={() => setCollapsed(false)} title="Show opportunities">
          <span className="opps-rail-count">{opps.length}</span>
          <span className="opps-rail-label">Opportunities</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="opps">
      <header className="opps-header">
        <div>
          <h3>Opportunities</h3>
          <span className="opps-params">
            due ≤ {days}d · last profit ≥ {formatMoney(minProfit)}
          </span>
        </div>
        <button className="opps-collapse" onClick={() => setCollapsed(true)} title="Collapse panel">
          »
        </button>
      </header>
      <div className="opps-cards">
        {opps.map((r) => (
          <OppCard key={r.id} row={r} today={today} lookups={lookups} onOpen={onOpenRefill} onHover={onHoverRow} onGoTo={onGoToRow} />
        ))}
        {opps.length === 0 && !horizonShort && (
          <div className="opps-empty">Nothing high-value due through {shortDate(horizon)}.</div>
        )}
        {horizonShort && (
          <div className="opps-horizon">
            No data beyond {shortDate(maxDue!)} — the look-ahead window runs to {shortDate(horizon)}. Newer refills
            aren't in the tool yet (import arrives in v2; until then, add them manually).
          </div>
        )}
      </div>
    </aside>
  );
}
