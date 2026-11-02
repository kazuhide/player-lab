import { Player } from "@bitmovin/player-web-x/bundles/playerx-hls";
import { makeWebXAdapter } from "./webx-shared";

export const createAdapter = makeWebXAdapter(Player, "hls");
