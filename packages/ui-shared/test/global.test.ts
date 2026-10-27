import { beforeEach, describe, expect, it, vi } from "vitest";

// `src/global.ts` registers our factories on `window.bitmovin.playerui.UIFactory` for the
// native WebView harness to resolve by name. It touches `window` and imports the (DOM-bound)
// bitmovin-player-ui + our factories at module load, so we stub `window` and mock those
// modules — this unit-tests the WIRING (which names get registered) without a DOM or a build.

vi.mock("bitmovin-player-ui", () => ({
  // Stock methods that must be preserved by the spread.
  UIFactory: { buildSmallScreenUI: vi.fn(() => null), buildTvUI: () => null, defaultLayouts: { main: () => null } },
}));

vi.mock("../src/liveUi", () => ({
  LiveUIFactory: { buildLiveUI: () => "live" },
  SportsUIFactory: { buildSportsUI: () => "sports" },
  CinemaUIFactory: { buildCinemaUI: () => "cinema" },
  CompactUIFactory: { buildCompactUI: () => "compact" },
  PremiereUIFactory: { buildPremiereUI: () => "premiere" },
  CreatorUIFactory: { buildCreatorUI: () => "creator" },
  StudioUIFactory: { buildStudioUI: () => "studio" },
}));

type Registry = Record<string, unknown>;
const registeredFactory = (): Registry =>
  (globalThis as unknown as { window: { bitmovin: { playerui: { UIFactory: Registry } } } })
    .window.bitmovin.playerui.UIFactory;

describe("WebView global bundle (src/global.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as { window?: unknown }).window = {};
  });

  it("registers every self-contained custom factory it declares", async () => {
    const { CUSTOM_FACTORY_NAMES } = await import("../src/global");
    const factory = registeredFactory();
    for (const name of CUSTOM_FACTORY_NAMES) {
      expect(typeof factory[name], `${name} must be registered for Variant.Custom`).toBe("function");
    }
    // The headline factory the native phases reference must be in the declared set.
    expect(CUSTOM_FACTORY_NAMES).toContain("buildSportsUI");
  });

  it("preserves the library's stock factory methods (spread of UIFactory)", async () => {
    await import("../src/global");
    const factory = registeredFactory();
    expect(typeof factory.buildSmallScreenUI).toBe("function");
    expect(typeof factory.buildTvUI).toBe("function");
  });

  it("forwards the original receiver, arguments and result and preserves non-factory properties", async () => {
    await import("../src/global");
    const { UIFactory } = await import("bitmovin-player-ui");
    const receiver = { marker: "native-host" };
    const player = {};
    const config = { metadata: { title: "Example" } };
    const options = { hideDelay: 7000 };
    const factory = registeredFactory().buildSmallScreenUI as (...args: unknown[]) => unknown;
    expect(factory.call(receiver, player, config, options)).toBeNull();
    expect(UIFactory.buildSmallScreenUI).toHaveBeenLastCalledWith(player, config, options);
    const contexts = vi.mocked(UIFactory.buildSmallScreenUI).mock.contexts;
    expect(contexts[contexts.length - 1]).toBe(receiver);
    expect(registeredFactory().defaultLayouts).toBe(UIFactory.defaultLayouts);
  });

  it("does NOT register Binge (it needs a JS↔native bridge, not a pure factory)", async () => {
    const { CUSTOM_FACTORY_NAMES } = await import("../src/global");
    expect(CUSTOM_FACTORY_NAMES).not.toContain("buildBingeUI");
    expect(registeredFactory().buildBingeUI).toBeUndefined();
  });
});
