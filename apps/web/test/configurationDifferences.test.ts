import { expect, it } from "vitest";
import { configurationDifferences, configurationValueText, copiedConfigurationString, redactConfigurationText, sameConfigurationValue } from "../../../shared/configurationDifferences";

it("distinguishes additions, removals, changes and exact reverts without depending on object key order", () => {
  expect(configurationDifferences({ title: "A", keep: true, remove: "x" }, { keep: true, title: "B", add: [1] }))
    .toEqual(expect.arrayContaining([
      { path: "title", kind: "changed", before: "A", after: "B" },
      { path: "remove", kind: "removed", before: "x", after: "[not set]" },
      { path: "add.0", kind: "added", before: "[not set]", after: "1" },
    ]));
  expect(configurationDifferences({ title: "A", keep: true }, { keep: true, title: "A" })).toEqual([]);
  expect(sameConfigurationValue({ x: [1, false] }, { x: [1, "false"] })).toBe(false);
  expect(configurationDifferences({ length: 1 }, { length: 2 })).toEqual([
    { path: "length", kind: "changed", before: "1", after: "2" },
  ]);
  expect(configurationDifferences({ x: [1] }, { x: { "0": 1 } })).toEqual([
    { path: "x", kind: "changed", before: "[1]", after: '{"0":1}' },
  ]);
  expect(configurationValueText("", "SourceConfig.description")).toBe('""');
});

it("keeps real secret, token and callback edits visible while redacting both displayed values", () => {
  const before = { apiSettings: { "PlayerConfig.analyticsConfig.licenseKey": "before-secret" }, url: "https://user:pass@example.test/a?token=old-token", scripts: { bodies: { request: "return oldSecret;" } } };
  const after = { apiSettings: { "PlayerConfig.analyticsConfig.licenseKey": "after-secret" }, url: "https://new:pass@example.test/a?token=new-token", scripts: { bodies: { request: "return newSecret;" } } };
  const differences = configurationDifferences(before, after);
  expect(differences).toHaveLength(3);
  expect(differences.every(change => change.kind === "changed")).toBe(true);
  const text = JSON.stringify(differences);
  for (const secret of ["before-secret", "after-secret", "old-token", "new-token", "oldSecret", "newSecret", "user:pass", "new:pass"]) expect(text).not.toContain(secret);
  expect(text).toContain("[redacted]"); expect(text).toContain("[callback]");
  expect(configurationValueText("proxy-value", "Proxy-Authorization")).toBe("[redacted]");
  expect(configurationValueText("access-value", "accessToken")).toBe("[redacted]");
  expect(redactConfigurationText("https://example.test/a?design=dark&monkey=banana&%74oken=encoded-secret"))
    .toBe("https://example.test/a?design=dark&monkey=banana&%74oken=[redacted]");
  expect(configurationDifferences(before, before)).toEqual([]);
});

it("does not invoke getters or callbacks to compare and format a preview", () => {
  const source = Object.defineProperty({}, "token", { enumerable: true, get() { throw new Error("Do not run"); } });
  expect(configurationValueText(source, "SourceConfig")).toContain("[unavailable]");
  expect(sameConfigurationValue(source, { token: "x" })).toBe(false);
  const array = Object.defineProperty([], "0", { enumerable: true, get() { throw new Error("Do not run array getters"); } });
  expect(configurationValueText(array, "SourceConfig.items")).toContain("[unavailable]");
});

it("limits user-info redaction to URL authorities while retaining ordinary at signs in queries and fragments", () => {
  for (const url of [
    "https://example.test?email=user@example.test",
    "https://example.test#email=user@example.test",
    "https://example.test/path?email=user@example.test#contact=other@example.test",
  ]) {
    expect(redactConfigurationText(url)).toBe(url);
    expect(copiedConfigurationString(url)).toBe(url);
    expect(configurationValueText(url, "SourceConfig.hls")).toBe(url);
  }
  expect(redactConfigurationText("https://user:pass@example.test?email=user@example.test"))
    .toBe("https://[redacted]@example.test?email=user@example.test");
});
