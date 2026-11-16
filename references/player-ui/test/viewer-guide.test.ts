import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveViewerHistory, selectHighlights } from "../src/viewer-data.ts";
import { VIEWER_CATALOG, VIEWER_HISTORY_EXAMPLES } from "../src/viewer-fixtures.ts";

for (const locale of ["en", "ja"] as const) {
  test(`${locale} viewer guide callbacks execute against the documented fixture`, async () => {
    const path = `../docs/viewer-experiences${locale === "ja" ? ".ja" : ""}.md`;
    const guide = readFileSync(new URL(path, import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)].map(match => match[1]).join("\n")
      .replace(/^import .*;\n/gm, "");
    const calls: [string, unknown][] = [];
    const record = (name: string) => (value?: unknown) => { calls.push([name, value]); return true; };
    const playback = { ui: { setViewerMarkers: record("markers") }, viewer: {
      offerPreferences: record("offer"), startHighlights: record("highlights"), stopHighlights: record("stop"),
      playFrom: record("resume"), restorePreferences: record("apply"), undoPreferences: record("undo"),
    } };
    const snapshot = JSON.parse(readFileSync(new URL("../public/data/sparse.snapshot.json", import.meta.url), "utf8"));
    const actions = new Function("deriveViewerHistory", "selectHighlights", "VIEWER_CATALOG", "VIEWER_HISTORY_EXAMPLES", "playback", "snapshot", "locale",
      `${code}\nreturn { playHighlights, stopHighlights, continueWatching, applySettings, undoSettings };`)(
      deriveViewerHistory, selectHighlights, VIEWER_CATALOG, VIEWER_HISTORY_EXAMPLES, playback, snapshot, locale,
    );
    const markers = calls.find(([name]) => name === "markers")![1] as { startMs: number; title: string }[];
    assert.deepEqual(markers.map(marker => marker.startMs), [18_000, 40_000]);
    assert.equal(markers[0].title, VIEWER_CATALOG.clips[0].title[locale]);
    assert.equal(await actions.playHighlights(), true);
    actions.stopHighlights();
    assert.equal(await actions.continueWatching(), true);
    assert.equal(calls.find(([name]) => name === "resume")![1], 12_000);
    assert.equal(actions.applySettings(), true);
    assert.deepEqual(calls.find(([name]) => name === "apply")![1], { audioLanguage: "en", subtitleEnabled: true, subtitleLanguage: "ja" });
    assert.equal(actions.undoSettings(), true);
  });
}
