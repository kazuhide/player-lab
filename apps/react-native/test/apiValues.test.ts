import { describe, expect, it } from "vitest";
import { apiValue, finiteNumber, stringEntries } from "../src/apiValues";

describe("API experiment value boundaries", () => {
  it("preserves finite values and rejects empty, nonfinite and out-of-range input", () => {
    expect(finiteNumber(" -1.5e2 ", "offset")).toBe(-150);
    for (const text of ["", "Infinity", "NaN", "0x10", "1second"]) {
      expect(() => finiteNumber(text, "offset")).toThrow();
    }
    expect(() => finiteNumber("101", "volume", 0, 100)).toThrow();
  });
  it("accepts dictionary values containing equals signs and rejects duplicate or prototype names", () => {
    expect(stringEntries(" Accept=video/mp4\nvalue=a=b")).toEqual({ Accept: "video/mp4", value: "a=b" });
    for (const text of ["value", "a=b\na=c", "__proto__=value", "constructor=value"]) {
      expect(() => stringEntries(text)).toThrow();
    }
  });
  it("bounds cyclic results and removes credential values recursively", () => {
    const value: Record<string, unknown> = { config: { licenseKey: "PRIVATE", headers: { Authorization: "PRIVATE" } }, duration: Infinity };
    value.self = value;
    const output = apiValue(value);
    expect(output).not.toContain("PRIVATE");
    expect(output).toContain("[circular]");
    expect(output).toContain("Infinity");
    expect(apiValue(Array.from({ length: 10000 }, () => ({ value: "x".repeat(10000) }))).length).toBeLessThan(40000);
  });
});
