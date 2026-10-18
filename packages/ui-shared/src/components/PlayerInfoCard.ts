import { Component } from "bitmovin-player-ui";
import type { ComponentConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { CURRENT_ATBAT, FEATURED_MATCHUP, HOME_LINEUP, renderPlayerInfo } from "../sportsData";

/**
 * A broadcast-style player-info card overlaid in a corner: the current at-bat (batter + pitcher
 * with their stats and the B-S-O count) plus a mini batting order. Renders {@link CURRENT_ATBAT}
 * / {@link HOME_LINEUP} sample data; a real build would refresh it from a feed. Same leaf-Component
 * approach as {@link ScoreboardStrip}.
 */
export class PlayerInfoCard extends Component<ComponentConfig> {
  constructor(config: ComponentConfig = {}) {
    super({ cssClass: "ui-playerinfo-card", ...config });
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    this.getDomElement().html(renderPlayerInfo(CURRENT_ATBAT, HOME_LINEUP, FEATURED_MATCHUP.home));
  }
}
