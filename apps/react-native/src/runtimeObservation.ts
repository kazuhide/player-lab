import type { Player, SubtitleTrack } from "bitmovin-player-react-native";

/** Read-only public SDK boundary used only by the opt-in runtime entry. */
export type RuntimeReadablePlayer = Pick<Player,
  "isDestroyed" | "getCurrentTime" | "getDuration" | "isLive" | "isPlaying" | "isMuted" |
  "getAvailableSubtitles" | "getSubtitleTrack">;

export interface RuntimeAppState {
  ui: "Default" | "Sports" | "Live (DVR)" | "Cinema";
  revision: number;
  dvrAllowed: boolean;
  logCount: number;
  sourceType: "hls" | "dash" | "progressive";
  startOffset: number | null;
  autoplay: boolean;
  startupMuted: boolean;
  forwardBuffer: number | null;
  maxBitrate: number | null;
  externalSubtitleConfigured: boolean;
}

interface RuntimeSample {
  sequence: number;
  time: number | null;
  duration: number | null;
  live: boolean;
  playing: boolean;
  muted: boolean;
  subtitleCount: number;
  externalSubtitleAvailable: boolean;
  externalSubtitleSelected: boolean;
}

interface OwnerReport {
  generation: number;
  viewReady: boolean;
  sourceLoads: number;
  sourceLoaded: number;
  timeChanged: number;
  cueEnter: number;
  errors: number;
  readFailures: number;
  errorCodes: number[];
  sample: RuntimeSample | null;
}

export interface RuntimeReport {
  protocol: 1;
  created: number;
  retired: Array<{ generation: number; wrapperDestroyed: boolean }>;
  owner: OwnerReport | null;
  app: RuntimeAppState | null;
  lifecycle: "active" | "background" | "inactive" | "unknown";
  code: { generation: number; clipboardMatches: boolean | null; readFailed: boolean };
  batch: { id: number; generation: number; samples: RuntimeSample[] } | null;
}

export interface RuntimeOwner {
  viewReady(): void;
  sourceLoad(): void;
  event(kind: "sourceLoaded" | "timeChanged" | "cueEnter" | "error", code?: number): void;
  /** Call after the normal owner's destroy path. This flag is not a native completion acknowledgement. */
  retire(): void;
}

export interface RuntimeMonitor {
  attach(player: RuntimeReadablePlayer): RuntimeOwner;
  appState(state: RuntimeAppState): void;
  lifecycle(state: RuntimeReport["lifecycle"]): void;
  appliedCode(code: string): void;
  checkClipboard(read: () => Promise<string>): Promise<void>;
  sample(): Promise<void>;
  sampleBatch(): Promise<void>;
  report(): RuntimeReport;
}

const finite = (value: number): number | null => Number.isFinite(value) ? value : null;
const external = (track: Pick<SubtitleTrack, "identifier"> | null) => track?.identifier === "player-lab-external";

/** No source, configuration, event payload, native ID, key or SDK message is serialized. */
export function createRuntimeMonitor(changed: () => void = () => {}): RuntimeMonitor {
  const state: RuntimeReport = { protocol: 1, created: 0, retired: [], owner: null, app: null, lifecycle: "unknown",
    code: { generation: 0, clipboardMatches: null, readFailed: false }, batch: null };
  let current: { player: RuntimeReadablePlayer; report: OwnerReport; pending: Promise<void> | null } | null = null;
  let appliedCode: string | null = null;
  let generation = 0;
  let batchPending = false;
  let batchId = 0;

  const monitor: RuntimeMonitor = {
    attach(player) {
      const report: OwnerReport = { generation: ++state.created, viewReady: false, sourceLoads: 0,
        sourceLoaded: 0, timeChanged: 0, cueEnter: 0, errors: 0, readFailures: 0, errorCodes: [], sample: null };
      const owner = { player, report, pending: null as Promise<void> | null };
      generation++; state.batch = null;
      current = owner;
      state.owner = report;
      changed();
      const active = () => current === owner;
      return {
        viewReady() { if (active()) { report.viewReady = true; changed(); } },
        sourceLoad() {
          if (active()) {
            report.sourceLoads++; report.sourceLoaded = 0; report.sample = null;
            generation++; state.batch = null; changed();
          }
        },
        event(kind, code) {
          if (!active()) return;
          if (kind === "error") {
            report.errors++;
            if (Number.isSafeInteger(code) && code! >= 0 && code! <= 1000000000) {
              report.errorCodes = [...report.errorCodes, code!].slice(-8);
            }
          } else report[kind]++;
          changed();
        },
        retire() {
          // Retiring twice or receiving old callbacks cannot retire the replacement owner.
          if (!active()) return;
          current = null;
          state.owner = null;
          generation++; state.batch = null;
          state.retired = [...state.retired, { generation: report.generation, wrapperDestroyed: player.isDestroyed }].slice(-32);
          changed();
        },
      };
    },
    appState(app) {
      // Copy each declared scalar rather than retaining an object that could carry credentials.
      state.app = { ui: app.ui, revision: app.revision, dvrAllowed: app.dvrAllowed, logCount: app.logCount,
        sourceType: app.sourceType, startOffset: app.startOffset, autoplay: app.autoplay,
        startupMuted: app.startupMuted, forwardBuffer: app.forwardBuffer, maxBitrate: app.maxBitrate,
        externalSubtitleConfigured: app.externalSubtitleConfigured };
      changed();
    },
    lifecycle(value) {
      state.lifecycle = value;
      if (value !== "active") { generation++; state.batch = null; }
      changed();
    },
    appliedCode(code) {
      if (code === appliedCode) return;
      appliedCode = code;
      state.code = { generation: state.code.generation + 1, clipboardMatches: null, readFailed: false };
      changed();
    },
    async checkClipboard(read) {
      const expected = appliedCode;
      const generation = state.code.generation;
      if (expected === null) return;
      try {
        const actual = await read();
        if (generation !== state.code.generation) return;
        state.code.clipboardMatches = actual === expected;
      } catch {
        if (generation !== state.code.generation) return;
        state.code.readFailed = true;
      }
      changed();
    },
    async sample() {
      const owner = current;
      if (!owner || !owner.report.viewReady) return;
      if (owner.pending) return owner.pending;
      const sourceLoads = owner.report.sourceLoads;
      const pending = (async () => {
        try {
          const p = owner.player;
          const [time, duration, live, playing, muted, tracks, selected] = await Promise.all([
            p.getCurrentTime(), p.getDuration(), p.isLive(), p.isPlaying(), p.isMuted(),
            p.getAvailableSubtitles(), p.getSubtitleTrack(),
          ]);
          if (current !== owner || sourceLoads !== owner.report.sourceLoads) return;
          owner.report.sample = { sequence: (owner.report.sample?.sequence ?? 0) + 1,
            time: finite(time), duration: finite(duration), live, playing, muted, subtitleCount: tracks.length,
            externalSubtitleAvailable: tracks.some(external), externalSubtitleSelected: external(selected) };
          changed();
        } catch {
          if (current === owner && sourceLoads === owner.report.sourceLoads) { owner.report.readFailures++; changed(); }
        }
      })();
      owner.pending = pending;
      await pending;
      if (owner.pending === pending) owner.pending = null;
    },
    async sampleBatch() {
      const owner = current;
      if (!owner || !owner.report.viewReady || batchPending) return;
      batchPending = true;
      const token = generation;
      const id = ++batchId;
      const samples: RuntimeSample[] = [];
      let sequence = owner.report.sample?.sequence ?? 0;
      state.batch = null;
      try {
        for (let index = 0; index < 5; index++) {
          await monitor.sample();
          if (current !== owner || token !== generation || !owner.report.sample || owner.report.sample.sequence <= sequence) return;
          sequence = owner.report.sample.sequence;
          samples.push({ ...owner.report.sample });
          if (index < 4) await new Promise<void>((resolve) => setTimeout(resolve, 800));
        }
        if (current === owner && token === generation) {
          state.batch = { id, generation: owner.report.generation, samples }; changed();
        }
      } finally { batchPending = false; }
    },
    report() {
      // Callers cannot mutate the owner's counters through the report.
      return JSON.parse(JSON.stringify(state)) as RuntimeReport;
    },
  };
  return monitor;
}
