import { describe, expect, it, vi } from "vitest";
import { appliedConfiguration } from "../src/startup/demo-configuration";
import type { DemoEngineId } from "../src/startup/contract";
import ts from "typescript";

// Applied startup-profile metadata shapes from the four public SDK adapters.
function fixtures(): Record<DemoEngineId, { engine: DemoEngineId; version: string; configuration: Record<string, unknown> }> {
  return {
    "web-x": { engine: "web-x", version: "10.3.1", configuration: {
      profile: "startup", bundle: "playerx-hls", sourceType: "hls", contentType: "content",
      muted: true, autoplay: false, preventSeeking: false, playsInline: true, controls: false,
      startTimeSeconds: 0, playbackRate: 1, defaultLogLevel: 0, stagingAttach: false,
      stagingLoadControl: 0, startLoadControl: 2, startSequence: "attach-before-load",
    } },
    "bitmovin-8": { engine: "bitmovin-8", version: "8.283.0", configuration: {
      profile: "startup", modular: true, format: "hls",
      modules: ["Core", "EngineBitmovin", "RendererMSE", "ABR", "ContainerMP4", "HLS", "ContainerTS"],
      playback: { muted: true, autoplay: false, audioLanguage: "en", preferredTech: [{ player: "html5", streaming: "hls" }] },
      ui: false, analytics: false, storage: { disableStorageApi: true },
      buffer: { audio: { forwardduration: 12, backwardduration: 6 }, video: { forwardduration: 12, backwardduration: 6 } },
      logs: { level: "off", bitmovin: false }, sourceOptions: { startOffset: 0 }, playbackRate: 1,
    } },
    hls: { engine: "hls", version: "1.7.4", configuration: {
      debug: false, autoStartLoad: true, startPosition: 0, audioPreference: { lang: "en" },
      preferManagedMediaSource: false, enableWorker: true, lowLatencyMode: false, enableInterstitialPlayback: false,
      maxBufferLength: 12, maxMaxBufferLength: 12, backBufferLength: 6, frontBufferFlushThreshold: 12,
    } },
    shaka: { engine: "shaka", version: "5.3.3", configuration: {
      bundle: "shaka-player.hls-es2021", sourceType: "hls", startTimeSeconds: 0,
      preferredAudio: [{ language: "en", role: "", label: "", channelCount: 2, codec: "", spatialAudio: false }],
      streaming: { preferNativeHls: false, fallbackToNativeHlsOnMseError: false, useNativeHlsForFairPlay: false,
        lowLatencyMode: false, bufferingGoal: 12, bufferBehind: 6, rebufferingGoal: 0 },
      cmcd: { enabled: false }, cmsd: { enabled: false },
      ads: { disableHLSInterstitial: true, disableDASHInterstitial: true, disableSVTA: true },
    } },
  };
}
const clearFmp4Packages = [
  "adaptation", "capabilities", "container-mp4", "data", "hls-manifest", "media-state", "mse-playback",
  "native-playback", "network", "platform-detection", "playback-api", "playback", "playback-technology",
  "segment-processing", "source", "sources-api", "stream-data-structure", "streaming", "video-element-controller", "view-mode",
].map((name) => `playerx-${name}.package`);
function compactFixture() {
  const metadata = fixtures()["web-x"];
  metadata.configuration.bundle = "playerx-core-clear-fmp4";
  metadata.configuration.packages = [...clearFmp4Packages];
  return metadata;
}

describe("applied SDK configuration code", () => {
  it.each(["web-x", "bitmovin-8", "hls", "shaka"] as const)("renders the actual %s settings using only placeholders", (engine) => {
    const result = appliedConfiguration(fixtures()[engine], engine);
    expect(result).toMatchObject({ engine, version: fixtures()[engine].version });
    expect(result?.code).toContain("mediaUrl");
    expect(result?.code).not.toContain("https://");
    expect(result?.code).not.toContain("undefined");
  });
  it("keeps native Web X source/load/attach order exactly as recorded", () => {
    const metadata = fixtures()["web-x"];
    const original = appliedConfiguration(metadata, "web-x")!.code;
    expect(original).toContain('"loadControl": 0');
    expect(original).toContain("source.currentTime = 0");
    expect(original.indexOf("player.sources.attachVideo")).toBeLessThan(original.indexOf("source.loadControl = 2"));
    metadata.configuration.startSequence = "load-before-attach";
    const candidate = appliedConfiguration(metadata, "web-x")!.code;
    expect(candidate.indexOf("source.loadControl = 2")).toBeLessThan(candidate.indexOf("player.sources.attachVideo"));
    expect(candidate).toContain("await source.play()");
  });
  it("renders the complete observed clear-fMP4 public composition and awaited partial cleanup", () => {
    const code = appliedConfiguration(compactFixture(), "web-x")!.code;
    expect(code).toContain('Player as CorePlayer');
    expect(code).toContain('bundles/playerx-core');
    for (const name of clearFmp4Packages) expect(code).toContain(`@bitmovin/player-web-x/packages/${name}`);
    expect(code.match(/player\.packages\.add\(/g)).toHaveLength(20);
    expect(code).toContain('import * as ViewModeEntry');
    expect(code).toContain('Reflect.get(ViewModeEntry, "default")');
    expect(code).toContain('typeof onAdd === "function"');
    expect(code).toContain('dependencies.length === 3');
    const validation = code.indexOf('const viewMode = resolvePublicViewModePackage(');
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(code.indexOf('CorePlayer(config)'));
    expect(code).toContain('await player.dispose()');
    expect(code).toContain('const player = await createPlayer(');
    expect(code).toContain('source.currentTime = 0');
    expect(code).toContain('"loadControl": 0');
    expect(code).not.toContain('from "./');
    for (const omitted of ['playerx-container-ts', 'playerx-ts-transmuxer', 'playerx-aes-decryption', 'SubtitleSourceApi']) expect(code).not.toContain(omitted);
    expect(ts.transpileModule(code, { reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).diagnostics).toEqual([]);
  });
  it("executes the projected ViewMode resolver with real namespace shapes and preserves the package by reference", async () => {
    const code = appliedConfiguration(compactFixture(), "web-x")!.code;
    const body = code.slice(code.indexOf("function isPublicViewModePackage"), code.indexOf("\nvideo.muted"));
    const names = [...code.matchAll(/import \{ (\w+) \} from "@bitmovin\/player-web-x\/packages\//g)].map((match) => match[1]!);
    const definition = { onAdd() {}, dependencies: ["core-effects", "source-state-atom", "source-api-manager"], extra: {} };
    const factory = (value: unknown) => {
      const add = vi.fn(); const core = vi.fn(() => ({ packages: { add }, dispose: vi.fn(async () => {}) }));
      const create = new Function("ViewModeEntry", "CorePlayer", ...names, `${body}\nreturn createPlayer;`)(
        { default: value }, core, ...names.map((name) => ({ name })));
      return { create, add, core };
    };
    for (const value of [definition, { version: "10.3.1", default: definition }]) {
      const f = factory(value); await f.create({});
      expect(f.core).toHaveBeenCalledOnce(); expect(f.add).toHaveBeenCalledTimes(20);
      expect(f.add.mock.calls[f.add.mock.calls.length - 1]?.[0]).toBe(definition);
    }
    for (const value of [null, { version: "10.3.1" }, { default: { default: definition } },
      { onAdd() {}, dependencies: ["core-effects", "source-state-atom", "wrong-dependency"] }]) {
      const f = factory(value);
      await expect(f.create({})).rejects.toThrow("Public ViewMode package export is incompatible");
      expect(f.core).not.toHaveBeenCalled(); expect(f.add).not.toHaveBeenCalled();
    }
  });
  it("accepts only the exact compact HLS constructor and recorded package order", () => {
    for (const change of ["missing", "unknown", "order", "duplicate", "dash"] as const) {
      const metadata = compactFixture();
      if (change === "missing") delete metadata.configuration.packages;
      else if (change === "dash") metadata.configuration.sourceType = "dash";
      else {
        const packages = metadata.configuration.packages as string[];
        if (change === "unknown") packages[0] = "https://private.invalid/?token=private-key";
        if (change === "order") [packages[0], packages[1]] = [packages[1]!, packages[0]!];
        if (change === "duplicate") packages[1] = packages[0]!;
      }
      expect(appliedConfiguration(metadata, "web-x")).toBeNull();
    }
  });
  it("uses the emitted-worker placeholder while preserving configured worker intent", () => {
    const metadata = fixtures().hls;
    expect(appliedConfiguration(metadata, "hls")!.code).toContain('import emittedWorkerUrl from "hls.js/dist/hls.worker.js?url"');
    expect(appliedConfiguration(metadata, "hls")!.code).toContain('"workerPath": emittedWorkerUrl');
    metadata.configuration.enableWorker = false;
    expect(appliedConfiguration(metadata, "hls")!.code).toContain('"enableWorker": false');
  });
  it("shows modular v8 source options and public SDK play after load", () => {
    const code = appliedConfiguration(fixtures()["bitmovin-8"], "bitmovin-8")!.code;
    expect(code).toContain('bitmovin-player/modules/bitmovinplayer-core');
    expect(code).toContain('bitmovinplayer-container-ts'); expect(code).not.toContain('bitmovinplayer-analytics');
    expect(code).not.toContain('getModules');
    expect(code).toContain('function bitmovin8Module(value)');
    expect(code.indexOf('Player.addModule(bitmovin8Module(EngineBitmovin))')).toBeLessThan(code.indexOf('new Player(container'));
    expect(code).toContain('"startOffset": 0'); expect(code).toContain('"forwardduration": 12');
    expect(code.indexOf("player.setVideoElement(video)")).toBeLessThan(code.indexOf("await player.load"));
    expect(code.indexOf("await player.load")).toBeLessThan(code.indexOf("await player.play"));
  });
  it("shows Shaka attach, real MIME/start position and concurrent native play", () => {
    const code = appliedConfiguration(fixtures().shaka, "shaka")!.code;
    expect(code).toContain('shaka-player/dist/shaka-player.hls-es2021.js');
    expect(code).toContain('player.load(mediaUrl, 0, "application/x-mpegurl")');
    expect(code).toContain('const playing = video.play()');
    expect(code).toContain('await Promise.all([loading, playing])');
    expect(code).toContain('"bufferingGoal": 12');
  });
  it("preserves real DASH bundle and source identities for the three DASH-capable players", () => {
    const all = fixtures();
    Object.assign(all["web-x"].configuration, { bundle: "playerx-dash", sourceType: "dash" });
    Object.assign(all.shaka.configuration, { bundle: "shaka-player.dash-es2021", sourceType: "dash" });
    Object.assign(all["bitmovin-8"].configuration, { format: "dash",
      modules: ["Core", "EngineBitmovin", "RendererMSE", "ABR", "ContainerMP4", "XML", "DASH"],
      playback: { muted: true, autoplay: false, audioLanguage: "en", preferredTech: [{ player: "html5", streaming: "dash" }] } });
    expect(appliedConfiguration(all["web-x"], "web-x")!.code).toContain('bundles/playerx-dash');
    const v8 = appliedConfiguration(all["bitmovin-8"], "bitmovin-8")!.code;
    expect(v8).toContain('bitmovinplayer-xml'); expect(v8).toContain('"html5.dash"');
    expect(v8).not.toContain('bitmovinplayer-hls'); expect(v8).not.toContain('bitmovinplayer-container-ts');
    expect(appliedConfiguration(all.shaka, "shaka")!.code).toContain('player.load(mediaUrl, 0, "application/dash+xml")');
  });
  it("produces syntactically usable module code without executing or importing any SDK", () => {
    for (const [engine, metadata] of Object.entries(fixtures())) {
      const code = appliedConfiguration(metadata, engine as DemoEngineId)!.code;
      const result = ts.transpileModule(code, { reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      expect(result.diagnostics).toEqual([]);
    }
  });
  it("never copies unknown nested fields, raw keys, media addresses, headers, container or video objects", () => {
    for (const engine of ["web-x", "bitmovin-8", "hls", "shaka"] as const) {
      const metadata = fixtures()[engine];
      Object.assign(metadata.configuration, { key: "private-key", url: "https://private.invalid/?token=private-token",
        workerPath: "https://private.invalid/worker", headers: { Authorization: "private-header" },
        video: { id: "private-video" }, container: { id: "private-container" } });
      for (const value of Object.values(metadata.configuration)) {
        if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(value, { secret: "private-nested" });
      }
      const code = appliedConfiguration(metadata, engine)!.code;
      expect(code).not.toContain("private-"); expect(code).not.toContain("private.invalid");
      expect(code).not.toContain("Authorization");
    }
  });
  it("does not invent common buffer or log overrides missing from default-profile snapshots", () => {
    const all = fixtures();
    delete all["bitmovin-8"].configuration.buffer; delete all["bitmovin-8"].configuration.logs;
    for (const key of ["maxBufferLength", "maxMaxBufferLength", "backBufferLength", "frontBufferFlushThreshold"]) delete all.hls.configuration[key];
    const streaming = all.shaka.configuration.streaming as Record<string, unknown>;
    for (const key of ["bufferingGoal", "bufferBehind", "rebufferingGoal"]) delete streaming[key];
    expect(appliedConfiguration(all["bitmovin-8"], "bitmovin-8")!.code).not.toContain('"buffer"');
    expect(appliedConfiguration(all.hls, "hls")!.code).not.toContain('"maxBufferLength"');
    expect(appliedConfiguration(all.shaka, "shaka")!.code).not.toContain('"bufferingGoal"');
  });
  it("does not evaluate metadata accessors or serialize provider toJSON hooks", () => {
    const metadata = fixtures().hls; let accessed = false;
    Object.defineProperty(metadata.configuration, "key", { get() { accessed = true; return "private-key"; } });
    Object.assign(metadata.configuration, { toJSON: () => ({ secret: "private-hook" }) });
    expect(appliedConfiguration(metadata, "hls")!.code).not.toContain("private-");
    expect(accessed).toBe(false);
    Object.defineProperty(metadata.configuration, "enableWorker", { get() { accessed = true; return true; } });
    expect(appliedConfiguration(metadata, "hls")).toBeNull(); expect(accessed).toBe(false);
  });
  it("fails closed on missing, wrong-engine, unsupported bundle or malformed allowlisted settings", () => {
    expect(appliedConfiguration(null, "hls")).toBeNull();
    expect(appliedConfiguration(fixtures().hls, "shaka")).toBeNull();
    const hls = fixtures().hls; hls.configuration.enableWorker = "private-key";
    expect(appliedConfiguration(hls, "hls")).toBeNull();
    const webx = fixtures()["web-x"]; webx.configuration.bundle = "private-bundle";
    expect(appliedConfiguration(webx, "web-x")).toBeNull();
    const shaka = fixtures().shaka; shaka.configuration.startTimeSeconds = NaN;
    expect(appliedConfiguration(shaka, "shaka")).toBeNull();
  });
});
