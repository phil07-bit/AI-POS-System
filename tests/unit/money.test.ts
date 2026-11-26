import { describe, expect, it } from "vitest";
import { formatMoney, minorToDecimalString, parseMoneyToMinor, prorateMinor, sumMinor } from "@/lib/money";

describe("money", () => {
  it("parses decimal strings to pesewas without floating point error", () => {
    expect(parseMoneyToMinor("0.10")).toBe(10);
    expect(parseMoneyToMinor("0.29")).toBe(29); // 0.29*100 = 28.999… in floats
    expect(parseMoneyToMinor("1,250.5")).toBe(125050);
    expect(parseMoneyToMinor("GH₵ 3,000")).toBe(300000);
    expect(parseMoneyToMinor("12")).toBe(1200);
  });
  it("rejects invalid or over-precise input", () => {
    expect(() => parseMoneyToMinor("abc")).toThrow();
    expect(() => parseMoneyToMinor("1.234")).toThrow();
    expect(() => parseMoneyToMinor("")).toThrow();
  });
  it("formats GHS", () => {
    expect(formatMoney(125050)).toBe("GH₵ 1,250.50");
    expect(formatMoney(5)).toBe("GH₵ 0.05");
    expect(formatMoney(-150000)).toBe("-GH₵ 1,500.00");
    expect(formatMoney(123456789)).toBe("GH₵ 1,234,567.89");
    expect(minorToDecimalString(100)).toBe("1.00");
  });
  it("sums and prorates in integers", () => {
    expect(sumMinor([10, 20, null, undefined, 30])).toBe(60);
    expect(prorateMinor(300000, 15, 30)).toBe(150000);
    expect(prorateMinor(100000, 1, 3)).toBe(33333);
    expect(prorateMinor(100000, 2, 3)).toBe(66667);
    expect(prorateMinor(100000, 31, 30)).toBe(100000);
  });
});
