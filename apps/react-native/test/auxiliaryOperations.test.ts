import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OfflineContentManagerListener } from "bitmovin-player-react-native";

const native = vi.hoisted(() => ({
  nextInitialize: undefined as Promise<void> | undefined,
  managers: [] as Array<{ config: object; initialize: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn>; listener: OfflineContentManagerListener }>,
}));
vi.mock("bitmovin-player-react-native", () => ({
  Player: class { unload = vi.fn(); loadSource = vi.fn(); loadOfflineContent = vi.fn(); },
  Source: class {},
  OfflineState: { Downloaded: "Downloaded" }, OfflineEventType: { onCompleted: "onCompleted" },
  BitmovinCastManager: { isInitialized: vi.fn(async () => false), initialize: vi.fn(async () => {}), updateContext: vi.fn(async () => {}), sendMessage: vi.fn(async () => {}) },
  OfflineContentManager: class {
    listener: OfflineContentManagerListener = {};
    constructor(public config: object) { native.managers.push(this); }
    initialize = vi.fn(() => native.nextInitialize ?? Promise.resolve());
    destroy = vi.fn(async () => {});
    download = vi.fn(async () => {});
    addListener = (listener: OfflineContentManagerListener) => { this.listener = listener; return vi.fn(); };
  },
}));

import { Player, OfflineState, OfflineEventType } from "bitmovin-player-react-native";
import { AuxiliaryOperations } from "../src/auxiliaryOperations";
import type { NativeSettings } from "../src/nativeSettings";

const settings = (): NativeSettings => ({ source: { url: "https://example.com/live.m3u8" }, player: {}, view: {}, webUi: {}, props: {},
  offline: { identifier: "sample-content", sourceConfig: { url: "https://example.com/offline.m3u8" } },
  download: { minimumBitrate: 500000, audioOptionIds: ["audio-en"] }, offlineOptions: { restrictedToAssetCache: true }, cast: {},
});
beforeEach(() => { native.managers.length = 0; native.nextInitialize = undefined; });

describe("Owned offline API experiments", () => {
  it("uses the edited configuration and download request when explicitly invoked", async () => {
    const engine = new AuxiliaryOperations(new Player(), settings, vi.fn());
    const operations = engine.operations();
    await operations.find((operation) => operation.id === "OfflineContentManager.initialize")!.run({});
    expect(native.managers[0]!.config).toEqual(settings().offline);
    await operations.find((operation) => operation.id === "OfflineContentManager.download")!.run({});
    expect(native.managers[0]!.download).toHaveBeenLastCalledWith(settings().download);
    engine.dispose();
    await Promise.resolve(); await Promise.resolve();
    expect(native.managers[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("awaits a late initialization before disposing and never logs a retired listener", async () => {
    let finish!: () => void;
    native.nextInitialize = new Promise<void>((resolve) => { finish = resolve; });
    const record = vi.fn();
    const engine = new AuxiliaryOperations(new Player(), settings, record);
    const initializing = engine.operations().find((operation) => operation.id === "OfflineContentManager.initialize")!.run({});
    await Promise.resolve(); await Promise.resolve();
    const manager = native.managers[0]!;
    engine.dispose();
    expect(manager.destroy).not.toHaveBeenCalled();
    manager.listener.onCompleted?.({ nativeId: "old", identifier: "sample-content", eventType: OfflineEventType.onCompleted, state: OfflineState.Downloaded });
    expect(record).not.toHaveBeenCalled();
    finish(); await initializing; await Promise.resolve(); await Promise.resolve();
    expect(manager.destroy).toHaveBeenCalledOnce();
  });

  it("shares a retirement barrier across competing reinitializations", async () => {
    let finish!: () => void;
    native.nextInitialize = new Promise<void>((resolve) => { finish = resolve; });
    const engine = new AuxiliaryOperations(new Player(), settings, vi.fn());
    const initialize = engine.operations().find((operation) => operation.id === "OfflineContentManager.initialize")!;
    const first = initialize.run({});
    await Promise.resolve(); await Promise.resolve();
    const second = initialize.run({});
    const third = initialize.run({});
    await Promise.resolve();
    expect(native.managers).toHaveLength(1);
    native.nextInitialize = undefined;
    finish(); await Promise.all([first, second, third]);
    expect(native.managers).toHaveLength(2);
    expect(native.managers[0]!.destroy).toHaveBeenCalledOnce();
    engine.dispose();
  });
});
