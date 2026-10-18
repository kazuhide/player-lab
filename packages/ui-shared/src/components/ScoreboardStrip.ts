import { Component } from "bitmovin-player-ui";
import type { ComponentConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { OTHER_GAMES, renderScoreboard } from "../sportsData";

/**
 * A broadcast-style "other games around the league" strip, overlaid at the top of the player.
 * It renders {@link OTHER_GAMES} sample data once (a real build would update it from a feed on
 * a timer / WebSocket). A leaf {@link Component} whose single div we fill via the DOM wrapper —
 * the data is static and developer-controlled, so setting markup directly is safe.
 */
export class ScoreboardStrip extends Component<ComponentConfig> {
  constructor(config: ComponentConfig = {}) {
    super({ cssClass: "ui-scoreboard-strip", ...config });
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    this.getDomElement().html(renderScoreboard(OTHER_GAMES));
  }
}
