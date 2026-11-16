import { validatePrivateQueryData, validateSourceURL } from "./query-incidence.ts";
import { validateSnapshot } from "./snapshot.ts";
import type { EngagementSnapshot, QueryIncidenceSnapshot } from "./types.ts";

export interface PrivateDemoProfile {
  id: string;
  title: { en: string; ja: string };
  snapshot: EngagementSnapshot;
}

export type PrivateData =
  | { kind: "query"; source: { hls: string }; snapshot: QueryIncidenceSnapshot }
  | { kind: "synthetic-live-demo"; source: { hls: string }; profiles: PrivateDemoProfile[] };

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    throw new Error(label + " has unsupported or missing fields");
  }
  return result;
}

/** Keeps real Query counts separate from explicitly authored synthetic scenarios. */
export function validatePrivateData(value: unknown): PrivateData {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !("kind" in value) || value.kind !== "synthetic-live-demo") {
    return { kind: "query", ...validatePrivateQueryData(value) };
  }
  const input = object(value, ["schemaVersion", "kind", "source", "profiles"], "private demo");
  if (input.schemaVersion !== 1) throw new Error("Unsupported private demo version");
  const source = object(input.source, ["hls"], "demo source");
  const hls = validateSourceURL(source.hls);
  if (!Array.isArray(input.profiles) || input.profiles.length < 1 || input.profiles.length > 5) throw new Error("Invalid demo profile count");
  const ids = new Set<string>();
  let timeline: string | undefined;
  const profiles = Array.from(input.profiles, value => {
    const profile = object(value, ["id", "title", "snapshot"], "demo profile");
    if (typeof profile.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,59}$/.test(profile.id) || ids.has(profile.id)) throw new Error("Invalid or duplicate demo profile id");
    ids.add(profile.id);
    const title = object(profile.title, ["en", "ja"], "demo profile title");
    for (const key of ["en", "ja"]) {
      if (typeof title[key] !== "string" || !title[key].trim() || title[key].length > 120) throw new Error("Invalid demo profile title");
    }
    const snapshot = validateSnapshot(profile.snapshot);
    const identity = JSON.stringify([snapshot.content.id, snapshot.content.revision, snapshot.content.durationMs,
      snapshot.period.start, snapshot.period.end, snapshot.generatedAt]);
    if (timeline !== undefined && timeline !== identity) throw new Error("Demo profiles must share one content timeline and observation period");
    timeline = identity;
    return { id: profile.id, title: { en: title.en as string, ja: title.ja as string }, snapshot };
  });
  return { kind: "synthetic-live-demo", source: { hls }, profiles };
}
