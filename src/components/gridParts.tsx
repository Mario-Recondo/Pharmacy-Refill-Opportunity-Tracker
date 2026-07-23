import { useEffect, useRef, useState } from "react";
import type { CustomCellEditorProps, CustomCellRendererProps } from "ag-grid-react";
import { textColorFor } from "../lib/colors";
import { insuranceDisplayName, insuranceLogoUrl, secondaryLogoUrl } from "../lib/rules";
import type { Lookups, RefillRow } from "../data/types";

/** Passed to AG Grid as `context`, readable from every renderer/style callback. */
export interface GridCtx {
  lookups: Lookups;
  /** max positive profit among currently visible rows — drives relative green shading */
  profitMax: number;
}

/** One choice in the dropdown editor. Color is optional — insurance/secondary
 *  options render plain since the logo feature retired their colors (§6.1);
 *  dropdowns stay text-only by design. */
export interface PillItem {
  value: number | string | null;
  label: string;
  color?: string;
  meaning?: string;
  clear?: boolean;
}

// ---------------------------------------------------------------------------
// Colored dropdown editor (popup). The spike proved AG Grid's stock select
// can't color options, so this is a custom editor: one full-width swatch per
// option, arrow-key + Enter navigation, Esc cancels.
// ---------------------------------------------------------------------------

export function PillSelectEditor(props: CustomCellEditorProps<RefillRow>) {
  const { items, allowClear } = props.colDef!.cellEditorParams as {
    items: PillItem[];
    allowClear: boolean;
  };
  const choices: PillItem[] = allowClear
    ? [{ value: null, label: "— clear —", clear: true }, ...items]
    : items;
  const [highlight, setHighlight] = useState(() =>
    Math.max(0, choices.findIndex((c) => c.value === props.value)),
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.focus();
    listRef.current?.children[highlight]?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (item: PillItem) => {
    props.onValueChange(item.value);
    props.stopEditing();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(choices.length - 1, Math.max(0, highlight + (e.key === "ArrowDown" ? 1 : -1)));
      setHighlight(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(choices[highlight]);
    } else if (e.key === "Escape") {
      props.stopEditing(true);
    }
  };

  return (
    <div className="pill-editor" ref={listRef} tabIndex={0} onKeyDown={onKeyDown}>
      {choices.map((c, i) => (
        <div
          key={String(c.value)}
          className={`pill-option${c.clear ? " clear" : ""}${i === highlight ? " highlight" : ""}${c.value === props.value ? " current" : ""}`}
          style={c.color ? { background: c.color, color: textColorFor(c.color) } : undefined}
          title={c.meaning || undefined}
          onMouseEnter={() => setHighlight(i)}
          onClick={() => pick(c)}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rx # click-to-copy (story 1.4): single click copies for pasting into
// PioneerRX search, with a brief visual confirmation.
// ---------------------------------------------------------------------------

export function RxCopyRenderer(props: CustomCellRendererProps<RefillRow>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(props.value ?? ""));
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 900);
    } catch {
      /* clipboard unavailable — nothing to confirm */
    }
  };

  return (
    <span className={`rx-copy${copied ? " copied" : ""}`} title="Click to copy" onClick={copy}>
      {copied ? "Copied ✓" : props.value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Right-click row menu (story 2.4): delete lives here — deliberately not a
// one-click affordance. Any click elsewhere, Esc, or scroll dismisses it.
// ---------------------------------------------------------------------------

export interface CtxMenuState {
  x: number;
  y: number;
  row: RefillRow;
}

export function RowCtxMenu({
  menu,
  onDelete,
  onDismiss,
  extraItems,
}: {
  menu: CtxMenuState;
  onDelete: (row: RefillRow) => void;
  onDismiss: () => void;
  extraItems?: Array<{ label: string; onClick: (row: RefillRow) => void }>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("mousedown", onDismiss);
    window.addEventListener("wheel", onDismiss, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDismiss);
      window.removeEventListener("wheel", onDismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ctx-menu-header">
        Rx {menu.row.rx_number} · {menu.row.drug_name}
      </div>
      {extraItems?.map((item) => (
        <button key={item.label} className="ctx-menu-item" onClick={() => item.onClick(menu.row)}>
          {item.label}
        </button>
      ))}
      <button className="ctx-menu-item danger" onClick={() => onDelete(menu.row)}>
        Delete refill…
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Insurance / Secondary cells (story 4.5): plan name with the master-brand
// logo to its right — logo or nothing, no color fallback (§6.1). Designated
// plans carry the "(Medicare)"/"(Medicaid)" suffix in the name itself.
// ---------------------------------------------------------------------------

function LogoName({ name, logo }: { name: string; logo: string | undefined }) {
  return (
    <span className="logo-cell">
      <span className="logo-cell-name">{name}</span>
      {logo && <img className="logo-cell-img" src={logo} alt="" />}
    </span>
  );
}

export function InsuranceRenderer(props: CustomCellRendererProps<RefillRow>) {
  const { lookups } = props.context as GridCtx;
  const plan = lookups.insurances.find((i) => i.id === props.value);
  if (!plan) return null;
  return <LogoName name={insuranceDisplayName(plan)} logo={insuranceLogoUrl(plan, lookups)} />;
}

export function SecondaryRenderer(props: CustomCellRendererProps<RefillRow>) {
  const { lookups } = props.context as GridCtx;
  const sec = lookups.secondaryCoverages.find((s) => s.id === props.value);
  if (!sec) return null;
  return <LogoName name={sec.name} logo={secondaryLogoUrl(sec)} />;
}

// ---------------------------------------------------------------------------
// Refill Note cell: note name plus, for age-counter notes (Nimble Link), a
// days-since-sent counter (story 1.9) that turns red at the Settings threshold.
// ---------------------------------------------------------------------------

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function RefillNoteRenderer(props: CustomCellRendererProps<RefillRow>) {
  const ctx = props.context as GridCtx;
  const note = ctx.lookups.refillNotes.find((n) => n.id === props.value);
  if (!note) return null;
  const setAt = props.data?.refill_note_set_at;
  // behavior flag, not the name (§4.3): renaming the note must not kill the counter
  const showCounter = note.shows_age_counter === 1 && setAt;
  const days = showCounter ? daysSince(setAt) : 0;
  const stale = showCounter && days >= ctx.lookups.settings.nimbleLinkAlertDays;
  return (
    <span className="note-cell">
      <span className="note-name">{note.name}</span>
      {showCounter && (
        <span className={`nimble-days${stale ? " stale" : ""}`} title={`${days} day(s) since the Nimble link was sent`}>
          {days}d
        </span>
      )}
    </span>
  );
}
