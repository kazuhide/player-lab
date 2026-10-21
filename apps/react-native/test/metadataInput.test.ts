import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ StyleSheet: { create: (value: unknown) => value } }));
import { metadataValue } from "../src/metadataInput";

describe("native metadata values", () => {
  const leaf = (kind: string, text = "") => ({ kind, text, children: [] });
  it("retains nested value types instead of converting every entry to text", () => {
    expect(metadataValue(JSON.stringify({ kind: "object", text: "", children: [
      { key: "name", node: leaf("string", "episode") }, { key: "count", node: leaf("number", "2") },
      { key: "flags", node: { kind: "array", text: "", children: [{ key: "0", node: leaf("boolean", "false") }, { key: "1", node: leaf("null") }] } },
    ] }))).toEqual({ name: "episode", count: 2, flags: [false, null] });
  });
  it("rejects duplicate or prototype field names, invalid numbers and invalid root values before dispatch", () => {
    const child = { key: "entry", node: leaf("null") };
    const object = (children: unknown[]) => JSON.stringify({ kind: "object", text: "", children });
    expect(() => metadataValue(object([child, child]))).toThrow("unique");
    expect(() => metadataValue(object([{ key: "__proto__", node: leaf("null") }]))).toThrow("prototypes");
    expect(() => metadataValue(object([{ key: "n", node: leaf("number", "Infinity") }]))).toThrow("finite number");
    expect(() => metadataValue(JSON.stringify(leaf("array")))).toThrow("object or null");
  });
});
