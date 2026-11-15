import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeEngagement } from "../src/engagement.ts";
import { validateManifest, validateSnapshot } from "../src/snapshot.ts";
import { buildDemoFixtures, serializeDemoExport } from "../tools/generate-fixtures.ts";

test("demo profiles have explicit sample populations and deterministic content identity", () => {
  const first = buildDemoFixtures();
  assert.deepEqual(first, buildDemoFixtures());
  assert.deepEqual(first.manifest.profiles.map((profile) => profile.id), ["sparse", "single", "broader", "watched", "empty"]);
  assert.equal(validateManifest(first.manifest).content.durationMs, 60_000);
  const populations = { sparse: 5, single: 1, broader: 25, watched: 5, empty: 0 };
  for (const profile of first.manifest.profiles) {
    const input = first.exports[profile.id];
    assert.equal(input.synthetic, true);
    assert.deepEqual(input.content, first.manifest.content);
    const snapshot = computeEngagement(input);
    assert.equal(snapshot.sessionCount, populations[profile.id as keyof typeof populations]);
    assert.ok(input.samples.every((sample) => sample.impressionId.startsWith("synthetic-")));
    assert.equal(input.samples.length, new Set(input.samples.map((sample) => `${sample.impressionId}:${sample.sequenceNumber}`)).size);
    assert.equal(serializeDemoExport(input).split("\n").filter((line) => line.trimStart().startsWith('{"impressionId"')).length, input.samples.length);
  }
});

test("replay profiles peak around the authored demonstration sections without manufacturing watched-only replay", () => {
  const { exports } = buildDemoFixtures();
  for (const id of ["sparse", "single", "broader"]) {
    const snapshot = computeEngagement(exports[id]);
    assert.equal(snapshot.suggestedMode, "replay");
    assert.ok(snapshot.points.some((point) => point.startMs >= 18_000 && point.endMs <= 24_000 && (point.replay ?? 0) > 0));
    assert.ok(snapshot.points.some((point) => point.startMs >= 40_000 && point.endMs <= 46_000 && (point.replay ?? 0) > 0));
    assert.ok(snapshot.points.filter((point) => point.endMs <= 16_000 || point.startMs >= 48_000).every((point) => point.replay === 0 || point.replay === null));
  }
  const watched = computeEngagement(exports.watched);
  assert.equal(watched.suggestedMode, "reach");
  assert.ok(watched.points.every((point) => point.replay === 0 || point.replay === null));
  assert.equal(computeEngagement(exports.empty).suggestedMode, "empty");
});

test("checked-in synthetic samples and compact snapshots exactly match deterministic generation", () => {
  const generated = buildDemoFixtures();
  const root = new URL("../public/data/", import.meta.url);
  const manifest = validateManifest(JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")));
  assert.deepEqual(manifest, generated.manifest);
  for (const profile of manifest.profiles) {
    const sampleText = readFileSync(new URL(profile.samples, root), "utf8");
    assert.equal(sampleText, serializeDemoExport(generated.exports[profile.id]));
    const snapshot = validateSnapshot(JSON.parse(readFileSync(new URL(profile.snapshot, root), "utf8")));
    assert.deepEqual(snapshot, computeEngagement(JSON.parse(sampleText)));
    assert.equal(snapshot.generatedAt, snapshot.period.end);
    assert.ok(!JSON.stringify(snapshot).includes("impressionId"));
    assert.ok(!JSON.stringify(snapshot).includes("sequenceNumber"));
  }
});
