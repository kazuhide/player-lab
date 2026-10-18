import { Label } from "bitmovin-player-ui";
import type { LabelConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { formatWallClock } from "../format";

/**
 * The absolute wall-clock label (§7): `HH:MM:SS` of the current live position.
 * `getCurrentTime()` defaults to `TimeMode.AbsoluteTime` (UNIX seconds via HLS
 * `EXT-X-PROGRAM-DATE-TIME` / DASH `availabilityStartTime`), so accuracy depends
 * on the stream providing those. Shown only for live streams.
 */
export class WallClockLabel extends Label<LabelConfig> {
  constructor(config: LabelConfig = {}) {
    super({ cssClass: "ui-label-wallclock", ...config });
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
      this.setText(formatWallClock(player.getCurrentTime()));
    };

    const events = [
      PlayerEvent.SourceLoaded,
      PlayerEvent.SourceUnloaded,
      PlayerEvent.TimeChanged,
      PlayerEvent.TimeShifted,
      PlayerEvent.Playing,
      PlayerEvent.Paused,
      PlayerEvent.DurationChanged,
    ];
    for (const event of events) {
      player.on(event, update);
    }
    uimanager.onRelease.subscribe(() => {
      for (const event of events) {
        player.off(event, update);
      }
    });

    update();
  }
}
