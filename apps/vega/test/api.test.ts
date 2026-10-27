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
import { typedCode } from "../src/api/typedCode";

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
    play: vi.fn(async () => {}), pause: vi.fn(), timeShift: vi.fn(),
    isLive: vi.fn(() => false), getMaxTimeShift: vi.fn(() => 0),
    sgai: { getActiveAd: vi.fn((): object | undefined => undefined), list: vi.fn(() => []), skip: vi.fn(async () => {}) },
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
  it("rejects SGAI skip for ordinary VOD even when the registered module exposes the method", async () => {
    const { session, player } = fixture();
    const skip = row("PlayerAPI.sgai.skip");
    await expect(session.run(skip, 0, [])).rejects.toThrow("No SGAI ad is active.");
    expect(session.operationAvailability(skip)).toEqual({ callable: false, reason: "No SGAI ad is active." });
    expect(session.availability().find(entry => entry.id === skip.id)).toEqual({ id: skip.id, callable: false, reason: "No SGAI ad is active." });
    expect(player.sgai.skip).not.toHaveBeenCalled();
    expect(session.operationAvailability(row("PlayerAPI.sgai.list"))).toEqual({ callable: true });
    expect(player.sgai.list).not.toHaveBeenCalled();
  });

  it("rechecks current SGAI state at dispatch and refreshes availability with recording paused", async () => {
    vi.useFakeTimers();
    const { session, player, listeners } = fixture();
    const skip = row("PlayerAPI.sgai.skip");
    player.sgai.getActiveAd.mockReturnValue({ isLinear: true });
    expect(session.operationAvailability(skip)).toEqual({ callable: true });
    session.setRecording(false);
    const changed = vi.fn(); session.onChange(changed);
    player.sgai.getActiveAd.mockReturnValue(undefined);
    const finished = catalog.rows.find(entry => entry.id === "PlayerEvent.AdFinished")!.value!;
    [...listeners.get(finished)!][0]!({ type: finished });
    vi.advanceTimersByTime(125);
    expect(changed).toHaveBeenCalled();
    expect(session.eventLines()).toEqual([]);
    await expect(session.run(skip, 0, [])).rejects.toThrow("No SGAI ad is active.");
    expect(player.sgai.skip).not.toHaveBeenCalled();
    player.sgai.getActiveAd.mockReturnValue({ isLinear: true });
    await session.run(skip, 0, []);
    expect(player.sgai.skip).toHaveBeenCalledOnce();
  });

  it("uses the current source for playback operations while retaining source load and event recovery paths", async () => {
    const { session, player } = fixture();
    player.getSource.mockReturnValue(null as never);
    await expect(session.run(row("PlayerAPI.play"), 0, [])).rejects.toThrow("Load a source before this operation.");
    expect(player.play).not.toHaveBeenCalled();
    expect(session.operationAvailability(row("PlayerAPI.load"))).toEqual({ callable: true });
    expect(session.operationAvailability(row("PlayerAPI.on"))).toEqual({ callable: true });
    await session.run(row("PlayerAPI.load"), 0, [{ hls: "https://example.com/recovery.m3u8" }]);
    expect(player.load).toHaveBeenCalledOnce();
  });

  it("uses native live state for timeshift and rechecks the source immediately before dispatch", async () => {
    const { session, player } = fixture();
    const shift = row("PlayerAPI.timeShift");
    expect(session.operationAvailability(shift).callable).toBe(false);
    player.isLive.mockReturnValue(true); player.getMaxTimeShift.mockReturnValue(-300);
    expect(session.operationAvailability(shift)).toEqual({ callable: true });
    player.getSource.mockReturnValueOnce({ hls: "https://example.com/live.m3u8" }).mockReturnValueOnce(null as never);
    await expect(session.run(shift, 0, [new NumericInput("-10")])).rejects.toThrow("Load a source before this operation.");
    expect(player.timeShift).not.toHaveBeenCalled();
  });

  it("retains live-edge recovery without a DVR window while blocking a rewind request", async () => {
    const { session, player } = fixture();
    player.isLive.mockReturnValue(true);
    const shift = row("PlayerAPI.timeShift");
    expect(session.operationAvailability(shift)).toEqual({ callable: true });
    await session.run(shift, 0, [new NumericInput("0")]);
    expect(player.timeShift).toHaveBeenCalledWith(0);
    await expect(session.run(shift, 0, [new NumericInput("-10")])).rejects.toThrow("no live DVR window");
    expect(player.timeShift).toHaveBeenCalledOnce();
  });

  it("does not treat Analytics SSAI notifications as SGAI playback commands", async () => {
    const { session, player } = fixture();
    const adStart = vi.fn(); Object.assign(player, { analytics: { ssai: { adStart } } });
    const notify = row("PlayerAPI.analytics.ssai.adStart");
    expect(session.operationAvailability(notify)).toEqual({ callable: true });
    await session.run(notify, 0, []);
    expect(adStart).toHaveBeenCalledOnce();
  });

  it("keeps client-side scheduling independent of active ad state and separates it from SGAI", async () => {
    const { session, player } = fixture();
    const ads = { schedule: vi.fn(async () => []), skip: vi.fn(async () => {}), getActiveAd: vi.fn((): object | null => null),
      list: vi.fn((): Array<{ id: string }> => []), getActiveAdBreak: () => null, discardAdBreak: vi.fn() };
    Object.assign(player, { ads, getCurrentTime: () => 5 });
    expect(session.operationAvailability(row("PlayerAPI.ads.schedule"))).toEqual({ callable: true });
    await expect(session.run(row("PlayerAPI.ads.skip"), 0, [])).rejects.toThrow("No client-side ad is active");
    player.sgai.getActiveAd.mockReturnValue({ isLinear: true });
    expect(session.operationAvailability(row("PlayerAPI.ads.skip")).callable).toBe(false);
    ads.getActiveAd.mockReturnValue({ isLinear: true, skippableAfter: 10 });
    await expect(session.run(row("PlayerAPI.ads.skip"), 0, [])).rejects.toThrow("cannot be skipped yet");
    ads.getActiveAd.mockReturnValue({ isLinear: true, skippableAfter: 0 });
    await session.run(row("PlayerAPI.ads.skip"), 0, []); expect(ads.skip).toHaveBeenCalledOnce();
    expect(session.operationAvailability(row("PlayerAPI.ads.discardAdBreak")).callable).toBe(false);
    ads.list.mockReturnValue([{ id: "current-break" }]);
    await expect(session.run(row("PlayerAPI.ads.discardAdBreak"), 0, ["old-break"])).rejects.toThrow("current or scheduled");
    await session.run(row("PlayerAPI.ads.discardAdBreak"), 0, ["current-break"]);
    expect(ads.discardAdBreak).toHaveBeenCalledWith("current-break");
  });

  it("keeps auto quality and subtitle clearing available while rejecting stale current-source choices", async () => {
    const { session, player } = fixture();
    const setVideoQuality = vi.fn(); const disable = vi.fn(); const enable = vi.fn();
    Object.assign(player, { setVideoQuality, getAvailableVideoQualities: vi.fn(() => []), subtitles: { list: () => [], disable, enable } });
    await session.run(row("PlayerAPI.setVideoQuality"), 0, ["auto"]);
    expect(setVideoQuality).toHaveBeenCalledWith("auto");
    await expect(session.run(row("PlayerAPI.setVideoQuality"), 0, ["old-source-quality"])).rejects.toThrow("current source or use auto");
    expect(setVideoQuality).toHaveBeenCalledOnce();
    expect(session.operationAvailability(row("PlayerAPI.subtitles.enable")).callable).toBe(false);
    player.getSource.mockReturnValue(null as never);
    await session.run(row("PlayerAPI.subtitles.disable"), 0, ["old-source-subtitle"]);
    expect(disable).toHaveBeenCalledOnce(); expect(enable).not.toHaveBeenCalled();
  });

  it("rejects operations whose native capability getter fails instead of sending an SDK command", async () => {
    const { session, player } = fixture();
    player.sgai.getActiveAd.mockImplementation(() => { throw new Error("native getter unavailable"); });
    await expect(session.run(row("PlayerAPI.sgai.skip"), 0, [])).rejects.toThrow("current native SDK state");
    expect(player.sgai.skip).not.toHaveBeenCalled();
  });

  it("dispatches published numeric arguments and rejects invalid input before calling the SDK", async () => {
    const { session, player } = fixture();
    expect(await session.run(row("PlayerAPI.seek"), 0, [new NumericInput("12.5"), "gui-test"])).toEqual({ value: "true", code: 'player.seek(12.5, "gui-test");' });
    expect(player.seek).toHaveBeenCalledWith(12.5, "gui-test");
    await expect(session.run(row("PlayerAPI.seek"), 0, [new NumericInput("NaN")])).rejects.toThrow("Enter a number");
    expect(player.seek).toHaveBeenCalledTimes(1);
  });

  it("reports current method and state availability without invoking the selected commands", () => {
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
  it("redacts copied URL credentials and header strings without changing live input or callback text", () => {
    const value = { url: "https://user:pass@example.test/master.m3u8?token=private-token&quality=hd", headers: { "X-Session": "private-header" } };
    const copied = inputCode(value);
    for (const secret of ["user:pass", "private-token", "private-header"]) expect(copied).not.toContain(secret);
    expect(copied).toContain("quality=hd");
    expect(value.headers["X-Session"]).toBe("private-header");
    expect(value.url).toContain("private-token");
    expect(inputCode("https://example.test/master.m3u8?quality=hd")).toBe('"https://example.test/master.m3u8?quality=hd"');
    const body = 'return "https://example.test/a?token=program-data";';
    expect(inputCode(new CallbackInput(body, callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true))).toContain(body);
    expect(JSON.parse(inputCode(body))).toBe(body);
  });
  it("masks complete URL userinfo in copied data while retaining SDK input and program text", () => {
    const url = "https://user:p@ss@example.test/a?email=user@example.test#contact=other@example.test";
    const expected = "https://[redacted]@example.test/a?email=user@example.test#contact=other@example.test";
    const value = { hls: url };
    expect(JSON.parse(inputCode(value))).toEqual({ hls: expected });
    expect(JSON.parse(typedCode(catalog.roots.SourceConfig!, value, ["SourceConfig"]))).toEqual({ hls: expected });
    expect(value.hls).toBe(url);
    const body = `return ${JSON.stringify(url)};`;
    expect(JSON.parse(inputCode(body))).toBe(body);
    expect(inputCode(new CallbackInput(body, callbackSignature("PlayerConfig.network.preprocessHttpRequest"), true, true))).toContain(body);
  });

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
