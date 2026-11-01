import { describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => ({ NativeModules: {}, StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock("bitmovin-player-react-native", () => ({
  CustomUi: class {}, AnalyticsRetryPolicy: {}, ForceReuseVideoCodecReason: {}, PictureInPictureAction: {},
  ScalingMode: { Fit: "Fit", Stretch: "Stretch", Zoom: "Zoom" }, SourceType: { HLS: "hls", DASH: "dash", PROGRESSIVE: "progressive" },
  SurfaceType: {}, TimelineReferencePoint: { START: "start", END: "end" },
  UserInterfaceType: { Bitmovin: "Bitmovin", System: "System", Subtitle: "Subtitle" },
}));
import { CURRENT_SDK_VERSION, PROFILE_LIMITS, PROFILE_OVERRIDE_IDS, ConfigurationProfileError, ProfileRepository,
  captureProfile, decodeProfiles, encodeProfiles, restoreProfile, type ProfileIO } from "../src/configurationProfiles";
import { NATIVE_SETTING_FIELDS } from "../src/nativeSettings";
import { translateCopy } from "../src/localization";
import type { ConfigurationDraft } from "../src/configuration";

const platform = "react-native-android" as const;
const safeId = "PlayerConfig.tweaksConfig.timeChangedInterval";
const excludedId = "PlayerConfig.licenseKey";
function draft(): ConfigurationDraft {
  return { url: "https://example.com/private-stream.m3u8?token=private-token", type: "hls", title: "private-title", poster: "https://example.com/private-poster", startOffset: "", timeline: "default", autoplay: false, muted: false, forwardDuration: "", maxBitrate: "", subtitleUrl: "", subtitleLabel: "", subtitleLanguage: "", subtitleDefault: false };
}
function memory() {
  let value: string | null = null;
  let fail = false;
  const io: ProfileIO = { read: vi.fn(async () => value), write: vi.fn(async next => {
    if (fail) throw new Error("private filesystem detail"); value = next;
  }) };
  return { io, get value() { return value; }, set value(next) { value = next; }, set fail(next: boolean) { fail = next; } };
}

const profile = () => captureProfile("Low buffer", draft(), platform);
const mutate = (change: (data: Record<string, any>) => void) => {
  const data = JSON.parse(encodeProfiles([profile()], platform)); change(data); return JSON.stringify(data);
};

describe("local named configuration drafts", () => {

  it("provides Japanese explanations for each profile validation and storage error", () => {
    for (const code of ["invalid", "format", "name", "capacity", "duplicate", "missing", "sdk", "storage", "recovery"] as const) {
      const message = new ConfigurationProfileError(code).message;
      expect(translateCopy(message, "ja"), code).not.toBe(message);
      expect(translateCopy(message, "en"), code).toBe(message);
    }
  });


  it("rejects non-finite values before JSON encoding and restores valid small and large decimals without exponent notation", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const saved = profile(); saved.settings.startOffset = value;
      expect(() => encodeProfiles([saved], platform)).toThrow();
    }
    for (const value of ["0.0000001", "-0.0000001", "1000000000000000000000", "0." + "0".repeat(323) + "5"]) {
      const source = draft(); source.startOffset = value;
      const saved = captureProfile("Decimal", source, platform);
      const restored = restoreProfile(saved, draft(), platform);
      expect(restored.startOffset).not.toMatch(/[eE]/);
      expect(Number(restored.startOffset)).toBe(Number(value));
      expect(captureProfile("Again", restored, platform).settings.startOffset).toBe(Number(value));
    }
  });

  it("keeps every explicitly allowed override aligned with an actual primitive editor field", () => {
    for (const id of PROFILE_OVERRIDE_IDS) {
      const field = NATIVE_SETTING_FIELDS.find(candidate => candidate.id === id);
      expect(field, id).toBeDefined();
      expect(["number", "boolean", "enum"], id).toContain(field!.kind);
      const value = field!.kind === "number" ? "1" : field!.choices![0]!;
      const source = draft(); source.apiSettings = { [id]: value };
      expect(captureProfile("Field", source, platform).overrides[id], id).toBe(value);
    }
  });

  it("saves, selects after restart, replaces only after confirmation, and deletes durably", async () => {
    const disk = memory(); const first = new ProfileRepository(disk.io, platform);
    await first.save(profile());
    const restarted = new ProfileRepository(disk.io, platform);
    expect(await restarted.list()).toEqual([profile()]);
    await expect(restarted.save(profile())).rejects.toMatchObject({ code: "duplicate" });
    await restarted.save({ ...profile(), name: "Low buffer" }, true);
    expect(await restarted.remove("Low buffer")).toEqual([]);
    expect(await new ProfileRepository(disk.io, platform).list()).toEqual([]);
  });

  it("omits every excluded field and preserves current excluded inputs on draft restoration", () => {
    const source = draft();
    source.apiSettings = { [safeId]: "1.5", [excludedId]: "secret-license", "Unknown.runtime.token": "private-value" }; source.scripts = { allowed: true, bodies: { "PlayerConfig.networkConfig.preprocessHttpRequest": "return private_request;" } }; source.arraySettings = { subtitles: [] };
    const saved = captureProfile("Safe", source, platform);
    const encoded = encodeProfiles([saved], platform);
    expect(encoded).not.toMatch(/private-|Bearer|secret-|return |metadata/);
    const current = draft(); current.apiSettings = { [excludedId]: "secret-current", "Unknown.runtime.token": "private-current" }; current.scripts = source.scripts; current.arraySettings = source.arraySettings;
    const restored = restoreProfile(saved, current, platform);
    expect(restored.url).toBe(current.url); expect(restored.title).toBe(current.title); expect(restored.apiSettings?.[excludedId]).toBe("secret-current"); expect(restored.apiSettings?.["Unknown.runtime.token"]).toBe("private-current"); expect(restored.scripts).toBe(current.scripts); expect(restored.arraySettings).toBe(current.arraySettings); expect(restored.apiSettings?.[safeId]).toBe("1.5");
    expect(restored.autoplay).toBe(source.autoplay);
    expect(restored.muted).toBe(source.muted);
    expect(current).not.toBe(restored);
  });

  it("replaces allowed overrides as a set, including omitted SDK defaults, without materializing excluded inputs", () => {
    const saved = captureProfile("Defaults", draft(), platform);
    const current = draft(); current.apiSettings = { [safeId]: "0.25", [excludedId]: "secret-current" };
    const restored = restoreProfile(saved, current, platform);
    expect(restored.apiSettings).toEqual({ [excludedId]: "secret-current" });
  });

  it("requires SDK mismatch confirmation after validating current supported fields", () => {
    const saved = { ...profile(), sdkVersion: "99.0.0" };
    expect(() => restoreProfile(saved, draft(), platform)).toThrow(ConfigurationProfileError);
    expect(restoreProfile(saved, draft(), platform, true).autoplay).toBe(saved.settings.autoplay);
    expect(() => restoreProfile({ ...saved, overrides: { "PlayerConfig.unknown": true } } as never, draft(), platform, true)).toThrow();
    expect(CURRENT_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects corrupt, unsupported old/future/platform/unknown fields and wrong types rather than dropping them", () => {
    for (const raw of ["{", "[]", "null", mutate(d => d.schemaVersion = 0), mutate(d => d.schemaVersion = 2),
      mutate(d => d.platform = "another-platform"), mutate(d => d.unknown = true), mutate(d => d.profiles[0].unknown = true),
      mutate(d => d.profiles[0].settings.unknown = 1), mutate(d => d.profiles[0].settings.autoplay = "false"),
      mutate(d => d.profiles[0].overrides["PlayerConfig.unknown"] = true),
      mutate(d => d.profiles[0].overrides[safeId] = { script: "return secret;" }),
      mutate(d => d.profiles[0].sourcePreset = "unknown-preset"),
      mutate(d => d.profiles.push(d.profiles[0])),
      mutate(d => d.profiles[0].name = "bad\nname"),
      mutate(d => d.profiles[0].settings.startOffset = "Infinity"),
      mutate(d => d.profiles[0].overrides["__proto__"] = { secret: true }) + "trailing",
    ]) expect(() => decodeProfiles(raw, platform), raw).toThrow(ConfigurationProfileError);
    expect(() => decodeProfiles(null, "web" as never)).toThrow();
    expect(() => encodeProfiles([], "web" as never)).toThrow();
    expect(() => decodeProfiles('{"schemaVersion":1,"platform":' + JSON.stringify(platform) + ',"profiles":[],"__proto__":{}}', platform)).toThrow();
  });

  it("normalizes names and bounds Unicode characters, count, profile bytes, collection bytes and numeric input", async () => {
    expect(captureProfile("  Cafe\u0301  ", draft(), platform).name).toBe("Café");
    expect(captureProfile("😀".repeat(48), draft(), platform).name).toHaveLength(96);
    for (const name of ["", "   ", "😀".repeat(49), "a\u0000b", "\ud800"]) expect(() => captureProfile(name, draft(), platform)).toThrow();
    const disk = memory(); const store = new ProfileRepository(disk.io, platform);
    for (let i = 0; i < PROFILE_LIMITS.count; i++) await store.save({ ...profile(), name: "Profile " + i });
    await expect(store.save({ ...profile(), name: "overflow" })).rejects.toMatchObject({ code: "capacity" });
    expect(() => decodeProfiles(" ".repeat(PROFILE_LIMITS.totalBytes + 1), platform)).toThrow();
    expect(() => decodeProfiles(mutate(d => d.profiles[0].name = "界".repeat(PROFILE_LIMITS.profileBytes)), platform)).toThrow();
    const bad = draft(); bad.startOffset = "Infinity"; expect(() => captureProfile("Bad", bad, platform)).toThrow();
    const invalid = draft(); invalid.apiSettings = { [safeId]: "NaN" };
    expect(() => captureProfile("Bad", invalid, platform)).toThrow();
  });

  it("accepts only exact built-in source URLs and types, keeping arbitrary current URLs out of storage", () => {
    const original = draft(); const saved = captureProfile("Custom", original, platform);
    expect(saved.sourcePreset).toBeNull();
    const current = draft(); current.url = "https://example.com/current.m3u8?token=private-current";
    expect(restoreProfile(saved, current, platform).url).toBe(current.url);
    const builtIn = { ...original, url: "https://demo.unified-streaming.com/k8s/vod2live/stable/unified-learning.isml/.m3u8" }; const preset = captureProfile("Built-in", builtIn, platform); expect(preset.sourcePreset).toBe("live-hls"); expect(restoreProfile(preset, current, platform).url).toBe(builtIn.url); expect(captureProfile("Changed", { ...builtIn, url: builtIn.url + "?token=private" }, platform).sourcePreset).toBeNull(); expect(() => decodeProfiles(encodeProfiles([profile()], platform), "react-native-ios")).toThrow();
  });

  it("preserves the last acknowledged list on failed writes, rejects unreadable data and serializes edits", async () => {
    const disk = memory(); const store = new ProfileRepository(disk.io, platform);
    await store.save(profile()); const acknowledged = disk.value;
    disk.fail = true;
    await expect(store.remove(profile().name)).rejects.toMatchObject({ code: "storage" });
    expect(disk.value).toBe(acknowledged);
    disk.fail = false;
    await Promise.all([store.save({ ...profile(), name: "Second" }), store.save({ ...profile(), name: "Third" })]);
    expect((await store.list()).map(p => p.name)).toEqual(["Low buffer", "Second", "Third"]);
    disk.value = "corrupt";
    await expect(store.save({ ...profile(), name: "New" })).rejects.toBeInstanceOf(ConfigurationProfileError);
    expect(disk.value).toBe("corrupt");
    const failed = new ProfileRepository({ read: async () => { throw new Error("private-path"); }, write: async () => {} }, platform);
    await expect(failed.list()).rejects.toMatchObject({ code: "storage", message: "Saved configurations could not be read or written." });
  });
});
