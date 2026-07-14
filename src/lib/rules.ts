import type { Lookup, Lookups } from "../data/types";
import { logoUrl } from "./logoAssets";

/** Call notes apply only when the refill note's allows_call_note flag is set (design doc §5).
 *  Keyed off the flag, never the name — renames must not break gating. */
export function noteQualifiesForCallNote(refillNoteId: number | null | undefined, lookups: Lookups): boolean {
  if (refillNoteId == null) return false;
  return lookups.refillNotes.find((n) => n.id === refillNoteId)?.allows_call_note === 1;
}

/** Month-grid aging counter renders when the refill note's shows_age_counter flag is set (design doc §5). */
export function noteShowsAgeCounter(refillNoteId: number | null | undefined, lookups: Lookups): boolean {
  if (refillNoteId == null) return false;
  return lookups.refillNotes.find((n) => n.id === refillNoteId)?.shows_age_counter === 1;
}

/** "(Medicare)" / "(Medicaid)" suffix — renders everywhere the plan name does (design doc §6.1). */
export function designationSuffix(l: Lookup | undefined): string {
  if (!l) return "";
  const parts = [l.is_medicare === 1 ? "(Medicare)" : null, l.is_medicaid === 1 ? "(Medicaid)" : null].filter(Boolean);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function insuranceDisplayName(l: Lookup | undefined): string {
  return l ? `${l.name}${designationSuffix(l)}` : "";
}

/** Logo-or-nothing (design doc §6.1): the plan's group logo, or undefined for
 *  ungrouped plans and logo-less groups — no color fallback. */
export function insuranceLogoUrl(l: Lookup | undefined, lookups: Lookups): string | undefined {
  if (!l || l.group_id == null) return undefined;
  return logoUrl(lookups.insuranceGroups.find((g) => g.id === l.group_id)?.logo);
}

/** Secondary coverages carry their logo directly on the row. */
export function secondaryLogoUrl(l: Lookup | undefined): string | undefined {
  return logoUrl(l?.logo);
}
