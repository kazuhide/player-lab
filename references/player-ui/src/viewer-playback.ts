import type { AudioTrack, PlayerEvent, SubtitleTrack } from "bitmovin-player";
import type { ViewerPreferences, ViewerSection } from "./viewer-data.ts";

const EVENTS = ["seek", "seeked", "timechanged", "play", "playing", "paused", "ready", "sourceunloaded", "sourceloaded",
  "adbreakstarted", "adstarted", "adbreakfinished", "caststart", "caststarted", "caststopped", "error", "destroy",
  "audiochanged", "subtitleenabled", "subtitledisabled", "subtitleadded", "subtitleremoved"] as const satisfies readonly `${PlayerEvent}`[];
type EventName = typeof EVENTS[number];
type Event = { type: string; issuer?: string; seekTarget?: number };
type Audio = Pick<AudioTrack, "id" | "lang">;
type Subtitle = Pick<SubtitleTrack, "id" | "lang" | "enabled">;

/** The public SDK surface used here, kept free of a vendor runtime import for logic tests. */
export interface ViewerPlayerPort {
  getDuration(): number;
  getCurrentTime(): number;
  getPlaybackSpeed(): number;
  getSource(): object | null;
  isLive(): boolean;
  isCasting(): boolean;
  isPaused(): boolean;
  seek(seconds: number, issuer?: string): boolean;
  play(issuer?: string): Promise<void>;
  pause(issuer?: string): void;
  on(name: EventName, listener: (event: Event) => void): void;
  off(name: EventName, listener: (event: Event) => void): void;
  getAudio(): Audio | null;
  getAvailableAudio(): Audio[];
  setAudio(id: string): void;
  subtitles: { list(): Subtitle[]; enable(id: string, exclusive?: boolean): void; disable(id: string): void };
  ads: { isLinearAdActive(): boolean } | null;
}

type Availability = "available" | "unavailable" | "unknown";
export interface ViewerPlaybackState {
  available: boolean;
  mode: "full" | "highlights";
  activeClipId: string | null;
  status: "idle" | "seeking" | "playing" | "complete" | "cancelled" | "error" | "preferences-restored" | "preferences-undone";
  preferences: { audio: Availability; subtitles: Availability };
  canUndoPreferences: boolean;
}
interface TrackState { audioId: string | null; subtitleIds: string[] | null }
interface Undo extends TrackState { context: number; audio: boolean; subtitles: boolean }
const ISSUER = "player-lab-viewer-tools";
const POSITION_TOLERANCE_MS = 150;

export function createViewerPlayback(player: ViewerPlayerPort, options: {
  durationMs: number;
  isAvailable?: () => boolean;
  seekTimeoutMs?: number;
}) {
  let destroyed = false;
  let enabled = true;
  let sourceReady = true;
  let adActive = false;
  let castActive = false;
  let generation = 0;
  let context = 0;
  let mode: ViewerPlaybackState["mode"] = "full";
  let status: ViewerPlaybackState["status"] = "idle";
  let queue: ViewerSection[] = [];
  let clipIndex = -1;
  let moving = false;
  let wantsPlayback = false;
  let offered: ViewerPreferences | null = null;
  let undo: Undo | null = null;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSeek: { target: number; seeked: boolean; finish: (success: boolean) => void } | undefined;
  let pendingPlay: { cancel: () => void; pauseLate: boolean } | undefined;
  const subscribers = new Set<(state: ViewerPlaybackState) => void>();
  const bindings: [EventName, (event: Event) => void][] = [];
  let lastNotice = "";

  function available(): boolean {
    try {
      return !destroyed && enabled && sourceReady && !adActive && !castActive && (options.isAvailable?.() ?? true) &&
        Number.isSafeInteger(options.durationMs) && options.durationMs > 0 && player.getSource() !== null &&
        Number.isFinite(player.getDuration()) && Math.abs(player.getDuration() * 1_000 - options.durationMs) <= 1_000 &&
        !player.isLive() && !player.isCasting() && !(player.ads?.isLinearAdActive() ?? false);
    } catch { return false; }
  }
  function currentTracks(): TrackState {
    const tracks = player.subtitles.list();
    return { audioId: player.getAudio()?.id ?? null,
      subtitleIds: tracks.every(track => typeof track.enabled === "boolean") ? tracks.filter(track => track.enabled).map(track => track.id) : null };
  }
  function preferenceAvailability(): ViewerPlaybackState["preferences"] {
    if (!offered || destroyed) return { audio: "unknown", subtitles: "unknown" };
    try {
      const audio = player.getAvailableAudio();
      const subtitles = player.subtitles.list();
      const actual = currentTracks();
      return {
        audio: offered.audioLanguage === null ? "unknown" : !audio.some(track => track.lang === offered!.audioLanguage) ? "unavailable" : actual.audioId === null ? "unknown" : "available",
        subtitles: offered.subtitleEnabled === null || (offered.subtitleEnabled && offered.subtitleLanguage === null) ? "unknown" :
          offered.subtitleEnabled && !subtitles.some(track => track.lang === offered!.subtitleLanguage) ? "unavailable" : actual.subtitleIds === null ? "unknown" : "available",
      };
    } catch { return { audio: "unknown", subtitles: "unknown" }; }
  }
  function canUndo(): boolean {
    try {
      return available() && undo !== null && undo.context === context &&
        (!undo.audio || player.getAvailableAudio().some(track => track.id === undo!.audioId)) &&
        (!undo.subtitles || undo.subtitleIds!.every(id => player.subtitles.list().some(track => track.id === id)));
    } catch { return false; }
  }
  function state(): ViewerPlaybackState {
    return { available: available(), mode, activeClipId: queue[clipIndex]?.id ?? null, status,
      preferences: preferenceAvailability(), canUndoPreferences: canUndo() };
  }
  function notify(): void {
    const next = state();
    const key = JSON.stringify(next);
    if (key === lastNotice) return;
    lastNotice = key;
    for (const listener of [...subscribers]) listener(next);
  }
  function clearBoundary(): void { clearTimeout(boundaryTimer); boundaryTimer = undefined; }
  function pause(): void { wantsPlayback = false; try { player.pause(ISSUER); } catch { /* An unloaded/destroyed SDK cannot be paused. */ } }
  function cancel(next: ViewerPlaybackState["status"], pausePending = true): void {
    generation++;
    clearBoundary();
    pendingSeek?.finish(false);
    if (pendingPlay) {
      const attempt = pendingPlay;
      attempt.pauseLate = pausePending;
      wantsPlayback = false;
      attempt.cancel();
      if (pausePending && !destroyed) pause();
    }
    queue = []; clipIndex = -1; mode = "full"; moving = false; status = next;
  }
  const current = (token: number) => token === generation && available();
  function checkSeek(): void {
    if (pendingSeek?.seeked && Math.abs(player.getCurrentTime() * 1_000 - pendingSeek.target) <= POSITION_TOLERANCE_MS) pendingSeek.finish(true);
  }
  function seekTo(target: number, token: number): Promise<boolean> {
    if (!current(token)) return Promise.resolve(false);
    if (Math.abs(player.getCurrentTime() * 1_000 - target) <= 25) return Promise.resolve(true);
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => finish(false), options.seekTimeoutMs ?? 5_000);
      const request = { target, seeked: false, finish };
      function finish(success: boolean): void {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (pendingSeek === request) pendingSeek = undefined;
        resolve(success && current(token));
      }
      pendingSeek = request;
      try { if (!player.seek(target / 1_000, ISSUER)) finish(false); }
      catch { finish(false); }
    });
  }
  function play(token: number): Promise<boolean> {
    if (!current(token)) return Promise.resolve(false);
    wantsPlayback = true;
    return new Promise(resolve => {
      let settled = false;
      const attempt = { cancel: () => finish(false), pauseLate: false };
      function finish(success: boolean): void {
        if (settled) return;
        settled = true;
        if (pendingPlay === attempt) pendingPlay = undefined;
        resolve(success);
      }
      pendingPlay = attempt;
      try {
        void player.play(ISSUER).then(() => {
          if (!current(token)) {
            if (!destroyed && attempt.pauseLate && !wantsPlayback) pause();
            finish(false);
          } else finish(true);
        }, () => { if (token === generation) wantsPlayback = false; finish(false); });
      } catch { if (token === generation) wantsPlayback = false; finish(false); }
    });
  }
  function armBoundary(): void {
    clearBoundary();
    if (mode !== "highlights" || moving || !current(generation) || player.isPaused()) return;
    const remaining = queue[clipIndex].endMs - player.getCurrentTime() * 1_000;
    if (remaining <= 0) { atBoundary(); return; }
    const speed = player.getPlaybackSpeed();
    boundaryTimer = setTimeout(atBoundary, Math.max(20, remaining / (Number.isFinite(speed) && speed > 0 ? speed : 1)));
    boundaryTimer.unref?.();
  }
  async function move(index: number, token: number): Promise<boolean> {
    if (!current(token)) return false;
    moving = true; clearBoundary(); clipIndex = index; status = "seeking"; pause(); notify();
    const reached = await seekTo(queue[index].startMs, token);
    if (!reached || !current(token)) {
      if (token === generation) { cancel("error"); notify(); }
      return false;
    }
    const started = await play(token);
    if (!started || !current(token)) {
      if (token === generation) { cancel("error"); pause(); notify(); }
      return false;
    }
    moving = false; status = "playing"; notify(); armBoundary();
    return true;
  }
  function atBoundary(): void {
    if (mode !== "highlights" || moving || !current(generation)) return;
    if (player.getCurrentTime() * 1_000 < queue[clipIndex].endMs) { armBoundary(); return; }
    pause();
    if (clipIndex + 1 < queue.length) void move(clipIndex + 1, generation);
    else { cancel("complete"); notify(); }
  }
  function applyTracks(previous: TrackState, audio: boolean, subtitles: boolean): void {
    if (audio) player.setAudio(previous.audioId!);
    if (subtitles) {
      for (const track of player.subtitles.list()) player.subtitles.disable(track.id);
      for (const id of previous.subtitleIds!) player.subtitles.enable(id, false);
    }
  }
  function offerPreferences(preferences: ViewerPreferences | null): void {
    if (destroyed || offered === preferences || (offered !== null && preferences !== null &&
      offered.audioLanguage === preferences.audioLanguage && offered.subtitleEnabled === preferences.subtitleEnabled && offered.subtitleLanguage === preferences.subtitleLanguage)) return;
    offered = preferences ? { ...preferences } : null;
    context++; undo = null; notify();
  }
  function restorePreferences(preferences: ViewerPreferences): boolean {
    if (!available()) return false;
    offerPreferences(preferences);
    const eligible = preferenceAvailability();
    const audio = eligible.audio === "available";
    const subtitles = eligible.subtitles === "available";
    if (!audio && !subtitles) return false;
    const previous = { ...currentTracks(), context, audio, subtitles };
    const before = context;
    try {
      if (audio) player.setAudio(player.getAvailableAudio().find(track => track.lang === preferences.audioLanguage)!.id);
      if (subtitles) {
        if (preferences.subtitleEnabled) player.subtitles.enable(player.subtitles.list().find(track => track.lang === preferences.subtitleLanguage)!.id);
        else for (const track of player.subtitles.list()) player.subtitles.disable(track.id);
      }
      if (before !== context || !available()) return false;
      undo = previous; status = "preferences-restored"; notify(); return true;
    } catch {
      try { applyTracks(previous, audio, subtitles); } catch { /* Keep the original snapshot available for explicit undo. */ }
      if (before === context) undo = previous;
      status = "error"; notify(); return false;
    }
  }
  function undoPreferences(): boolean {
    if (!canUndo()) return false;
    const previous = undo!;
    try { applyTracks(previous, previous.audio, previous.subtitles); }
    catch { status = "error"; notify(); return false; }
    undo = null; status = "preferences-undone"; notify(); return true;
  }
  function bind(name: EventName, listener: (event: Event) => void): void { bindings.push([name, listener]); player.on(name, listener); }
  bind("seek", event => { if (event.issuer !== ISSUER) { cancel("cancelled"); notify(); } });
  bind("seeked", () => { if (pendingSeek) { pendingSeek.seeked = true; checkSeek(); } });
  bind("timechanged", () => { checkSeek(); atBoundary(); });
  bind("play", event => { if (event.issuer !== ISSUER) wantsPlayback = true; });
  bind("playing", () => { armBoundary(); notify(); });
  bind("paused", event => { if (event.issuer !== ISSUER) wantsPlayback = false; clearBoundary(); });
  for (const name of ["sourceunloaded", "sourceloaded", "error"] as const) bind(name, () => {
    sourceReady = false; context++; undo = null; cancel("cancelled", false); notify();
  });
  bind("ready", () => { sourceReady = true; notify(); });
  for (const name of ["adbreakstarted", "adstarted"] as const) bind(name, () => { adActive = true; cancel("cancelled", false); notify(); });
  bind("adbreakfinished", () => { adActive = false; notify(); });
  for (const name of ["caststart", "caststarted"] as const) bind(name, () => { castActive = true; cancel("cancelled", false); notify(); });
  bind("caststopped", () => { castActive = false; notify(); });
  for (const name of ["audiochanged", "subtitleenabled", "subtitledisabled", "subtitleadded", "subtitleremoved"] as const) bind(name, notify);

  function destroy(): void {
    if (destroyed) return;
    destroyed = true; cancel("cancelled", false); undo = null; offered = null;
    for (const [name, listener] of bindings) player.off(name, listener);
    subscribers.clear();
  }
  bind("destroy", destroy);
  return {
    get state() { return state(); },
    get canUndoPreferences() { return canUndo(); },
    async startHighlights(items: readonly ViewerSection[]): Promise<boolean> {
      cancel("idle");
      if (!available() || !items.length || items.length > 1_000 || items.some((item, index) =>
        !item.id || items.findIndex(other => other.id === item.id) !== index || !Number.isSafeInteger(item.startMs) || !Number.isSafeInteger(item.endMs) ||
        item.startMs < 0 || item.endMs <= item.startMs || item.endMs > options.durationMs || (index > 0 && item.startMs < items[index - 1].endMs))) {
        status = "error"; notify(); return false;
      }
      queue = items.map(item => ({ ...item })); mode = "highlights";
      return move(0, generation);
    },
    stopHighlights() { if (mode === "highlights" || pendingSeek || pendingPlay) { cancel("cancelled"); notify(); } },
    async playFrom(milliseconds: number): Promise<boolean> {
      cancel("idle");
      if (!available() || !Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds >= options.durationMs) { status = "error"; notify(); return false; }
      const token = generation;
      status = "seeking"; notify();
      const reached = await seekTo(Math.min(milliseconds, player.getDuration() * 1_000 - 100), token);
      const started = reached && current(token) && await play(token);
      if (!current(token)) return false;
      status = started ? "playing" : "error"; notify(); return started;
    },
    offerPreferences, restorePreferences, undoPreferences,
    setEnabled(next: boolean) { if (destroyed || next === enabled) return; enabled = next; if (!next) { cancel("cancelled"); context++; undo = null; } notify(); },
    reset() { if (destroyed) return; cancel("idle"); context++; undo = null; offered = null; notify(); },
    subscribe(listener: (state: ViewerPlaybackState) => void) {
      if (destroyed) return () => {};
      subscribers.add(listener); listener(state());
      return () => { subscribers.delete(listener); };
    },
    destroy,
  };
}

export type ViewerPlayback = ReturnType<typeof createViewerPlayback>;
