import { mkdirSync, writeFileSync } from "node:fs";
import { computeEngagement } from "../src/engagement.ts";
import { validateManifest } from "../src/snapshot.ts";
import type { AnalyticsSample, DemoExport, DemoManifest, EngagementSnapshot } from "../src/types.ts";

const CONTENT = { id: "bbb-60s", revision: "bbb-60s-demo-v1", durationMs: 60_000 };
const PERIOD = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" };
const PROFILES = [
  { id: "sparse", en: "Few playback sessions", ja: "少数の再生記録", sessions: 5, repeat: true },
  { id: "single", en: "One playback session", ja: "1セッションの例", sessions: 1, repeat: true },
  { id: "broader", en: "More playback sessions", ja: "再生記録を増やした例", sessions: 25, repeat: true },
  { id: "watched", en: "Watched without replay", ja: "再視聴がない例", sessions: 5, repeat: false },
  { id: "empty", en: "No observations", ja: "データなし", sessions: 0, repeat: false },
];

/** All identities, clocks and behavior below are authored examples, not exported viewer data. */
function session(profile: string, index: number, repeat: boolean, single: boolean): AnalyticsSample[] {
  const samples: AnalyticsSample[] = [];
  let clock = Date.parse(PERIOD.start) + 60_000 + index * 180_000;
  let sequence = 0;
  let position = 0;
  const id = `synthetic-${profile}-${String(index + 1).padStart(2, "0")}`;
  const append = (from: number, to: number, state: string, played: number): void => {
    sequence++;
    clock += state === "playing" ? played : 300;
    samples.push({ impressionId: id, sequenceNumber: sequence, time: clock, videoId: CONTENT.id,
      videoDuration: CONTENT.durationMs, videotimeStart: from, videotimeEnd: to, played, state, ad: 0,
      videoBitrate: sequence % 3 === 0 ? 2_400_000 : 1_200_000,
      videoPlaybackWidth: sequence % 3 === 0 ? 1280 : 854, videoPlaybackHeight: sequence % 3 === 0 ? 720 : 480 });
    position = to;
  };
  const playTo = (target: number): void => {
    while (position < target) append(position, Math.min(position + 4_000, target), "playing", Math.min(4_000, target - position));
  };
  const replay = (from: number, to: number): void => {
    append(position, from, "seeking", 0);
    playTo(to);
  };
  const initialEnd = single ? 56_000 : [60_000, 50_000, 44_000, 32_000, 56_000][index % 5];
  playTo(initialEnd);
  if (repeat) {
    if (index % 5 !== 4) replay(18_000 + (index % 3) * 500, 24_000 - (index % 2) * 500);
    if (single || index % 5 === 0 || index % 5 === 1 || index % 5 === 4) replay(40_000 + (index % 3) * 500, 46_000 - (index % 2) * 500);
    if (index % 5 === 0) replay(20_000, 22_000);
  }
  return samples;
}

export function buildDemoFixtures(): { manifest: DemoManifest; exports: Record<string, DemoExport> } {
  const exports: Record<string, DemoExport> = {};
  for (const profile of PROFILES) exports[profile.id] = {
    schemaVersion: 1, synthetic: true, content: { ...CONTENT }, period: { ...PERIOD },
    samples: Array.from({ length: profile.sessions }, (_, index) => session(profile.id, index, profile.repeat, profile.sessions === 1)).flat(),
  };
  const manifest = validateManifest({ schemaVersion: 1, synthetic: true, content: { ...CONTENT },
    profiles: PROFILES.map((profile) => ({ id: profile.id, title: { en: profile.en, ja: profile.ja },
      snapshot: `${profile.id}.snapshot.json`, samples: `${profile.id}.samples.json` })) });
  return { manifest, exports };
}

/** Keep each sample on one line so changes to authored behavior remain reviewable. */
export function serializeDemoExport(input: DemoExport): string {
  return `{
  "schemaVersion": 1,
  "synthetic": true,
  "content": ${JSON.stringify(input.content)},
  "period": ${JSON.stringify(input.period)},
  "samples": [${input.samples.length ? "\n" : ""}${input.samples.map((sample) => `    ${JSON.stringify(sample)}`).join(",\n")}${input.samples.length ? "\n  " : ""}]
}
`;
}

export function serializeSnapshot(snapshot: EngagementSnapshot): string {
  const { points, ...metadata } = snapshot;
  const prefix = JSON.stringify(metadata, null, 2).slice(0, -2);
  return `${prefix},\n  "points": [\n${points.map((point) => `    ${JSON.stringify(point)}`).join(",\n")}\n  ]\n}\n`;
}

if (import.meta.main) {
  const root = new URL("../public/data/", import.meta.url);
  mkdirSync(root, { recursive: true });
  const { manifest, exports } = buildDemoFixtures();
  writeFileSync(new URL("manifest.json", root), JSON.stringify(manifest, null, 2) + "\n");
  for (const profile of manifest.profiles) {
    const input = exports[profile.id];
    writeFileSync(new URL(profile.samples, root), serializeDemoExport(input));
    writeFileSync(new URL(profile.snapshot, root), serializeSnapshot(computeEngagement(input)));
  }
  console.log(`Generated ${manifest.profiles.length} synthetic profiles. No account data was read.`);
}
