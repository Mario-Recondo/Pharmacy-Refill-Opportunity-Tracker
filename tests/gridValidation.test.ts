import { describe, expect, it } from "vitest";
import {
  parseMoneyEdit,
  parseNonNegativeIntegerEdit,
} from "../src/lib/gridValidation";

describe("grid edit validation", () => {
  it("parses valid money and silently restores invalid money", () => {
    expect(parseMoneyEdit("$1,234.50", 10)).toBe(1234.5);
    expect(parseMoneyEdit("-2.75", 10)).toBe(-2.75);
    expect(parseMoneyEdit("", 10)).toBeNull();
    expect(parseMoneyEdit("not money", 10)).toBe(10);
  });

  it("accepts only non-negative whole refill counts", () => {
    expect(parseNonNegativeIntegerEdit("0", 4)).toBe(0);
    expect(parseNonNegativeIntegerEdit("12", 4)).toBe(12);
    expect(parseNonNegativeIntegerEdit("", 4)).toBeNull();
    expect(parseNonNegativeIntegerEdit("-1", 4)).toBe(4);
    expect(parseNonNegativeIntegerEdit("2.5", 4)).toBe(4);
  });
});
