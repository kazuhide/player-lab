import path from "node:path";
import ts from "typescript";
import type { PlayerAPI } from "bitmovin-player";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("bitmovin-player/modules/bitmovinplayer-core", async () => {
  const { default: schema } = await import("../src/api/schema.json");
  return { PlayerEvent: Object.fromEntries(schema.rows.filter((row) => row.category === "event").map((row) => [row.name, row.value])) };
});

import { catalog } from "../src/api/catalog";
import { VegaSessionApi } from "../src/api/sessionApi";
import { ApiMaterializer, ResourcePool, inputCode } from "../src/api/materialize";
import { configurationOverrides, validateConfigurationShape, type ConfigInput } from "../src/api/configInputs";
import { apiPath, parseBinary, validateData } from "../src/api/values";
import { BinaryInput, CallbackInput, ExpressionInput, NumericInput, ResourceInput, type ApiEntry, type Signature } from "../src/api/types";
import { configurationCode } from "../src/configurationCode";

const row = (id: string): ApiEntry => catalog.rows.find((entry) => entry.id === id)!;
const signature = (id: string): Signature => catalog.nodes[row(id).schema!]!.signatures![0]!;
const callbackSignature = (id: string): Signature => {
  const node = catalog.nodes[row(id).schema!]!;
  return (node.kind === "function" ? node : node.options!.map((id) => catalog.nodes[id]!).find((node) => node.kind === "function")!).signatures![0]!;
};
const sessions: VegaSessionApi[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.useRealTimers(); });

function fixture() {
  const video = Object.create({ native: true });
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const player = {
    getVideoElement: vi.fn(() => video), getSource: vi.fn(() => ({ hls: "https://example.com/media.m3u8" })),
    getDuration: vi.fn(() => 60), seek: vi.fn(() => true), load: vi.fn(async () => {}),
    on: vi.fn((event: string, callback: (event: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback);
    }),
    off: vi.fn((event: string, callback: (event: unknown) => void) => { listeners.get(event)?.delete(callback); }),
    setVideoElement: vi.fn(),
  };
  const session = new VegaSessionApi(); sessions.push(session);
  session.bind(player as unknown as PlayerAPI, () => true); session.loaded();
  return { session, player, video, listeners };
}

describe("Vega typed API dispatch and session ownership", () => {
  it("dispatches published numeric arguments and rejects invalid input before calling the SDK", async () => {
    const { session, player } = fixture();
    expect(await session.run(row("PlayerAPI.seek"), 0, [new NumericInput("12.5"), "gui-test"])).toEqual({ value: "true", code: 'player.seek(12.5, "gui-test");' });
    expect(player.seek).toHaveBeenCalledWith(12.5, "gui-test");
    await expect(session.run(row("PlayerAPI.seek"), 0, [new NumericInput("NaN")])).rejects.toThrow("Enter a number");
    expect(player.seek).toHaveBeenCalledTimes(1);
  });

  it("reports actual current method availability without invoking APIs or presenting it as feature qualification", () => {
    const { session, player } = fixture();
    const present = session.availability();
    expect(present.find(row => row.id === "PlayerAPI.seek")).toEqual({ id: "PlayerAPI.seek", callable: true });
    expect(present.find(row => row.id === "PlayerAPI.ads.schedule")?.callable).toBe(false);
    expect(player.seek).not.toHaveBeenCalled(); expect(player.getDuration).not.toHaveBeenCalled();
    session.dispose(); expect(() => session.availability()).toThrow("no longer active");
  });

  it("passes a real SDK-returned native media object and rejects a plain object or incompatible resource", async () => {
    const { session, player, video } = fixture();
    const query = await session.run(row("PlayerAPI.getVideoElement"), 0, []);
    expect(query.value).toContain("current SDK resource");
    const expected = catalog.nodes[signature("PlayerAPI.setVideoElement").parameters[0]!.schema]!;
    const resource = session.resources.list(expected).find((entry) => entry.label.includes("video element"))!;
    await session.run(row("PlayerAPI.setVideoElement"), 0, [new ResourceInput(resource.id)]);
    expect(player.setVideoElement).toHaveBeenCalledWith(video);
    await expect(session.run(row("PlayerAPI.setVideoElement"), 0, [{}])).rejects.toThrow("expected HTMLElement");
    const incompatible = session.resources.add({}, "Incompatible test object", "Other")!;
    await expect(session.run(row("PlayerAPI.setVideoElement"), 0, [new ResourceInput(incompatible)])).rejects.toThrow("expected HTMLElement");
    expect(player.setVideoElement).toHaveBeenCalledTimes(1);
  });

  it("preserves an edited callback instance for on/off and stops its execution after owner retirement", async () => {
    const { session, player, listeners } = fixture();
    const event = catalog.rows.find((entry) => entry.id === "PlayerEvent.Play")!.value!;
    const changed = vi.fn();
    player.getDuration.mockImplementation(() => { changed(); return 60; });
    const callbackType = catalog.nodes[signature("PlayerAPI.on").parameters[1]!.schema]!;
    const callback = new CallbackInput("lab.getPlayer().getDuration();", callbackType.signatures![0]!, true);
    await session.run(row("PlayerAPI.on"), 0, [event, callback]);
    const installed = player.on.mock.calls[player.on.mock.calls.length - 1]![1];
    installed({ type: event }); expect(changed).toHaveBeenCalledTimes(1);
    const schema = catalog.nodes[signature("PlayerAPI.off").parameters[1]!.schema]!;
    const identity = session.resources.list(schema).find((entry) => entry.label.startsWith("Callback"))!;
    await session.run(row("PlayerAPI.off"), 0, [event, new ResourceInput(identity.id)]);
    expect(player.off).toHaveBeenLastCalledWith(event, installed);
    expect(listeners.get(event)?.has(installed)).toBe(false);
    session.dispose();
    expect(() => installed({ type: event })).toThrow("retired Vega session");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(session.resources.list(schema)).toEqual([]);
  });

  it("keeps a pending SDK operation locked until it settles and rejects a retired owner's late result", async () => {
    const { session, player } = fixture();
    let resolve!: () => void;
    player.load.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const pending = session.run(row("PlayerAPI.load"), 0, [{ hls: "https://example.com/media.m3u8" }]);
    expect(session.isBusy()).toBe(true);
    await expect(session.run(row("PlayerAPI.getDuration"), 0, [])).rejects.toThrow("previous SDK operation");
    session.dispose(); resolve();
    await expect(pending).rejects.toThrow("retired before this operation completed");
    expect(session.isBusy()).toBe(false);
    expect(player.getDuration).not.toHaveBeenCalled();
  });

  it("bounds and redacts real event summaries and detaches every named event on retirement", () => {
    vi.useFakeTimers();
    const { session, player, listeners } = fixture();
    const event = catalog.rows.find((entry) => entry.id === "PlayerEvent.Play")!.value!;
    const callback = [...listeners.get(event)!][0]!;
    for (let index = 0; index < 120; index++) callback({ index, authorization: "private-test-value" });
    vi.advanceTimersByTime(125);
    expect(session.eventLines()).toHaveLength(80);
    expect(session.eventLines().join("\n")).not.toContain("private-test-value");
    session.setRecording(false); callback({ index: "paused" });
    expect(session.eventLines().join("\n")).not.toContain("paused");
    session.dispose(); callback({ index: "retired" });
    expect(session.eventLines().join("\n")).not.toContain("retired");
    expect(player.off).toHaveBeenCalledTimes(catalog.rows.filter((entry) => entry.category === "event").length);
  });

  it("cleans up successful earlier registrations when the SDK rejects an event registration", () => {
    const { player } = fixture();
    const partial = new VegaSessionApi(); sessions.push(partial);
    let registrations = 0;
    player.on.mockImplementation(() => { if (++registrations === 4) throw new Error("native event unavailable"); });
    player.off.mockClear();
    expect(() => partial.bind(player as unknown as PlayerAPI, () => true)).toThrow("native event unavailable");
    expect(player.off).toHaveBeenCalledTimes(3);
    partial.dispose(); expect(player.off).toHaveBeenCalledTimes(3);
  });
});

describe("Vega applied configuration values and callbacks", () => {
  it("materializes numbers, lists, dictionaries, structured DRM settings and bytes as actual SDK input values", () => {
    const session = new VegaSessionApi(); sessions.push(session);
    const inputs: ConfigInput[] = [
      { id: "PlayerConfig.buffer.video.forwardduration", indices: [], value: new NumericInput("22.5") },
      { id: "SourceConfig.options.headers", indices: [], value: { "X-Lab": "a=1" } },
      { id: "SourceConfig.drm.widevine.keySystemPriority", indices: [], value: ["com.widevine.alpha"] },
      { id: "SourceConfig.drm.widevine.mediaKeySystemConfig", indices: [], value: { persistentState: "required", videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"' }] } },
      { id: "SourceConfig.drm.widevine.serverCertificate", indices: [], value: new BinaryInput("00a1ff", "hex", "ArrayBuffer") },
    ];
    const applied = session.prepare({ key: "test-only" }, { hls: "https://example.com/a.m3u8" }, inputs);
    expect(applied.config.buffer?.video?.forwardduration).toBe(22.5);
    expect(applied.source.options?.headers).toEqual({ "X-Lab": "a=1" });
    expect(applied.source.drm?.widevine?.keySystemPriority).toEqual(["com.widevine.alpha"]);
    expect(applied.source.drm?.widevine?.mediaKeySystemConfig).toEqual({ persistentState: "required", videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.4d401f"' }] });
    expect(new Uint8Array(applied.source.drm!.widevine!.serverCertificate!)).toEqual(new Uint8Array([0, 161, 255]));
  });

  it("does not execute an edited callback or value factory during validation or code generation", async () => {
    const called = vi.fn();
    const pool = new ResourcePool({ ArrayBuffer, Uint8Array });
    const materializer = new ApiMaterializer(catalog, {}, pool, { called }, () => {});
    const callback = new CallbackInput("lab.called(); return request;", callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true);
    materializer.preflight(callback); expect(called).not.toHaveBeenCalled();
    const installed = materializer.materialize(callback) as (type: unknown, request: object) => Promise<object>;
    expect(called).not.toHaveBeenCalled();
    const request = { method: "GET", url: "https://example.com/a.m3u8", headers: {}, responseType: "text", credentials: "omit" };
    expect(await installed("manifest", request)).toBe(request); expect(called).toHaveBeenCalledTimes(1);
    const factory = new ExpressionInput("lab.called(); return 9;", true);
    materializer.preflight(factory); expect(called).toHaveBeenCalledTimes(1);
    expect(materializer.materialize(factory)).toBe(9); expect(called).toHaveBeenCalledTimes(2);
    expect(materializer.materialize(factory)).toBe(9); expect(called).toHaveBeenCalledTimes(2);
    materializer.dispose(); expect(() => installed("manifest", request)).toThrow("retired Vega session");
  });

  it("preserves a valid SDK request body beyond editor limits in an approved identity callback", async () => {
    const materializer = new ApiMaterializer(catalog, {}, new ResourcePool({}), {}, () => {});
    const callback = materializer.materialize(new CallbackInput("return request;", callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true)) as (type: unknown, request: object) => Promise<object>;
    const request = { method: "POST", url: "https://example.com/license", headers: {}, responseType: "text", credentials: "omit", body: "x".repeat(65537) };
    await expect(callback("license", request)).resolves.toBe(request);
    await expect(callback("license", { ...request, method: 4 })).rejects.toThrow("expected HttpRequestMethod");
    materializer.dispose();
  });

  it("preserves the SDK callback's exact argument count, this and rest values in the live and exported functions", () => {
    const sig: Signature = { parameters: [{ name: "value", schema: "any", optional: true, rest: false },
      { name: "remaining", schema: "any", optional: false, rest: true }], returns: "text" };
    const typed = { ...catalog, nodes: { ...catalog.nodes, any: { kind: "unknown", label: "any" }, text: { kind: "string", label: "string" } } };
    const lab = { suffix: "end" };
    const input = new CallbackInput('return arguments.length + "/" + String(value) + "/" + remaining.length + "/" + this.name + "/" + lab.suffix;', sig, true);
    const materializer = new ApiMaterializer(typed, {}, new ResourcePool({}), lab, () => {});
    materializer.preflight(input);
    const live = materializer.materialize(input) as (...args: unknown[]) => string;
    const exported = new Function("lab", "return (" + inputCode(input) + ")")(lab) as typeof live;
    for (const args of [[], [undefined], [1, "second", "third"]]) expect(live.apply({ name: "owner" }, args)).toBe(exported.apply({ name: "owner" }, args));
    materializer.dispose();
  });

  it("rejects a callback's invalid public return type and an asynchronous result after retirement", async () => {
    let release!: () => void;
    const pool = new ResourcePool({});
    const materializer = new ApiMaterializer(catalog, {}, pool, { wait: () => new Promise<void>((done) => { release = done; }) }, () => {});
    const bad = materializer.materialize(new CallbackInput("return 4;", callbackSignature("SourceConfig.drm.fairplay.prepareContentId"), true)) as (url: string) => unknown;
    expect(() => bad("skd://example")).toThrow("expected string");
    const late = materializer.materialize(new CallbackInput("await lab.wait(); return request;", callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true)) as (type: unknown, request: object) => Promise<object>;
    const pending = late("manifest", {}); materializer.dispose(); release();
    await expect(pending).rejects.toThrow("retired before the callback resolved");
  });

  it("rejects reserved paths, sparse arrays, oversized decoded bytes and incomplete nested configurations before dispatch", () => {
    expect(() => apiPath('PlayerConfig["__proto__"].polluted')).toThrow("Reserved");
    const sparse = configurationOverrides([{ id: "PlayerConfig.playback.preferredTech[].player", indices: [2], value: "html5" }]);
    expect(() => sparse.apply("PlayerConfig", {})).toThrow("sparse arrays");
    expect(() => validateConfigurationShape({ key: "test" }, { hls: "https://example.com/a.m3u8" }, [
      { id: "PlayerConfig.playback.preferredTech[].player", indices: [0], value: "html5" },
    ])).toThrow("PlayerConfig.playback");
    expect(() => parseBinary(Buffer.alloc(65537).toString("base64"), "base64")).toThrow("64 KiB");
    const unknown = Object.entries(catalog.nodes).find(([, node]) => node.kind === "unknown")![0];
    expect(() => validateData(catalog, unknown, new ExpressionInput("x".repeat(65537), true))).toThrow("64 KiB");
  });

  it("compiles applied enum, binary, callback and structured configuration code against the pinned SDK declarations", () => {
    const inputs: ConfigInput[] = [
      { id: "SourceConfig.options.startOffsetTimelineReference", indices: [], value: "end" },
      { id: "PlayerConfig.network.preprocessHttpRequest", indices: [], value: new CallbackInput("return request;", callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true) },
      { id: "SourceConfig.drm.widevine.serverCertificate", indices: [], value: new BinaryInput("000102", "hex", "ArrayBuffer") },
      { id: "SourceConfig.options.headers", indices: [], value: { Authorization: "private-test-value" } },
    ];
    const code = configurationCode({ player: { playback: { autoplay: false, muted: true } }, source: { hls: "https://example.com/media.m3u8" }, draft: {
      url: "https://example.com/media.m3u8", type: "hls", title: "", poster: "", startOffset: "", timeline: "default", autoplay: false, muted: true,
      videoForwardDuration: "", audioForwardDuration: "", maxVideoBitrate: "", subtitleUrl: "", subtitleLabel: "", subtitleLanguage: "", subtitleEnabled: false, apiInputs: inputs,
    } });
    expect(code).toContain("SDK.TimelineReferencePoint.End");
    expect(code).not.toContain("private-test-value"); expect(code).toContain("YOUR_VALUE");
    const file = path.resolve("test/generated-sdk-api-example.ts");
    const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config.config, ts.sys, path.resolve(".")).options;
    const host = ts.createCompilerHost(options); const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, language, onError, create) => name === file ? ts.createSourceFile(file, code, language, true) : read(name, language, onError, create);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});
