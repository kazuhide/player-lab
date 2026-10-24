import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  players: [] as Array<{ config: object; load: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; listeners: Map<string, Set<() => void>> }>,
  videos: [] as Array<{ deinitializeSync: ReturnType<typeof vi.fn> }>,
  initialization: null as Promise<void> | null,
  destruction: null as Promise<void> | null,
  appState: "active",
  appStateListeners: new Set<(state: string) => void>(),
}));
vi.mock("react-native", () => ({
  Button: "Button", Pressable: "Pressable", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: <T,>(styles: T) => styles },
  NativeModules: {},
  Platform: { OS: "android", Version: 36 },
  AppState: {
    get currentState() { return runtime.appState; },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      runtime.appStateListeners.add(callback);
      return { remove: () => runtime.appStateListeners.delete(callback) };
    },
  },
}));
// The Vega core installs browser shims when imported. Mock that native boundary, while
// retaining the real application controller/session and the SDK's declared event names.
vi.mock("bitmovin-player/modules/bitmovinplayer-core", async () => {
  const { default: schema } = await import("../src/api/schema.json");
  return {
    PlayerEvent: Object.fromEntries(schema.rows.filter((row) => row.category === "event").map((row) => [row.name, row.value])),
    TimelineReferencePoint: { Start: "start", End: "end" },
    NetworkRequestApi: { Fetch: "fetch", XHR: "xhr" },
  };
});

vi.mock("@amazon-devices/react-native-w3cmedia", () => ({
  KeplerVideoSurfaceView: "KeplerVideoSurfaceView",
  MediaSource: class NativeMediaSource {},
  HTMLMediaElement: class NativeHTMLMediaElement {},
  WebCrypto: { subtle: {} },
  VideoPlayer: class {
    src = "";
    constructor() { runtime.videos.push(this); }
    initialize = vi.fn(() => { const gate = runtime.initialization; runtime.initialization = null; return gate ?? Promise.resolve(); });
    deinitializeSync = vi.fn(() => "success");
    setSurfaceHandle = vi.fn();
    clearSurfaceHandle = vi.fn();
  },
}));
vi.mock("../src/vegaPlayer", () => ({
  createVegaPlayer: (config: object) => {
    const listeners = new Map<string, Set<() => void>>();
    const player = {
      config, listeners, load: vi.fn(async () => {}),
      destroy: vi.fn(() => { const gate = runtime.destruction; runtime.destruction = null; return gate ?? Promise.resolve(); }),
      on: (event: string, callback: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
      off: (event: string, callback: () => void) => listeners.get(event)?.delete(callback),
      isLive: () => true, getDuration: () => Infinity, getMaxTimeShift: () => -900, getTimeShift: () => 0, getCurrentTime: () => 0,
      timeShift: vi.fn(), seek: vi.fn(() => true),
    };
    runtime.players.push(player);
    return player;
  },
}));

import { App } from "../src/App";

let screen: ReactTestRenderer;
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
function element(type: string, props: Record<string, unknown> = {}): ReactTestInstance {
  return screen.root.findAll((node) => String(node.type) === type && Object.entries(props).every(([key, value]) => node.props[key] === value))[0]!;
}
const current = () => runtime.players[runtime.players.length - 1]!;
const button = (title: string) => element("Pressable", { accessibilityRole: "button", accessibilityLabel: title });
const input = (label: string) => element("TextInput", { accessibilityLabel: label });
function appliedCode(): string {
  return screen.root.findAll((node) => String(node.type) === "View" &&
    typeof node.props.testID === "string" && node.props.testID.startsWith("applied-code-line-"))
    .map((row) => { const value = row.find((node) => String(node.type) === "Text").props.children; return value === "\u00a0" ? "" : value; }).join("\n");
}
async function press(title: string) { await act(async () => button(title).props.onPress()); }
async function action(title: string) { await act(async () => element("Pressable", { accessibilityLabel: title }).props.onPress()); }
async function text(label: string, value: string) { await act(async () => input(label).props.onChangeText(value)); }
async function appState(state: string) {
  await act(async () => {
    runtime.appState = state;
    for (const listener of runtime.appStateListeners) listener(state);
  });
}
async function mount() {
  await act(async () => { screen = create(<App />); });
  await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("surface"));
}
beforeEach(() => {
  vi.stubGlobal("crypto", undefined);
  runtime.players.length = 0;
  runtime.videos.length = 0;
  runtime.initialization = null;
  runtime.destruction = null;
  runtime.appState = "active";
  runtime.appStateListeners.clear();
  errors = vi.spyOn(console, "error");
  warnings = vi.spyOn(console, "warn");
});
afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  const unexpectedErrors = [...errors.mock.calls];
  const unexpectedWarnings = [...warnings.mock.calls];
  errors.mockRestore();
  warnings.mockRestore();
  vi.unstubAllGlobals();
  expect(unexpectedErrors).toEqual([]);
  expect(unexpectedWarnings).toEqual([]);
});

describe("Vega configuration in the mounted App and media session", () => {
  it("changes application language while retaining the native owner, draft, code and API result", async () => {
    await mount(); await press("Show configuration");
    await text("Source title", "Unapplied user title"); await press("Show applied code");
    const code = appliedCode(); const owner = current(); const count = runtime.players.length;
    await action("Show SDK API experiments"); await action("Run Vega SDK API");
    const result = element("Text", { accessibilityLabel: "Vega API result" }).props.children;
    const executed = element("Text", { accessibilityLabel: "Vega executed API code" }).props.children;
    await press("日本語");
    expect(input("ソースのタイトル").props.value).toBe("Unapplied user title");
    expect(button("適用してプレイヤーを再作成").props.disabled).toBe(false);
    expect(appliedCode()).toBe(code);
    expect(element("Text", { accessibilityLabel: "VegaのAPI実行結果" }).props.children).toBe(result);
    expect(element("Text", { accessibilityLabel: "Vegaで実行したAPIのコード" }).props.children).toBe(executed);
    expect(current()).toBe(owner); expect(runtime.players).toHaveLength(count);
    expect(owner.destroy).not.toHaveBeenCalled();
    await press("English");
    expect(input("Source title").props.value).toBe("Unapplied user title"); expect(current()).toBe(owner);
  });

  it("preserves the native cleanup barrier across explicit repeated recreation", async () => {
    await mount();
    const old = current();
    let released!: () => void;
    runtime.destruction = new Promise<void>((resolve) => { released = resolve; });
    await action("Show SDK API experiments"); await action("Recreate Vega player");
    // A stale surface callback can be delivered while the old SDK still owns gvideo.
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("next-surface"));
    await action("Recreate Vega player");
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("latest-surface"));
    expect(old.destroy).toHaveBeenCalledOnce();
    expect(runtime.videos).toHaveLength(1);
    expect(runtime.players).toHaveLength(1);
    await act(async () => released());
    expect(runtime.videos).toHaveLength(2);
    expect(runtime.players).toHaveLength(2);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledOnce();
  });

  it("does not bypass unconfirmed native initialization cancellation through Recreate", async () => {
    let initialized!: () => void;
    runtime.initialization = new Promise<void>((resolve) => { initialized = resolve; });
    await mount();
    await action("Show SDK API experiments"); await action("Recreate Vega player");
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("replacement-surface"));
    await action("Recreate Vega player");
    await act(async () => initialized());
    expect(runtime.videos).toHaveLength(1);
    expect(runtime.players).toHaveLength(0);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledOnce();
    expect(warnings).toHaveBeenCalledExactlyOnceWith("Vega initialization cancellation unconfirmed; restart the app before playing again");
    warnings.mockClear();
  });

  it("applies a typed advanced field from the normal GUI and exports only the applied value", async () => {
    await mount(); await press("Show configuration"); await action("Show all SDK configuration");
    await action("Set Vega API value");
    await text("SDK text value", "GUI source description");
    expect(current().load).toHaveBeenCalledTimes(1);
    await press("Apply and recreate player");
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ description: "GUI source description" }));
    await press("Show applied code");
    expect(appliedCode()).toContain("GUI source description");
    await text("SDK text value", "Unapplied advanced description");
    expect(appliedCode()).not.toContain("Unapplied advanced description");
    await action("Remove Vega API override"); await press("Apply and recreate player");
    expect(current().load.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });

  it("edits required technology siblings together in a parent form before applying the player configuration", async () => {
    await mount(); await press("Show configuration"); await action("Show all SDK configuration");
    await text("Filter Vega configuration APIs", "PlayerConfig.playback.preferredTech");
    await action("PlayerConfig.playback.preferredTech"); await action("Set Vega API value");
    await action("Add SDK list item");
    await action("player (set)"); await action("PlayerType.Html5");
    await action("streaming (set)"); await action("StreamType.Hls");
    expect(runtime.players).toHaveLength(1);
    await press("Apply and recreate player");
    expect(current().config).toEqual(expect.objectContaining({ playback: expect.objectContaining({ preferredTech: [{ player: "html5", streaming: "hls" }] }) }));
    await press("Show applied code");
    expect(appliedCode()).toContain('"preferredTech"');
    expect(appliedCode()).toContain('"streaming": SDK.StreamType.Hls');
  });

  it("connects an explicitly approved edited callback through the GUI to the SDK configuration boundary", async () => {
    await mount(); await press("Show configuration"); await action("Show all SDK configuration");
    await text("Filter Vega configuration APIs", "PlayerConfig.network.preprocessHttpRequest");
    await action("PlayerConfig.network.preprocessHttpRequest"); await action("Set Vega API value");
    await text("SDK callback JavaScript body", 'request.headers["X-Lab"] = "GUI callback"; return request;');
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(1);
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
    await act(async () => element("Switch", { accessibilityLabel: "Allow this SDK callback" }).props.onValueChange(true));
    await press("Apply and recreate player");
    const network = Reflect.get(current().config, "network");
    const callback = Reflect.get(network, "preprocessHttpRequest") as (type: string, request: object) => Promise<object>;
    const request = { method: "GET", url: "https://example.com/a.m3u8", headers: {}, responseType: "text", credentials: "omit" };
    expect(await callback("manifest", request)).toEqual(expect.objectContaining({ headers: { "X-Lab": "GUI callback" } }));
    await press("Show applied code"); expect(appliedCode()).toContain('request.headers["X-Lab"]');
  });

  it("runs a typed SDK operation from the GUI and keeps malformed numbers away from its SDK call", async () => {
    await mount(); await action("Show SDK API experiments");
    await text("Filter Vega API operations", "PlayerAPI.seek"); await action("PlayerAPI.seek");
    await text("SDK numeric value", "12.75"); await action("Run Vega SDK API");
    const seek = Reflect.get(current(), "seek") as ReturnType<typeof vi.fn>;
    expect(seek).toHaveBeenCalledWith(12.75);
    expect(element("Text", { accessibilityLabel: "Vega executed API code" }).props.children).toBe("player.seek(12.75);");
    expect(element("Text", { accessibilityLabel: "Vega API result" }).props.children).toBe("true");
    await text("SDK numeric value", "invalid"); await action("Run Vega SDK API");
    expect(seek).toHaveBeenCalledTimes(1);
    expect(element("Text", { accessibilityLabel: "Vega API result" }).props.children).toContain("Enter a number");
  });

  it("resets argument editor ownership when switching from numeric seek to optional play arguments", async () => {
    await mount(); await action("Show SDK API experiments");
    await text("Filter Vega API operations", "PlayerAPI.seek"); await action("PlayerAPI.seek");
    await text("SDK numeric value", "12.5");
    await text("Filter Vega API operations", "PlayerAPI.play"); await action("PlayerAPI.play");
    expect(element("Pressable", { accessibilityLabel: "Set issuer" })).toBeDefined();
    await action("Set issuer"); await text("SDK text value", "GUI player command");
    await text("Filter Vega API operations", "PlayerAPI.seek"); await action("PlayerAPI.seek");
    expect(input("SDK numeric value").props.value).toBe("0");
    await action("Run Vega SDK API"); expect(Reflect.get(current(), "seek")).toHaveBeenCalledWith(0);
  });

  it("renders each published operation's argument form after selection without running a native API", async () => {
    const { catalog } = await import("../src/api/catalog");
    await mount(); await action("Show SDK API experiments");
    let selected = "PlayerAPI.getDuration";
    for (const entry of catalog.rows.filter(entry => entry.category === "command" || entry.category === "observation")) {
      await text("Filter Vega API operations", entry.id);
      if (selected !== entry.id) await action(entry.id);
      selected = entry.id;
      expect(element("Pressable", { accessibilityLabel: "Run Vega SDK API" }), entry.id).toBeDefined();
    }
    expect(current().load).toHaveBeenCalledTimes(1);
    expect(Reflect.get(current(), "seek")).not.toHaveBeenCalled();
  });

  it("lets users inspect the actual current SDK API availability from the normal screen", async () => {
    await mount(); await action("Show SDK API experiments"); await action("Inspect current SDK API availability");
    const value = JSON.parse(String(element("Text", { accessibilityLabel: "Vega SDK API availability" }).props.children));
    expect(value.find((row: { id: string }) => row.id === "PlayerAPI.seek")).toEqual({ id: "PlayerAPI.seek", callable: true });
    expect(value.find((row: { id: string }) => row.id === "PlayerAPI.ads.schedule")?.callable).toBe(false);
    expect(Reflect.get(current(), "seek")).not.toHaveBeenCalled();
  });

  it("shows redacted named SDK events and drops retired owner events after recreation", async () => {
    await mount(); await action("Show SDK API experiments");
    const old = current(); const callback = [...old.listeners.get(PlayerEvent.Play)!][0]! as (event: unknown) => void;
    await act(async () => { callback({ marker: "current owner", authorization: "private-test-value" }); await new Promise((resolve) => setTimeout(resolve, 150)); });
    const events = () => String(element("Text", { accessibilityLabel: "Vega SDK event log" }).props.children ?? "");
    expect(events()).toContain("current owner"); expect(events()).not.toContain("private-test-value");
    await action("Recreate Vega player");
    await act(async () => { callback({ marker: "retired owner" }); await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(events()).not.toContain("retired owner");
    expect(old.listeners.get(PlayerEvent.Play)?.size).toBe(0);
  });

  it("renders public subtitle cues and clears them on replacement and background without accepting retired callbacks", async () => {
    await mount();
    const old = current();
    const enter = [...old.listeners.get(PlayerEvent.CueEnter)!][0]! as (cue: object) => void;
    await act(async () => enter({ subtitleId: "external", start: 1, end: 3, text: "Visible public cue" }));
    expect(element("Text", { testID: "vega-subtitle-cue" }).props.children).toBe("Visible public cue");
    await press("Show configuration"); await text("Source title", "New owner"); await press("Apply and recreate player");
    expect(old.listeners.get(PlayerEvent.CueEnter)?.size).toBe(0);
    await act(async () => enter({ subtitleId: "external", start: 1, end: 3, text: "Retired cue" }));
    expect(element("Text", { testID: "vega-subtitle-cue" })).toBeUndefined();
    const next = [...current().listeners.get(PlayerEvent.CueEnter)!][0]! as (cue: object) => void;
    await act(async () => next({ subtitleId: "external", start: 1, end: 3, text: "Current cue" }));
    await appState("background");
    expect(element("Text", { testID: "vega-subtitle-cue" })).toBeUndefined();
  });
  it("applies and exports the validated external WebVTT fields through the existing session", async () => {
    await mount(); await press("Show configuration");
    await text("External WebVTT URL", " https://example.com/captions.vtt ");
    await text("Subtitle label", " English captions ");
    await text("Subtitle language", "en-us");
    await act(async () => element("Switch", { accessibilityLabel: "Enable external subtitle on load" }).props.onValueChange(true));
    const old = current();
    await press("Apply and recreate player");
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleTracks: [{
      url: "https://example.com/captions.vtt", label: "English captions", lang: "en-US",
      id: "player-lab-external", kind: "subtitle", enabled: true,
    }] }));
    await press("Show applied code");
    const code = appliedCode();
    expect(code).toContain('"enabled": true');
    await text("Subtitle label", "Unapplied draft"); await press("Reset draft");
    expect(input("Subtitle label").props.value).toBe("English captions");
    await text("External WebVTT URL", ""); await press("Apply and recreate player");
    expect(current().load.mock.calls[current().load.mock.calls.length - 1]?.[0]).not.toHaveProperty("subtitleTracks");
  });
  it("shows applied configuration code without exporting drafts or native credentials", async () => {
    await mount();
    await press("Show configuration");
    await press("Show applied code");
    const code = appliedCode;
    const original = code();
    expect(original).toContain("YOUR_PLAYER_KEY");
    expect(original).not.toContain("licenseKey");
    await text("Source title", "APPLIED_SOURCE_TITLE");
    expect(code()).toBe(original);
    await press("Apply and recreate player");
    expect(code()).toContain("APPLIED_SOURCE_TITLE");
    expect(code()).toContain('"ui": false');
    expect(code()).toContain("native media initialization");
  });

  it("lets TV focus reach every applied-code line through the normal screen", async () => {
    await mount(); await press("Show configuration"); await press("Show applied code");
    const rows = screen.root.findAll((node) => String(node.type) === "View" &&
      typeof node.props.testID === "string" && node.props.testID.startsWith("applied-code-line-"));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((row) => row.props.focusable === true && row.props.accessible === true)).toBe(true);
    expect(rows[rows.length - 1]!.props.testID).toMatch(/-last$/);
  });

  it("makes each TV switch focusable without applying its configuration draft", async () => {
    await mount();
    const player = current();
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.focusable).toBe(true);
    await press("Show configuration");
    for (const accessibilityLabel of ["Autoplay", "Mute on startup"]) {
      const control = element("Switch", { accessibilityLabel });
      expect(control.props.focusable).toBe(true);
      await act(async () => control.props.onValueChange(!control.props.value));
    }
    expect(current()).toBe(player);
    expect(runtime.players).toHaveLength(1);
    await press("Reset draft");
    expect(element("Switch", { accessibilityLabel: "Autoplay" }).props.value).toBe(true);
    expect(element("Switch", { accessibilityLabel: "Mute on startup" }).props.value).toBe(true);
  });

  it("uses a local URL parser when the legacy native URL getters are unavailable", async () => {
    class LegacyURL {
      get protocol(): string { throw new Error("URL.protocol is not implemented"); }
      get hostname(): string { throw new Error("URL.hostname is not implemented"); }
    }
    vi.stubGlobal("URL", LegacyURL);
    try {
      await mount();
      await press("Show configuration");
      await text("Source URL", "HTTPS://example.com/movie.m3u8");
      await press("HLS");
      await press("Apply and recreate player");
      expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ hls: "HTTPS://example.com/movie.m3u8" }));
      expect(globalThis.URL).toBe(LegacyURL);
    } finally { vi.unstubAllGlobals(); }
  });
  it("isolates drafts and maps validated source/player fields through the real session path", async () => {
    await mount();
    expect(runtime.players).toHaveLength(1);
    await press("Show configuration");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    await text("Source URL", "https://example.com/custom.m3u8");
    await press("HLS");
    await text("Source title", "Custom source");
    await text("Poster URL", "https://example.com/poster.jpg");
    await text("Start offset (seconds)", "-30");
    await press("End");
    await text("Video forward buffer (seconds)", "20");
    await text("Audio forward buffer (seconds)", "25");
    await text("Maximum video bitrate (bits per second)", "3500000");
    await act(async () => element("Switch", { accessibilityLabel: "Autoplay" }).props.onValueChange(false));
    await act(async () => element("Switch", { accessibilityLabel: "Mute on startup" }).props.onValueChange(false));
    expect(runtime.players).toHaveLength(1);
    const old = current();
    await press("Apply and recreate player");
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.players).toHaveLength(2);
    expect(current().config).toMatchObject({
      ui: false, playback: { autoplay: false, muted: false },
      buffer: { video: { forwardduration: 20 }, audio: { forwardduration: 25 } },
      adaptation: { bitrates: { maxSelectableVideoBitrate: 3500000 } },
    });
    expect(current().load).toHaveBeenCalledWith({ hls: "https://example.com/custom.m3u8", title: "Custom source", poster: "https://example.com/poster.jpg",
      options: { startOffset: -30, startOffsetTimelineReference: "end" } });
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Source URL", "file:///movie.mpd"], ["Poster URL", "invalid"], ["Start offset (seconds)", "NaN"],
    ["Source URL", "https:example.com/movie.mpd"], ["Source URL", "https://example.com/a b.mpd"],
    ["Video forward buffer (seconds)", "-1"], ["Audio forward buffer (seconds)", "Infinity"],
    ["Maximum video bitrate (bits per second)", "0"],
  ])("rejects invalid %s input %s without replacing resources", async (label, value) => {
    await mount();
    await press("Show configuration");
    await text(label, value);
    await press("Apply and recreate player");
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
    await press("Reset draft");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.players).toHaveLength(1);
  });

  it("keeps selected presets, logs and DVR permission, and removes optional settings when cleared", async () => {
    await mount();
    await act(async () => {
      element("Switch", { accessibilityLabel: "Allow DVR" }).props.onValueChange(false);
      for (const callback of current().listeners.get(PlayerEvent.SourceLoaded) ?? []) callback();
    });
    await press("VOD HLS");
    const selected = current().load.mock.calls[0]![0];
    await press("Show configuration");
    await text("Video forward buffer (seconds)", "10");
    await text("Maximum video bitrate (bits per second)", "2000000");
    await press("Apply and recreate player");
    expect(current().load).toHaveBeenCalledWith(selected);
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(1);
    await text("Video forward buffer (seconds)", "");
    await text("Maximum video bitrate (bits per second)", "");
    await press("Apply and recreate player");
    expect(current().config).not.toHaveProperty("buffer");
    expect(current().config).not.toHaveProperty("adaptation");
    const count = runtime.players.length;
    await text("Source URL", ` ${selected.hls} `);
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(count);
  });

  it("serializes rapid Apply operations behind old media cleanup and ignores retired callbacks", async () => {
    await mount();
    const old = current();
    const retiredCallback = [...old.listeners.get(PlayerEvent.SourceLoaded)!][0]!;
    let release!: () => void;
    runtime.destruction = new Promise<void>((resolve) => { release = resolve; });
    await press("Show configuration");
    await text("Source URL", "https://example.com/intermediate.mpd");
    await press("Apply and recreate player");
    await text("Source URL", "https://example.com/latest.mpd");
    await press("Apply and recreate player");
    await act(async () => retiredCallback());
    expect(runtime.players).toHaveLength(1);
    expect(runtime.videos).toHaveLength(1);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toEqual([]);
    await act(async () => release());
    expect(runtime.players).toHaveLength(2);
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ dash: "https://example.com/latest.mpd" }));
    expect(runtime.videos).toHaveLength(2);
    expect(old.destroy).toHaveBeenCalledTimes(1);
  });

  it("maps progressive sources and beginning-relative offsets without HLS/DASH leftovers", async () => {
    await mount();
    await press("Show configuration");
    await press("Progressive MP4");
    await text("Source URL", "https://example.com/movie.mp4");
    await text("Source title", "");
    await text("Poster URL", "");
    await text("Start offset (seconds)", "10.5");
    await press("Start");
    await press("Apply and recreate player");
    expect(current().load).toHaveBeenCalledWith({ progressive: "https://example.com/movie.mp4", options: { startOffset: 10.5, startOffsetTimelineReference: "start" } });
  });

  it("keeps the latest configuration but blocks replacement after unconfirmed initialization cancellation", async () => {
    let initialized!: () => void;
    runtime.initialization = new Promise<void>((resolve) => { initialized = resolve; });
    await mount();
    expect(runtime.players).toHaveLength(0);
    await press("Show configuration");
    await text("Source URL", "https://example.com/latest.mpd");
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(0);
    await act(async () => initialized());
    expect(runtime.players).toHaveLength(0);
    expect(runtime.videos).toHaveLength(1);
    expect(input("Source URL").props.value).toBe("https://example.com/latest.mpd");
    expect(warnings).toHaveBeenCalledExactlyOnceWith("Vega initialization cancellation unconfirmed; restart the app before playing again");
    warnings.mockClear();
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
  });

  it("retires background media and resumes only after cleanup with applied settings and drafts intact", async () => {
    await mount();
    await press("Show configuration");
    await text("Source URL", "https://example.com/movie.m3u8");
    await press("HLS");
    await text("Source title", "Applied title");
    await text("Poster URL", "https://example.com/poster.jpg");
    await text("Start offset (seconds)", "-30");
    await press("End");
    await act(async () => {
      element("Switch", { accessibilityLabel: "Autoplay" }).props.onValueChange(false);
      element("Switch", { accessibilityLabel: "Allow DVR" }).props.onValueChange(false);
    });
    await press("Apply and recreate player");
    await text("Source title", "Unapplied title");
    const old = current();
    const appliedSource = old.load.mock.calls[0]![0];
    const retiredCallback = [...old.listeners.get(PlayerEvent.SourceLoaded)!][0]!;
    const retiredSurface = element("KeplerVideoSurfaceView").props.onSurfaceViewCreated;
    const oldVideo = runtime.videos[runtime.videos.length - 1]!;
    let attached = true;
    const reset = vi.fn(() => { attached = false; retiredCallback(); });
    Object.defineProperty(oldVideo, "src", { set: reset });
    oldVideo.deinitializeSync.mockImplementation(() => attached ? "timedout" : "success");
    let released!: () => void;
    runtime.destruction = new Promise<void>((resolve) => { released = resolve; });

    await appState("inactive");
    expect(old.destroy).not.toHaveBeenCalled();
    await appState("background");
    await appState("background");
    expect(reset).toHaveBeenCalledExactlyOnceWith("");
    expect(oldVideo.deinitializeSync.mock.results[0]!.value).toBe("success");
    expect(oldVideo.deinitializeSync.mock.invocationCallOrder[0]).toBeLessThan(old.destroy.mock.invocationCallOrder[0]!);
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(screen.root.findAll((node) => String(node.type) === "KeplerVideoSurfaceView")).toHaveLength(0);
    expect([...old.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    await act(async () => retiredCallback());
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(0);
    await act(async () => retiredSurface("background-surface"));
    await appState("active");
    await act(async () => retiredSurface("retired-surface"));
    expect(runtime.players).toHaveLength(2);
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("resumed-surface"));
    expect(runtime.videos).toHaveLength(2);
    await act(async () => released());

    expect(runtime.players).toHaveLength(3);
    expect(runtime.videos[1]!.deinitializeSync).toHaveBeenCalledTimes(1);
    expect(current().config).toEqual(old.config);
    expect(current().load).toHaveBeenCalledWith(appliedSource);
    expect(current().config).toMatchObject({ playback: { autoplay: false } });
    expect(input("Source title").props.value).toBe("Unapplied title");
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(button("Apply and recreate player").props.disabled).toBe(false);
  });

  it("cancels initialization and rejects retired surface events during a batched background/active transition", async () => {
    let initialized!: () => void;
    runtime.initialization = new Promise<void>((resolve) => { initialized = resolve; });
    await mount();
    const retiredSurface = element("KeplerVideoSurfaceView").props.onSurfaceViewCreated;
    await act(async () => {
      runtime.appState = "background";
      for (const listener of runtime.appStateListeners) listener("background");
      runtime.appState = "active";
      for (const listener of runtime.appStateListeners) listener("active");
    });
    await act(async () => retiredSurface("retired-surface"));
    expect(runtime.players).toHaveLength(0);
    expect(runtime.videos).toHaveLength(1);
    await act(async () => initialized());
    expect(runtime.players).toHaveLength(0);
    expect(runtime.videos).toHaveLength(1);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("current-surface"));
    expect(runtime.players).toHaveLength(0);
    expect(runtime.videos).toHaveLength(1);
    expect(warnings).toHaveBeenCalledExactlyOnceWith("Vega initialization cancellation unconfirmed; restart the app before playing again");
    warnings.mockClear();
  });

  it("waits for foreground before creating native media and unsubscribes on unmount", async () => {
    runtime.appState = "background";
    await act(async () => { screen = create(<App />); });
    expect(screen.root.findAll((node) => String(node.type) === "KeplerVideoSurfaceView")).toHaveLength(0);
    expect(runtime.videos).toHaveLength(0);
    await appState("active");
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("foreground-surface"));
    expect(runtime.players).toHaveLength(1);
    await act(async () => screen.unmount());
    expect(runtime.appStateListeners.size).toBe(0);
    await appState("active");
    expect(runtime.players).toHaveLength(1);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
  });

  it("keeps source/config changes while backgrounded without acquiring native resources", async () => {
    await mount();
    const old = current();
    const retiredSurface = element("KeplerVideoSurfaceView").props.onSurfaceViewCreated;
    await appState("background");
    await press("Show configuration");
    await text("Source URL", "https://example.com/first.mpd");
    await press("Apply and recreate player");
    await text("Source URL", "https://example.com/latest.mpd");
    await text("Video forward buffer (seconds)", "12");
    await act(async () => element("Switch", { accessibilityLabel: "Allow DVR" }).props.onValueChange(false));
    await press("Apply and recreate player");
    await act(async () => retiredSurface("background-surface"));
    expect(runtime.players).toHaveLength(1);
    expect(runtime.videos).toHaveLength(1);
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
    await appState("active");
    expect(runtime.players).toHaveLength(1);
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("foreground-surface"));
    expect(runtime.players).toHaveLength(2);
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ dash: "https://example.com/latest.mpd" }));
    expect(current().config).toMatchObject({ buffer: { video: { forwardduration: 12 } } });
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(button("Hide configuration")).toBeDefined();
    expect(button("Apply and recreate player").props.disabled).toBe(true);
  });

  it("synchronously releases the retiring owner when the current Apply waiter backgrounds", async () => {
    await mount();
    const old = current();
    let released!: () => void;
    runtime.destruction = new Promise<void>((resolve) => { released = resolve; });
    await press("Show configuration");
    await text("Source URL", "https://example.com/latest.mpd");
    await press("Apply and recreate player");
    expect(runtime.videos).toHaveLength(1);
    expect(runtime.videos[0]!.deinitializeSync).not.toHaveBeenCalled();
    await appState("background");
    await appState("background");
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.videos[0]!.deinitializeSync).toHaveBeenCalledTimes(1);
    await act(async () => released());
    expect(runtime.players).toHaveLength(1);
    await appState("active");
    await act(async () => element("KeplerVideoSurfaceView").props.onSurfaceViewCreated("fresh-surface"));
    expect(runtime.players).toHaveLength(2);
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ dash: "https://example.com/latest.mpd" }));
  });
});
