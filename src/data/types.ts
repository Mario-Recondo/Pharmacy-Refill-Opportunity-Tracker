// Row and lookup shapes shared by the data layer and the grid.

export type RefillStatus = "Pending" | "Checked Out" | "MISSED";

export const STATUSES: RefillStatus[] = ["Pending", "Checked Out", "MISSED"];

export interface Lookup {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  active: number;
  is_medicare_medicaid?: number;
  meaning?: string;
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
}

export interface Lookups {
  insurances: Lookup[];
  secondaryCoverages: Lookup[];
  refillNotes: Lookup[];
  callNotes: Lookup[];
  settings: AppSettings;
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
  refill_note_id: number | null;
  call_note_id: number | null;
  refill_note_set_at: string | null; // ISO timestamp; drives the Nimble Link aging counter
  status: RefillStatus;
  notes: string | null;
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
  "refill_note_id",
  "call_note_id",
  "status",
  "notes",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];
