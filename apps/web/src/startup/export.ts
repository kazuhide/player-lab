import { MAX_RESULTS, parseTrialResult, type TrialResult } from "./model";
import type { BrowserTrial } from "./runner";
import { parseEnvironment, parseUtc, type EnvironmentSnapshot } from "./environment";

export interface ExportInput {
  readonly run: number; readonly seed: number;
  readonly phase: "comparison" | "screening" | "confirmation";
  readonly measurement: TrialResult; readonly observations: BrowserTrial;
  readonly measuredAt: string; readonly environment: EnvironmentSnapshot;
}
function statistic(value: number | null | undefined, signed = false): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || typeof value !== "number" || (!signed && value < 0)) {
    throw new Error("A comparison statistic is invalid.");
  }
  return value;
}

/** An explicit export boundary. SDK metadata, request addresses and errors stay out. */
export function createComparisonExport(entries: readonly ExportInput[], exportedAt: string) {
  if (!Array.isArray(entries) || entries.length > MAX_RESULTS) throw new Error("Too many comparison results.");
  const savedAt = parseUtc(exportedAt);
  const trials = entries.map((entry) => {
    if (!Number.isSafeInteger(entry.run) || entry.run < 1 || !Number.isInteger(entry.seed)
      || entry.seed < 0 || entry.seed > 0xffffffff || !["comparison", "screening", "confirmation"].includes(entry.phase)) {
      throw new Error("The comparison sequence is invalid.");
    }
    const { observations: observation } = entry;
    const video = observation.video;
    const resources = observation.resources;
    const longTasks = observation.longTasks;
    const sample = observation.sample;
    const engine = sample?.mediaEngine;
    if (engine && !["media-source", "managed-media-source", "media-source-family", "native", "unknown"].includes(engine)) {
      throw new Error("The media backend observation is invalid.");
    }
    if (sample?.workerActive !== undefined && sample.workerActive !== null && typeof sample.workerActive !== "boolean") {
      throw new Error("The worker observation is invalid.");
    }
    return {
      run: entry.run, seed: entry.seed, phase: entry.phase,
      measuredAt: parseUtc(entry.measuredAt), environment: parseEnvironment(entry.environment),
      measurement: parseTrialResult(entry.measurement),
      statistics: {
        sdkCode: statistic(observation.sdkCode),
        video: video ? { width: statistic(video.width), height: statistic(video.height),
          advancedSeconds: statistic(video.advancedSeconds), droppedFrames: statistic(video.droppedFrames),
          totalFrames: statistic(video.totalFrames) } : null,
        resources: resources ? { count: statistic(resources.count), observedTransferBytes: statistic(resources.observedTransferBytes),
          zeroTransferSizeCount: statistic(resources.zeroTransferSizeCount) } : null,
        longTasks: longTasks ? { count: statistic(longTasks.count), durationMs: statistic(longTasks.durationMs) } : null,
        javascriptHeapDeltaBytes: statistic(observation.javascriptHeapDeltaBytes, true),
        cleanupMs: statistic(observation.cleanupMs),
        providerSample: sample ? { mediaEngine: sample.mediaEngine, workerActive: sample.workerActive,
          loadLatencySeconds: statistic(sample.loadLatencySeconds),
          timeToFirstFrameSeconds: statistic(sample.timeToFirstFrameSeconds),
          bandwidthEstimateBps: statistic(sample.bandwidthEstimateBps) } : null,
      },
    };
  });
  return { schemaVersion: 2 as const, exportedAt: savedAt, clock: "selection-relative-ms" as const, trials };
}
