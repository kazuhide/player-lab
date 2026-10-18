import { Label } from "bitmovin-player-ui";
import type { LabelConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { formatBehindLive } from "../format";
import { DEFAULT_LIVE_EDGE_EPSILON } from "../liveState";

export interface BehindLiveLabelConfig extends LabelConfig {
  /** Seconds within the edge still treated as "at live". Default 1. */
  liveEdgeEpsilon?: number;
}

/**
 * The relative DVR label (§7): `"LIVE"` at the edge, otherwise `"-Xs behind"`.
 * Driven by `getTimeShift()` — always reliable — and shown only for live streams.
 */
export class BehindLiveLabel extends Label<BehindLiveLabelConfig> {
  private readonly liveEdgeEpsilon: number;

  constructor(config: BehindLiveLabelConfig = {}) {
    super({ cssClass: "ui-label-behindlive", ...config });
    this.liveEdgeEpsilon = config.liveEdgeEpsilon ?? DEFAULT_LIVE_EDGE_EPSILON;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    const { PlayerEvent } = player.exports;

    const update = (): void => {
      if (!player.isLive()) {
        this.hide();
        return;
      }
      this.show();
      this.setText(formatBehindLive(player.getTimeShift(), { epsilon: this.liveEdgeEpsilon }));
    };

    const events = [
      PlayerEvent.SourceLoaded,
      PlayerEvent.SourceUnloaded,
      PlayerEvent.TimeChanged,
      PlayerEvent.TimeShift,
      PlayerEvent.TimeShifted,
      PlayerEvent.Playing,
      PlayerEvent.Paused,
      PlayerEvent.DurationChanged,
    ];
    for (const event of events) {
      player.on(event, update);
    }
    // Explicit teardown. The framework also auto-removes handlers on release; this
    // is intentional belt-and-suspenders so the contract is obvious locally.
    uimanager.onRelease.subscribe(() => {
      for (const event of events) {
        player.off(event, update);
      }
    });

    update();
  }
}
