import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import path from "node:path";
import { HttpRequestType, type PlayerConfig } from "bitmovin-player-react-native";

const runtime = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY = "test-license";
  process.env.EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY = "";
  return { os: "android", clipboard: vi.fn(async (_code: string) => {}), players: [] as Array<{
    config: PlayerConfig;
    load: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    getMaxTimeShift: ReturnType<typeof vi.fn>;
    isLive: ReturnType<typeof vi.fn>;
    getDuration: ReturnType<typeof vi.fn>;
    setVolume: ReturnType<typeof vi.fn>;
    getVolume: ReturnType<typeof vi.fn>;
  }> };
});

vi.mock("react-native", () => ({
  Button: "Button", Modal: "Modal", ScrollView: "ScrollView", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View",
  Platform: { get OS() { return runtime.os; }, get Version() { return runtime.os === "ios" ? "15.1" : 36; }, select: (options: Record<string, string>) => options[runtime.os] ?? options.default },
  StyleSheet: { create: <T,>(styles: T) => styles },
  NativeModules: {},
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: runtime.clipboard }));

vi.mock("bitmovin-player-react-native", async () => {
  const { useState } = await import("react");
  return {
    CustomUi: class { constructor(public factoryFunction: string) {} },
    PlayerView: "PlayerView",
    Source: class {},
    CustomMessageHandler: class {
      constructor(private readonly options: { onReceivedSynchronousMessage: (message: string, data: string | undefined) => string | undefined; onReceivedAsynchronousMessage: (message: string, data: string | undefined) => void }) {}
      receivedSynchronousMessage(message: string, data: string | undefined) { return this.options.onReceivedSynchronousMessage(message, data); }
      receivedAsynchronousMessage(message: string, data: string | undefined) { return this.options.onReceivedAsynchronousMessage(message, data); }
      sendMessage() {}
    },
    HttpRequestType: { Unknown: "unknown" },
    SourceType: { NONE: "none", HLS: "hls", DASH: "dash", PROGRESSIVE: "progressive" },
    SubtitleFormat: { CEA: "cea", TTML: "ttml", VTT: "vtt", SRT: "srt" },
    AdSourceType: { BITMOVIN: "bitmovin", IMA: "ima", UNKNOWN: "unknown", PROGRESSIVE: "progressive" },
    TimelineReferencePoint: { START: "start", END: "end" },
    UserInterfaceType: { Bitmovin: "Bitmovin", System: "System", Subtitle: "Subtitle" },
    AnalyticsRetryPolicy: { NO_RETRY: "noRetry", LONG_TERM: "longTerm" },
    ScalingMode: { Fit: "Fit", Stretch: "Stretch", Zoom: "Zoom" },
    SurfaceType: { SurfaceView: "SurfaceView", TextureView: "TextureView" },
    ForceReuseVideoCodecReason: { ColorInfoMismatch: "ColorInfoMismatch", MaxInputSizeExceeded: "MaxInputSizeExceeded", MaxResolutionExceeded: "MaxResolutionExceeded" },
    PictureInPictureAction: { TogglePlayback: "TogglePlayback", Seek: "Seek" },
    usePlayer: (config: PlayerConfig) => useState(() => {
      const player = {
        config, load: vi.fn(), isDestroyed: false, destroy: vi.fn(() => { player.isDestroyed = true; }), timeShift: vi.fn(),
        isLive: vi.fn(async () => true), getDuration: vi.fn(async () => Infinity),
        getMaxTimeShift: vi.fn(async () => -900), getTimeShift: vi.fn(async () => 0),
        getCurrentTime: vi.fn(async () => 0),
        setVolume: vi.fn(), getVolume: vi.fn(async () => 100), play: vi.fn(), pause: vi.fn(),
      };
      runtime.players.push(player);
      return player;
    })[0],
  };
});

import App from "../App";
import { createRuntimeMonitor } from "../src/runtimeObservation";

let screen: ReactTestRenderer;
let errors: ReturnType<typeof vi.spyOn>;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function element(type: string, props: Record<string, unknown> = {}): ReactTestInstance {
  return screen.root.findAll((node) => String(node.type) === type && Object.entries(props).every(([key, value]) => node.props[key] === value))[0]!;
}
const button = (title: string) => element("Button", { title });
const input = (label: string) => element("TextInput", { accessibilityLabel: label });
const current = () => runtime.players[runtime.players.length - 1]!;
async function press(title: string) { await act(async () => button(title).props.onPress()); }
async function text(label: string, value: string) { await act(async () => input(label).props.onChangeText(value)); }
async function ready() { await act(async () => element("PlayerView").props.onPlayerViewReady()); }

beforeEach(async () => {
  runtime.os = "android";
  runtime.players.length = 0;
  runtime.clipboard.mockClear();
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  errors = vi.spyOn(console, "error");
});

afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  // React 19 deprecates this renderer. Native hosts are mocked; act/runtime errors still fail.
  const unexpected = errors.mock.calls.filter(([message]) => !String(message).startsWith("react-test-renderer is deprecated."));
  errors.mockRestore();
  expect(unexpected).toEqual([]);
});

function expectValidCode(code: string): void {
  const file = path.resolve("test/generated-configuration-example.tsx");
  const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.resolve(".")).options;
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, onError, create) => name === file ? ts.createSourceFile(file, code, language, true, ts.ScriptKind.TSX) : read(name, language, onError, create);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
}

async function mount() {
  await act(async () => { screen = create(<App />); });
}

describe("React Native configuration in the mounted App", () => {
  it("applies individually edited SDK fields to Player, Source and PlayerView and exports the applied values", async () => {
    await mount(); await ready(); await press("Show configuration");
    await press("Set this API value"); await text("Value for SourceConfig.description", "Applied description");
    await text("Filter configuration APIs", "PlayerConfig.tweaksConfig.timeChangedInterval");
    await press("PlayerConfig.tweaksConfig.timeChangedInterval"); await press("Set this API value");
    await text("Value for PlayerConfig.tweaksConfig.timeChangedInterval", "0.25");
    await text("Filter configuration APIs", "PlayerViewConfig.surfaceType");
    await press("PlayerViewConfig.surfaceType"); await press("Set this API value"); await press("TextureView");
    await press("Apply and recreate player"); await ready();
    expect(current().config).toMatchObject({ tweaksConfig: { timeChangedInterval: 0.25 } });
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ description: "Applied description" }));
    expect(element("PlayerView").props.config).toMatchObject({ surfaceType: "TextureView" });
    await press("Show applied code");
    const code = input("Applied configuration code").props.value;
    expect(code).toContain('"timeChangedInterval": 0.25');
    expect(code).toContain("SDK.SurfaceType.TextureView");
    expect(code).toContain("Applied description");
    expect(code).not.toContain("as PlayerConfig");
    expectValidCode(code);
  });

  it("applies typed subtitle lists and roles from the mounted GUI and removes the complete list", async () => {
    await mount(); await ready(); await press("Show configuration");
    await press("Edit this list"); await press("Add list item");
    await text("Track URL", "https://example.com/captions.ttml");
    await text("Track label", "English captions"); await text("Track language", "en-US");
    await text("Track identifier (optional)", "captions"); await press("ttml");
    await press("Add track role"); await text("Role 1 schemeIdUri", "urn:mpeg:dash:role:2011");
    await text("Role 1 value", "caption"); await press("Apply and recreate player"); await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleTracks: [{
      url: "https://example.com/captions.ttml", label: "English captions", language: "en-US", identifier: "captions",
      format: "ttml", roles: [{ schemeIdUri: "urn:mpeg:dash:role:2011", value: "caption" }],
    }] }));
    await press("Remove list item"); await press("Apply and recreate player"); await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleTracks: [] }));
  });

  it("only installs edited callbacks after explicit approval and applies them to the real SDK configuration boundary", async () => {
    await mount(); await ready(); await press("Show configuration");
    await press("Edit this callback");
    const id = "PlayerConfig.networkConfig.preprocessHttpRequest";
    await text(`JavaScript body for ${id}`, 'return { ...request, url: request.url + "?lab=1" };');
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(1);
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("Enable execution");
    await act(async () => element("Switch", { accessibilityLabel: "Allow edited JavaScript execution" }).props.onValueChange(true));
    await press("Apply and recreate player"); await ready();
    const callback = current().config.networkConfig?.preprocessHttpRequest;
    expect(callback).toBeTypeOf("function");
    const result = await callback!(HttpRequestType.Unknown, { method: "GET", url: "https://example.com/manifest.mpd", headers: {} });
    expect(result.url).toBe("https://example.com/manifest.mpd?lab=1");
    await press("Show applied code");
    const code = input("Applied configuration code").props.value;
    expect(code).toContain('return { ...request, url: request.url + "?lab=1" };');
    expect(code).toContain("async (type, request)");
    expectValidCode(code);
  });

  it("requires coherent DRM configuration, preserves its dictionary and masks header values in code", async () => {
    await mount(); await ready(); await press("Show configuration");
    await text("Filter configuration APIs", "SourceConfig.drmConfig.widevine.httpHeaders");
    await press("SourceConfig.drmConfig.widevine.httpHeaders"); await press("Set this API value");
    await text("Value for SourceConfig.drmConfig.widevine.httpHeaders", "Authorization=PRIVATE_HEADER");
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(1);
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("licenseUrl");
    await text("Filter configuration APIs", "SourceConfig.drmConfig.widevine.licenseUrl");
    await press("SourceConfig.drmConfig.widevine.licenseUrl"); await press("Set this API value");
    await text("Value for SourceConfig.drmConfig.widevine.licenseUrl", "https://example.com/license");
    await press("Apply and recreate player"); await ready(); await press("Show applied code");
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ drmConfig: { widevine: {
      licenseUrl: "https://example.com/license", httpHeaders: { Authorization: "PRIVATE_HEADER" },
    } } }));
    expect(input("Applied configuration code").props.value).not.toContain("PRIVATE_HEADER");
  });

  it("removes an applied SDK override and rejects invalid typed input before creating a player", async () => {
    await mount(); await ready(); await press("Show configuration");
    await press("Set this API value"); await text("Value for SourceConfig.description", "Temporary description");
    await press("Apply and recreate player"); await ready();
    await press("Remove this API override"); await press("Apply and recreate player"); await ready();
    expect(current().load.mock.calls[current().load.mock.calls.length - 1]?.[0]).not.toHaveProperty("description");
    const count = runtime.players.length;
    await text("Filter configuration APIs", "PlayerConfig.tweaksConfig.timeChangedInterval");
    await press("PlayerConfig.tweaksConfig.timeChangedInterval"); await press("Set this API value");
    await text("Value for PlayerConfig.tweaksConfig.timeChangedInterval", "Infinity");
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(count);
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("finite number");
  });

  it("dispatches typed API arguments only after validation and displays the executed call", async () => {
    await mount(); await ready(); await press("Show API experiments");
    await text("Filter API operations", "setVolume"); await press("Player.setVolume");
    await text("Volume (0–100)", "101"); await press("Run selected API");
    expect(current().setVolume).not.toHaveBeenCalled();
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("Volume must be");
    await text("Volume (0–100)", "37.5"); await press("Run selected API");
    expect(current().setVolume).toHaveBeenLastCalledWith(37.5);
    expect(element("Text", { accessibilityLabel: "Executed API code" }).props.children).toBe("player.setVolume(37.5)");
  });

  it("does not publish a retired API query result into the replacement player", async () => {
    let complete!: (value: number) => void;
    await mount(); await ready(); await press("Show API experiments");
    current().getVolume.mockImplementationOnce(() => new Promise<number>((resolve) => { complete = resolve; }));
    await text("Filter API operations", "getVolume"); await press("Player.getVolume"); await press("Run selected API");
    await press("Sports"); await ready(); await press("Show API experiments");
    await act(async () => complete(12345));
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).not.toContain("12345");
  });

  it("shows named event payloads, redacts credentials and ignores retired event proxies", async () => {
    vi.useFakeTimers();
    try {
      await mount(); await ready(); await press("Show API experiments");
      const oldView = element("PlayerView").props;
      await act(async () => { oldView.onCastAvailable({ type: "castAvailable", device: "receiver", licenseKey: "PRIVATE" }); vi.advanceTimersByTime(125); });
      const eventLog = () => element("Text", { accessibilityLabel: "API event log" }).props.children as string;
      expect(eventLog()).toContain("onCastAvailable"); expect(eventLog()).toContain("receiver"); expect(eventLog()).not.toContain("PRIVATE");
      await press("Sports"); await ready(); await press("Show API experiments");
      await act(async () => { oldView.onCastAvailable({ type: "castAvailable", device: "retired-device" }); vi.advanceTimersByTime(125); });
      expect(eventLog()).not.toContain("retired-device");
    } finally { vi.useRealTimers(); }
  });

  it("keeps Android SDK touches inside the player until every player pointer ends or cancels", async () => {
    await mount(); await ready();
    const playerArea = () => element("View", { testID: "player-lab-player" });
    const scroll = () => element("ScrollView", { testID: "player-lab-screen" });
    const touch = (identifier: string, remaining: string[]) => ({ nativeEvent: {
      identifier, touches: remaining.map((identifier) => ({ identifier })),
    } });
    expect(scroll().props.scrollEnabled).not.toBe(false);
    expect(playerArea().props.onTouchStartCapture).toBeTypeOf("function");
    await act(async () => playerArea().props.onTouchStartCapture(touch("one", ["one"])));
    expect(scroll().props.scrollEnabled).toBe(false);
    await act(async () => playerArea().props.onTouchStartCapture(touch("two", ["one", "two"])));
    await act(async () => element("PlayerView").props.onSourceLoaded());
    expect(scroll().props.scrollEnabled).toBe(false);
    await act(async () => playerArea().props.onTouchEndCapture(touch("one", ["two"])));
    expect(scroll().props.scrollEnabled).toBe(false);
    await act(async () => playerArea().props.onTouchCancelCapture(touch("two", [])));
    expect(scroll().props.scrollEnabled).toBe(true);
    await act(async () => playerArea().props.onTouchStartCapture(touch("three", ["three", "outside"])));
    await act(async () => playerArea().props.onTouchEndCapture(touch("three", ["outside"])));
    expect(scroll().props.scrollEnabled).toBe(true);
    // Form fingers that never started in the video must not keep it locked.
    await press("Show configuration");
    await text("Source title", "Form remains editable");
    expect(input("Source title").props.value).toBe("Form remains editable");
  });

  it("releases an Android touch on player replacement and ignores the retired pane's notifications", async () => {
    await mount(); await ready();
    const playerArea = () => element("View", { testID: "player-lab-player" });
    const scroll = () => element("ScrollView", { testID: "player-lab-screen" });
    const touch = (identifier: string, remaining: string[]) => ({ nativeEvent: {
      identifier, touches: remaining.map((identifier) => ({ identifier })),
    } });
    const retired = playerArea().props;
    expect(retired.onTouchStartCapture).toBeTypeOf("function");
    await act(async () => retired.onTouchStartCapture(touch("old", ["old"])));
    await press("Sports");
    expect(scroll().props.scrollEnabled).toBe(true);
    await act(async () => playerArea().props.onTouchStartCapture(touch("new", ["new"])));
    expect(scroll().props.scrollEnabled).toBe(false);
    await act(async () => retired.onTouchCancelCapture(touch("old", [])));
    await act(async () => retired.onTouchStartCapture(touch("late", ["late"])));
    expect(scroll().props.scrollEnabled).toBe(false);
    await act(async () => playerArea().props.onTouchEndCapture(touch("new", [])));
    expect(scroll().props.scrollEnabled).toBe(true);
  });

  it("keeps the iOS player and form scroll handling unchanged", async () => {
    runtime.os = "ios";
    await mount(); await ready();
    const playerArea = element("View", { testID: "player-lab-player" });
    expect(playerArea.props.onTouchStartCapture).toBeUndefined();
    expect(playerArea.props.onTouchEndCapture).toBeUndefined();
    expect(playerArea.props.onTouchCancelCapture).toBeUndefined();
    expect(element("ScrollView", { testID: "player-lab-screen" }).props.scrollEnabled).not.toBe(false);
  });

  it("applies one validated WebVTT track and exports only its applied metadata", async () => {
    await mount();
    await ready();
    await press("Show configuration");
    await text("External WebVTT URL", " https://example.com/captions.vtt ");
    await text("Subtitle label", " English captions ");
    await text("Subtitle language", "en-us");
    await act(async () => element("Switch", { accessibilityLabel: "Mark as default" }).props.onValueChange(true));
    await press("Apply and recreate player");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleTracks: [{
      url: "https://example.com/captions.vtt", label: "English captions", language: "en-US",
      identifier: "player-lab-external", format: "vtt", isDefault: true,
    }] }));
    await press("Show applied code");
    expect(input("Applied configuration code").props.value).toContain('"isDefault": true');
    await text("Subtitle label", "Only a draft");
    await press("Reset draft");
    expect(input("Subtitle label").props.value).toBe("English captions");
    await press("Sports");
    await ready();
    expect(current().load.mock.calls[current().load.mock.calls.length - 1]?.[0].subtitleTracks[0].language).toBe("en-US");
    await text("External WebVTT URL", "");
    await press("Apply and recreate player");
    await ready();
    expect(current().load.mock.calls[current().load.mock.calls.length - 1]?.[0]).not.toHaveProperty("subtitleTracks");
    expect(input("Subtitle label").props.value).toBe("");
  });

  it.each([
    ["External WebVTT URL", "file:///captions.vtt"],
    ["Subtitle label", "  "],
    ["Subtitle language", "not a language"],
  ])("keeps invalid external subtitle %s away from the SDK", async (label, value) => {
    await mount(); await ready(); await press("Show configuration");
    await text("External WebVTT URL", "https://example.com/captions.vtt");
    await text("Subtitle label", "English");
    await text("Subtitle language", "en");
    await text(label, value);
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
  });
  it("observes the real mounted owner only in the opt-in runtime entry and retires it on Apply", async () => {
    const monitor = createRuntimeMonitor();
    await act(async () => { screen = create(<App runtimeChecks={monitor} />); });
    expect(monitor.report()).toMatchObject({ created: 1, owner: { generation: 1, viewReady: false } });
    await ready();
    await act(async () => element("PlayerView").props.onSourceLoaded());
    expect(monitor.report().owner).toMatchObject({ viewReady: true, sourceLoads: 1, sourceLoaded: 1 });
    const oldView = element("PlayerView").props;
    await press("Show configuration");
    await text("Source title", "Runtime applied title");
    await press("Apply and recreate player");
    expect(monitor.report()).toMatchObject({ created: 2, retired: [{ generation: 1, wrapperDestroyed: true }],
      owner: { generation: 2, sourceLoaded: 0 }, app: { revision: 1, ui: "Default", logCount: 3 } });
    await act(async () => oldView.onSourceLoaded());
    expect(monitor.report().owner?.sourceLoaded).toBe(0);
  });
  it("places the iOS configuration inputs inside the ScrollView that adjusts for the keyboard", async () => {
    runtime.os = "ios";
    await mount();
    await ready();
    await press("Show configuration");
    const controls = [
      ...["Source URL", "Source title", "Start offset (seconds)", "Forward buffer (seconds)", "Maximum bitrate (bits per second)"].map(input),
      element("Switch", { accessibilityLabel: "Autoplay" }),
      element("Switch", { accessibilityLabel: "Mute on startup" }),
    ];
    const scrolls = controls.map((control) => {
      let parent = control.parent;
      while (parent && String(parent.type) !== "ScrollView") parent = parent.parent;
      return parent;
    });
    expect(scrolls[0]).not.toBeNull();
    expect(new Set(scrolls).size).toBe(1);
    expect(scrolls[0]!.props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it("does not acknowledge an older clipboard request beside newly applied code", async () => {
    let finish!: () => void;
    runtime.clipboard.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await mount();
    await ready();
    await press("Show configuration");
    await press("Show applied code");
    await press("Copy code");
    await text("Source title", "NEW_APPLIED_CODE");
    await press("Apply and recreate player");
    await act(async () => finish());
    const feedback = () => screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "Copied.");
    expect(feedback()).toHaveLength(0);
    await press("Copy code");
    expect(feedback()).toHaveLength(1);
    await text("Source title", "ANOTHER_APPLIED_CODE");
    await press("Apply and recreate player");
    expect(feedback()).toHaveLength(0);
  });

  it("exports the applied source and custom UI without copying draft edits or license values", async () => {
    await mount();
    await ready();
    await press("Show configuration");
    await press("Show applied code");
    const original = input("Applied configuration code").props.value as string;
    expect(original).toContain("YOUR_PLAYER_KEY");
    expect(original).not.toContain("test-license");
    await text("Source title", "ONLY_AFTER_APPLY");
    await press("Copy code");
    expect(runtime.clipboard).toHaveBeenLastCalledWith(original);
    expect(input("Applied configuration code").props.value).not.toContain("ONLY_AFTER_APPLY");
    await press("Apply and recreate player");
    expect(input("Applied configuration code").props.value).toContain("ONLY_AFTER_APPLY");
    await press("Sports");
    await press("Copy code");
    const copied = runtime.clipboard.mock.calls[runtime.clipboard.mock.calls.length - 1]?.[0];
    expect(copied).toContain("bitmovin.playerui.UIFactory.buildSportsUI");
    expect(copied).toContain("file:///android_asset/webui/bitmovinplayer-ui.js");
    expect(copied).not.toContain("test-license");
  });

  it("uses a local URL parser when the legacy native URL getters are unavailable", async () => {
    class LegacyURL {
      get protocol(): string { throw new Error("URL.protocol is not implemented"); }
      get hostname(): string { throw new Error("URL.hostname is not implemented"); }
    }
    vi.stubGlobal("URL", LegacyURL);
    try {
      await mount();
      await ready();
      await press("Show configuration");
      await text("Source URL", "HTTPS://example.com/movie.m3u8");
      await press("Apply and recreate player");
      await ready();
      expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ url: "HTTPS://example.com/movie.m3u8" }));
      expect(globalThis.URL).toBe(LegacyURL);
    } finally { vi.unstubAllGlobals(); }
  });
  it("waits for the native view and applies validated drafts to a replacement player", async () => {
    await mount();
    expect(current().load).not.toHaveBeenCalled();
    await ready();
    expect(current().load).toHaveBeenCalledTimes(1);
    await press("Show configuration");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    await text("Source URL", "https://example.com/movie.m3u8");
    await press("HLS");
    await text("Source title", "Custom stream");
    await text("Poster URL", "https://example.com/poster.jpg");
    await text("Start offset (seconds)", "-20.5");
    await press("End");
    await text("Forward buffer (seconds)", "30");
    await text("Maximum bitrate (bits per second)", "2500000");
    await act(async () => element("Switch", { accessibilityLabel: "Autoplay" }).props.onValueChange(true));
    await act(async () => element("Switch", { accessibilityLabel: "Mute on startup" }).props.onValueChange(true));
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
    const old = current();
    await press("Apply and recreate player");
    expect(old.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.players).toHaveLength(2);
    expect(current().config).toMatchObject({
      playbackConfig: { isAutoplayEnabled: true, isMuted: true },
      bufferConfig: { audioAndVideo: { forwardDuration: 30 } },
      adaptationConfig: { maxSelectableBitrate: 2500000 },
    });
    expect(current().load).not.toHaveBeenCalled();
    await ready();
    expect(current().load).toHaveBeenCalledWith({
      url: "https://example.com/movie.m3u8", type: "hls", title: "Custom stream", poster: "https://example.com/poster.jpg",
      options: { startOffset: -20.5, startOffsetTimelineReference: "end" },
    });
    expect(button("Apply and recreate player").props.disabled).toBe(true);
  });

  it("keeps invalid drafts away from the SDK and resets drafts without recreating", async () => {
    await mount();
    await ready();
    await press("Show configuration");
    for (const [label, value] of [["Source URL", "javascript:alert(1)"], ["Start offset (seconds)", "Infinity"], ["Forward buffer (seconds)", "0"], ["Maximum bitrate (bits per second)", "-1"]]) {
      await text(label!, value!);
    }
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("HTTP");
    await press("Reset draft");
    expect(input("Forward buffer (seconds)").props.value).toBe("");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.players).toHaveLength(1);
  });

  it("keeps the full custom source, UI, log and DVR flag across Apply and ignores old view callbacks", async () => {
    await mount();
    await ready();
    await act(async () => element("Switch", { accessibilityLabel: "Allow DVR" }).props.onValueChange(false));
    await act(async () => element("PlayerView").props.onSourceLoaded());
    await act(async () => { element("PlayerView").props.onPlayerError(); element("PlayerView").props.onSourceError(); });
    const oldView = element("PlayerView").props;
    const old = current();
    await press("Show configuration");
    await text("Source URL", "https://example.com/retained.m3u8");
    await press("HLS");
    await text("Source title", "Retained title");
    await text("Poster URL", "https://example.com/retained.jpg");
    await press("Apply and recreate player");
    await ready();
    await press("Sports");
    await ready();
    await act(async () => element("Switch", { accessibilityLabel: "Mute on startup" }).props.onValueChange(true));
    await press("Apply and recreate player");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://example.com/retained.m3u8", title: "Retained title", poster: "https://example.com/retained.jpg" }));
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(1);
    expect(button("Sports").props.disabled).toBe(true);
    expect(current().config).toHaveProperty("styleConfig.playerUiJs");
    const loads = old.load.mock.calls.length;
    await act(async () => { oldView.onPlayerViewReady(); oldView.onSourceLoaded(); oldView.onPlayerError(); oldView.onSourceError(); });
    expect(old.load).toHaveBeenCalledTimes(loads);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(1);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "Player error")).toHaveLength(1);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "Source error")).toHaveLength(1);
  });

  it("logs numeric SDK error codes without copying SDK messages", async () => {
    await mount();
    await ready();
    await act(async () => {
      element("PlayerView").props.onPlayerError({ code: 1000, message: "opaque SDK detail" });
      element("PlayerView").props.onSourceError({ code: 2000, message: "opaque SDK detail" });
    });
    const labels = screen.root.findAll((node) => String(node.type) === "Text").map((node) => node.props.children);
    expect(labels).toContain("Player error (1000)");
    expect(labels).toContain("Source error (2000)");
    expect(labels).not.toContain("opaque SDK detail");
  });

  it.each([
    ["Source URL", "https:example.com/movie.m3u8"],
    ["Source URL", "https://example.com/a b.m3u8"],
    ["Poster URL", "data:image/png;base64,abc"],
    ["Start offset (seconds)", "Infinity"],
    ["Start offset (seconds)", "0x10"],
    ["Forward buffer (seconds)", "0"],
    ["Forward buffer (seconds)", "-5"],
    ["Maximum bitrate (bits per second)", "0"],
    ["Maximum bitrate (bits per second)", "2mbps"],
    ["Maximum bitrate (bits per second)", "0.5"],
    ["Maximum bitrate (bits per second)", "2147483648"],
    ["Maximum bitrate (bits per second)", "2147483646.99999999"],
    ["Maximum bitrate (bits per second)", "9007199254740992"],
  ])("rejects invalid %s input %s without replacing the active SDK owner", async (label, value) => {
    await mount();
    await ready();
    await press("Show configuration");
    await text(label, value);
    await press("Apply and recreate player");
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
  });

  it.each(["0.5", "9007199254740992", "9007199254740990.5", "1.0000000000000000001"])("rejects iOS bitrate bridge input %s without recreating", async (value) => {
    runtime.os = "ios";
    await mount();
    await ready();
    await press("Show configuration");
    await text("Maximum bitrate (bits per second)", value);
    await press("Apply and recreate player");
    expect(element("Text", { accessibilityRole: "alert" })).toBeDefined();
    expect(runtime.players).toHaveLength(1);
    expect(current().load).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["android", "2147483647", 2147483647],
    ["android", "2500000.0", 2500000],
    ["ios", "2147483648", 2147483648],
    ["ios", "9007199254740991", 9007199254740991],
  ])("preserves the exact %s bitrate bridge boundary %s", async (platform, value, expected) => {
    runtime.os = String(platform);
    await mount();
    await ready();
    await press("Show configuration");
    await text("Maximum bitrate (bits per second)", String(value));
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(2);
    expect(current().config).toMatchObject({ adaptationConfig: { maxSelectableBitrate: expected } });
  });

  it("loads presets immediately and retains the chosen source through subsequent recreation", async () => {
    await mount();
    await ready();
    await press("VOD HLS");
    const calls = current().load.mock.calls;
    const selected = calls[calls.length - 1]![0];
    expect(selected).toMatchObject({ type: "hls", title: "VOD HLS" });
    await press("Cinema");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(selected);
    await press("Show configuration");
    await text("Source URL", `  ${selected.url}  `);
    const count = runtime.players.length;
    await press("Apply and recreate player");
    expect(runtime.players).toHaveLength(count);
    expect(button("Apply and recreate player").props.disabled).toBe(true);
  });

  it("discards a pending retired snapshot after Apply while the replacement keeps its own state", async () => {
    await mount();
    await ready();
    const old = current();
    let finish!: (value: number) => void;
    old.getMaxTimeShift.mockReturnValueOnce(new Promise<number>((resolve) => { finish = resolve; }));
    old.isLive.mockResolvedValueOnce(false);
    old.getDuration.mockResolvedValueOnce(120);
    await act(async () => element("PlayerView").props.onTimeChanged());
    await press("Show configuration");
    await text("Source title", "Replacement source");
    await press("Apply and recreate player");
    await ready();
    await act(async () => finish(-1500));
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "live→VOD detected (poll)")).toEqual([]);
    const status = screen.root.findAll((node) => String(node.type) === "Text" && typeof node.props.children === "string" && node.props.children.includes("window="))[0]!;
    expect(status.props.children).toContain("window=900s");
  });

  it("offers HLS/progressive on iOS, starts with HLS, and preserves the iOS zero-buffer meaning", async () => {
    runtime.os = "ios";
    await mount();
    await ready();
    expect(current().load).toHaveBeenCalledWith(expect.objectContaining({ type: "hls" }));
    await press("Show configuration");
    expect(screen.root.findAll((node) => String(node.type) === "Button" && String(node.props.title).includes("DASH"))).toEqual([]);
    await text("Forward buffer (seconds)", "0");
    await press("Apply and recreate player");
    expect(current().config).toMatchObject({ bufferConfig: { audioAndVideo: { forwardDuration: 0 } } });
    await ready();
    await press("Progressive MP4");
    await text("Source URL", "https://example.com/movie.mp4");
    await text("Forward buffer (seconds)", "");
    await text("Maximum bitrate (bits per second)", "");
    await press("Apply and recreate player");
    expect(current().config).not.toHaveProperty("bufferConfig");
    expect(current().config).not.toHaveProperty("adaptationConfig");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ type: "progressive" }));
  });
});
