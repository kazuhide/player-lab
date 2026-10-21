import type { PlayerAPI, ErrorEvent } from "bitmovin-player";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";

export interface RuntimeAppState {
  dvrAllowed: boolean;
  logCount: number;
  sourceType: "hls" | "dash" | "progressive";
  startOffset: number | null;
  autoplay: boolean;
  startupMuted: boolean;
  videoForwardBuffer: number | null;
  audioForwardBuffer: number | null;
  maxVideoBitrate: number | null;
  externalSubtitleConfigured: boolean;
}
interface OwnerReport {
  generation: number;
  sourceLoaded: number;
  cueEnter: number;
  cueVisible: boolean;
  errors: number;
  errorCodes: number[];
  readFailures: number;
  sample: null | { sequence: number; time: number | null; duration: number | null; live: boolean; playing: boolean;
    muted: boolean; decodedFrames: number | null; subtitleCount: number; externalSubtitleAvailable: boolean; externalSubtitleEnabled: boolean };
}
export interface RuntimeReport {
  protocol: 1;
  created: number;
  owner: OwnerReport | null;
  retired: Array<{ generation: number; releaseConfirmed: boolean }>;
  setupErrors: number;
  app: RuntimeAppState | null;
  codeGeneration: number;
}
export interface RuntimeOwner { retire(): void; released(): void; cueVisibility(visible: boolean): void }
export interface RuntimeMonitor {
  attach(player: PlayerAPI, decodedFrames: () => number | undefined): RuntimeOwner;
  sample(): void;
  appState(app: RuntimeAppState): void;
  appliedCode(code: string): void;
  setupError(): void;
  report(): RuntimeReport;
}
const finite = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Public SDK observations only. The report excludes URLs, cues, keys, IDs and SDK messages. */
export function createRuntimeMonitor(): RuntimeMonitor {
  const state: RuntimeReport = { protocol: 1, created: 0, owner: null, retired: [], setupErrors: 0, app: null, codeGeneration: 0 };
  let current: { player: PlayerAPI; frames: () => number | undefined; report: OwnerReport } | null = null;
  let code: string | null = null;
  return {
    attach(player, frames) {
      const report: OwnerReport = { generation: ++state.created, sourceLoaded: 0, cueEnter: 0, cueVisible: false,
        errors: 0, errorCodes: [], readFailures: 0, sample: null };
      const owner = { player, frames, report };
      current = owner; state.owner = report;
      const sourceLoaded = () => { if (current === owner) report.sourceLoaded++; };
      const cue = () => { if (current === owner) report.cueEnter++; };
      const error = (event: ErrorEvent) => {
        if (current !== owner) return;
        report.errors++;
        if (Number.isSafeInteger(event.code) && event.code >= 0 && event.code <= 1000000000) report.errorCodes = [...report.errorCodes, event.code].slice(-8);
      };
      player.on(PlayerEvent.SourceLoaded, sourceLoaded); player.on(PlayerEvent.CueEnter, cue); player.on(PlayerEvent.Error, error);
      let retired: RuntimeReport["retired"][number] | null = null;
      return {
        retire() {
          if (retired) return;
          player.off(PlayerEvent.SourceLoaded, sourceLoaded); player.off(PlayerEvent.CueEnter, cue); player.off(PlayerEvent.Error, error);
          retired = { generation: report.generation, releaseConfirmed: false };
          state.retired = [...state.retired, retired].slice(-32);
          if (current === owner) { current = null; state.owner = null; }
        },
        released() { if (retired) retired.releaseConfirmed = true; },
        cueVisibility(visible) { if (current === owner) report.cueVisible = visible; },
      };
    },
    sample() {
      if (!current) return;
      const { player, report, frames } = current;
      try {
        const tracks = player.subtitles.list();
        report.sample = { sequence: (report.sample?.sequence ?? 0) + 1, time: finite(player.getCurrentTime()), duration: finite(player.getDuration()),
          live: player.isLive(), playing: player.isPlaying(), muted: player.isMuted(), decodedFrames: finite(frames()),
          subtitleCount: tracks.length, externalSubtitleAvailable: tracks.some((track) => track.id === "player-lab-external"),
          externalSubtitleEnabled: tracks.some((track) => track.id === "player-lab-external" && track.enabled === true) };
      } catch { report.readFailures++; }
    },
    appState(app) { state.app = { dvrAllowed: app.dvrAllowed, logCount: app.logCount, sourceType: app.sourceType,
      startOffset: app.startOffset, autoplay: app.autoplay, startupMuted: app.startupMuted,
      videoForwardBuffer: finite(app.videoForwardBuffer ?? undefined), audioForwardBuffer: finite(app.audioForwardBuffer ?? undefined),
      maxVideoBitrate: finite(app.maxVideoBitrate ?? undefined), externalSubtitleConfigured: app.externalSubtitleConfigured }; },
    appliedCode(value) { if (value !== code) { code = value; state.codeGeneration++; } },
    setupError() { state.setupErrors++; },
    report() { return JSON.parse(JSON.stringify(state)) as RuntimeReport; },
  };
}
