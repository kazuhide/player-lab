import {
  AirPlayToggleButton,
  AudioTrackSelectBox,
  BufferingOverlay,
  CastToggleButton,
  Container,
  ControlBar,
  FullscreenToggleButton,
  PictureInPictureToggleButton,
  PlaybackSpeedSelectBox,
  PlaybackTimeLabel,
  PlaybackTimeLabelMode,
  PlaybackToggleButton,
  PlaybackToggleOverlay,
  QuickSeekButton,
  RecommendationOverlay,
  SeekBar,
  SeekBarLabel,
  SettingsPanel,
  SettingsPanelItem,
  SettingsPanelPage,
  SettingsToggleButton,
  Spacer,
  SubtitleOverlay,
  TitleBar,
  UIContainer,
  UIComponentLayoutOverride,
  UIFactory,
  UIManager,
  UIVariantIdentifier,
  VideoQualitySelectBox,
  VolumeSlider,
  VolumeToggleButton,
} from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import type { Component, ComponentConfig, UIConfig } from "bitmovin-player-ui";
import { BehindLiveLabel } from "./components/BehindLiveLabel";
import { LiveButton } from "./components/LiveButton";
import { WallClockLabel } from "./components/WallClockLabel";
import { ScoreboardStrip } from "./components/ScoreboardStrip";
import { PlayerInfoCard } from "./components/PlayerInfoCard";
import { SportsInfoToggleButton } from "./components/SportsInfoToggleButton";
import { SkipIntroButton } from "./components/SkipIntroButton";
import { NextEpisodeButton } from "./components/NextEpisodeButton";
import { NextUpCard } from "./components/NextUpCard";

/** Which casting / remote-playback buttons to add to a custom UI tree. Each is opt-in:
 *  the custom factories ship without them, so this controls dynamic add/remove. (The stock
 *  Default UI already includes all three — see DefaultUIFactory.) The buttons still hide
 *  themselves when the platform can't offer the feature: AirPlay is Safari-only, PiP needs
 *  browser support (works in Chrome), and Cast needs `remotecontrol` configured on the
 *  player plus a reachable receiver. */
export interface CastingButtons {
  /** Apple AirPlay (Safari). */
  airplay?: boolean;
  /** Picture-in-Picture (works in Chromium/Chrome). */
  pip?: boolean;
  /** Google Cast / Chromecast (needs PlayerConfig.remotecontrol + a device). */
  cast?: boolean;
}

export interface LiveUiOptions {
  /** Seconds within the edge still treated as "at live" for the LIVE button. */
  liveEdgeEpsilon?: number;
  /**
   * Extra cssClasses appended to the root container. The point of the demo: the
   * SAME component tree can be re-skinned entirely from CSS by adding a class
   * (e.g. `["ui-skin-neon"]`) and styling it — no component changes.
   */
  extraCssClasses?: string[];
  /** Control-bar auto-hide delay (ms). `-1` keeps the UI always shown (autohide off);
   *  `undefined` uses the factory's default. (Explicit `undefined` allowed so callers
   *  can pass a "default-or-off" value without spreading.) */
  hideDelay?: number | undefined;
  /** Casting / remote-playback buttons to add to this custom tree (default: none).
   *  Accepts `undefined` so callers can forward an optional value without spreading. */
  casting?: CastingButtons | undefined;
  /** Continuous-play wiring for the Binge theme (Skip Intro / Next episode / Next-up card).
   *  The playlist + `player.load` are app-owned, so the title + advance action are injected. */
  continuousPlay?: ContinuousPlayOptions | undefined;
}

/** Options for the Binge theme's episodic-VOD components. */
export interface ContinuousPlayOptions {
  /** Intro range (seconds) for the Skip Intro button — sample timing in this demo. */
  introStart?: number;
  introEnd?: number;
  /** Title of the next episode, read each time the Next-up card appears. */
  getNextTitle?: () => string | undefined;
  /** Auto-advance + countdown on the Next-up card (the "continuous play" option). */
  autoplayNext?: boolean;
  /** Load the next episode (app-owned: the playlist + player.load). */
  onPlayNext?: () => void;
}

/** The casting buttons to splice into a control row, in display order (PiP · AirPlay · Cast).
 *  Returns `[]` when none are enabled, so it spreads cleanly into a components array. */
function castingComponents(casting?: CastingButtons): Component<ComponentConfig>[] {
  if (!casting) return [];
  const out: Component<ComponentConfig>[] = [];
  if (casting.pip) out.push(new PictureInPictureToggleButton());
  if (casting.airplay) out.push(new AirPlayToggleButton());
  if (casting.cast) out.push(new CastToggleButton());
  return out;
}

// UI v4.23 applies layout settings (including the legacy speed-setting flag) to
// identified variants. Custom layouts intentionally include their quick-seek
// buttons; the stock layout keeps the SDK's default component exclusions.
function createUiManager(player: PlayerAPI, ui: UIContainer, config?: UIConfig, custom = false): UIManager {
  const appliedConfig = custom ? {
    ...config,
    componentLayoutOverrides: {
      QuickSeekButton: UIComponentLayoutOverride.Include,
      ...config?.componentLayoutOverrides,
    },
  } : config;
  return new UIManager(player, [{ ui, identifier: UIVariantIdentifier.main }], appliedConfig);
}

/**
 * The stock Bitmovin "modern" UI with UIConfig-aware settings and a configurable hide delay.
 *
 * `UIFactory.buildUI` gives no `hideDelay` hook, so to make the autohide toggle work on
 * the Default theme without forking the UI, we take the library's own desktop layout
 * (`UIFactory.defaultLayouts.main()`) and re-wrap its EXACT component tree in a
 * `UIContainer` whose `hideDelay` we control. Same components, same player-state hide
 * exceptions and classes. UIConfig also reaches the stock settings-panel builder.
 * Scope: only the `main`/desktop variant is reproduced — `buildUI` also composes
 * empty-state, small-screen (<800px), TV and ad variants, which this drops. The demo
 * player is always desktop-width and the custom themes are single-container too, so it's
 * consistent within the app; just don't expect the empty-state placeholder or the
 * small-screen switch here. The "autohide on" delay is read from the stock container's
 * own config so it tracks the library default rather than a hardcoded literal.
 */
export function buildDefaultUiContainer(options: LiveUiOptions = {}, config?: UIConfig): UIContainer {
  const stock = UIFactory.defaultLayouts.main(config);
  const cfg = stock.getConfig();
  // Adopt the children, but release the unused root's localization subscription.
  stock.release();
  return new UIContainer({
    components: cfg.components ?? [],
    cssClasses: [...(cfg.cssClasses ?? []), ...(options.extraCssClasses ?? [])],
    // Preserve the stock player-state hide exceptions (don't hide while paused, etc.).
    ...(cfg.hidePlayerStateExceptions ? { hidePlayerStateExceptions: cfg.hidePlayerStateExceptions } : {}),
    // -1 when autohide is off; otherwise the stock container's own (merged) delay.
    hideDelay: options.hideDelay ?? cfg.hideDelay ?? 2000,
  });
}

/** Factory for the stock modern UI with a controllable autohide. Use with `ui: false`. */
export const DefaultUIFactory = {
  buildDefaultUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildDefaultUiContainer(options, config), config);
  },
};

/**
 * The DVR-focused `UIContainer`. It mirrors the library's default modern control
 * bar and injects a LIVE / go-to-edge button next to the play control. The
 * `SeekBar` already branches on `isLive()` and sizes the DVR window via
 * `getMaxTimeShift()`, so it doubles as the DVR scrubber — no rewrite needed.
 */
export function buildLiveUiContainer(options: LiveUiOptions = {}): UIContainer {
  const liveButton =
    options.liveEdgeEpsilon !== undefined
      ? new LiveButton({ liveEdgeEpsilon: options.liveEdgeEpsilon })
      : new LiveButton();
  const behindLiveLabel =
    options.liveEdgeEpsilon !== undefined
      ? new BehindLiveLabel({ liveEdgeEpsilon: options.liveEdgeEpsilon })
      : new BehindLiveLabel();

  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      new ControlBar({
        components: [
          new Container({
            components: [
              // VOD current time on the left; the live wall-clock takes over for live.
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentTime, hideInLivePlayback: true }),
              new WallClockLabel(),
              new SeekBar({ label: new SeekBarLabel() }),
              // VOD total on the right; the behind-live offset takes over for live.
              behindLiveLabel,
              new PlaybackTimeLabel({
                timeLabelMode: PlaybackTimeLabelMode.TotalTime,
                hideInLivePlayback: true,
                cssClasses: ["text-right"],
              }),
            ],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              // ±10s skip flanking play — the library's built-in QuickSeekButton
              // already handles VOD (seek) and live (timeShift) with its own icons.
              new QuickSeekButton({ seekSeconds: -10 }),
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: 10 }),
              liveButton,
              new VolumeToggleButton(),
              new VolumeSlider(),
              new Spacer(),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
      new RecommendationOverlay(), // The SDK provides Replay after native completion.
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-live", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory entry point. Use with `ui: false` in the player config. */
export const LiveUIFactory = {
  /** Build a {@link UIManager} wired with the DVR UI for `player`. */
  buildLiveUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildLiveUiContainer(options), config, true);
  },
};

/**
 * An "immersive / cinema" custom UI — a different COMPOSITION (not just a re-skin):
 * a full-width seek bar on its own row above a slim control strip, a big center
 * play overlay, and an aggressive auto-hide so the chrome gets out of the way.
 * Demonstrates the layout/config lever distinct from the re-skin themes.
 */
export function buildCinemaUiContainer(options: LiveUiOptions = {}): UIContainer {
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      new ControlBar({
        components: [
          new Container({
            components: [new SeekBar({ label: new SeekBarLabel() })],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              new PlaybackToggleButton(),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentTime }),
              new Spacer(),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-cinema", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 1000,
  });
}

/** Factory for the immersive "cinema" custom UI. Use with `ui: false`. */
export const CinemaUIFactory = {
  buildCinemaUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildCinemaUiContainer(options), config, true);
  },
};

/**
 * A "compact" custom UI — a single slim control row (play · scrubber · time) and no
 * center overlay, for tight or embedded placements. Play/pause comes from the
 * player-surface gesture. Another COMPOSITION, even leaner than the others.
 */
export function buildCompactUiContainer(options: LiveUiOptions = {}): UIContainer {
  return new UIContainer({
    components: [
      new BufferingOverlay(),
      new ControlBar({
        components: [
          new Container({
            components: [
              new PlaybackToggleButton(),
              new SeekBar({ label: new SeekBarLabel() }),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentTime }),
              ...castingComponents(options.casting),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-compact", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the compact custom UI. Use with `ui: false`. */
export const CompactUIFactory = {
  buildCompactUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildCompactUiContainer(options), config, true);
  },
};

// ===========================================================================
// Streaming-service-style compositions (homages, not affiliated): each is a
// genuinely different COMPONENT TREE — not a re-skin — that evokes a familiar
// player, paired with a brand-flavored CSS skin (see ui-shared.scss). They show
// that the SAME components, rearranged, reproduce very different "house styles".
// Tuned for VOD (these services are VOD-first); the SeekBar still branches on
// isLive() so they degrade gracefully on a live source.
// ===========================================================================

/** A "more options" settings panel (quality · speed · audio) for the gear button.
 *  A fresh instance is built per UI tree — components can't be shared across managers. */
function buildSettingsPanel() {
  return new SettingsPanel({
    components: [
      new SettingsPanelPage({
        components: [
          new SettingsPanelItem({ label: "画質", settingComponent: new VideoQualitySelectBox() }),
          new SettingsPanelItem({ label: "再生速度", settingComponent: new PlaybackSpeedSelectBox() }),
          new SettingsPanelItem({ label: "音声", settingComponent: new AudioTrackSelectBox() }),
        ],
      }),
    ],
    hidden: true,
  });
}

/**
 * Premiere-style: a title bar up top, a big center play, and a full-width scrubber
 * on its own row above a slim control strip (play · ±10s · … · time-remaining ·
 * settings · fullscreen). Cinematic and minimal; the brand red lives in the CSS skin.
 */
export function buildPremiereUiContainer(options: LiveUiOptions = {}): UIContainer {
  const settingsPanel = buildSettingsPanel();
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      new TitleBar(), // default TitleBar already renders MetadataLabel Title + Description
      new ControlBar({
        components: [
          new Container({
            components: [new SeekBar({ label: new SeekBarLabel() })],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: -10 }),
              new QuickSeekButton({ seekSeconds: 10 }),
              new Spacer(),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.RemainingTime, hideInLivePlayback: true }),
              new SettingsToggleButton({ settingsPanel }),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
      settingsPanel,
      // An end-of-playback "up next" overlay. It reads
      // UIConfig.metadata.recommendations and shows when playback finishes. Placed LAST so it
      // paints above the chrome (the library sets no z-index — paint order = DOM order).
      new RecommendationOverlay(),
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-premiere", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the Premiere-style custom UI. Use with `ui: false`. */
export const PremiereUIFactory = {
  buildPremiereUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    // Enable the playback-speed item in the settings panel (UIConfig defaults it off).
    return createUiManager(player, buildPremiereUiContainer(options), { playbackSpeedSelectionEnabled: true, ...config }, true);
  },
};

/**
 * Creator-style: a full-width scrubber across the very bottom, with a single control
 * row beneath it — left cluster (play · volume slider · current/total time), a
 * spacer, then a right cluster (settings gear · fullscreen). The brand red is in CSS.
 */
export function buildCreatorUiContainer(options: LiveUiOptions = {}): UIContainer {
  const settingsPanel = buildSettingsPanel();
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      new TitleBar(), // give Creator a title bar too (Title + Description metadata)
      new ControlBar({
        components: [
          new Container({
            components: [new SeekBar({ label: new SeekBarLabel() })],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: 10 }),
              new VolumeToggleButton(),
              new VolumeSlider(),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentAndTotalTime, hideInLivePlayback: true }),
              new Spacer(),
              new SettingsToggleButton({ settingsPanel }),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
      settingsPanel,
      new RecommendationOverlay(), // official tv element: end-of-playback "up next" (last = paints on top)
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-creator", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the Creator-style custom UI. Use with `ui: false`. */
export const CreatorUIFactory = {
  buildCreatorUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildCreatorUiContainer(options), { playbackSpeedSelectionEnabled: true, ...config }, true);
  },
};

/**
 * Studio-style: a title bar up top, a big center play, and a single inline control
 * row where the scrubber sits BETWEEN the time labels (play · ±10s · current ·
 * ───seekbar─── · total · settings · fullscreen). The deep brand blue is in CSS.
 */
export function buildStudioUiContainer(options: LiveUiOptions = {}): UIContainer {
  const settingsPanel = buildSettingsPanel();
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      new TitleBar(),
      new ControlBar({
        components: [
          new Container({
            components: [
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: -10 }),
              new QuickSeekButton({ seekSeconds: 10 }),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentTime, hideInLivePlayback: true }),
              new SeekBar({ label: new SeekBarLabel() }),
              new PlaybackTimeLabel({
                timeLabelMode: PlaybackTimeLabelMode.TotalTime,
                hideInLivePlayback: true,
                cssClasses: ["text-right"],
              }),
              new SettingsToggleButton({ settingsPanel }),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
      settingsPanel,
      new RecommendationOverlay(), // official tv element: end-of-playback "up next" (last = paints on top)
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-studio", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the Studio-style custom UI. Use with `ui: false`. */
export const StudioUIFactory = {
  buildStudioUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildStudioUiContainer(options), { playbackSpeedSelectionEnabled: true, ...config }, true);
  },
};

/**
 * A sports-broadcast UI for live games. It's the live/DVR control set plus two CUSTOM overlay
 * components that show information a sports viewer wants without leaving the stream:
 *  - {@link ScoreboardStrip} — other games "around the league", across the top.
 *  - {@link PlayerInfoCard}  — the current at-bat (batter/pitcher + stats, the B-S-O count) and a
 *    mini lineup, in a corner.
 * A {@link SportsInfoToggleButton} in the control bar shows/hides both overlays. The overlays use
 * fictional sample data (see sportsData.ts) — the demonstration is the custom-Component lever and
 * the overlay composition, not a live data feed.
 */
export function buildSportsUiContainer(options: LiveUiOptions = {}): UIContainer {
  const scoreboard = new ScoreboardStrip();
  const playerCard = new PlayerInfoCard();
  const infoToggle = new SportsInfoToggleButton([scoreboard, playerCard]);
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      // Info overlays — siblings of the ControlBar, positioned by CSS so they persist over the
      // video independent of the controls.
      scoreboard,
      playerCard,
      new ControlBar({
        components: [
          new Container({
            components: [
              new WallClockLabel(),
              new SeekBar({ label: new SeekBarLabel() }),
              new BehindLiveLabel(),
            ],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              new QuickSeekButton({ seekSeconds: -10 }),
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: 10 }),
              new LiveButton(),
              new VolumeToggleButton(),
              new VolumeSlider(),
              new Spacer(),
              infoToggle,
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
      new RecommendationOverlay(), // The SDK provides Replay after native completion.
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-sports", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the sports-broadcast custom UI. Use with `ui: false`. */
export const SportsUIFactory = {
  buildSportsUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildSportsUiContainer(options), config, true);
  },
};

/**
 * A "binge / continuous play" UI for episodic VOD. A clean VOD control set plus three custom
 * components that string episodes together the way a streaming service does:
 *  - {@link SkipIntroButton} — a control-bar button that appears only during the (sample) intro
 *    range and seeks past it.
 *  - {@link NextEpisodeButton} — a control-bar button that appears near the end of a clip to jump
 *    to the next episode.
 *  - {@link NextUpCard} — an end-of-clip overlay showing the next title; it auto-advances with a
 *    countdown when "continuous play" is on (manual advance is the Next-episode button).
 * The interactive controls live in the control bar (a direct UIContainer-child overlay does NOT
 * receive clicks — the container consumes them) so they're genuinely clickable; the Next-up card
 * is an informational overlay. The playlist (next title, advance action) is app-owned and passed
 * via {@link LiveUiOptions.continuousPlay}; these components are pure UI glue.
 */
export function buildBingeUiContainer(options: LiveUiOptions = {}): UIContainer {
  const cp = options.continuousPlay ?? {};
  const skipIntro = new SkipIntroButton({ introStart: cp.introStart, introEnd: cp.introEnd });
  const nextUp = new NextUpCard({
    getNextTitle: cp.getNextTitle,
    autoplay: cp.autoplayNext,
    onPlayNext: cp.onPlayNext,
  });
  return new UIContainer({
    components: [
      new SubtitleOverlay(),
      new BufferingOverlay(),
      new PlaybackToggleOverlay(),
      nextUp, // informational overlay near the end (auto-advance; no click needed)
      new ControlBar({
        components: [
          new Container({
            components: [new SeekBar({ label: new SeekBarLabel() })],
            cssClasses: ["controlbar-top"],
          }),
          new Container({
            components: [
              new PlaybackToggleButton(),
              new QuickSeekButton({ seekSeconds: -10 }),
              new QuickSeekButton({ seekSeconds: 10 }),
              new PlaybackTimeLabel({ timeLabelMode: PlaybackTimeLabelMode.CurrentTime, hideInLivePlayback: true }),
              skipIntro, // control-bar button (clickable); self-hides outside the intro range
              new Spacer(),
              new NextEpisodeButton({ onPlayNext: cp.onPlayNext }),
              ...castingComponents(options.casting),
              new FullscreenToggleButton(),
            ],
            cssClasses: ["controlbar-bottom"],
          }),
        ],
      }),
    ],
    cssClasses: ["ui-skin-modern", "ui-skin-binge", ...(options.extraCssClasses ?? [])],
    hideDelay: options.hideDelay ?? 2000,
  });
}

/** Factory for the binge / continuous-play custom UI. Use with `ui: false`. */
export const BingeUIFactory = {
  buildBingeUI(player: PlayerAPI, config?: UIConfig, options?: LiveUiOptions): UIManager {
    return createUiManager(player, buildBingeUiContainer(options), config, true);
  },
};

