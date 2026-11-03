import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ core: vi.fn(), add: vi.fn(), dispose: vi.fn(), player: {} as unknown,
  packages: Array.from({ length: 18 }, () => ({ onAdd: () => {}, dependencies: [] as string[] })),
  excludedAdaptation: { onAdd: () => {}, dependencies: [] as string[] },
  excludedPlatform: { onAdd: () => {}, dependencies: [] as string[] },
  excludedViewMode: { onAdd: () => {}, dependencies: ["core-effects", "source-state-atom", "source-api-manager"] } }));
vi.mock("@bitmovin/player-web-x/bundles/playerx-core", () => ({ Player: sdk.core }));
vi.mock("@bitmovin/player-web-x/packages/playerx-adaptation.package", () => ({ AdaptationPackage: sdk.excludedAdaptation }));
vi.mock("@bitmovin/player-web-x/packages/playerx-no-adaptation.package", () => ({ NoAdaptationPackage: sdk.packages[0] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-capabilities.package", () => ({ CapabilitiesPackage: sdk.packages[1] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-container-mp4.package", () => ({ ContainerMp4Package: sdk.packages[2] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-data.package", () => ({ DataPackage: sdk.packages[3] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-hls-manifest.package", () => ({ HlsManifestPackage: sdk.packages[4] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-media-state.package", () => ({ MediaStatePackage: sdk.packages[5] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-mse-playback.package", () => ({ MsePlaybackPackage: sdk.packages[6] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-native-playback.package", () => ({ NativePlaybackPackage: sdk.packages[7] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-network.package", () => ({ NetworkPackage: sdk.packages[8] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-platform-detection.package", () => ({ PlatformDetectionPackage: sdk.excludedPlatform }));
vi.mock("@bitmovin/player-web-x/packages/playerx-playback-api.package", () => ({ PlaybackApiPackage: sdk.packages[9] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-playback.package", () => ({ PlaybackPackage: sdk.packages[10] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-playback-technology.package", () => ({ PlaybackTechnologyPackage: sdk.packages[11] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-segment-processing.package", () => ({ SegmentProcessingPackage: sdk.packages[12] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-source.package", () => ({ SourcePackage: sdk.packages[13] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-sources-api.package", () => ({ SourcesApiPackage: sdk.packages[14] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-stream-data-structure.package", () => ({ StreamDataStructurePackage: sdk.packages[15] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-streaming.package", () => ({ StreamingPackage: sdk.packages[16] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-video-element-controller.package", () => ({ VideoElementControllerPackage: sdk.packages[17] }));
vi.mock("@bitmovin/player-web-x/packages/playerx-view-mode.package", () => ({ default: sdk.excludedViewMode }));
import { createAdapter, createPlayer } from "../src/startup/adapters/webx-clear-fmp4";
import { makeWebXAdapter, type NativePlayerApi } from "../src/startup/adapters/webx-shared";
import type { AdapterContext } from "../src/startup/contract";
import type { PlayerConfig } from "@bitmovin/player-web-x/types/bundles/Types";

const configuration: PlayerConfig = { key: "fixture-key", defaultContainer: {} as HTMLElement,
  defaultVideoElement: {} as HTMLVideoElement, playback: { muted: true, autoplay: true, preventSeeking: false }, defaultLogLevel: 0 };
function adapterFixture() {
  const source = { id: "fixture", currentTime: 0, playbackRate: 1, loadControl: 0,
    events: { Type: { Ready: "ready", Playing: "playing" }, on: vi.fn(), off: vi.fn() },
    play: vi.fn(async () => {}), pause: vi.fn() };
  const player = { packages: { add: sdk.add }, dispose: sdk.dispose,
    events: { Type: { PlayerError: "error", SourceError: "source-error", VideoAttached: "attached" }, on: vi.fn(), off: vi.fn() },
    sources: { add: vi.fn(() => source), attachVideo: vi.fn() } };
  const controller = new AbortController();
  const context = { video: {} as HTMLVideoElement, container: {} as HTMLElement,
    url: "https://media.invalid/fixture.m3u8", licenseKey: "fixture-key", profile: "startup",
    signal: controller.signal, mark: vi.fn(), fatal: vi.fn() } satisfies AdapterContext;
  return { player, source, context, controller };
}
beforeEach(() => {
  sdk.add.mockReset(); sdk.dispose.mockReset().mockResolvedValue(undefined); sdk.core.mockReset();
  sdk.player = { packages: { add: sdk.add }, dispose: sdk.dispose }; sdk.core.mockReturnValue(sdk.player);
});

describe("clear fMP4 public package factory (SDK doubles)", () => {
  it("forwards the existing config and registers every required package in the declared order", async () => {
    expect(await createPlayer(configuration)).toBe(sdk.player);
    expect(sdk.core).toHaveBeenCalledExactlyOnceWith(configuration);
    expect(sdk.add.mock.calls.map(([pkg]) => pkg)).toEqual(sdk.packages);
    expect(sdk.dispose).not.toHaveBeenCalled();
  });
  it("awaits partial registration cleanup before rejecting and stops adding packages", async () => {
    const failure = new Error("fixture registration failure");
    sdk.add.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw failure; });
    let release!: () => void; sdk.dispose.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = createPlayer(configuration); const rejected = expect(pending).rejects.toBe(failure);
    let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(sdk.add).toHaveBeenCalledTimes(2); expect(sdk.dispose).toHaveBeenCalledOnce();
    release(); await rejected;
  });
  it("preserves an awaited cleanup rejection instead of pretending partial setup was released", async () => {
    sdk.add.mockImplementationOnce(() => { throw new Error("fixture registration failure"); });
    const cleanup = new Error("fixture cleanup failure"); sdk.dispose.mockRejectedValue(cleanup);
    await expect(createPlayer(configuration)).rejects.toBe(cleanup); expect(sdk.dispose).toHaveBeenCalledOnce();
  });
  it("exports the applied compact package set without changing source staging or playback config", async () => {
    const f = adapterFixture(); sdk.core.mockReturnValue(f.player);
    const session = await createAdapter(f.context);
    expect(session.metadata.configuration).toMatchObject({ bundle: "playerx-core-clear-fmp4",
      startSequence: "attach-before-load", muted: true, autoplay: true, stagingAttach: false, stagingLoadControl: 0 });
    const packages = session.metadata.configuration.packages;
    expect(Array.isArray(packages) && packages.length).toBe(18);
    expect(packages).toContain("playerx-no-adaptation.package"); expect(packages).not.toContain("playerx-adaptation.package");
    expect(packages).toContain("playerx-playback-api.package"); expect(packages).toContain("playerx-native-playback.package");
    expect(packages).not.toContain("playerx-platform-detection.package"); expect(packages).not.toContain("playerx-view-mode.package");
    expect(f.player.sources.add).toHaveBeenCalledWith({ resources: [{ url: f.context.url, type: "hls" }], contentType: "content" },
      { attach: false, loadControl: 0 });
    expect(sdk.core).toHaveBeenCalledWith(expect.objectContaining({ defaultVideoElement: f.context.video,
      defaultContainer: f.context.container, playback: { muted: true, autoplay: true, preventSeeking: false } }));
    await session.dispose();
  });
  it("marks constructor completion only after an asynchronous factory resolves", async () => {
    const f = adapterFixture(); let release!: (player: NativePlayerApi) => void;
    const pendingPlayer = new Promise<NativePlayerApi>((resolve) => { release = resolve; });
    const pending = makeWebXAdapter(() => pendingPlayer, "hls")(f.context);
    expect(f.context.mark).toHaveBeenCalledExactlyOnceWith("constructorStart");
    expect(f.player.sources.add).not.toHaveBeenCalled();
    release(f.player as unknown as NativePlayerApi);
    const session = await pending;
    expect(f.context.mark.mock.calls).toEqual([["constructorStart"], ["constructorEnd"]]);
    await session.dispose();
  });
  it("disposes a factory result delivered after cancellation without starting a source", async () => {
    const f = adapterFixture(); let release!: (player: NativePlayerApi) => void;
    const pendingPlayer = new Promise<NativePlayerApi>((resolve) => { release = resolve; });
    const pending = makeWebXAdapter(() => pendingPlayer, "hls")(f.context);
    const rejected = expect(pending).rejects.toThrow("aborted");
    f.controller.abort(); release(f.player as unknown as NativePlayerApi); await rejected;
    expect(sdk.dispose).toHaveBeenCalledOnce(); expect(f.player.sources.add).not.toHaveBeenCalled();
    expect(f.context.mark.mock.calls).toEqual([["constructorStart"]]);
  });
});
