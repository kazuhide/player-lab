/**
 * @showcase/ui-shared — the one shared UI: a customized bitmovin-player-ui with a
 * DVR seek bar, a LIVE / go-to-edge button, and the §7 live time labels
 * (absolute wall-clock + relative "behind live").
 *
 * Web app (M3): `new Player({ ui: false, ... })` then `LiveUIFactory.buildLiveUI(player)`,
 * and include the CSS from `@showcase/ui-shared/css`.
 * WebView apps (M4–M6) load the built `bitmovinplayer-ui.js` / `.css` bundle.
 */
export { LiveButton, type LiveButtonConfig } from "./components/LiveButton";
export { BehindLiveLabel, type BehindLiveLabelConfig } from "./components/BehindLiveLabel";
export { WallClockLabel } from "./components/WallClockLabel";
export { ScoreboardStrip } from "./components/ScoreboardStrip";
export { PlayerInfoCard } from "./components/PlayerInfoCard";
export { SportsInfoToggleButton } from "./components/SportsInfoToggleButton";
export { SkipIntroButton, type SkipIntroButtonConfig } from "./components/SkipIntroButton";
export { NextEpisodeButton, type NextEpisodeButtonConfig } from "./components/NextEpisodeButton";
export { NextUpCard, type NextUpCardConfig } from "./components/NextUpCard";
export {
  buildDefaultUiContainer,
  DefaultUIFactory,
  buildLiveUiContainer,
  LiveUIFactory,
  buildCinemaUiContainer,
  CinemaUIFactory,
  buildCompactUiContainer,
  CompactUIFactory,
  buildPremiereUiContainer,
  PremiereUIFactory,
  buildCreatorUiContainer,
  CreatorUIFactory,
  buildStudioUiContainer,
  StudioUIFactory,
  buildSportsUiContainer,
  SportsUIFactory,
  buildBingeUiContainer,
  BingeUIFactory,
  type LiveUiOptions,
  type CastingButtons,
  type ContinuousPlayOptions,
} from "./liveUi";
export { type GameScore, type AtBat, type LineupEntry } from "./sportsData";
// Re-export the stock factory, manager and timing helpers so apps depend only on @showcase/ui-shared
// (the UI layer) rather than bitmovin-player-ui directly. `UIFactory.buildUI` is the
// default/stock theme used alongside the custom builds above.
export { UIFactory, UIManager, PlayerUtils } from "bitmovin-player-ui";
// Re-export the UIConfig type so apps can type their UI-settings overrides without
// taking a direct dependency on bitmovin-player-ui.
export type { UIConfig } from "bitmovin-player-ui";
export {
  DEFAULT_LIVE_EDGE_EPSILON,
  isAtLiveEdge,
  behindLiveSeconds,
  deriveLiveButtonState,
  type LiveButtonState,
} from "./liveState";
export {
  formatDuration,
  formatBehindLive,
  formatWallClock,
  type BehindLiveOptions,
  type WallClockOptions,
} from "./format";
