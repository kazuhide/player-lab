import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("bitmovin-player-react-native", () => ({ CustomUi: class {}, AnalyticsRetryPolicy: {}, ForceReuseVideoCodecReason: {}, PictureInPictureAction: {},
  ScalingMode: { Fit: "Fit", Stretch: "Stretch", Zoom: "Zoom" }, SourceType: { HLS: "hls", DASH: "dash" }, SurfaceType: {}, TimelineReferencePoint: { START: "start", END: "end" },
  UserInterfaceType: { Bitmovin: "Bitmovin", System: "System", Subtitle: "Subtitle" } }));
const native = vi.hoisted(() => ({ files: new Map<string, string>(), read: vi.fn(), oversized: new Set<string>(), failMove: false, failCopy: false, failWrite: false }));
vi.mock("expo-file-system", () => ({
  Paths: { document: "private-documents" },
  File: class {
    uri: string;
    constructor(...paths: string[]) { this.uri = paths.join("/"); }
    get exists() { return native.files.has(this.uri); }
    get size() { return native.oversized.has(this.uri) ? 131073 : Buffer.byteLength(native.files.get(this.uri) ?? ""); }
    async text() { native.read(this.uri); if (!this.exists) throw new Error("missing"); return native.files.get(this.uri)!; }
    create() { native.files.set(this.uri, ""); }
    write(raw: string) { if (native.failWrite && this.uri.endsWith(".tmp")) throw new Error("disk full"); native.files.set(this.uri, raw); }
    delete() { native.files.delete(this.uri); }
    async copy(target: { uri: string }) { if (native.failCopy) throw new Error("copy failed"); native.files.set(target.uri, native.files.get(this.uri)!); }
    async move(target: { uri: string }) {
      native.files.delete(target.uri);
      if (native.failMove) throw new Error("move failed after deleting destination");
      native.files.set(target.uri, native.files.get(this.uri)!); native.files.delete(this.uri); this.uri = target.uri;
    }
  },
}));
import { createProfileIO } from "../src/profileStorage";
import { CURRENT_SDK_VERSION, encodeProfiles } from "../src/configurationProfiles";
const primary = "private-documents/player-lab-profiles-react-native-android-v1.json";
const raw = () => encodeProfiles([], "react-native-android");
const changed = () => encodeProfiles([{ name: "Changed", sdkVersion: CURRENT_SDK_VERSION, sourcePreset: null,
  settings: { type: "hls", startOffset: null, timeline: "default", autoplay: true, muted: false, forwardDuration: null, maxBitrate: null }, overrides: {} }], "react-native-android");
beforeEach(() => { native.files.clear(); native.read.mockClear(); native.oversized.clear(); native.failMove = false; native.failCopy = false; native.failWrite = false; });

describe("Expo profile files", () => {
  it("persists verified content across adapters and never deletes the moved primary during temporary cleanup", async () => {
    await createProfileIO("react-native-android").write(raw());
    expect(native.files.get(primary)).toBe(raw());
    expect(await createProfileIO("react-native-android").read()).toBe(raw());
    expect(native.files.has(primary + ".tmp")).toBe(false);
    expect(await createProfileIO("react-native-ios").read()).toBeNull();
  });
  it("checks native file size before reading content and does not silently accept a malformed primary", async () => {
    native.files.set(primary, raw()); native.oversized.add(primary);
    await expect(createProfileIO("react-native-android").read()).rejects.toMatchObject({ code: "capacity" });
    expect(native.read).not.toHaveBeenCalled();
    native.oversized.clear(); native.files.set(primary, "corrupt"); native.files.set(primary + ".backup", raw());
    await expect(createProfileIO("react-native-android").read()).rejects.toMatchObject({ code: "invalid" });
    expect(native.files.get(primary)).toBe("corrupt");
  });
  it("preserves the previous acknowledged primary on temporary write or replacement failure", async () => {
    const io = createProfileIO("react-native-android"); await io.write(raw());
    const previous = native.files.get(primary);
    native.failWrite = true;
    await expect(io.write(changed())).rejects.toMatchObject({ code: "storage" });
    expect(native.files.get(primary)).toBe(previous);
    native.failWrite = false; native.failMove = true;
    await expect(io.write(changed())).rejects.toMatchObject({ code: "storage" });
    expect(native.files.get(primary)).toBe(previous);
    expect(native.files.has(primary + ".tmp")).toBe(false);
  });
  it("offers explicit recovery after an interrupted replacement and validates the backup without loading it", async () => {
    const io = createProfileIO("react-native-android"); await io.write(raw());
    native.failMove = true; native.failCopy = true;
    await expect(io.write(changed())).rejects.toMatchObject({ code: "storage" });
    expect(native.files.has(primary)).toBe(false);
    expect(native.files.get(primary + ".backup")).toBe(raw());
    const restarted = createProfileIO("react-native-android");
    await expect(restarted.read()).rejects.toMatchObject({ code: "recovery" });
    expect(native.files.has(primary)).toBe(false);
    native.failMove = false; native.failCopy = false;
    await restarted.recover!();
    expect(await restarted.read()).toBe(raw());
  });
  it("refuses corrupt or oversized recovery data and leaves unrelated files unchanged", async () => {
    const other = "private-documents/unrelated.json"; native.files.set(other, "private-existing");
    native.files.set(primary + ".backup", "bad");
    const io = createProfileIO("react-native-android");
    await expect(io.recover!()).rejects.toMatchObject({ code: "invalid" });
    native.files.set(primary + ".backup", raw()); native.oversized.add(primary + ".backup");
    await expect(io.recover!()).rejects.toMatchObject({ code: "capacity" });
    expect(native.files.get(other)).toBe("private-existing");
    expect(native.files.has(primary)).toBe(false);
  });
});
