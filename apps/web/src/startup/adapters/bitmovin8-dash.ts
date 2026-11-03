import { Player } from "bitmovin-player/modules/bitmovinplayer-core";
import Engine from "bitmovin-player/modules/bitmovinplayer-engine-bitmovin";
import Renderer from "bitmovin-player/modules/bitmovinplayer-mserenderer";
import Xml from "bitmovin-player/modules/bitmovinplayer-xml";
import Dash from "bitmovin-player/modules/bitmovinplayer-dash";
import Abr from "bitmovin-player/modules/bitmovinplayer-abr";
import Mp4 from "bitmovin-player/modules/bitmovinplayer-container-mp4";
import { bitmovin8Module, makeBitmovin8Adapter } from "./bitmovin8-shared";

// addModule initializes the registry; getModules before its first call throws in v8.283.0.
for (const module of [Engine, Renderer, Xml, Dash, Abr, Mp4]) Player.addModule(bitmovin8Module(module));

export const createAdapter = makeBitmovin8Adapter(Player, "dash");
