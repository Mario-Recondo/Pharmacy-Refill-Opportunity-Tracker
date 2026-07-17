// Business color rules (design doc §5): copay tier boundaries and dynamic
// profit shading. These colors are the technician's scanning language — a
// boundary shifting by a cent is a real regression.
import { describe, expect, it } from "vitest";
import { copayColor, formatMoney, profitStyle, textColorFor } from "../src/lib/colors";
import type { CopayTier } from "../src/data/types";

// the seeded sheet-matching tiers (§5): $0 / to $29.99 / to $99.99 / to $300 / above
const TIERS: CopayTier[] = [
  { max: 0, color: "yellow-green" },
  { max: 29.99, color: "blue" },
  { max: 99.99, color: "purple" },
  { max: 300, color: "pink" },
  { max: null, color: "red" },
];

describe("copayColor", () => {
  it.each([
    [0, "yellow-green"],
    [0.01, "blue"],
    [29.99, "blue"],
    [30, "purple"],
    [99.99, "purple"],
    [100, "pink"],
    [300, "pink"],
    [300.01, "red"],
  ])("$%s → %s", (value, color) => {
    expect(copayColor(value as number, TIERS)).toBe(color);
  });

  it("empty cell gets no color", () => {
    expect(copayColor(null, TIERS)).toBeUndefined();
    expect(copayColor(undefined, TIERS)).toBeUndefined();
  });
});

describe("profitStyle", () => {
  it("empty gets nothing; zero and losses get the distinct red treatment", () => {
    expect(profitStyle(null, 100)).toBeUndefined();
    expect(profitStyle(0, 100)).toEqual({ backgroundColor: "#fdecea", color: "#b71c1c" });
    expect(profitStyle(-12.5, 100)).toEqual({ backgroundColor: "#fdecea", color: "#b71c1c" });
  });

  it("the max visible profit gets the strongest green with white text", () => {
    expect(profitStyle(250, 250)).toEqual({ backgroundColor: "rgb(27, 138, 58)", color: "#ffffff" });
  });

  it("a small positive profit still reads green — the floor keeps it off white", () => {
    const style = profitStyle(1, 1000)!;
    expect(style.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(style).toEqual(profitStyle(0.01, 99999)); // anything under the floor shades identically
  });

  it("shading is RELATIVE: the same value shades stronger in a weaker visible set", () => {
    const inStrongSet = profitStyle(50, 500)!;
    const inWeakSet = profitStyle(50, 60)!;
    expect(inStrongSet.backgroundColor).not.toEqual(inWeakSet.backgroundColor);
  });
});

describe("formatMoney", () => {
  it.each([
    [null, ""],
    [12.5, "$12.50"],
    [0, "$0.00"],
    [-5, "-$5.00"],
  ])("%s → %s", (value, text) => {
    expect(formatMoney(value as number | null)).toBe(text);
  });
});

describe("textColorFor", () => {
  it("dark text on light backgrounds, white on dark", () => {
    expect(textColorFor("#ffffff")).toBe("#1a1a1a");
    expect(textColorFor("#1d3557")).toBe("#ffffff");
  });
});
