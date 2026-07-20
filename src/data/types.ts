// Row and lookup shapes shared by the data layer and the grid.

export type RefillStatus = "Pending" | "Checked Out" | "MISSED";

export const STATUSES: RefillStatus[] = ["Pending", "Checked Out", "MISSED"];

export interface Lookup {
  id: number;
  name: string;
  sort_order: number;
  active: number;
  color?: string; // refill/call notes only — insurance/secondary colors retired by the logo feature
  meaning?: string; // notes only
  allows_call_note?: number; // refill notes: behavior flags, keyed off flags not names
  shows_age_counter?: number;
  requires_followup?: number; // call notes: "contact made, waiting on patient" — feeds the Req Follow Up tab
  group_id?: number | null; // insurances: master-brand group; NULL = ungrouped
  is_medicare?: number; // insurances: designation flags → "(Medicare)"/"(Medicaid)" suffix
  is_medicaid?: number;
  logo?: string | null; // secondary coverages: direct per-row bundled-logo key
}

export interface InsuranceGroup {
  id: number;
  name: string;
  logo: string | null; // bundled asset key; NULL = no logo (plans render plain)
  sort_order: number;
  active: number;
  is_default: number;
}

export interface CopayTier {
  max: number | null; // null = no upper bound (top tier)
  color: string;
}

export interface AppSettings {
  alertLookaheadDays: number;
  alertMinProfit: number;
  copayTiers: CopayTier[];
  statusColors: Record<string, string>;
  nimbleLinkAlertDays: number;
  followupWaitDays: number; // quiet days before a qualifying row surfaces on Req Follow Up
  backupFolder: string | null; // persisted on first backup; makes later backups one-click
}

export interface Lookups {
  insurances: Lookup[];
  insuranceGroups: InsuranceGroup[];
  secondaryCoverages: Lookup[];
  refillNotes: Lookup[];
  callNotes: Lookup[];
  settings: AppSettings;
}

export interface Drug {
  id: number;
  name: string;
  ndc: string | null;
}

export interface RefillRow {
  id: number;
  rx_number: string;
  drug_id: number;
  drug_name: string;
  ndc: string | null;
  due_date: string; // ISO yyyy-mm-dd
  insurance_id: number | null;
  secondary_id: number | null;
  old_copay: number | null;
  new_copay: number | null;
  old_profit: number | null;
  new_profit: number | null;
  refills_filled: number | null;
  refills_left: number | null;
  refill_note_id: number | null;
  call_note_id: number | null;
  refill_note_set_at: string | null; // ISO timestamp; drives the Nimble Link aging counter
  call_note_set_at: string | null; // ISO timestamp; the Req Follow Up "quiet days" clock
  added_to_call_list_on: string | null;
  status: RefillStatus;
  notes: string | null;
}

/**
 * Append-only workflow event (refill_events table): note/status changes made by
 * the technician plus followup_entered/followup_left span markers written by
 * the sweep. Values are display names captured at event time — renames never
 * rewrite history. `profit` snapshots new_profit on status → Checked Out.
 */
export type RefillEventKind = "refill_note" | "call_note" | "status" | "followup_entered" | "followup_left";

export interface RefillEvent {
  id: number;
  refill_id: number;
  at: string; // ISO timestamp
  kind: RefillEventKind;
  old_value: string | null;
  new_value: string | null;
  profit: number | null;
}

/** Fields the grid may write back. rx_number, drug and due_date change only via the drawer (M2). */
export const EDITABLE_FIELDS = [
  "insurance_id",
  "secondary_id",
  "old_copay",
  "new_copay",
  "old_profit",
  "new_profit",
  "refills_filled",
  "refills_left",
  "refill_note_id",
  "call_note_id",
  "status",
  "notes",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];
