/**
 * Modular player construction for Vega — extracted from the React component so the
 * Bitmovin player-API surface (module registration, `new Player`, `PlayerAPI`)
 * type-checks against `bitmovin-player@8.138.0-beta.28` without dragging in the
 * React Native / Kepler JSX types. This is the part most worth verifying.
 *
 * Player modules must be imported `require`-style (Metro bundler limitation), as in
 * the Bitmovin Vega sample. DRM and crypto modules enable the corresponding
 * source settings; content and native device support still determine playback.
 */
import type { PlayerAPI, PlayerConfig } from "bitmovin-player";
import { Player } from "bitmovin-player/modules/bitmovinplayer-core";
import { vegaPlayerConfig } from "./playerConfig";

import PolyfillModule = require("bitmovin-player/modules/bitmovinplayer-polyfill");
import AnalyticsModule = require("bitmovin-player/modules/bitmovinplayer-analytics");
import ReactNativeModule = require("bitmovin-player/modules/bitmovinplayer-reactnative");
import EngineBitmovinModule = require("bitmovin-player/modules/bitmovinplayer-engine-bitmovin");
import EngineNativeModule = require("bitmovin-player/modules/bitmovinplayer-engine-native");
import MseRendererModule = require("bitmovin-player/modules/bitmovinplayer-mserenderer");
import XmlModule = require("bitmovin-player/modules/bitmovinplayer-xml");
import DashModule = require("bitmovin-player/modules/bitmovinplayer-dash");
import HlsModule = require("bitmovin-player/modules/bitmovinplayer-hls");
import AbrModule = require("bitmovin-player/modules/bitmovinplayer-abr");
import LowLatencyModule = require("bitmovin-player/modules/bitmovinplayer-lowlatency");
import SmoothModule = require("bitmovin-player/modules/bitmovinplayer-smooth");
import DrmModule = require("bitmovin-player/modules/bitmovinplayer-drm");
import CryptoModule = require("bitmovin-player/modules/bitmovinplayer-crypto");
import ContainerTsModule = require("bitmovin-player/modules/bitmovinplayer-container-ts");
import ContainerMp4Module = require("bitmovin-player/modules/bitmovinplayer-container-mp4");
import ContainerWebmModule = require("bitmovin-player/modules/bitmovinplayer-container-webm");
import ThumbnailModule = require("bitmovin-player/modules/bitmovinplayer-thumbnail");
import SubtitlesModule = require("bitmovin-player/modules/bitmovinplayer-subtitles");
import SubtitlesVttModule = require("bitmovin-player/modules/bitmovinplayer-subtitles-vtt");
import SubtitlesTtmlModule = require("bitmovin-player/modules/bitmovinplayer-subtitles-ttml");
import SubtitlesCea608Module = require("bitmovin-player/modules/bitmovinplayer-subtitles-cea608");

let modulesRegistered = false;

/** Register the modules used by this App once. */
export function registerVegaPlayerModules(): void {
  if (modulesRegistered) return;
  Player.addModule(PolyfillModule.default);
  // Analytics collection starts only when its configuration is supplied.
  Player.addModule(AnalyticsModule.default);
  Player.addModule(ReactNativeModule.default);
  Player.addModule(EngineNativeModule.default);
  Player.addModule(EngineBitmovinModule.default);
  Player.addModule(MseRendererModule.default);
  Player.addModule(HlsModule.default);
  Player.addModule(XmlModule.default);
  Player.addModule(DashModule.default);
  Player.addModule(AbrModule.default);
  Player.addModule(LowLatencyModule.default);
  Player.addModule(SmoothModule.default);
  Player.addModule(DrmModule.default);
  Player.addModule(CryptoModule.default);
  Player.addModule(ContainerTsModule.default);
  Player.addModule(ContainerMp4Module.default);
  Player.addModule(ContainerWebmModule.default);
  Player.addModule(ThumbnailModule.default);
  Player.addModule(SubtitlesModule.default);
  Player.addModule(SubtitlesVttModule.default);
  Player.addModule(SubtitlesTtmlModule.default);
  Player.addModule(SubtitlesCea608Module.default);
  modulesRegistered = true;
}

/**
 * Create a modular player. On Vega there is no DOM container — playback is routed to
 * the W3C media element via the polyfills (see `BitmovinPlayer.tsx`).
 */
export function createVegaPlayer(config: PlayerConfig): PlayerAPI {
  registerVegaPlayerModules();
  return new Player(undefined as unknown as HTMLElement, vegaPlayerConfig(config));
}
