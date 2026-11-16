import { computeEngagement } from "../src/engagement.ts";
import { validateContent, validatePeriod } from "../src/snapshot.ts";
import type { AnalyticsSample, DemoContent, DemoExport, EngagementSnapshot } from "../src/types.ts";

export interface LiveDemoScenario {
  id: string;
  title: { en: string; ja: string };
  export: DemoExport;
  snapshot: EngagementSnapshot;
}

interface Rewind {
  at: number;
  distance: number;
  watch: number;
}

/** Generates a shared virtual broadcast clock, never a recording of real viewers. */
function session(content: DemoContent, start: number, index: number, distributed: boolean): AnalyticsSample[] {
  const duration = content.durationMs;
  const joined = Math.round(duration * ((index * 7) % 13) / 80);
  const left = Math.round(duration * (index % 7 === 6 ? .58 : index % 7 === 5 ? .75 : 1)) - 1;
  const jitter = (index % 5 - 2) * .006 * duration;
  const rewinds: Rewind[] = distributed ? [{
    at: Math.round(duration * (.33 + ((index * 5) % 9) * .055)),
    distance: Math.round(duration * .075), watch: Math.round(duration * .05),
  }] : [
    ...(index % 4 !== 3 ? [{ at: Math.round(duration * .49 + jitter),
      distance: Math.round(duration * .095), watch: Math.round(duration * (.055 + index % 3 * .006)) }] : []),
    ...(index % 3 === 0 ? [{ at: Math.round(duration * .83 + jitter),
      distance: Math.round(duration * .12), watch: Math.round(duration * .07) }] : []),
  ];
  const samples: AnalyticsSample[] = [];
  let wall = joined, position = joined;
  const packet = (state: string, from: number, to: number, played: number): void => {
    samples.push({
      impressionId: "live-demo-" + String(index + 1).padStart(3, "0"),
      sequenceNumber: samples.length + 1, time: start + wall, videoId: content.id,
      videoDuration: duration, videotimeStart: from, videotimeEnd: to, played, state, ad: 0,
    });
  };
  const watchUntil = (until: number): void => {
    while (wall < until) {
      const length = Math.min(10_000, until - wall);
      const from = position;
      wall += length; position += length;
      packet("playing", from, position, length);
    }
  };
  const seek = (target: number): void => {
    const from = position;
    wall += 150;
    position = target;
    packet("seeking", from, position, 0);
  };
  for (const rewind of rewinds.toSorted((a, b) => a.at - b.at)) {
    if (rewind.at <= wall || rewind.at - rewind.distance < joined ||
      rewind.at + rewind.watch + 300 >= left) continue;
    watchUntil(rewind.at);
    seek(position - rewind.distance);
    watchUntil(wall + rewind.watch);
    // A return targets the broadcast position after the seek latency.
    seek(wall + 150);
  }
  watchUntil(left);
  return samples;
}

/** Computes curves from authored playback passes rather than drawing target curves. */
export function createLiveDemoScenarios(contentInput: DemoContent, periodInput: { start: string; end: string }): LiveDemoScenario[] {
  const content = { ...validateContent(contentInput) };
  const period = { ...validatePeriod(periodInput) };
  if (content.durationMs < 30_000 || content.durationMs > 900_000) throw new Error("Live demo windows must be between 30 seconds and 15 minutes");
  const start = Date.parse(period.start);
  if (Date.parse(period.end) - start < content.durationMs) throw new Error("The reporting window must contain the virtual broadcast");
  const definitions = [
    { id: "live-focused", title: { en: "Concentrated rewatching", ja: "見返しが集中する" }, count: 18, distributed: false },
    { id: "live-distributed", title: { en: "Distributed rewatching", ja: "見返しが分散する" }, count: 18, distributed: true },
    { id: "live-sparse", title: { en: "A small audience", ja: "視聴データが少ない" }, count: 4, distributed: false },
  ];
  return definitions.map(definition => {
    const input: DemoExport = {
      schemaVersion: 1, synthetic: true, content: { ...content }, period: { ...period },
      samples: Array.from({ length: definition.count }, (_, index) =>
        session(content, start, index, definition.distributed)).flat(),
    };
    return { id: definition.id, title: { ...definition.title }, export: input,
      snapshot: computeEngagement(input, 2_000) };
  });
}
