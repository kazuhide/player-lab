import { afterEach, describe, expect, it, vi } from "vitest";
import { requireProvisionedStreams } from "../../../tests/e2e/src/streams";

afterEach(() => vi.unstubAllEnvs());
describe("provisioned browser-test prerequisites", () => {
  it("identifies an unset media base before any player load", () => {
    vi.stubEnv("VITE_TEST_STREAM_BASE_URL", "");
    expect(() => requireProvisionedStreams()).toThrow(/Export VITE_TEST_STREAM_BASE_URL/);
  });
  it("rejects a relative media base instead of fetching local application HTML", () => {
    vi.stubEnv("VITE_TEST_STREAM_BASE_URL", "/test-media");
    expect(() => requireProvisionedStreams()).toThrow(/absolute HTTP or HTTPS/);
  });
  it("accepts a configured HTTP or HTTPS media base", () => {
    vi.stubEnv("VITE_TEST_STREAM_BASE_URL", "https://media.example.test/test-streams/");
    expect(() => requireProvisionedStreams()).not.toThrow();
  });
  it("constructs absolute feature URLs when the base is configured", async () => {
    vi.stubEnv("VITE_TEST_STREAM_BASE_URL", "https://media.example.test/test-streams/");
    vi.resetModules();
    const { PROVISIONED } = await import("../../../tests/e2e/src/streams");
    expect(PROVISIONED.vodBaselineHls).toBe("https://media.example.test/test-streams/vod-baseline/master.m3u8");
    expect(PROVISIONED.subtitleVttEn).toBe("https://media.example.test/test-streams/assets/sintel_en.vtt");
    expect(Object.values(PROVISIONED).every((url) => url.startsWith("https://media.example.test/test-streams/"))).toBe(true);
  });
  it("keeps all unavailable provisioned URLs empty rather than relative", async () => {
    vi.stubEnv("VITE_TEST_STREAM_BASE_URL", "");
    vi.resetModules();
    const { PROVISIONED } = await import("../../../tests/e2e/src/streams");
    expect(new Set(Object.values(PROVISIONED))).toEqual(new Set([""]));
  });

});
