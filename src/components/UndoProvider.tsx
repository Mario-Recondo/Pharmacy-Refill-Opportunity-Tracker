// Ctrl+Z for accidental field edits (technician request, 2026-07-24).
//
// Undo replays through `updateRefillField`, the same serialized atomic write the
// original edit used (ADR 0003), so the append-only event log records the undo as
// a new compensating change rather than losing the history. Row identity is the
// refill id, never a grid row index, so undo survives sorting, filtering, tab
// switches, and month changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { updateRefillField } from "../data/refills";
import {
  afterUndo,
  armRow,
  decideUndo,
  disarm,
  emptyUndoState,
  recordEdit,
  type UndoEntry,
  type UndoState,
} from "../lib/undoStack";
import { useGridInteractionController } from "./GridInteractionProvider";

/** A warned cross-row boundary goes stale, so a much later keypress asks again. */
const ARMED_TIMEOUT_MS = 6000;
const TOAST_MS = 4000;

interface UndoController {
  /** Records a persisted edit. Call only after the write succeeded. */
  record(entry: UndoEntry): void;
  /** Registers a reload so undone rows refresh; returns the unsubscribe. */
  registerRefresh(reload: () => void): () => void;
  /** Overrides the context row while the drawer is open, since no grid cell is
   *  focused then. Pass null on close. */
  setContextRow(rowId: number | null): void;
}

const UndoContext = createContext<UndoController | null>(null);

export function UndoProvider({ children }: { children: ReactNode }) {
  const grid = useGridInteractionController();
  const stateRef = useRef<UndoState>(emptyUndoState);
  const contextRowRef = useRef<number | null>(null);
  const refreshersRef = useRef(new Set<() => void>());
  const armedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busyRef = useRef(false);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "warn" } | null>(null);

  const showToast = useCallback((text: string, tone: "info" | "warn") => {
    setToast({ text, tone });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const record = useCallback((entry: UndoEntry) => {
    stateRef.current = recordEdit(stateRef.current, entry);
    clearTimeout(armedTimerRef.current);
  }, []);

  const registerRefresh = useCallback((reload: () => void) => {
    refreshersRef.current.add(reload);
    return () => {
      refreshersRef.current.delete(reload);
    };
  }, []);

  const setContextRow = useCallback((rowId: number | null) => {
    contextRowRef.current = rowId;
  }, []);

  const contextRowId = useCallback(
    () => contextRowRef.current ?? grid.focusedRowId(),
    [grid],
  );

  const performUndo = useCallback(
    async (entry: UndoEntry) => {
      busyRef.current = true;
      try {
        for (const step of entry.steps) {
          await updateRefillField(entry.rowId, step.field, step.oldValue ?? null);
        }
      } catch (err) {
        showToast(`Undo failed — nothing changed. ${err}`, "warn");
        return;
      } finally {
        busyRef.current = false;
      }

      stateRef.current = afterUndo(stateRef.current, entry);
      for (const reload of refreshersRef.current) reload();

      const fields = entry.steps.map((step) => step.field);
      const shown = grid.revealCells(entry.rowId, fields);
      showToast(
        `Undid ${entry.fieldLabel} on ${entry.rowLabel} — restored ${entry.restoredLabel}` +
          (shown ? "" : " (row not in this view)"),
        "info",
      );
    },
    [grid, showToast],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key !== "z" && event.key !== "Z") return;
      // Inside an editor Ctrl+Z belongs to the text field, not the row history.
      if (grid.isEditing()) return;
      // Holding the key must not walk the stack (technician concern, 2026-07-24).
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (busyRef.current) return;

      event.preventDefault();
      const decision = decideUndo(stateRef.current, contextRowId());
      if (decision.kind === "empty") {
        showToast("Nothing to undo", "info");
        return;
      }
      if (decision.kind === "confirm-row") {
        stateRef.current = armRow(stateRef.current, decision.entry.rowId);
        clearTimeout(armedTimerRef.current);
        armedTimerRef.current = setTimeout(() => {
          stateRef.current = disarm(stateRef.current);
        }, ARMED_TIMEOUT_MS);
        showToast(
          `Next undo affects ${decision.entry.rowLabel} (${decision.entry.fieldLabel}) — press Ctrl+Z again to undo`,
          "warn",
        );
        return;
      }
      void performUndo(decision.entry);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [contextRowId, grid, performUndo, showToast]);

  useEffect(
    () => () => {
      clearTimeout(armedTimerRef.current);
      clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const value = useMemo<UndoController>(
    () => ({ record, registerRefresh, setContextRow }),
    [record, registerRefresh, setContextRow],
  );

  return (
    <UndoContext.Provider value={value}>
      {children}
      {toast && (
        <div className={`undo-toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </UndoContext.Provider>
  );
}

export function useUndoController(): UndoController {
  const controller = useContext(UndoContext);
  if (!controller) {
    throw new Error("Undo hooks must be used inside UndoProvider");
  }
  return controller;
}

/** Reloads this view's rows after an undo writes to the database. */
export function useUndoRefresh(reload: () => void): void {
  const { registerRefresh } = useUndoController();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(
    () => registerRefresh(() => reloadRef.current()),
    [registerRefresh],
  );
}
