/**
 * WebView bundle entry. When `dist/bitmovinplayer-ui.js` is loaded by a host page —
 * the native SDK's Web UI harness on Android (`UiConfig.WebUi`), iOS
 * (`StyleConfig.playerUiJs/Css`), or React Native (`styleConfig.playerUiJs/Css`) — it
 * registers our custom UI factories under the global the host references by name, e.g.
 * `Variant.Custom("bitmovin.playerui.UIFactory.buildSportsUI")`.
 *
 * Only SELF-CONTAINED factories are registered here: each needs just `(player, config)`
 * and bakes its own sample data / defaults, so it runs inside a native WebView with no
 * JS↔native callbacks. BingeUIFactory is intentionally NOT registered — its
 * "next episode" action asks the host app to load the next source, which requires a
 * CustomMessageHandler bridge (a later phase), not a pure UI factory.
 */
import { UIFactory, type UIConfig, type UIManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { applyNativeLiveRewindPolicy } from "./nativeLiveRewind";
import {
  CinemaUIFactory,
  CompactUIFactory,
  CreatorUIFactory,
  LiveUIFactory,
  PremiereUIFactory,
  SportsUIFactory,
  StudioUIFactory,
} from "./liveUi";

interface PlayerUiGlobal {
  bitmovin?: { playerui?: Record<string, unknown> };
}

// The self-contained custom factories, keyed by the name a native
// Variant.Custom("bitmovin.playerui.UIFactory.<name>") resolves against.
const CUSTOM_FACTORIES = {
  buildLiveUI: LiveUIFactory.buildLiveUI,
  buildSportsUI: SportsUIFactory.buildSportsUI,
  buildCinemaUI: CinemaUIFactory.buildCinemaUI,
  buildCompactUI: CompactUIFactory.buildCompactUI,
  buildPremiereUI: PremiereUIFactory.buildPremiereUI,
  buildCreatorUI: CreatorUIFactory.buildCreatorUI,
  buildStudioUI: StudioUIFactory.buildStudioUI,
};

/**
 * The custom factory names this bundle exposes — the single source of truth for both the
 * registration below and the wiring test, so adding a factory can't silently skip coverage.
 */
export const CUSTOM_FACTORY_NAMES = Object.keys(CUSTOM_FACTORIES);

const scope = window as unknown as PlayerUiGlobal;
const bitmovin = (scope.bitmovin ??= {});
const playerui = (bitmovin.playerui ??= {});

// Keep stock layouts and forward every factory argument, including custom theme options.
playerui.UIFactory = Object.fromEntries(Object.entries({ ...UIFactory, ...CUSTOM_FACTORIES }).map(([name, factory]) => [
  name,
  typeof factory === "function" && name.startsWith("build") ? function (this: unknown, ...args: unknown[]) {
    const manager = Reflect.apply(factory, this, args) as UIManager;
    return applyNativeLiveRewindPolicy(args[0] as PlayerAPI, manager, args[1] as UIConfig | undefined);
  } : factory,
]));
