import { afterEach, describe, expect, it, vi } from "vitest";
const network = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("../src/startup/demo-network", () => ({ prepareDemoNetwork: network.prepare }));
import { DemoRuntime } from "../src/startup/demo-session";
import type { DemoNetworkStatus } from "../src/startup/demo-contract";
afterEach(() => vi.unstubAllGlobals());

describe("retained runtime network ownership", () => {
  it("sends null release through an unsupported controller without promoting support or emitting pre-start samples", async () => {
    const status: DemoNetworkStatus = { support: "unsupported", reason: "opaque-media", rateBytesPerSecond: 2048,
      shapedResponses: 1, deliveredBytes: 512, skippedResponses: 1 };
    const setRate = vi.fn(async (rate: number | null) => { status.rateBytesPerSecond = rate; });
    const dispose = vi.fn(async () => {}); network.prepare.mockResolvedValue({ get status() { return { ...status }; }, setRate, dispose });
    const sample = vi.fn();
    const runtime = new DemoRuntime({ engine: "hls", video: {} as HTMLVideoElement, container: {} as HTMLElement, onSample: sample });
    try {
      expect(await runtime.setNetworkRate(null)).toMatchObject({ support: "unsupported", reason: "opaque-media", rateBytesPerSecond: null });
      expect(setRate).toHaveBeenCalledExactlyOnceWith(null); expect(sample).not.toHaveBeenCalled();
      expect(await runtime.setNetworkRate(4096)).toMatchObject({ support: "unsupported" }); expect(setRate).toHaveBeenCalledTimes(1);
    } finally { await runtime.dispose(); }
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
