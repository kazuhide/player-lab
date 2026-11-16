import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const language of ["", ".ja"]) {
  test(`the ${language ? "Japanese" : "English"} guide's aggregation and evidence examples compose into a loadable pack`, async () => {
    const guide = new URL(`../docs/live-demo-data${language}.md`, import.meta.url);
    const markdown = await readFile(guide, "utf8");
    const blocks = [...markdown.matchAll(/```js\n([\s\S]*?)```/g)].map(match => match[1]);
    assert.equal(blocks.length, 2);
    const samples = [
      { sequence_number: 0, state: "playing", played: 20_000, seeked: 0, videotime_start: 0, videotime_end: 20_000 },
      { sequence_number: 1, state: "seeking", played: 0, seeked: 125, videotime_start: 20_000, videotime_end: 10_000 },
      { sequence_number: 2, state: "playing", played: 20_000, seeked: 0, videotime_start: 10_000, videotime_end: 30_000 },
    ].map((sample, index) => ({ ...sample,
      client_time: Date.parse("2026-01-01T00:01:00.000Z") + index, ad: 0, video_duration: 60_000,
      video_id: "player-lab-live-demo-<RUN_ID>-<SCENARIO>", m3u8_url: "/__private/media/master.m3u8",
    }));
    const example = blocks.join("\n").replace(/from "(\.\.\/src\/[^"\n]+)"/g, (_, path: string) => `from ${JSON.stringify(new URL(path, guide).href)}`);
    const source = `import assert from "node:assert/strict";
const rawSamples = ${JSON.stringify(samples)};
const capturedFinalSequence = 2;
const apiFetchedAt = "2026-01-01T00:11:00.000Z";
${example}
assert.equal(pack.schemaVersion, 1);
const loaded = validatePrivateData(JSON.parse(JSON.stringify(pack)));
assert.equal(loaded.kind, "observability-replay-demo");
assert.equal(loaded.profiles[0].snapshot.synthetic, false);
assert.ok(loaded.profiles[0].snapshot.points.some(point => point.replay > 0));
assert.deepEqual(loaded.profiles[0].evidence.sessions[0].response.data.result, rawSamples);
`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
}
