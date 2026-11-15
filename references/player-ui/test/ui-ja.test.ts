import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UI_JA } from "../src/ui-ja.ts";

const officialEnglish = JSON.parse(readFileSync(new URL(
  "../node_modules/bitmovin-player-ui/src/ts/localization/languages/en.json", import.meta.url,
), "utf8")) as Record<string, string>;

test("the Player Lab Japanese vocabulary covers every pinned official UI string", () => {
  assert.deepEqual(Object.keys(UI_JA).sort(), Object.keys(officialEnglish).sort());
  for (const [key, value] of Object.entries(UI_JA)) {
    assert.ok(value.trim().length > 0, `${key} must not be empty`);
  }
});

test("Japanese UI strings preserve official placeholders and embedded markup", () => {
  for (const [key, english] of Object.entries(officialEnglish)) {
    const japanese = UI_JA[key];
    assert.deepEqual(japanese.match(/\{[^{}]+\}/g)?.sort() ?? [], english.match(/\{[^{}]+\}/g)?.sort() ?? [], key);
    assert.deepEqual(japanese.match(/<\/?[a-z]+>/g) ?? [], english.match(/<\/?[a-z]+>/g) ?? [], key);
  }
});
