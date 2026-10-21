import { describe, expect, it } from "vitest";
import { ApiOverrides, apiPath, parseBinary, validateData } from "../src/api/values";
import { BinaryInput, ElementInput, type ApiSchema } from "../src/api/types";

const schema: ApiSchema = { schemaVersion: 1, playerVersion: "8", uiVersion: "4", constructors: {}, rows: [], nodes: {
  text: { kind: "string", label: "string" }, number: { kind: "number", label: "number" },
  optional: { kind: "union", label: "string | undefined", options: ["text", "unset"] },
  unset: { kind: "undefined", label: "undefined" },
  list: { kind: "array", label: "string[]", item: "text" },
  request: { kind: "object", label: "Request", properties: [
    { name: "url", schema: "text", optional: false }, { name: "title", schema: "optional", optional: true },
  ] },
  map: { kind: "object", label: "Record<string, number>", properties: [], additional: "number" },
} };

describe("SDK editor input validation", () => {
  it("rejects invalid nested values and omitted required inputs", () => {
    expect(() => validateData(schema, "request", {})).toThrow(/url/);
    expect(() => validateData(schema, "list", ["en", 4])).toThrow(/\[1\]/);
    expect(() => validateData(schema, "map", { retry: "3" })).toThrow(/retry/);
    expect(() => validateData(schema, "number", Number.NaN)).toThrow();
    expect(validateData(schema, "request", { url: "https://example.com/stream.m3u8" })).toEqual({ url: "https://example.com/stream.m3u8" });
  });

  it("rejects prototype keys even in dictionaries", () => {
    const input = JSON.parse('{"__proto__": 1}');
    expect(() => validateData(schema, "map", input)).toThrow(/reserved/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("parses quoted SDK path keys and explicit array indices", () => {
    expect(apiPath('PlayerConfig.network.requestTimeout["drm/certificate/fairplay"]')).toEqual(["network", "requestTimeout", "drm/certificate/fairplay"]);
    expect(apiPath("SourceConfig.subtitleTracks[].lang", [2])).toEqual(["subtitleTracks", 2, "lang"]);
    expect(() => apiPath("SourceConfig.subtitleTracks[].lang", [-1])).toThrow();
    expect(() => apiPath("PlayerConfig.__proto__.polluted")).toThrow(/reserved/i);
  });

  it("decodes certificate bytes without treating plain objects as ArrayBuffer", () => {
    expect(Array.from(parseBinary("0001feff", "hex"))).toEqual([0, 1, 254, 255]);
    expect(Array.from(parseBinary("AAH+/w==", "base64"))).toEqual([0, 1, 254, 255]);
    expect(() => parseBinary("abc", "hex")).toThrow();
    expect(() => parseBinary("not a certificate", "base64")).toThrow();
  });

  it("distinguishes a certificate buffer from its view and a video element from an unrelated element", () => {
    const typed: ApiSchema = { ...schema, nodes: { ...schema.nodes,
      certificate: { kind: "binary", label: "ArrayBuffer", name: "ArrayBuffer" },
      video: { kind: "instance", label: "HTMLVideoElement", name: "HTMLVideoElement", factories: [] },
      document: { kind: "instance", label: "Document", name: "Document", factories: [] } } };
    expect(() => validateData(typed, "certificate", new Uint8Array([1, 2]))).toThrow(/ArrayBuffer/);
    expect(() => validateData(typed, "certificate", new BinaryInput("0102", "hex", "DataView"))).toThrow(/ArrayBuffer/);
    expect(() => validateData(typed, "video", new ElementInput("div"))).toThrow(/HTMLVideoElement/);
    expect(() => validateData(typed, "document", new ElementInput("div"))).toThrow(/Document/);
    expect(validateData(typed, "video", new ElementInput("video"))).toEqual(new ElementInput("video"));
    expect(validateData(typed, "certificate", new Uint8Array([1, 2]).buffer)).toBeInstanceOf(ArrayBuffer);
  });
});

describe("independent API overrides", () => {
  it("preserves sibling array values and restores the base when an override is removed", () => {
    const overrides = new ApiOverrides();
    const base = { subtitleTracks: [{ url: "first.vtt", lang: "en" }, { url: "second.vtt", lang: "de" }] };
    overrides.set("SourceConfig", ["subtitleTracks", 1, "lang"], "ja");
    expect(overrides.apply("SourceConfig", base)).toEqual({ subtitleTracks: [base.subtitleTracks[0], { url: "second.vtt", lang: "ja" }] });
    expect(base.subtitleTracks[1]!.lang).toBe("de");
    overrides.remove("SourceConfig", ["subtitleTracks", 1, "lang"]);
    expect(overrides.apply("SourceConfig", base)).toEqual(base);
  });

  it("keeps false, zero and empty text, and maps component overrides to UIConfig", () => {
    const overrides = new ApiOverrides();
    overrides.set("PlayerConfig", ["playback", "autoplay"], false);
    overrides.set("PlayerConfig", ["live", "targetLatency"], 0);
    overrides.set("UIConfig", ["componentConfigOverrides", "Label", "text"], "");
    expect(overrides.apply("PlayerConfig", {})).toEqual({ playback: { autoplay: false }, live: { targetLatency: 0 } });
    expect(overrides.apply("UIConfig", {})).toEqual({ componentConfigOverrides: { Label: { text: "" } } });
  });

  it("rejects holes in newly created arrays and never invokes a materializer for a stale value", () => {
    const overrides = new ApiOverrides();
    overrides.set("SourceConfig", ["subtitleTracks", 2, "lang"], "ja");
    expect(() => overrides.apply("SourceConfig", {})).toThrow(/array/i);
    overrides.remove("SourceConfig", ["subtitleTracks", 2, "lang"]);
    expect(overrides.apply("SourceConfig", {})).toEqual({});
  });

  it("lets a later ordinary GUI patch discard only overlapping advanced overrides", () => {
    const overrides = new ApiOverrides();
    overrides.set("PlayerConfig", ["playback", "autoplay"], true);
    overrides.set("PlayerConfig", ["playback", "muted"], false);
    overrides.set("PlayerConfig", ["live", "targetLatency"], 5);
    overrides.discardPatch("PlayerConfig", { playback: { autoplay: false } });
    expect(overrides.apply("PlayerConfig", { playback: { autoplay: false } })).toEqual({ playback: { autoplay: false, muted: false }, live: { targetLatency: 5 } });
  });

  it("returns displaced child edits so a rejected parent edit can restore them without losing siblings", () => {
    const overrides = new ApiOverrides();
    overrides.set("PlayerConfig", ["playback", "autoplay"], true);
    overrides.set("PlayerConfig", ["playback", "muted"], false);
    overrides.set("PlayerConfig", ["live", "targetLatency"], 5);
    const replaced = overrides.set("PlayerConfig", ["playback"], { autoplay: false });
    expect(overrides.apply("PlayerConfig", {})).toEqual({ playback: { autoplay: false }, live: { targetLatency: 5 } });
    overrides.remove("PlayerConfig", ["playback"]);
    for (const prior of replaced) overrides.set("PlayerConfig", prior.path, prior.value);
    expect(overrides.apply("PlayerConfig", {})).toEqual({ playback: { autoplay: true, muted: false }, live: { targetLatency: 5 } });
  });
});
