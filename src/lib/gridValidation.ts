export function parseMoneyEdit(
  newValue: unknown,
  oldValue: unknown,
): number | null | unknown {
  const text = String(newValue ?? "").replace(/[$,\s]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : oldValue;
}

export function parseNonNegativeIntegerEdit(
  newValue: unknown,
  oldValue: unknown,
): number | null | unknown {
  const text = String(newValue ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : oldValue;
}
