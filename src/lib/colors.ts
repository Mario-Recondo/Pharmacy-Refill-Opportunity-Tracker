import type { CopayTier } from "../data/types";

/** Readable text color for a given background (relative luminance threshold). */
export function textColorFor(bgHex: string): string {
  const hex = bgHex.replace("#", "");
  if (hex.length !== 6) return "#1a1a1a";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#1a1a1a" : "#ffffff";
}

/** Copay tier color per design doc §5; tiers come from Settings, ordered by max ascending. */
export function copayColor(value: number | null | undefined, tiers: CopayTier[]): string | undefined {
  if (value == null) return undefined;
  for (const tier of tiers) {
    if (tier.max === null || value <= tier.max) return tier.color;
  }
  return undefined;
}

const PROFIT_FLOOR = 0.18; // small positive profits must still read as green (design doc §5)

/**
 * Dynamic profit shading (design doc §5): green intensity relative to the maximum
 * profit among the rows currently visible. Zero/negative gets a distinct red tint.
 */
export function profitStyle(
  value: number | null | undefined,
  maxVisible: number,
): { backgroundColor: string; color: string } | undefined {
  if (value == null) return undefined;
  if (value <= 0) return { backgroundColor: "#fdecea", color: "#b71c1c" };
  const t = maxVisible > 0 ? Math.max(value / maxVisible, PROFIT_FLOOR) : PROFIT_FLOOR;
  // Interpolate white → strong green (#1b8a3a)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const bg = `rgb(${mix(255, 27)}, ${mix(255, 138)}, ${mix(255, 58)})`;
  return { backgroundColor: bg, color: t > 0.62 ? "#ffffff" : "#0d3d1c" };
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}
