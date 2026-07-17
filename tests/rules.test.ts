// Behavior-flag rules (design doc §4.3/§5): gating and rendering key off
// FLAGS, never names — renaming a lookup must not change behavior. Plus the
// logo-or-nothing rendering rule (§6.1).
import { describe, expect, it } from "vitest";
import {
  designationSuffix,
  insuranceDisplayName,
  insuranceLogoUrl,
  noteQualifiesForCallNote,
  noteShowsAgeCounter,
} from "../src/lib/rules";
import type { Lookup, Lookups } from "../src/data/types";

const lk = (o: Partial<Lookup> & { id: number; name: string }): Lookup => ({
  sort_order: 0,
  active: 1,
  ...o,
});

const LOOKUPS = {
  refillNotes: [
    lk({ id: 1, name: "Totally Renamed Note", allows_call_note: 1, shows_age_counter: 1 }),
    lk({ id: 2, name: "Nimble Link", allows_call_note: 0, shows_age_counter: 0 }), // name lies; flag rules
  ],
  callNotes: [],
  secondaryCoverages: [],
  insurances: [],
  insuranceGroups: [
    { id: 10, name: "CVS Health", logo: "cvs-health", sort_order: 0, active: 1 },
    { id: 11, name: "Independent PBMs", logo: null, sort_order: 0, active: 1 },
  ],
  settings: {} as Lookups["settings"],
} satisfies Lookups;

describe("call-note gating keys off allows_call_note, never the name", () => {
  it("a renamed note with the flag still gates open", () => {
    expect(noteQualifiesForCallNote(1, LOOKUPS)).toBe(true);
  });
  it("a note NAMED Nimble Link without the flag stays closed", () => {
    expect(noteQualifiesForCallNote(2, LOOKUPS)).toBe(false);
  });
  it("no note, unknown note → closed", () => {
    expect(noteQualifiesForCallNote(null, LOOKUPS)).toBe(false);
    expect(noteQualifiesForCallNote(999, LOOKUPS)).toBe(false);
  });
});

describe("aging counter keys off shows_age_counter", () => {
  it("flag on → counter; flag off → none", () => {
    expect(noteShowsAgeCounter(1, LOOKUPS)).toBe(true);
    expect(noteShowsAgeCounter(2, LOOKUPS)).toBe(false);
  });
});

describe("designation suffix", () => {
  it("renders (Medicare) / (Medicaid) / both / neither", () => {
    expect(designationSuffix(lk({ id: 1, name: "X", is_medicare: 1 }))).toBe(" (Medicare)");
    expect(designationSuffix(lk({ id: 1, name: "X", is_medicaid: 1 }))).toBe(" (Medicaid)");
    expect(designationSuffix(lk({ id: 1, name: "X", is_medicare: 1, is_medicaid: 1 }))).toBe(" (Medicare) (Medicaid)");
    expect(designationSuffix(lk({ id: 1, name: "X" }))).toBe("");
  });

  it("insuranceDisplayName appends it everywhere the name renders", () => {
    expect(insuranceDisplayName(lk({ id: 1, name: "Molina", is_medicare: 1, is_medicaid: 1 }))).toBe(
      "Molina (Medicare) (Medicaid)",
    );
    expect(insuranceDisplayName(undefined)).toBe("");
  });
});

describe("logo-or-nothing (§6.1)", () => {
  it("a plan in a logo-bearing group gets the group's logo", () => {
    expect(insuranceLogoUrl(lk({ id: 1, name: "CVS Caremark", group_id: 10 }), LOOKUPS)).toBeTruthy();
  });
  it("a logo-less group and an ungrouped plan render nothing — no color fallback", () => {
    expect(insuranceLogoUrl(lk({ id: 1, name: "Catalyst Rx", group_id: 11 }), LOOKUPS)).toBeUndefined();
    expect(insuranceLogoUrl(lk({ id: 1, name: "Wausau", group_id: null }), LOOKUPS)).toBeUndefined();
  });
});
