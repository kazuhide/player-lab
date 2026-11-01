import { SDK_VERSIONS, type EngineId, type StartupTuning } from "./contract";
import { makeTrialOrder, parseTrialResult, summarizeTrials, tuningKey, type TrialResult } from "./model";

export interface PlannedTrial { readonly engine: EngineId; readonly tuning: StartupTuning }
export interface TuningSelection {
  readonly tuning: StartupTuning;
  readonly fallbackReasons: Readonly<Partial<Record<EngineId, "incomplete-screening" | "no-complete-candidate">>>;
}
const defaults: StartupTuning = Object.freeze({ hlsWorker: true, shakaPrefetchLimit: 0, webXLoadControl: 2 });

/** Candidate settings are evaluated within each engine, never ranked against one another here. */
export function planScreening(seed: number): readonly PlannedTrial[] {
  const visits: Record<EngineId, number> = { "web-x": 0, hls: 0, shaka: 0 };
  return makeTrialOrder(6, seed).flat().map((engine) => {
    const visit = visits[engine]++;
    // Nothing/Manifests do not enable segment loading. They cannot be a
    // valid startup optimization; preserve the public Data policy (2).
    const tuning: StartupTuning = engine === "hls" ? { ...defaults, hlsWorker: visit % 2 === 0 }
      : engine === "shaka" ? { ...defaults, shakaPrefetchLimit: (visit % 3) as 0 | 1 | 2 } : { ...defaults };
    return Object.freeze({ engine, tuning: Object.freeze(tuning) });
  });
}

/** Select using a fixed training metric, then freeze settings for independent confirmation trials. */
export function selectStartupTuning(input: readonly TrialResult[]): TuningSelection {
  const results = input.map(parseTrialResult);
  const contexts = new Set(results.map(({ context }) => JSON.stringify([
    context.contentId, context.profile, context.sdkMode, context.httpCache,
  ])));
  if (contexts.size > 1 || results.some(({ context }) =>
    context.profile !== "startup" || context.version !== SDK_VERSIONS[context.engine])) {
    throw new Error("Configuration screening requires one startup cohort and the installed SDK versions.");
  }
  const tuning = { ...defaults };
  const fallbackReasons: Partial<Record<EngineId, "incomplete-screening" | "no-complete-candidate">> = {};
  for (const engine of ["web-x", "hls", "shaka"] as const) {
    const own = results.filter((result) => result.context.engine === engine);
    const expected = planScreening(0).filter((trial) => trial.engine === engine).map((trial) => tuningKey(trial.tuning)).sort();
    const actual = own.map((trial) => tuningKey(trial.context.tuning)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) { fallbackReasons[engine] = "incomplete-screening"; continue; }
    const candidates = summarizeTrials(own, "selectionToNativePlayingMs");
    const valid = candidates.filter((candidate) => candidate.n >= 2 && candidate.n === candidate.total
      && candidate.failureCount === 0 && candidate.cancelledCount === 0 && candidate.missingCount === 0);
    if (!valid.length) { fallbackReasons[engine] = "no-complete-candidate"; continue; }
    // Stable tie preference is the explicit default candidate, not an engine's
    // position in a completed cross-engine comparison.
    valid.sort((a, b) => a.medianMs! - b.medianMs!
      || Number(b.context.tuning.hlsWorker === true) - Number(a.context.tuning.hlsWorker === true)
      || (a.context.tuning.shakaPrefetchLimit ?? 0) - (b.context.tuning.shakaPrefetchLimit ?? 0));
    const chosen = valid[0]!.context.tuning;
    if (engine === "hls") tuning.hlsWorker = chosen.hlsWorker ?? defaults.hlsWorker!;
    if (engine === "shaka") tuning.shakaPrefetchLimit = chosen.shakaPrefetchLimit ?? defaults.shakaPrefetchLimit!;
  }
  return Object.freeze({ tuning: Object.freeze(tuning), fallbackReasons: Object.freeze(fallbackReasons) });
}
