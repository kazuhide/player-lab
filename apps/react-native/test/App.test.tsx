import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import path from "node:path";
import { HttpRequestType, type PlayerConfig } from "bitmovin-player-react-native";

const runtime = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_BITMOVIN_PLAYER_LICENSE_KEY = "test-license";
  process.env.EXPO_PUBLIC_BITMOVIN_ANALYTICS_LICENSE_KEY = "";
  return { castHost: undefined as undefined | { readOptions: ReturnType<typeof vi.fn>; saveOptions: ReturnType<typeof vi.fn> }, os: "android", keyboardDismiss: vi.fn(),
    keyboardListeners: new Map<string, Set<() => void>>(), window: { width: 393, height: 852, fontScale: 1, scale: 1 }, hostTop: 0,
    clipboard: vi.fn(async (_code: string) => {}), editorScrollY: 0, scrollEditor: vi.fn(), scrollEditorEnd: vi.fn(), apiScrollY: 0, scrollApi: vi.fn(), players: [] as Array<{
    config: PlayerConfig;
    load: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    getMaxTimeShift: ReturnType<typeof vi.fn>;
    isLive: ReturnType<typeof vi.fn>;
    getDuration: ReturnType<typeof vi.fn>;
    setVolume: ReturnType<typeof vi.fn>;
    getVolume: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
  }> };
});

vi.mock("react-native", () => ({
  Button: "Button", Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", StatusBar: "StatusBar", Switch: "Switch", Text: "Text", TextInput: "TextInput", View: "View", SafeAreaView: "SafeAreaView", KeyboardAvoidingView: "KeyboardAvoidingView",
  useWindowDimensions: () => runtime.window,
  Platform: { get OS() { return runtime.os; }, get Version() { return runtime.os === "ios" ? "15.1" : 36; }, select: (options: Record<string, string>) => options[runtime.os] ?? options.default },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Keyboard: { dismiss: runtime.keyboardDismiss, addListener: (name: string, callback: () => void) => {
    const listeners = runtime.keyboardListeners.get(name) ?? new Set<() => void>();
    listeners.add(callback); runtime.keyboardListeners.set(name, listeners);
    return { remove() { listeners.delete(callback); } };
  } },
  NativeModules: { get PlayerLabCastHost() { return runtime.castHost; } },
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: runtime.clipboard }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView",
  useSafeAreaFrame: () => ({ x: 0, y: runtime.hostTop, width: runtime.window.width, height: runtime.window.height }),
}));

vi.mock("bitmovin-player-react-native", async () => {
  const { useState } = await import("react");
  class MockSource {
    nativeId = "app-mock-source";
    isInitialized = false;
    isDestroyed = false;
    constructor(public config: import("bitmovin-player-react-native").SourceConfig) {}
    initialize = vi.fn(async () => { this.isInitialized = true; });
    destroy = vi.fn(() => { this.isDestroyed = true; });
    loadingState = vi.fn(async () => 2);
  }
  return {
    CustomUi: class { constructor(public factoryFunction: string) {} },
    PlayerView: "PlayerView",
    OfflineEventType: { onCompleted: "onCompleted", onError: "onError", onProgress: "onProgress", onOptionsAvailable: "onOptionsAvailable", onDrmLicenseUpdated: "onDrmLicenseUpdated", onDrmLicenseExpired: "onDrmLicenseExpired", onSuspended: "onSuspended", onResumed: "onResumed", onCanceled: "onCanceled" },
    Source: MockSource,
    CustomMessageHandler: class {
      constructor(private readonly options: { onReceivedSynchronousMessage: (message: string, data: string | undefined) => string | undefined; onReceivedAsynchronousMessage: (message: string, data: string | undefined) => void }) {}
      receivedSynchronousMessage(message: string, data: string | undefined) { return this.options.onReceivedSynchronousMessage(message, data); }
      receivedAsynchronousMessage(message: string, data: string | undefined) { return this.options.onReceivedAsynchronousMessage(message, data); }
      sendMessage = vi.fn();
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
    BufferType: { FORWARD_DURATION: "forwardDuration", BACKWARD_DURATION: "backwardDuration" },
    ForceReuseVideoCodecReason: { ColorInfoMismatch: "ColorInfoMismatch", MaxInputSizeExceeded: "MaxInputSizeExceeded", MaxResolutionExceeded: "MaxResolutionExceeded" },
    PictureInPictureAction: { TogglePlayback: "TogglePlayback", Seek: "Seek" },
    usePlayer: (config: PlayerConfig) => useState(() => {
      const player = {
        config,
        source: undefined as MockSource | undefined,
        load: vi.fn((configuration: import("bitmovin-player-react-native").SourceConfig) => player.loadSource(new MockSource(configuration))),
        loadSource: vi.fn((source: MockSource) => { player.source = source; void source.initialize().then(() => {}); }),
        unload: vi.fn(), buffer: { getLevel: vi.fn(async () => 5), setTargetLevel: vi.fn() }, isDestroyed: false, destroy: vi.fn(() => { player.isDestroyed = true; }), timeShift: vi.fn(),
        isAd: vi.fn(async () => false), skipAd: vi.fn(), isCastAvailable: vi.fn(async () => false), isCasting: vi.fn(async () => false),
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
function visible(node: ReactTestInstance): boolean {
  for (let parent: ReactTestInstance | null = node; parent; parent = parent.parent) {
    if (parent.props.accessibilityElementsHidden === true || parent.props.importantForAccessibility === "no-hide-descendants") return false;
  }
  return true;
}
const button = (title: string) => {
  const label = title === "Apply and recreate player" ? "Apply configuration" : title === "適用してプレイヤーを再作成" ? "設定を適用" : title;
  return screen.root.findAll(node => visible(node) && ((String(node.type) === "Button" && node.props.title === label)
    || (String(node.type) === "Pressable" && node.props.accessibilityLabel === label)))[0]!;
};
const input = (label: string) => element("TextInput", { accessibilityLabel: label });
const current = () => runtime.players[runtime.players.length - 1]!;
async function tap(testID: string) { await act(async () => element("Pressable", { testID }).props.onPress()); }
async function settingsGroup(group: string) {
  await tap("workspace-nav-settings");
  await tap("configuration-group-selector");
  await tap(`configuration-group-selector-option-${group}`);
}
async function basicField(group: string, field: string) {
  await settingsGroup(group); await tap("workspace-setting-selector"); await tap(`workspace-setting-selector-option-${field}`);
}
async function toggle(label: string, value: boolean) {
  if (label === "Autoplay") await basicField("player", "autoplay");
  if (label === "Mute on startup") await basicField("player", "muted");
  if (label === "Mark as default") await basicField("source", "subtitleDefault");
  if (label === "Allow DVR") await tap("workspace-nav-more");
  await act(async () => element("Switch", { accessibilityLabel: label }).props.onValueChange(value));
}
async function press(title: string) {
  if (title === "Show configuration") { await tap("workspace-nav-settings"); return; }
  if (title === "Show API experiments") { await tap("workspace-nav-apis"); return; }
  if (title === "Show applied code") {
    await tap("workspace-nav-code");
    if (!button(title)) return;
  }
  if (["Copy code", "Hide applied code"].includes(title)) await tap("workspace-nav-code");
  if (["HLS", "DASH", "Progressive MP4"].includes(title)) await basicField("source", "type");
  if (["Start", "End", "SDK default"].includes(title)) await basicField("source", "timeline");
  if (["Apply and recreate player", "Reset draft"].includes(title)) await tap("workspace-nav-settings");
  if (title === "Run selected API") await tap("workspace-nav-apis");
  if (title === "Recreate player after API experiments") { await tap("workspace-nav-apis"); await tap("api-view-selector"); await tap("api-view-selector-option-help"); }
  if (["-10s", "-30s", "-60s", "Live edge"].includes(title)) await tap("workspace-nav-more");
  if (["Set this API value", "Remove this API override"].includes(title)) await settingsGroup("sdk");
  if (["Edit this callback", "Remove this callback"].includes(title)) await settingsGroup("callbacks");
  if (["Edit this list", "Add list item", "Add track role", "Unset track roles", "SourceConfig.subtitleTracks", "OfflineContentConfig.sourceConfig.subtitleTracks", "PlayerConfig.advertisingConfig.schedule"].includes(title)) await settingsGroup("arrays");
  if (["Save Cast options for next launch", "Read native Cast startup state"].includes(title)) await settingsGroup("cast");
  if (["Pause event log", "Resume event log", "Clear API event log"].includes(title)) {
    await tap("workspace-nav-apis"); await tap("api-view-selector"); await tap("api-view-selector-option-events");
  }
  if (!button(title) && ["Default", "Sports", "Live (DVR)", "Cinema"].includes(title)) await tap("theme-selector");
  if (!button(title) && ["VOD HLS", "VOD DASH", "Live HLS", "Live DASH + DVR", "Live DASH + Multi-audio", "Live DASH + Subtitles"].includes(title)) await tap("source-selector");
  await act(async () => button(title).props.onPress());
}
async function text(label: string, value: string) {
  if (label === "Filter API operations") {
    await tap("workspace-nav-apis"); await tap("api-view-selector"); await tap("api-view-selector-option-operations");
    await tap("api-operation-selector");
    await act(async () => input("Find API operation").props.onChangeText(value));
    return;
  }
  if (label === "Filter configuration APIs" || label === "Filter callback APIs") {
    const callback = label === "Filter callback APIs";
    await settingsGroup(callback ? "callbacks" : "sdk");
    await tap(callback ? "callback-selector" : "sdk-setting-selector");
    await act(async () => input(callback ? "Find Callback API" : "Find Configuration API").props.onChangeText(value));
    return;
  }
  const basic: Record<string, [string, string]> = {
    "Source URL": ["source", "url"], "Source title": ["source", "title"], "Poster URL": ["source", "poster"],
    "Start offset (seconds)": ["source", "startOffset"], "External WebVTT URL": ["source", "subtitleUrl"],
    "Subtitle label": ["source", "subtitleLabel"], "Subtitle language": ["source", "subtitleLanguage"],
    "Forward buffer (seconds)": ["player", "forwardDuration"], "Maximum bitrate (bits per second)": ["player", "maxBitrate"],
  };
  if (basic[label]) {
    const [group, field] = basic[label];
    await basicField(group, field);
  }
  await act(async () => input(label).props.onChangeText(value));
}
async function ready() { await act(async () => element("PlayerView").props.onPlayerViewReady()); }

beforeEach(async () => {
  runtime.os = "android";
  runtime.players.length = 0;
  runtime.castHost = undefined;
  runtime.clipboard.mockClear();
  runtime.keyboardDismiss.mockClear();
  runtime.keyboardListeners.clear();
  runtime.window = { width: 393, height: 852, fontScale: 1, scale: 1 };
  runtime.hostTop = 0;
  runtime.editorScrollY = 0;
  runtime.scrollEditor.mockClear();
  runtime.scrollEditorEnd.mockClear();
  runtime.scrollEditor.mockImplementation(({ y }: { y: number }) => { runtime.editorScrollY = y; });
  runtime.apiScrollY = 0;
  runtime.scrollApi.mockClear();
  runtime.scrollApi.mockImplementation(({ y }: { y: number }) => { runtime.apiScrollY = y; });
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  errors = vi.spyOn(console, "error");
});

afterEach(async () => {
  if (screen) await act(async () => screen.unmount());
  vi.unstubAllGlobals();
  // React 19 deprecates this renderer. Native hosts are mocked; act/runtime errors still fail.
  const unexpected = errors.mock.calls.filter(([message]) => !String(message).startsWith("react-test-renderer is deprecated."));
  errors.mockRestore();
  expect(unexpected).toEqual([]);
});

function expectValidCode(code: string): void {
  const file = path.resolve("generated-configuration-example.tsx");
  const configFile = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.resolve(".")).options;
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, onError, create) => name === file ? ts.createSourceFile(file, code, language, true, ts.ScriptKind.TSX) : read(name, language, onError, create);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
}

async function mount() {
  await act(async () => { screen = create(<App />, { createNodeMock: element =>
    String(element.type) === "ScrollView" && element.props.testID === "configuration-fields-scroll"
      ? { scrollTo: runtime.scrollEditor, scrollToEnd: runtime.scrollEditorEnd } : String(element.type) === "ScrollView" && element.props.testID === "api-fields-scroll"
        ? { scrollTo: runtime.scrollApi } : null }); });
}

describe("React Native configuration in the mounted App", () => {
  it("connects the native UI preference channel and sends paused changes without reloading", async () => {
    await act(async () => { screen = create(<App />); });
    await ready();
    const original = current();
    const loads = original.load.mock.calls.length;
    const props = element("PlayerView").props;
    expect(props.customMessageHandler).toBeDefined();
    props.customMessageHandler.receivedAsynchronousMessage("playerlab-live-rewind-ready", undefined);
    expect(props.customMessageHandler.sendMessage).toHaveBeenLastCalledWith("playerlab-live-rewind-enabled", "true");
    await toggle("Allow DVR", false);
    expect(element("PlayerView").props.customMessageHandler).toBe(props.customMessageHandler);
    expect(props.customMessageHandler.sendMessage).toHaveBeenLastCalledWith("playerlab-live-rewind-enabled", "false");
    expect(runtime.players).toHaveLength(1);
    expect(original.load).toHaveBeenCalledTimes(loads);
    expect(original.destroy).not.toHaveBeenCalled();
  });

  it("marks skipAd unavailable in the ordinary-source picker with recording paused", async () => {
    await act(async () => { screen = create(<App />); });
    await ready();
    await press("Pause event log");
    await text("Filter API operations", "Player.skipAd");
    const choice = element("Pressable", { testID: "api-operation-selector-option-Player.skipAd" });
    expect(choice.props.accessibilityState.disabled).toBe(true);
    expect(choice.props.disabled).toBe(true);
  });

  it("tracks pause ads independently of isAd and blocks a stale skip after the ad finishes", async () => {
    await mount(); await ready(); await press("Pause event log");
    const owner = current();
    await act(async () => element("PlayerView").props.onNonLinearAdStarted({ ad: { isLinear: false } }));
    await text("Filter API operations", "Player.skipAd");
    expect(element("Pressable", { testID: "api-operation-selector-option-Player.skipAd" }).props.disabled).toBe(false);
    await press("Player.skipAd");
    const stale = element("Pressable", { testID: "api-run" }).props.onPress;
    expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(false);
    await act(async () => element("PlayerView").props.onNonLinearAdFinished({ ad: { isLinear: false } }));
    expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(true);
    await act(async () => stale());
    expect(Reflect.get(owner, "skipAd")).not.toHaveBeenCalled();
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("No active ad");
  });

  it("reads the latest linear-ad state immediately before native skip dispatch", async () => {
    await mount(); await ready();
    const owner = current();
    const isAd = Reflect.get(owner, "isAd");
    isAd.mockResolvedValue(true);
    await act(async () => element("PlayerView").props.onAdStarted({ skipOffset: 0, clientType: "bitmovin" }));
    await text("Filter API operations", "Player.skipAd"); await press("Player.skipAd");
    isAd.mockResolvedValue(false);
    await press("Run selected API");
    expect(Reflect.get(owner, "skipAd")).not.toHaveBeenCalled();
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("No active ad");
  });

  it("never dispatches a native command when a timed-out availability read finishes later", async () => {
    await mount(); await ready();
    const owner = current();
    Reflect.get(owner, "isAd").mockResolvedValue(true);
    await act(async () => element("PlayerView").props.onAdStarted({ skipOffset: 0, clientType: "bitmovin" }));
    await text("Filter API operations", "Player.skipAd"); await press("Player.skipAd");
    let finish!: (value: number) => void;
    owner.getMaxTimeShift.mockReturnValueOnce(new Promise<number>(resolve => { finish = resolve; }));
    vi.useFakeTimers();
    try {
      await press("Run selected API");
      await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
      expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("No response within 10 seconds");
      await act(async () => finish(-900));
      expect(Reflect.get(owner, "skipAd")).not.toHaveBeenCalled();
      expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("qualifies skip from the native ad clock and disables IMA while event recording is paused", async () => {
    await mount(); await ready(); await press("Pause event log");
    const owner = current();
    owner.isLive.mockResolvedValue(false);
    Reflect.get(owner, "isAd").mockResolvedValue(true);
    const clock = Reflect.get(owner, "getCurrentTime");
    clock.mockResolvedValue(4.9);
    await act(async () => element("PlayerView").props.onAdStarted({ skipOffset: 5, clientType: "bitmovin" }));
    await text("Filter API operations", "Player.skipAd");
    expect(element("Pressable", { testID: "api-operation-selector-option-Player.skipAd" }).props.disabled).toBe(true);
    await act(async () => button("Close").props.onPress());
    clock.mockResolvedValue(5);
    await act(async () => element("PlayerView").props.onTimeChanged());
    await text("Filter API operations", "Player.skipAd");
    expect(element("Pressable", { testID: "api-operation-selector-option-Player.skipAd" }).props.disabled).toBe(false);
    await press("Player.skipAd"); await press("Run selected API");
    expect(Reflect.get(owner, "skipAd")).toHaveBeenCalledOnce();
    expect(clock).toHaveBeenCalledWith("relative");
    await act(async () => element("PlayerView").props.onAdStarted({ skipOffset: 0, clientType: "ima" }));
    expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(true);
    expect(element("Text", { testID: "api-unavailable-reason" }).props.children).toBe("Programmatic skipping is unavailable for IMA ads.");
  });

  it("refreshes the actual ad threshold before dispatch instead of trusting the enabled Run state", async () => {
    await mount(); await ready();
    const owner = current(); owner.isLive.mockResolvedValue(false);
    Reflect.get(owner, "isAd").mockResolvedValue(true);
    const clock = Reflect.get(owner, "getCurrentTime"); clock.mockResolvedValue(5);
    await act(async () => element("PlayerView").props.onAdStarted({ skipOffset: 5, clientType: "bitmovin" }));
    await text("Filter API operations", "Player.skipAd"); await press("Player.skipAd");
    expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(false);
    clock.mockResolvedValue(4);
    await press("Run selected API");
    expect(Reflect.get(owner, "skipAd")).not.toHaveBeenCalled();
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toBe("Wait until the ad's skip offset is reached.");
  });

  it("updates seek availability from native live-to-VOD state while DVR stays disabled", async () => {
    await mount(); await ready(); await toggle("Allow DVR", false);
    await text("Filter API operations", "Player.seek");
    expect(element("Pressable", { testID: "api-operation-selector-option-Player.seek" }).props.disabled).toBe(true);
    await act(async () => button("Close").props.onPress());
    current().isLive.mockResolvedValue(false); current().getDuration.mockResolvedValue(60);
    await act(async () => element("PlayerView").props.onTimeChanged());
    await text("Filter API operations", "Player.seek");
    expect(element("Pressable", { testID: "api-operation-selector-option-Player.seek" }).props.disabled).toBe(false);
    await press("Player.seek");
    expect(element("Pressable", { testID: "api-run" }).props.disabled).toBe(false);
  });

  it("shows field differences, clears reverted edits, and retains differences after validation failure", async () => {
    await mount(); await ready();
    await basicField("source", "title");
    const original = input("Source title").props.value;
    await text("Source title", "Edited title");
    expect(element("View", { testID: "configuration-difference-title" })).toBeDefined();
    await text("Source title", original);
    expect(element("View", { testID: "configuration-difference-title" })).toBeUndefined();
    await text("Source title", "Applied title");
    await tap("configuration-apply"); await ready();
    await settingsGroup("player");
    await text("Forward buffer (seconds)", "invalid");
    await tap("configuration-apply");
    expect(element("View", { testID: "configuration-difference-forwardDuration" })).toBeDefined();
    await tap("configuration-reset");
    expect(element("View", { testID: "configuration-difference-forwardDuration" })).toBeUndefined();
    for (let parent = element("View", { testID: "configuration-actions" }).parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
  });

  it("indicates changed secret values with redacted before and after values and clears an exact revert", async () => {
    const id = "PlayerConfig.analyticsConfig.licenseKey";
    const testID = `configuration-difference-apiSettings.${id}`;
    await mount(); await ready();
    await text("Filter configuration APIs", id); await press(id); await press("Set this API value");
    await text(`Value for ${id}`, "first-private-value");
    await tap("configuration-apply"); await ready();
    await text(`Value for ${id}`, "second-private-value");
    const row = element("View", { testID });
    expect(row).toBeDefined();
    const values = row.findAll(node => String(node.type) === "Text").map(node => node.props.children);
    expect(values.filter(value => value === "[redacted]")).toHaveLength(2);
    expect(JSON.stringify(values)).not.toContain("first-private-value");
    expect(JSON.stringify(values)).not.toContain("second-private-value");
    await text(`Value for ${id}`, "first-private-value");
    expect(element("View", { testID })).toBeUndefined();
    expect(element("Pressable", { testID: "configuration-apply" }).props.disabled).toBe(true);
  });

  it("masks complete URL userinfo in the comparison while retaining the exact SDK input", async () => {
    const url = "https://user:p@ss@example.test/a?email=user@example.test#contact=other@example.test";
    const expected = "https://[redacted]@example.test/a?email=user@example.test#contact=other@example.test";
    await mount(); await ready();
    await text("Source URL", url);
    const row = element("View", { testID: "configuration-difference-url" });
    const values = row.findAll(node => String(node.type) === "Text").map(node => node.props.children);
    expect(values).toContain(expected);
    expect(input("Source URL").props.value).toBe(url);
    await tap("configuration-apply"); await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ url }));
  });

  it("shows added and removed overrides and clears a removal that reverts an unapplied addition", async () => {
    const id = "SourceConfig.description";
    const testID = `configuration-difference-apiSettings.${id}`;
    await mount(); await ready();
    await text("Filter configuration APIs", id); await press(id); await press("Set this API value");
    expect(element("View", { testID }).findAll(node => String(node.type) === "Text").map(node => node.props.children)).toContain("Added");
    await press("Remove this API override");
    expect(element("View", { testID })).toBeUndefined();
    expect(element("Pressable", { testID: "configuration-apply" }).props.disabled).toBe(true);
    await press("Set this API value"); await text(`Value for ${id}`, "Applied description");
    await tap("configuration-apply"); await ready();
    await press("Remove this API override");
    expect(element("View", { testID }).findAll(node => String(node.type) === "Text").map(node => node.props.children)).toContain("Removed");
    await tap("configuration-reset");
    expect(element("View", { testID })).toBeUndefined();
  });

  it.each(["android", "ios"])("keeps the %s compact input revealed after keyboard viewport and content changes", async os => {
    runtime.os = os;
    runtime.window = { width: 852, height: 393, fontScale: 1, scale: 1 };
    await mount(); await ready(); await text("Source title", "Retained landscape input");
    const owner = current();
    const originalInput = input("Source title");
    const editor = () => element("ScrollView", { testID: "configuration-fields-scroll" });
    expect(editor().props.onLayout).toBeUndefined();
    expect(editor().props.onContentSizeChange).toBeUndefined();
    runtime.keyboardDismiss.mockClear();
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    if (os === "android") {
      await act(async () => editor().props.onLayout({ nativeEvent: { layout: { width: 900, height: 61 } } }));
      expect(runtime.scrollEditorEnd).toHaveBeenLastCalledWith({ animated: false });
      expect(runtime.scrollEditorEnd).toHaveBeenCalledTimes(1);
      await act(async () => editor().props.onContentSizeChange(900, 90));
      expect(runtime.scrollEditorEnd).toHaveBeenCalledTimes(2);
    } else {
      expect(editor().props.onLayout).toBeUndefined();
      expect(editor().props.onContentSizeChange).toBeUndefined();
      expect(runtime.scrollEditorEnd).not.toHaveBeenCalled();
    }
    expect(input("Source title")).toBe(originalInput);
    expect(input("Source title").props.value).toBe("Retained landscape input");
    expect(runtime.keyboardDismiss).not.toHaveBeenCalled();
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidHide") ?? []) listener(); });
    expect(editor().props.onLayout).toBeUndefined();
    expect(editor().props.onContentSizeChange).toBeUndefined();
    await settingsGroup("callbacks"); await press("Edit this callback");
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(editor().props.onLayout).toBeUndefined();
    expect(editor().props.onContentSizeChange).toBeUndefined();
    expect(element("Switch", { accessibilityLabel: "Allow edited JavaScript execution" }).props.value).toBe(false);
    expect(runtime.scrollEditorEnd).toHaveBeenCalledTimes(os === "android" ? 2 : 0);
  });

  it.each(["android", "ios"])("keeps the %s compact basic editor focused on its input until Done", async os => {
    runtime.os = os;
    runtime.window = { width: 393, height: 852, fontScale: 2, scale: 1 };
    await mount(); await ready();
    const owner = current();
    const applyHelp = () => screen.root.findAll(node => String(node.type) === "Text"
      && typeof node.props.children === "string" && node.props.children.startsWith("Apply recreates the player"));
    await text("Source title", "Large-text draft");
    expect(applyHelp()).toHaveLength(1);
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(applyHelp()).toHaveLength(0);
    expect(input("Source title").props.value).toBe("Large-text draft");
    expect(element("Pressable", { testID: "configuration-apply" }).props.disabled).toBe(false);
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidHide") ?? []) listener(); });
    expect(applyHelp()).toHaveLength(1);
    await text("Maximum bitrate (bits per second)", "3500000");
    const bitrateHelp = () => screen.root.findAll(node => String(node.type) === "Text"
      && node.props.children === "Positive whole bits per second; blank leaves it unlimited.");
    expect(bitrateHelp()).toHaveLength(1);
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(bitrateHelp()).toHaveLength(0);
    expect(applyHelp()).toHaveLength(0);
    expect(input("Maximum bitrate (bits per second)").props.value).toBe("3500000");
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidHide") ?? []) listener(); });
    expect(bitrateHelp()).toHaveLength(1);
    expect(applyHelp()).toHaveLength(1);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("retains %s callback permission, draft and scrolling during compact input", async os => {
    runtime.os = os;
    runtime.window = { width: 393, height: 852, fontScale: 2, scale: 1 };
    await mount(); await ready();
    await settingsGroup("callbacks");
    await press("Edit this callback");
    const bodyLabel = "JavaScript body for PlayerConfig.networkConfig.preprocessHttpRequest";
    const body = input(bodyLabel).props.value;
    runtime.editorScrollY = 160;
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(screen.root.findAll(node => String(node.type) === "Text" && typeof node.props.children === "string"
      && node.props.children.startsWith("Allow execution, then Apply."))).toHaveLength(1);
    expect(input(bodyLabel).props.value).toBe(body);
    expect(element("Switch", { accessibilityLabel: "Allow edited JavaScript execution" }).props.value).toBe(false);
    expect(runtime.editorScrollY).toBe(160);
    expect(current().destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("reserves the %s portrait editor for large text while the keyboard is open", async os => {
    runtime.os = os;
    runtime.window = { width: 393, height: 852, fontScale: 2, scale: 1 };
    await mount(); await ready(); await text("Source title", "Large-text draft");
    const owner = current();
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(element("Pressable", { testID: "configuration-done" })).toBeDefined();
    expect(element("Pressable", { testID: "workspace-nav-settings" })).toBeUndefined();
    expect(element("Text", { children: "Draft changes have not been applied." })).toBeUndefined();
    expect(input("Source title").props.value).toBe("Large-text draft");
    expect(element("Pressable", { testID: "configuration-apply" }).props.disabled).toBe(false);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("reveals selected %s API inputs while retaining their values across workspace navigation", async os => {
    runtime.os = os;
    await mount(); await ready();
    const owner = current();
    await tap("workspace-nav-apis"); await tap("api-view-selector"); await tap("api-view-selector-option-help");
    runtime.apiScrollY = 500;
    await tap("api-view-selector"); await tap("api-view-selector-option-operations");
    expect(runtime.apiScrollY).toBe(0);
    await text("Filter API operations", "Player.setVolume"); await press("Player.setVolume");
    await text("Volume (0–100)", "45");
    runtime.apiScrollY = 160;
    await press("日本語"); await press("English");
    await tap("workspace-nav-settings"); await tap("workspace-nav-apis");
    expect(runtime.apiScrollY).toBe(160);
    expect(input("Volume (0–100)").props.value).toBe("45");
    await tap("api-operation-selector"); await tap("api-operation-selector-option-Player.setVolume");
    expect(runtime.apiScrollY).toBe(0);
    expect(input("Volume (0–100)").props.value).toBe("45");
    runtime.apiScrollY = 200;
    await tap("api-operation-selector"); await tap("api-operation-selector-option-Player.getCurrentTime");
    expect(runtime.apiScrollY).toBe(0);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("starts the selected %s editor at its inputs without resetting drafts or playback", async os => {
    runtime.os = os;
    await mount(); await ready();
    const owner = current();
    await text("Source title", "Retained draft");
    await settingsGroup("cast");
    runtime.editorScrollY = 500;
    await settingsGroup("callbacks");
    expect(runtime.editorScrollY).toBe(0);
    await press("Edit this callback");
    runtime.editorScrollY = 160;
    await text("JavaScript body for PlayerConfig.networkConfig.preprocessHttpRequest", "return request;");
    await press("日本語"); await press("English");
    await tap("workspace-nav-code"); await tap("workspace-nav-settings");
    expect(runtime.editorScrollY).toBe(160);
    expect(input("JavaScript body for PlayerConfig.networkConfig.preprocessHttpRequest").props.value).toBe("return request;");
    await settingsGroup("callbacks");
    expect(runtime.editorScrollY).toBe(0);
    await basicField("source", "title");
    expect(input("Source title").props.value).toBe("Retained draft");
    runtime.editorScrollY = 200;
    await tap("workspace-setting-selector"); await tap("workspace-setting-selector-option-title");
    expect(runtime.editorScrollY).toBe(0);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"].flatMap(os => ["apis", "code", "more"].map(tab => ({ os, tab }))))(
    "recovers the $os configuration from $tab when an approved handler fails on recreation", async ({ os, tab }) => {
      runtime.os = os;
      vi.stubGlobal("__playerLabRecoveryRuns", 0);
      await mount(); await ready();
      const id = "PlayerViewProps.fullscreenHandler";
      await text("Filter callback APIs", id); await press(id); await press("Edit this callback");
      await text(`JavaScript body for ${id}`, `
globalThis.__playerLabRecoveryRuns += 1;
if (globalThis.__playerLabRecoveryRuns > 1) throw new Error("Factory unavailable");
return { isFullscreenActive: false, enterFullscreen() {}, exitFullscreen() {} };`);
      await act(async () => element("Switch", { accessibilityLabel: "Allow edited JavaScript execution" }).props.onValueChange(true));
      await press("Apply and recreate player"); await ready();
      const previous = current();
      await tap(`workspace-nav-${tab}`);
      if (tab === "apis") {
        await tap("api-view-selector"); await tap("api-view-selector-option-help");
        await act(async () => button("Recreate player after API experiments").props.onPress());
      } else if (tab === "code") {
        await tap("theme-selector"); await tap("theme-selector-option-Sports");
      } else {
        await tap("source-selector"); await tap("source-selector-option-vod-hls");
      }
      expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("handler factory");
      expect(element("PlayerView")).toBeUndefined();
      expect(previous.destroy).toHaveBeenCalledOnce();
      const settings = element("Pressable", { testID: "workspace-nav-settings" });
      expect(settings).toBeDefined();
      expect(visible(settings)).toBe(true);
      await act(async () => settings.props.onPress());
      await press("Remove this callback"); await press("Apply and recreate player"); await ready();
      expect(element("Text", { accessibilityRole: "alert" })).toBeUndefined();
      expect(element("PlayerView")).toBeDefined();
      expect(current()).not.toBe(previous);
      expect(current().destroy).not.toHaveBeenCalled();
    });

  it.each(["android", "ios"])("localizes %s application validation errors without replacing the player", async os => {
    runtime.os = os;
    await mount(); await ready();
    const owner = current();
    await text("Maximum bitrate (bits per second)", "0"); await press("日本語");
    await tap("configuration-apply");
    const maximum = os === "android" ? "2147483647" : "9007199254740991";
    expect(element("Text", { accessibilityRole: "alert" }).props.children)
      .toBe(`最大ビットレートには1から${maximum} bit/sまでの整数を入力してください。空欄では上限を設けません。`);
    await press("English");
    await text("Maximum bitrate (bits per second)", "Infinity"); await press("日本語");
    await tap("configuration-apply");
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toBe("最大ビットレートには有限の数値を入力してください。");
    await tap("configuration-reset"); await press("English");
    await press("Edit this callback");
    await text("JavaScript body for PlayerConfig.networkConfig.preprocessHttpRequest", "return request;");
    await press("日本語"); await tap("configuration-apply");
    expect(element("Text", { accessibilityRole: "alert" }).props.children)
      .toBe("編集したJavaScriptの実行を許可してから適用するか、コールバックを削除してください。");
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("localizes the %s field name in helper-generated SDK override validation", async os => {
    runtime.os = os;
    await mount(); await ready();
    const owner = current();
    const id = "PlayerConfig.bufferConfig.audioAndVideo.forwardDuration";
    await text("Filter configuration APIs", id); await press(id); await press("Set this API value");
    await text(`Value for ${id}`, ""); await press("日本語"); await tap("configuration-apply");
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toBe("先読み時間には数値を入力してください。");
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("puts the exact %s method first when a query also matches its Player namespace", async (os) => {
    runtime.os = os;
    await mount(); await ready();
    const owner = current();
    await text("Filter API operations", "play");
    const choices = screen.root.findAll(node => visible(node) && String(node.type) === "Pressable"
      && String(node.props.testID).startsWith("api-operation-selector-option-"));
    expect(choices[0]!.props.testID).toBe("api-operation-selector-option-Player.play");
    expect(choices.some(choice => choice.props.testID === "api-operation-selector-option-Player.getVolume")).toBe(true);
    await act(async () => choices[0]!.props.onPress());
    await tap("api-run");
    expect(owner.play).toHaveBeenCalledOnce();
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["android", "ios"])("retains the %s player, draft and API inputs in a compact keyboard workspace", async (os) => {
    runtime.os = os;
    await mount(); await ready(); await basicField("source", "title");
    const owner = current();
    expect(element("SafeAreaView").props.edges).toContain("bottom");
    await act(async () => input("Source title").props.onChangeText("Landscape draft"));
    await act(async () => { runtime.window = { width: 852, height: 393, fontScale: 1.5, scale: 1 }; screen.update(<App />); });
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(element("SafeAreaView").props.edges).toEqual(["top", "left", "right"]);
    expect(input("Source title").props.disableFullscreenUI).toBe(true);
    expect(element("Pressable", { testID: "workspace-nav-settings" })).toBeUndefined();
    expect(element("View", { testID: "player-lab-player" }).props.accessibilityElementsHidden).toBe(true);
    const done = element("Pressable", { testID: "configuration-done" });
    for (let parent = done.parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
    await tap("configuration-done");
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidHide") ?? []) listener(); });
    expect(element("SafeAreaView").props.edges).toContain("bottom");
    expect(input("Source title").props.value).toBe("Landscape draft");
    await text("Filter API operations", "Player.setVolume"); await press("Player.setVolume");
    await act(async () => input("Volume (0–100)").props.onChangeText("42"));
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(element("Pressable", { testID: "api-operation-selector" })).toBeUndefined();
    expect(input("Volume (0–100)").props.value).toBe("42");
    expect(element("Pressable", { testID: "api-done" })).toBeDefined();
    await tap("api-run");
    expect(owner.setVolume).toHaveBeenCalledWith(42);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it("renders exported code as selectable text with one scrolling owner", async () => {
    await mount(); await ready(); await tap("workspace-nav-code");
    const code = element("Text", { accessibilityLabel: "Applied configuration code" });
    expect(code).toBeDefined();
    expect(code.props.selectable).toBe(true);
    expect(code.props.children).toMatch(/^import /);
    expect(input("Applied configuration code")).toBeUndefined();
    const scrolls: ReactTestInstance[] = [];
    for (let parent = code.parent; parent; parent = parent.parent) if (String(parent.type) === "ScrollView") scrolls.push(parent);
    expect(scrolls).toHaveLength(1);
    await press("Copy code");
    expect(runtime.clipboard).toHaveBeenLastCalledWith(code.props.children);
    const feedback = element("Text", { accessibilityLiveRegion: "polite" });
    const texts = screen.root.findAll(node => String(node.type) === "Text");
    expect(texts.indexOf(feedback)).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(feedback)).toBeLessThan(texts.indexOf(code));
  });

  it.each(["android", "ios"])("keeps the %s picker keyboard-aware in portrait and landscape", async (os) => {
    runtime.os = os;
    runtime.hostTop = os === "ios" ? 62 : 24;
    await mount(); await ready();
    expect(element("StatusBar")?.props.barStyle).toBe("dark-content");
    expect(element("KeyboardAvoidingView", { testID: "player-lab-screen" }).props.behavior).toBe("padding");
    const screenAvoidance = element("KeyboardAvoidingView", { testID: "player-lab-screen" });
    expect(screenAvoidance.props.keyboardVerticalOffset).toBe(runtime.hostTop);
    for (let parent = screenAvoidance.parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("SafeAreaView");
    expect(screenAvoidance.findAll(node => String(node.type) === "SafeAreaView")).toHaveLength(1);
    await tap("workspace-setting-selector");
    const modal = element("Modal");
    expect(modal.props.supportedOrientations).toEqual(["portrait", "landscape"]);
    const avoidance = modal.find(node => String(node.type) === "KeyboardAvoidingView");
    expect(avoidance.props.behavior).toBe(os === "ios" ? "padding" : "height");
    const close = modal.find(node => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Close");
    for (let parent = close.parent; parent && parent !== modal; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(modal.props.visible).toBe(true);
    expect(input("Find Setting").props.value).toBe("");
    await act(async () => close.props.onPress());
    expect(element("Modal")).toBeUndefined();
    await act(async () => { runtime.hostTop = 0; runtime.window = { width: 852, height: 393, fontScale: 1, scale: 1 }; screen.update(<App />); });
    expect(element("KeyboardAvoidingView", { testID: "player-lab-screen" }).props.keyboardVerticalOffset).toBe(0);
  });

  it("applies a UI setting through its own direct editor and exports the effective SDK value", async () => {
    await mount(); await ready(); await settingsGroup("ui");
    await tap("ui-setting-selector");
    await act(async () => input("Find Configuration API").props.onChangeText("PlayerViewConfig.surfaceType"));
    await press("PlayerViewConfig.surfaceType");
    await act(async () => button("Set this API value").props.onPress());
    await press("TextureView"); await press("Apply and recreate player"); await ready();
    expect(element("PlayerView").props.config.surfaceType).toBe("TextureView");
    await tap("workspace-nav-code");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain("SDK.SurfaceType.TextureView");
  });

  it("requires a query target in State and keeps its read action outside scrolling content", async () => {
    await mount(); await ready(); await tap("workspace-nav-apis");
    await tap("api-view-selector"); await tap("api-view-selector-option-state");
    const action = () => element("Pressable", { testID: "api-run" });
    expect(action().props.disabled).toBe(true);
    await act(async () => action().props.onPress());
    expect(Reflect.get(current(), "play")).not.toHaveBeenCalled();
    await tap("api-operation-selector");
    await act(async () => input("Find API operation").props.onChangeText("Player.getVolume"));
    await tap("api-operation-selector-option-Player.getVolume");
    expect(action().props.disabled).toBe(false);
    for (let parent = action().parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
    await tap("api-run");
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("100");
  });

  it("keeps a searchable setting picker open while its keyboard appears and retains the editor across rotation", async () => {
    await mount(); await ready();
    const owner = current();
    await tap("workspace-setting-selector");
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidShow") ?? []) listener(); });
    expect(input("Find Setting")).toBeDefined();
    expect(element("Modal").props.visible).toBe(true);
    await act(async () => input("Find Setting").props.onChangeText("title"));
    await tap("workspace-setting-selector-option-title");
    await act(async () => input("Source title").props.onChangeText("Retained through the keyboard"));
    await act(async () => { for (const listener of runtime.keyboardListeners.get("keyboardDidHide") ?? []) listener(); });
    await act(async () => { runtime.window = { width: 852, height: 393, fontScale: 2, scale: 1 }; screen.update(<App />); });
    expect(input("Source title").props.value).toBe("Retained through the keyboard");
    expect(element("Pressable", { testID: "configuration-apply" }).props.disabled).toBe(false);
    expect(current()).toBe(owner);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it("keeps the player and drafts while direct settings, fixed actions, APIs and code are selected", async () => {
    await mount(); await ready();
    expect(element("ScrollView", { testID: "player-lab-screen" })).toBeUndefined();
    const owner = current();
    const tap = async (testID: string) => act(async () => element("Pressable", { testID }).props.onPress());
    await tap("workspace-setting-selector");
    await tap("workspace-setting-selector-option-title");
    await text("Source title", "A retained draft");
    const apply = element("Pressable", { testID: "configuration-apply" });
    expect(apply.props.disabled).toBe(false);
    for (let parent = apply.parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
    await tap("workspace-nav-apis");
    await tap("api-operation-selector");
    await text("Find API operation", "Player.getVolume");
    await tap("api-operation-selector-option-Player.getVolume");
    await tap("api-run");
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("100");
    await tap("workspace-nav-code");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).not.toContain("A retained draft");
    await tap("workspace-nav-settings");
    expect(input("Source title").props.value).toBe("A retained draft");
    await press("日本語");
    expect(input("ソースのタイトル").props.value).toBe("A retained draft");
    expect(current()).toBe(owner);
    expect(runtime.players).toHaveLength(1);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("keeps a deferred API %s attributed to its executed identifier after selecting another API", async outcome => {
    await mount(); await ready(); await press("Show API experiments");
    const owner = current();
    let resolve!: (value: number) => void;
    let reject!: (error: Error) => void;
    owner.getVolume.mockImplementationOnce(() => new Promise<number>((done, fail) => { resolve = done; reject = fail; }));
    await text("Filter API operations", "Player.getVolume"); await press("Player.getVolume");
    await tap("api-run");
    await text("Filter API operations", "Player.getDuration"); await press("Player.getDuration");
    await act(async () => {
      if (outcome === "failure") reject(new Error("Deferred volume read failed."));
      else resolve(73);
    });
    expect(element("Pressable", { testID: "api-operation-selector" }).props.accessibilityValue.text).toBe("Player.getDuration");
    expect(element("Text", { testID: "api-result-origin" }).props.children).toBe("Player.getVolume");
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toBe(outcome === "failure" ? "Deferred volume read failed." : "73");
    expect(element("Text", { accessibilityLabel: "API result" }).props.accessibilityRole).toBe(outcome === "failure" ? "alert" : "text");
    expect(element("Text", { accessibilityLabel: "Executed API code" }).props.children).toBe(outcome === "failure" ? "" : "player.getVolume()");
    expect(current()).toBe(owner);
    expect(runtime.players).toHaveLength(1);
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it("switches application language without replacing the player, draft or executed SDK code", async () => {
    await mount(); await ready(); await press("Show configuration");
    await text("Source title", "Unapplied title in the user's language");
    await press("Show applied code");
    const applied = element("Text", { accessibilityLabel: "Applied configuration code" }).props.children;
    await press("Show API experiments"); await text("Filter API operations", "Player.getVolume");
    await press("Player.getVolume"); await press("Run selected API");
    const owner = current(); const count = runtime.players.length;
    const code = element("Text", { accessibilityLabel: "Executed API code" }).props.children;
    const result = element("Text", { accessibilityLabel: "API result" }).props.children;
    await press("日本語");
    await tap("workspace-nav-settings");
    expect(input("ソースのタイトル").props.value).toBe("Unapplied title in the user's language");
    expect(element("Text", { accessibilityLabel: "適用済み設定のコード" }).props.children).toBe(applied);
    expect(button("適用してプレイヤーを再作成").props.disabled).toBe(false);
    expect(element("Text", { accessibilityLabel: "実行したAPIのコード" }).props.children).toBe(code);
    expect(element("Text", { accessibilityLabel: "APIの実行結果" }).props.children).toBe(result);
    expect(current()).toBe(owner); expect(runtime.players).toHaveLength(count);
    expect(owner.destroy).not.toHaveBeenCalled();
    await press("English");
    expect(input("Source title").props.value).toBe("Unapplied title in the user's language");
    expect(current()).toBe(owner);
  });

  it("invalidates a pending legacy seek synchronously before each runtime source mutation", async () => {
    await mount(); await ready(); await press("Show API experiments");
    const player = current();
    for (const id of ["Player.load", "Player.unload"]) {
      let complete!: (value: number) => void;
      player.getMaxTimeShift.mockImplementationOnce(() => new Promise<number>((resolve) => { complete = resolve; }));
      let seeking: Promise<unknown> | undefined;
      await tap("workspace-nav-more");
      await act(async () => { seeking = button("-30s").props.onPress(); });
      await text("Filter API operations", id); await press(id); await press("Run selected API");
      await act(async () => { complete(-900); await seeking; });
    }
    expect(Reflect.get(player, "timeShift")).not.toHaveBeenCalled();
  });

  it("retires the native source before replacing it through Player.load", async () => {
    await mount(); await ready(); await press("Show API experiments");
    const player = current(); const previous = { isInitialized: true, isDestroyed: false, destroy: vi.fn() };
    Object.assign(player, { source: previous });
    await text("Filter API operations", "Player.load"); await press("Player.load"); await press("Run selected API");
    expect(previous.destroy).toHaveBeenCalledOnce();
    expect(Reflect.get(player, "unload")).toHaveBeenCalledOnce();
    expect(previous.destroy.mock.invocationCallOrder[0]).toBeLessThan(player.load.mock.invocationCallOrder[player.load.mock.invocationCallOrder.length - 1]!);
  });

  it("rejects a metadata child beyond the tree depth limit before storing or rendering it", async () => {
    await mount(); await ready(); await press("Show API experiments");
    await text("Filter API operations", "Source.setMetadata"); await press("Source.setMetadata");
    await press("Metadata object");
    for (let depth = 0; depth < 20; depth++) {
      await text("New metadata field name", "child"); await press("Add metadata field");
      await press("Edit metadata child"); await press("Metadata object");
    }
    await text("New metadata field name", "tooDeep"); await press("Add metadata field");
    expect(element("Text", { accessibilityRole: "alert" }).props.children).toContain("20 nested levels");
    expect(button("Edit metadata tooDeep")).toBeUndefined();
    await press("Metadata parent");
    expect(button("Edit metadata child")).toBeDefined();
  });

  it("exports buffer operations using the SDK enum expressions accepted by the pinned declarations", async () => {
    await mount(); await ready(); await press("Show API experiments");
    for (const id of ["Player.buffer.getLevel", "Player.buffer.setTargetLevel"]) {
      await text("Filter API operations", id); await press(id);
      for (const type of ["forwardDuration", "backwardDuration"]) {
        await press(type); await press("Run selected API");
        const code = String(element("Text", { accessibilityLabel: "Executed API code" }).props.children);
        expect(code).toContain(type === "forwardDuration" ? "SDK.BufferType.FORWARD_DURATION" : "SDK.BufferType.BACKWARD_DURATION");
        expectValidCode('import * as SDK from "bitmovin-player-react-native";\ndeclare const player: SDK.Player;\n' + code);
      }
    }
  });

  it("describes Cast option changes through the normal startup adapter without a native rebuild", async () => {
    await mount(); await ready(); await press("Show API experiments");
    const prose = screen.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children)).join("\n");
    expect(prose).toContain("Save Cast options for next launch");
    expect(prose).toContain("fully close and reopen");
    expect(prose).not.toContain("Custom receiver and namespace settings require the generated app.json changes");
  });

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
    const code = element("Text", { accessibilityLabel: "Applied configuration code" }).props.children;
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
    const dismissals = runtime.keyboardDismiss.mock.calls.length;
    await press("Finish editing JavaScript"); expect(runtime.keyboardDismiss).toHaveBeenCalledTimes(dismissals + 1);
    expect(runtime.players).toHaveLength(1);
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
    const code = element("Text", { accessibilityLabel: "Applied configuration code" }).props.children;
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
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).not.toContain("PRIVATE_HEADER");
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

  it("builds typed source metadata through the GUI tree and rejects an invalid nested number", async () => {
    await mount(); await ready(); await press("Show API experiments");
    const setMetadata = vi.fn(); Object.assign(current(), { source: { setMetadata } });
    await text("Filter API operations", "Source.setMetadata"); await press("Source.setMetadata");
    await press("Metadata object"); await text("New metadata field name", "episode"); await press("Add metadata field");
    await press("Edit metadata episode"); await press("Metadata number"); await text("Metadata scalar value", "7");
    await press("Run selected API"); expect(setMetadata).toHaveBeenLastCalledWith({ episode: 7 });
    await text("Metadata scalar value", "Infinity"); await press("Run selected API"); expect(setMetadata).toHaveBeenCalledOnce();
    expect(element("Text", { accessibilityLabel: "API result" }).props.children).toContain("finite number");
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

  it("saves edited Cast receiver and namespace independently, preserves the current player and distinguishes a pending process restart", async () => {
    const state = { savedOptions: { applicationId: "", messageNamespace: "" }, startupOptions: { applicationId: "FFE417E5", messageNamespace: "urn:x-cast:com.bitmovin.player.caf" }, nativeInitialized: true, pendingRestart: false, startupEvidence: "Native test host" };
    runtime.castHost = { readOptions: vi.fn(async () => state), saveOptions: vi.fn(async () => ({ ...state, pendingRestart: true })) };
    await mount(); await ready(); await press("Show configuration");
    await text("Filter configuration APIs", "BitmovinCastManagerOptions.applicationId");
    await press("BitmovinCastManagerOptions.applicationId"); await press("Set this API value");
    await text("Value for BitmovinCastManagerOptions.applicationId", "ABCDEF12");
    await text("Filter configuration APIs", "BitmovinCastManagerOptions.messageNamespace");
    await press("BitmovinCastManagerOptions.messageNamespace"); await press("Set this API value");
    await text("Value for BitmovinCastManagerOptions.messageNamespace", "urn:x-cast:player.lab");
    await press("Save Cast options for next launch");
    expect(runtime.castHost.saveOptions).toHaveBeenCalledWith("ABCDEF12", "urn:x-cast:player.lab");
    expect(runtime.players).toHaveLength(1);
    expect(element("Text", { accessibilityLabel: "Native Cast startup state" }).props.children).toContain('"pendingRestart": true');
    await press("Read native Cast startup state");
    expect(runtime.castHost.readOptions).toHaveBeenCalledTimes(2);
  });

  it("exports the Cast startup adapter and native build alternative while explaining the SDK initialize no-op", async () => {
    await mount(); await press("Show configuration");
    await text("Filter configuration APIs", "BitmovinCastManagerOptions.applicationId");
    await press("BitmovinCastManagerOptions.applicationId"); await press("Set this API value");
    await text("Value for BitmovinCastManagerOptions.applicationId", "ABCDEF12");
    await press("Apply and recreate player"); await press("Show applied code");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain('"appId": "ABCDEF12"');
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain("SDK 1.29 initialize does not read castOptions");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain("PlayerLabCastHost.saveOptions");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain('"android": "21.3.0"');
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain('"ios": "4.8.4"');
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
    const scroll = () => element("ScrollView", { testID: "playback-controls-scroll" });
    for (let parent = playerArea().parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
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
    const scroll = () => element("ScrollView", { testID: "playback-controls-scroll" });
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

  it("keeps the iOS player outside form scrolling without Android gesture interception", async () => {
    runtime.os = "ios";
    await mount(); await ready();
    const playerArea = element("View", { testID: "player-lab-player" });
    expect(playerArea.props.onTouchStartCapture).toBeUndefined();
    expect(playerArea.props.onTouchEndCapture).toBeUndefined();
    expect(playerArea.props.onTouchCancelCapture).toBeUndefined();
    expect(element("ScrollView", { testID: "playback-controls-scroll" }).props.scrollEnabled).not.toBe(false);
    for (let parent = playerArea.parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
  });

  it("applies one validated WebVTT track and exports only its applied metadata", async () => {
    await mount();
    await ready();
    await press("Show configuration");
    await text("External WebVTT URL", " https://example.com/captions.vtt ");
    await text("Subtitle label", " English captions ");
    await text("Subtitle language", "en-us");
    await toggle("Mark as default", true);
    await press("Apply and recreate player");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ subtitleTracks: [{
      url: "https://example.com/captions.vtt", label: "English captions", language: "en-US",
      identifier: "player-lab-external", format: "vtt", isDefault: true,
    }] }));
    await press("Show applied code");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain('"isDefault": true');
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
    await basicField("source", "subtitleLabel");
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
  it("keeps selected iOS inputs scrollable and fixed actions inside one keyboard-avoiding workspace", async () => {
    runtime.os = "ios";
    await mount();
    await ready();
    await press("Show configuration");
    const scrolls = [];
    for (const [group, field, label, kind] of [
      ["source", "url", "Source URL", "TextInput"], ["source", "title", "Source title", "TextInput"],
      ["source", "startOffset", "Start offset (seconds)", "TextInput"], ["player", "forwardDuration", "Forward buffer (seconds)", "TextInput"],
      ["player", "maxBitrate", "Maximum bitrate (bits per second)", "TextInput"], ["player", "autoplay", "Autoplay", "Switch"], ["player", "muted", "Mute on startup", "Switch"],
    ]) {
      await basicField(group!, field!);
      const control = element(kind!, { accessibilityLabel: label });
      let parent = control.parent;
      while (parent && String(parent.type) !== "ScrollView") parent = parent.parent;
      scrolls.push(parent);
    }
    expect(scrolls[0]?.props.keyboardDismissMode).toBe("on-drag");
    expect(scrolls[0]?.props.keyboardShouldPersistTaps).toBe("handled");
    expect(scrolls[0]).not.toBeNull();
    expect(new Set(scrolls).size).toBe(1);
    expect(scrolls[0]!.props.automaticallyAdjustKeyboardInsets).not.toBe(true);
    expect(element("KeyboardAvoidingView", { testID: "player-lab-screen" }).props.behavior).toBe("padding");
    for (let parent = element("View", { testID: "configuration-actions" }).parent; parent; parent = parent.parent) expect(String(parent.type)).not.toBe("ScrollView");
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
    const original = element("Text", { accessibilityLabel: "Applied configuration code" }).props.children as string;
    expect(original).toContain("YOUR_PLAYER_KEY");
    expect(original).not.toContain("test-license");
    await text("Source title", "ONLY_AFTER_APPLY");
    await press("Copy code");
    expect(runtime.clipboard).toHaveBeenLastCalledWith(original);
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).not.toContain("ONLY_AFTER_APPLY");
    await press("Apply and recreate player");
    expect(element("Text", { accessibilityLabel: "Applied configuration code" }).props.children).toContain("ONLY_AFTER_APPLY");
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
    await toggle("Autoplay", true);
    await toggle("Mute on startup", true);
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
    await basicField("player", "forwardDuration");
    expect(input("Forward buffer (seconds)").props.value).toBe("");
    expect(button("Apply and recreate player").props.disabled).toBe(true);
    expect(runtime.players).toHaveLength(1);
  });

  it("keeps the full custom source, UI, log and DVR flag across Apply and ignores old view callbacks", async () => {
    await mount();
    await ready();
    await toggle("Allow DVR", false);
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
    await toggle("Mute on startup", true);
    await press("Apply and recreate player");
    await ready();
    expect(current().load).toHaveBeenLastCalledWith(expect.objectContaining({ url: "https://example.com/retained.m3u8", title: "Retained title", poster: "https://example.com/retained.jpg" }));
    expect(element("Switch", { accessibilityLabel: "Allow DVR" }).props.value).toBe(false);
    expect(screen.root.findAll((node) => String(node.type) === "Text" && node.props.children === "SourceLoaded")).toHaveLength(1);
    expect(element("Pressable", { testID: "theme-selector" }).props.accessibilityValue.text).toBe("Sports");
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
