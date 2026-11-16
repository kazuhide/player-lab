import assert from "node:assert/strict";
import test from "node:test";
import { createViewerPlayback, type ViewerPlayerPort } from "../src/viewer-playback.ts";
import type { ViewerPreferences, ViewerSection } from "../src/viewer-data.ts";

const clips: ViewerSection[] = [
  { id: "first", title: { en: "First", ja: "First" }, startMs: 10_000, endMs: 12_000 },
  { id: "second", title: { en: "Second", ja: "Second" }, startMs: 20_000, endMs: 23_000 },
];
const preferences: ViewerPreferences = { audioLanguage: "ja", subtitleEnabled: true, subtitleLanguage: "ja" };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakePlayer implements ViewerPlayerPort {
  time = 0;
  duration = 60;
  live = false;
  casting = false;
  ad = false;
  paused = true;
  source: object | null = {};
  autoSeek = true;
  acceptSeek = true;
  playGate: ReturnType<typeof deferred> | null = null;
  plays = 0;
  seekTargets: number[] = [];
  audioTracks = [{ id: "en-audio", lang: "en" }, { id: "ja-audio", lang: "ja" }];
  audioId: string | null = "en-audio";
  subtitleTracks: { id: string; lang: string; enabled?: boolean }[] = [
    { id: "en-sub", lang: "en", enabled: true }, { id: "ja-sub", lang: "ja", enabled: false },
  ];
  listeners = new Map<string, Set<(event: { type: string; issuer?: string; seekTarget?: number }) => void>>();
  ads = { isLinearAdActive: () => this.ad };
  subtitles = {
    list: () => this.subtitleTracks.map(track => ({ ...track })),
    enable: (id: string, exclusive = true) => {
      if (!this.subtitleTracks.some(track => track.id === id)) throw new Error("unknown subtitle");
      for (const track of this.subtitleTracks) if (track.id === id || exclusive) track.enabled = track.id === id;
      this.emit("subtitleenabled");
    },
    disable: (id: string) => {
      const track = this.subtitleTracks.find(track => track.id === id);
      if (!track) throw new Error("unknown subtitle");
      track.enabled = false;
      this.emit("subtitledisabled");
    },
  };
  getDuration = () => this.duration;
  getCurrentTime = () => this.time;
  getPlaybackSpeed = () => 1;
  isLive = () => this.live;
  isCasting = () => this.casting;
  isPaused = () => this.paused;
  getSource = () => this.source;
  getAvailableAudio = () => this.audioTracks;
  getAudio = () => this.audioTracks.find(track => track.id === this.audioId) ?? null;
  setAudio = (id: string) => {
    if (!this.audioTracks.some(track => track.id === id)) throw new Error("unknown audio");
    this.audioId = id;
    this.emit("audiochanged");
  };
  on(name: string, listener: (event: { type: string; issuer?: string; seekTarget?: number }) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
  }
  off(name: string, listener: (event: { type: string; issuer?: string; seekTarget?: number }) => void) {
    this.listeners.get(name)?.delete(listener);
  }
  emit(type: string, values: { issuer?: string; seekTarget?: number } = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, ...values });
  }
  seek(time: number, issuer?: string) {
    this.seekTargets.push(time);
    if (!this.acceptSeek) return false;
    this.emit("seek", { issuer, seekTarget: time });
    if (this.autoSeek) { this.time = time; this.emit("seeked"); }
    return true;
  }
  async play(issuer?: string) {
    this.plays++;
    this.emit("play", { issuer });
    if (this.playGate) await this.playGate.promise;
    this.paused = false;
    this.emit("playing", { issuer });
  }
  pause(issuer?: string) { this.paused = true; this.emit("paused", { issuer }); }
  advance(time: number) { this.time = time; this.emit("timechanged"); }
}

function setup(t: { after: (callback: () => void) => void }) {
  const player = new FakePlayer();
  const viewer = createViewerPlayback(player, { durationMs: 60_000, seekTimeoutMs: 30 });
  t.after(() => viewer.destroy());
  return { player, viewer };
}

test("highlights seek between approved clips on one Player and pause at the final boundary", async t => {
  const { player, viewer } = setup(t);
  assert.equal(await viewer.startHighlights(clips), true);
  assert.equal(viewer.state.mode, "highlights");
  assert.equal(viewer.state.activeClipId, "first");
  assert.equal(player.time, 10);
  player.advance(12);
  await flush();
  assert.equal(player.time, 20);
  assert.equal(viewer.state.activeClipId, "second");
  player.advance(23);
  assert.equal(player.paused, true);
  assert.equal(viewer.state.mode, "full");
  assert.equal(viewer.state.status, "complete");
  assert.deepEqual(player.seekTargets, [10, 20]);
});

test("a same-position no-op seek does not wait for an event the SDK need not emit", async t => {
  const { player, viewer } = setup(t);
  player.time = 10;
  player.acceptSeek = false;
  assert.equal(await viewer.startHighlights(clips), true);
  assert.deepEqual(player.seekTargets, []);
  assert.equal(player.paused, false);
});

test("seeked alone is insufficient until the requested position is reached", async t => {
  const { player, viewer } = setup(t);
  player.autoSeek = false;
  const started = viewer.startHighlights(clips);
  player.emit("seeked");
  await flush();
  assert.equal(player.plays, 0);
  player.advance(10);
  assert.equal(await started, true);
});

test("stopping while a seek is pending resolves cancellation and never starts late playback", async t => {
  const { player, viewer } = setup(t);
  player.autoSeek = false;
  const started = viewer.startHighlights(clips);
  viewer.stopHighlights();
  assert.equal(await started, false);
  player.advance(10);
  player.emit("seeked");
  await flush();
  assert.equal(player.plays, 0);
  assert.equal(viewer.state.mode, "full");
});

test("an external pause takes precedence over pending history and highlights seeks", async t => {
  for (const action of ["history", "highlights"] as const) {
    const { player, viewer } = setup(t);
    player.paused = false;
    player.autoSeek = false;
    const started = action === "history" ? viewer.playFrom(31_000) : viewer.startHighlights(clips);
    player.pause("ui");
    player.advance(player.seekTargets.at(-1)!);
    player.emit("seeked");
    assert.equal(await started, false, action);
    await flush();
    assert.equal(player.plays, 0, action);
    assert.equal(player.paused, true, action);
    assert.equal(viewer.state.mode, "full", action);
    assert.equal(viewer.state.status, "cancelled", action);
  }
});

test("an external pause cancels delayed play without overriding a later manual play", async t => {
  for (const manualPlay of [false, true]) {
    const { player, viewer } = setup(t);
    const delayed = deferred();
    player.playGate = delayed;
    const started = viewer.playFrom(31_000);
    await flush();
    player.pause("ui");
    if (manualPlay) { player.playGate = null; await player.play("ui"); }
    delayed.resolve();
    assert.equal(await started, false);
    await flush();
    assert.equal(player.paused, !manualPlay);
    assert.equal(viewer.state.mode, "full");
    assert.equal(viewer.state.status, "cancelled");
  }
});

test("an uncompleted seek times out and late seek events cannot start playback", async t => {
  const { player, viewer } = setup(t);
  player.autoSeek = false;
  assert.equal(await viewer.startHighlights(clips), false);
  assert.equal(viewer.state.status, "error");
  player.advance(10); player.emit("seeked");
  await flush();
  assert.equal(player.plays, 0);
});

test("stopping pending play resolves promptly and a late play completion cannot resume recap", async t => {
  const { player, viewer } = setup(t);
  player.playGate = deferred();
  const started = viewer.startHighlights(clips);
  await flush();
  viewer.stopHighlights();
  assert.equal(await started, false);
  player.playGate.resolve();
  await flush();
  assert.equal(player.paused, true);
  assert.equal(viewer.state.mode, "full");
});

test("manual seeking exits highlights and stop returns to full playback at the current position", async t => {
  const { player, viewer } = setup(t);
  await viewer.startHighlights(clips);
  player.seek(35, "ui");
  assert.equal(viewer.state.mode, "full");
  assert.equal(player.time, 35);
  const before = player.seekTargets.length;
  viewer.stopHighlights();
  player.advance(40);
  assert.equal(player.seekTargets.length, before);
  assert.equal(player.paused, false);
});

test("newest navigation wins over a canceled highlights seek", async t => {
  const { player, viewer } = setup(t);
  player.autoSeek = false;
  const old = viewer.startHighlights(clips);
  player.autoSeek = true;
  assert.equal(await viewer.playFrom(31_000), true);
  assert.equal(await old, false);
  player.emit("seeked");
  await flush();
  assert.equal(player.time, 31);
  assert.equal(viewer.state.mode, "full");
  assert.equal(player.plays, 1);
});

test("late canceled play completion does not pause a newer successful navigation", async t => {
  const { player, viewer } = setup(t);
  const oldPlay = deferred(); player.playGate = oldPlay;
  const old = viewer.startHighlights(clips);
  await flush();
  player.playGate = null;
  assert.equal(await viewer.playFrom(31_000), true);
  assert.equal(await old, false);
  oldPlay.resolve(); await flush();
  assert.equal(player.time, 31);
  assert.equal(player.paused, false);
});

test("an older delayed play cannot resume after a newer recap has finished", async t => {
  const { player, viewer } = setup(t);
  const oldPlay = deferred(); player.playGate = oldPlay;
  const old = viewer.startHighlights(clips);
  await flush(); player.playGate = null;
  assert.equal(await viewer.startHighlights(clips), true);
  assert.equal(await old, false);
  player.advance(12); await flush(); player.advance(23);
  assert.equal(viewer.state.status, "complete");
  oldPlay.resolve(); await flush();
  assert.equal(player.paused, true);
});

test("source, ad, cast, error and destruction cancel pending recap operations", async t => {
  for (const event of ["sourceunloaded", "sourceloaded", "adbreakstarted", "caststart", "error", "destroy"]) {
    const { player, viewer } = setup(t);
    player.autoSeek = false;
    const started = viewer.startHighlights(clips);
    player.emit(event);
    assert.equal(await started, false, event);
    player.advance(10); player.emit("seeked");
    await flush();
    assert.equal(player.plays, 0, event);
  }
});

test("only matching available finite VOD and valid non-overlapping clips can be operated", async t => {
  for (const change of [
    (player: FakePlayer) => { player.duration = Infinity; },
    (player: FakePlayer) => { player.duration = 30; },
    (player: FakePlayer) => { player.live = true; },
    (player: FakePlayer) => { player.casting = true; },
    (player: FakePlayer) => { player.ad = true; },
    (player: FakePlayer) => { player.source = null; },
  ]) {
    const { player, viewer } = setup(t); change(player);
    assert.equal(await viewer.startHighlights(clips), false);
    assert.equal(await viewer.playFrom(10_000), false);
    assert.deepEqual(player.seekTargets, []);
  }
  const { player, viewer } = setup(t);
  viewer.setEnabled(false);
  assert.equal(await viewer.startHighlights(clips), false);
  viewer.setEnabled(true);
  for (const bad of [[], [{ ...clips[0], endMs: 60_001 }], [clips[1], clips[0]], [clips[0], { ...clips[1], startMs: 11_000 }]]) {
    assert.equal(await viewer.startHighlights(bad), false);
  }
  assert.equal(await viewer.playFrom(Number.NaN), false);
  assert.deepEqual(player.seekTargets, []);
});

test("a source with no optional advertising API still supports ordinary viewer actions", async t => {
  const { player, viewer } = setup(t);
  Object.assign(player, { ads: null });
  assert.equal(viewer.state.available, true);
  assert.equal(await viewer.startHighlights(clips), true);
  assert.equal(await viewer.playFrom(31_000), true);
});

test("rejected seek and play fail safely without automatically loading another source", async t => {
  const { player, viewer } = setup(t);
  player.acceptSeek = false;
  assert.equal(await viewer.startHighlights(clips), false);
  assert.equal(viewer.state.status, "error");
  player.acceptSeek = true;
  player.playGate = deferred(); player.playGate.reject(new Error("autoplay blocked"));
  assert.equal(await viewer.startHighlights(clips), false);
  assert.equal(viewer.state.mode, "full");
});

test("language restoration uses exact available tracks and undo restores actual current selections", t => {
  const { player, viewer } = setup(t);
  player.subtitleTracks[1].enabled = true;
  viewer.offerPreferences(preferences);
  assert.deepEqual(viewer.state.preferences, { audio: "available", subtitles: "available" });
  assert.equal(viewer.restorePreferences(preferences), true);
  assert.equal(player.audioId, "ja-audio");
  assert.deepEqual(player.subtitleTracks.filter(track => track.enabled).map(track => track.id), ["ja-sub"]);
  assert.equal(viewer.canUndoPreferences, true);
  assert.equal(viewer.undoPreferences(), true);
  assert.equal(player.audioId, "en-audio");
  assert.deepEqual(player.subtitleTracks.filter(track => track.enabled).map(track => track.id), ["en-sub", "ja-sub"]);
  assert.equal(viewer.canUndoPreferences, false);
});

test("missing preference information is distinct from recorded subtitle off and unavailable languages", t => {
  const { player, viewer } = setup(t);
  const unknown = { audioLanguage: null, subtitleEnabled: null, subtitleLanguage: null };
  viewer.offerPreferences(unknown);
  assert.deepEqual(viewer.state.preferences, { audio: "unknown", subtitles: "unknown" });
  assert.equal(viewer.restorePreferences(unknown), false);
  const unavailable = { audioLanguage: "fr", subtitleEnabled: true, subtitleLanguage: "en-US" };
  viewer.offerPreferences(unavailable);
  assert.deepEqual(viewer.state.preferences, { audio: "unavailable", subtitles: "unavailable" });
  assert.equal(viewer.restorePreferences(unavailable), false);
  assert.equal(player.audioId, "en-audio");
  const off = { audioLanguage: null, subtitleEnabled: false, subtitleLanguage: null };
  assert.equal(viewer.restorePreferences(off), true);
  assert.ok(player.subtitleTracks.every(track => track.enabled === false));
  assert.equal(viewer.undoPreferences(), true);
  assert.equal(player.subtitleTracks[0].enabled, true);
});

test("unknown actual track state is never replaced by an invented off state for undo", t => {
  const { player, viewer } = setup(t);
  player.audioId = null;
  player.subtitleTracks.forEach(track => { delete track.enabled; });
  viewer.offerPreferences(preferences);
  assert.deepEqual(viewer.state.preferences, { audio: "unknown", subtitles: "unknown" });
  assert.equal(viewer.restorePreferences(preferences), false);
  assert.equal(viewer.canUndoPreferences, false);
  assert.equal(player.audioId, null);
  assert.ok(player.subtitleTracks.every(track => track.enabled === undefined));
});

test("equal offers and enabled flags are idempotent; source, example and eligibility changes invalidate undo", t => {
  const { player, viewer } = setup(t);
  let notices = 0;
  viewer.subscribe(() => { notices++; });
  viewer.offerPreferences(preferences);
  viewer.restorePreferences(preferences);
  const before = notices;
  viewer.offerPreferences({ ...preferences }); viewer.setEnabled(true);
  viewer.offerPreferences({ subtitleLanguage: preferences.subtitleLanguage, subtitleEnabled: preferences.subtitleEnabled, audioLanguage: preferences.audioLanguage });
  assert.equal(notices, before);
  assert.equal(viewer.canUndoPreferences, true);
  viewer.offerPreferences({ ...preferences, subtitleEnabled: false });
  assert.equal(viewer.canUndoPreferences, false);
  viewer.restorePreferences(preferences); player.emit("sourceunloaded");
  assert.equal(viewer.undoPreferences(), false);
  viewer.restorePreferences(preferences); viewer.reset();
  assert.equal(viewer.undoPreferences(), false);
  viewer.restorePreferences(preferences); viewer.setEnabled(false);
  assert.equal(viewer.undoPreferences(), false);
});

test("destroy removes owned event listeners and subscriptions cannot outlive the controller", t => {
  const { player, viewer } = setup(t);
  let notices = 0;
  const unsubscribe = viewer.subscribe(() => { notices++; });
  unsubscribe();
  viewer.destroy();
  assert.ok([...player.listeners.values()].every(listeners => listeners.size === 0));
  const before = notices;
  player.emit("timechanged"); player.emit("sourceloaded");
  assert.equal(notices, before);
  assert.equal(viewer.state.available, false);
});
