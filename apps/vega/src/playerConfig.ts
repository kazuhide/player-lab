import type { PlayerConfig } from "bitmovin-player";
import { NetworkRequestApi } from "bitmovin-player/modules/bitmovinplayer-core";

export function vegaPlayerConfig(config: PlayerConfig): PlayerConfig {
  // Vega's media integration supports Fetch rather than the SDK's default XHR.
  return { ...config, network: { ...config.network, requestApi: NetworkRequestApi.Fetch } };
}
