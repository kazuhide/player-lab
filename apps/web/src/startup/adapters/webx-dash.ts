import { Player } from "@bitmovin/player-web-x/bundles/playerx-dash";
import { makeWebXAdapter } from "./webx-shared";

export const createAdapter = makeWebXAdapter(Player, "dash");
