import { describe, expect, it } from "vitest";
import { createProfileRules, decodeProfiles, encodeProfiles, saveProfile, deleteProfile, readProfiles, writeProfiles, clearProfiles, PROFILE_STORAGE_KEY, type ProfileStore } from "../src/configurationProfiles";

const rules = createProfileRules([
  { key: "PlayerConfig.playback.autoplay", kind: "bool" },
  { key: "PlayerConfig.playback.volume", kind: "number" },
  { key: "PlayerConfig.playback.audioLanguage", kind: "text" },
  { key: "PlayerConfig.style.width", kind: "text" },
  { key: "PlayerConfig.network.defaultRequestTimeout", kind: "number", min: 0 },
  { key: "PlayerConfig.network.requestApi", kind: "enum", options: ["", "xhr", "fetch"] },
  { key: "SourceConfig.options.startOffset", kind: "number" },
  { key: "PlayerConfig.key", kind: "text" },
  { key: "SourceConfig.poster", kind: "text" },
]);
const values = { "PlayerConfig.playback.autoplay": false, "PlayerConfig.playback.volume": 0, "SourceConfig.options.startOffset": null };
const empty = () => ({ schemaVersion: 1 as const, platform: "web" as const, profiles: [] });
const id = "00000000-0000-4000-8000-000000000001";
const saved = () => saveProfile(empty(), "Baseline", values, "8.281.0", rules, id);
function store(): ProfileStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

describe("named basic configuration profiles", () => {
  it("saves typed zero, false and explicit default without retaining references", () => {
    const collection = saved();
    expect(collection.profiles[0]?.values).toEqual(values);
    expect(collection.profiles[0]?.values).not.toBe(values);
    expect(decodeProfiles(encodeProfiles(collection, rules), rules)).toEqual(collection);
    expect(rules.has("PlayerConfig.key")).toBe(false);
    expect(rules.has("SourceConfig.poster")).toBe(false);
  });
  it("updates the same name, deletes explicitly and bounds profile counts and names", () => {
    let collection = saved();
    collection = saveProfile(collection, " baseline ", { ...values, "PlayerConfig.playback.volume": 37 }, "8.282.0", rules, "00000000-0000-4000-8000-000000000002");
    expect(collection.profiles).toHaveLength(1); expect(collection.profiles[0]?.id).toBe(id);
    expect(collection.profiles[0]?.sdkVersion).toBe("8.282.0");
    for (const name of ["", " ", "a".repeat(49), "line\nbreak"]) expect(() => saveProfile(collection, name, values, "8.281.0", rules, id)).toThrow();
    expect(() => saveProfile(collection, "あ".repeat(48), values, "8.281.0", rules, "00000000-0000-4000-8000-000000000002")).not.toThrow();
    for (let index = 1; index < 20; index++) collection = saveProfile(collection, `Case ${index}`, values, "8.281.0", rules, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    expect(() => saveProfile(collection, "Extra", values, "8.281.0", rules, "00000000-0000-4000-8000-999999999999")).toThrow();
    expect(deleteProfile(collection, id).profiles).toHaveLength(19);
    expect(collection.profiles).toHaveLength(20);
  });
  it("rejects old/future formats, other platforms and unknown structural fields", () => {
    for (const patch of [{ schemaVersion: 0 }, { schemaVersion: 2 }, { platform: "android" }, { credentials: "fictional-private-value" }, { profiles: {} }]) {
      expect(() => decodeProfiles(JSON.stringify({ ...saved(), ...patch }), rules)).toThrow();
    }
    const profile = saved().profiles[0]!;
    for (const patch of [{ credentials: "fictional-private-value" }, { sdkVersion: "" }, { name: "" }, { id: "not-an-id" }]) {
      expect(() => decodeProfiles(JSON.stringify({ ...empty(), profiles: [{ ...profile, ...patch }] }), rules)).toThrow();
    }
    expect(() => decodeProfiles("{bad-json", rules)).toThrow();
    expect(() => decodeProfiles(" ".repeat(128 * 1024 + 1), rules)).toThrow();
  });
  it("rejects unsupported keys, credentials, callback objects, invalid types and unsafe strings", () => {
    for (const [key, value] of [
      ["PlayerConfig.key", "fictional-private-value"], ["PlayerConfig.analytics.key", "fictional-private-value"],
      ["SourceConfig.hls", "https://example.invalid/video?token=fictional-private-value"],
      ["SourceConfig.drm.widevine.LA_URL", "https://example.invalid/license"], ["PlayerConfig.network.headers", { Authorization: "fictional-private-value" }],
      ["PlayerConfig.network.preprocessHttpRequest", { body: "return request;" }], ["SourceConfig.options.sessionId", "fictional-private-value"],
      ["PlayerConfig.playback.autoplay", "false"], ["PlayerConfig.playback.volume", Infinity],
      ["PlayerConfig.playback.volume", {}], ["PlayerConfig.network.defaultRequestTimeout", -1],
      ["PlayerConfig.network.requestApi", "unknown"], ["PlayerConfig.playback.audioLanguage", "https://example.invalid/?token=x"],
      ["PlayerConfig.style.width", "url(https://example.invalid/x)"], ["__proto__", { polluted: true }],
    ] as const) {
      const input = Object.fromEntries([[key, value]]);
      expect(() => saveProfile(empty(), "Unsafe", input, "8.281.0", rules, id)).toThrow();
      if (typeof value !== "number" || Number.isFinite(value)) expect(() => decodeProfiles(JSON.stringify({ ...empty(), profiles: [{ id, name: "Unsafe", sdkVersion: "8.281.0", values: input }] }), rules)).toThrow();
    }
    expect(() => saveProfile(empty(), "Valid", { "PlayerConfig.playback.audioLanguage": "ja-JP", "PlayerConfig.style.width": "99%" }, "8.281.0", rules, id)).not.toThrow();
    expect(() => decodeProfiles(JSON.stringify(saved()).replace('"PlayerConfig.playback.volume":0', '"PlayerConfig.playback.volume":1e400'), rules)).toThrow();
  });
  it("retains SDK provenance while validating its fields against the current editor", () => {
    const older = { ...saved(), profiles: [{ ...saved().profiles[0]!, sdkVersion: "8.280.0" }] };
    expect(decodeProfiles(JSON.stringify(older), rules).profiles[0]?.sdkVersion).toBe("8.280.0");
    const fewerRules = createProfileRules([{ key: "PlayerConfig.playback.autoplay", kind: "bool" }]);
    expect(() => decodeProfiles(JSON.stringify(older), fewerRules)).toThrow();
  });
  it("validates in-memory values before JSON can turn non-finite numbers into null", () => {
    const collection = saved();
    collection.profiles[0]!.values["PlayerConfig.playback.volume"] = Infinity;
    expect(() => encodeProfiles(collection, rules)).toThrow();
    const storage = store();
    expect(() => writeProfiles(() => storage, collection, rules)).toThrow();
    expect(storage.data.size).toBe(0);
  });
  it("represents an explicit removed override as null, including boolean and enum fields", () => {
    const profile = saveProfile(empty(), "No override", { "PlayerConfig.playback.autoplay": null, "PlayerConfig.network.requestApi": null }, "8.281.0", rules, id);
    expect(decodeProfiles(encodeProfiles(profile, rules), rules)).toEqual(profile);
  });
  it("handles unavailable, denied, corrupt and quota-limited storage without replacing prior values", () => {
    const storage = store(); const getter = () => storage;
    expect(readProfiles(getter, rules).profiles).toEqual([]);
    writeProfiles(getter, saved(), rules);
    expect(storage.data.has(PROFILE_STORAGE_KEY)).toBe(true);
    expect(readProfiles(getter, rules)).toEqual(saved());
    const denied = () => { throw new Error("fictional-private-value"); };
    expect(() => readProfiles(denied, rules)).toThrow("storage");
    expect(() => writeProfiles(denied, saved(), rules)).toThrow("storage");
    const before = storage.data.get(PROFILE_STORAGE_KEY);
    const quota = () => ({ ...storage, setItem: () => { throw new Error("fictional-private-value"); } });
    expect(() => writeProfiles(quota, saved(), rules)).toThrow("storage");
    expect(storage.data.get(PROFILE_STORAGE_KEY)).toBe(before);
    storage.data.set(PROFILE_STORAGE_KEY, "{broken");
    expect(() => readProfiles(getter, rules)).toThrow();
    expect(storage.data.get(PROFILE_STORAGE_KEY)).toBe("{broken");
    storage.data.set("ui-language", "ja");
    clearProfiles(getter); expect(readProfiles(getter, rules).profiles).toEqual([]);
    expect(storage.data.size).toBe(1); expect(storage.data.get("ui-language")).toBe("ja");
  });
});
