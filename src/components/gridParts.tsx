import { useEffect, useRef, useState } from "react";
import type { CustomCellEditorProps, CustomCellRendererProps } from "ag-grid-react";
import { textColorFor } from "../lib/colors";
import type { Lookups, RefillRow } from "../data/types";

/** Passed to AG Grid as `context`, readable from every renderer/style callback. */
export interface GridCtx {
  lookups: Lookups;
  /** max positive profit among currently visible rows — drives relative green shading */
  profitMax: number;
}

/** One choice in the colored dropdown editor. */
export interface PillItem {
  value: number | string | null;
  label: string;
  color: string;
  meaning?: string;
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
    ? [{ value: null, label: "— clear —", color: "#f5f5f5" }, ...items]
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
          className={`pill-option${i === highlight ? " highlight" : ""}${c.value === props.value ? " current" : ""}`}
          style={{ background: c.color, color: textColorFor(c.color) }}
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
}: {
  menu: CtxMenuState;
  onDelete: (row: RefillRow) => void;
  onDismiss: () => void;
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
      <button className="ctx-menu-item danger" onClick={() => onDelete(menu.row)}>
        Delete refill…
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Refill Note cell: note name plus, for Nimble Link, a days-since-sent counter
// (story 1.9) that turns red once it reaches the Settings threshold.
// ---------------------------------------------------------------------------

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function RefillNoteRenderer(props: CustomCellRendererProps<RefillRow>) {
  const ctx = props.context as GridCtx;
  const note = ctx.lookups.refillNotes.find((n) => n.id === props.value);
  if (!note) return null;
  const setAt = props.data?.refill_note_set_at;
  const showCounter = note.name === "Nimble Link" && setAt;
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
