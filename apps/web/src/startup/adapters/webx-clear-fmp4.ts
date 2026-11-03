import { Player as CorePlayer } from "@bitmovin/player-web-x/bundles/playerx-core";
import { NoAdaptationPackage } from "@bitmovin/player-web-x/packages/playerx-no-adaptation.package";
import { CapabilitiesPackage } from "@bitmovin/player-web-x/packages/playerx-capabilities.package";
import { ContainerMp4Package } from "@bitmovin/player-web-x/packages/playerx-container-mp4.package";
import { DataPackage } from "@bitmovin/player-web-x/packages/playerx-data.package";
import { HlsManifestPackage } from "@bitmovin/player-web-x/packages/playerx-hls-manifest.package";
import { MediaStatePackage } from "@bitmovin/player-web-x/packages/playerx-media-state.package";
import { MsePlaybackPackage } from "@bitmovin/player-web-x/packages/playerx-mse-playback.package";
import { NativePlaybackPackage } from "@bitmovin/player-web-x/packages/playerx-native-playback.package";
import { NetworkPackage } from "@bitmovin/player-web-x/packages/playerx-network.package";
import { PlaybackApiPackage } from "@bitmovin/player-web-x/packages/playerx-playback-api.package";
import { PlaybackPackage } from "@bitmovin/player-web-x/packages/playerx-playback.package";
import { PlaybackTechnologyPackage } from "@bitmovin/player-web-x/packages/playerx-playback-technology.package";
import { SegmentProcessingPackage } from "@bitmovin/player-web-x/packages/playerx-segment-processing.package";
import { SourcePackage } from "@bitmovin/player-web-x/packages/playerx-source.package";
import { SourcesApiPackage } from "@bitmovin/player-web-x/packages/playerx-sources-api.package";
import { StreamDataStructurePackage } from "@bitmovin/player-web-x/packages/playerx-stream-data-structure.package";
import { StreamingPackage } from "@bitmovin/player-web-x/packages/playerx-streaming.package";
import { VideoElementControllerPackage } from "@bitmovin/player-web-x/packages/playerx-video-element-controller.package";
import type { PlayerConfig } from "@bitmovin/player-web-x/types/bundles/Types";
import { makeWebXAdapter, type NativePlayerApi } from "./webx-shared";

export async function createPlayer(config: PlayerConfig): Promise<NativePlayerApi> {
  // Public package composition merges the API types of the registered packages.
  const player = CorePlayer(config) as NativePlayerApi;
  try {
    player.packages.add(NoAdaptationPackage);
    player.packages.add(CapabilitiesPackage);
    player.packages.add(ContainerMp4Package);
    player.packages.add(DataPackage);
    player.packages.add(HlsManifestPackage);
    player.packages.add(MediaStatePackage);
    player.packages.add(MsePlaybackPackage);
    player.packages.add(NativePlaybackPackage);
    player.packages.add(NetworkPackage);
    player.packages.add(PlaybackApiPackage);
    player.packages.add(PlaybackPackage);
    player.packages.add(PlaybackTechnologyPackage);
    player.packages.add(SegmentProcessingPackage);
    player.packages.add(SourcePackage);
    player.packages.add(SourcesApiPackage);
    player.packages.add(StreamDataStructurePackage);
    player.packages.add(StreamingPackage);
    player.packages.add(VideoElementControllerPackage);
    return player;
  } catch (error) {
    await player.dispose();
    throw error;
  }
}

export const createAdapter = makeWebXAdapter(createPlayer, "hls", {
  bundle: "playerx-core-clear-fmp4",
  packages: [
    "playerx-no-adaptation.package",
    "playerx-capabilities.package",
    "playerx-container-mp4.package",
    "playerx-data.package",
    "playerx-hls-manifest.package",
    "playerx-media-state.package",
    "playerx-mse-playback.package",
    "playerx-native-playback.package",
    "playerx-network.package",
    "playerx-playback-api.package",
    "playerx-playback.package",
    "playerx-playback-technology.package",
    "playerx-segment-processing.package",
    "playerx-source.package",
    "playerx-sources-api.package",
    "playerx-stream-data-structure.package",
    "playerx-streaming.package",
    "playerx-video-element-controller.package",
  ],
});
