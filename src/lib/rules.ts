import type { Lookups } from "../data/types";

/** Call notes only apply when the refill note is Nimble Link / Call Pt (design doc §5). */
export function noteQualifiesForCallNote(refillNoteId: number | null | undefined, lookups: Lookups): boolean {
  if (refillNoteId == null) return false;
  const name = lookups.refillNotes.find((n) => n.id === refillNoteId)?.name;
  return name === "Nimble Link" || name === "Call Pt";
}
