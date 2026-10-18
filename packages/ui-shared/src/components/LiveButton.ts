import { ButtonStyle, ToggleButton } from "bitmovin-player-ui";
import type { ToggleButtonConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";
import { DEFAULT_LIVE_EDGE_EPSILON, deriveLiveButtonState } from "../liveState";

export interface LiveButtonConfig extends ToggleButtonConfig {
  /** Seconds within the edge still treated as "at live". Default 1. */
  liveEdgeEpsilon?: number;
}

/**
 * A "LIVE" button for live / DVR streams.
 *
 * - ON (`at-live-edge`) when playing at the live edge.
 * - OFF (`behind-live`) when behind live — click jumps to the edge via `timeShift(0)`.
 * - Hidden for VOD.
 *
 * The state is derived by {@link deriveLiveButtonState}; this component is just the
 * thin glue that reads the player on the relevant events and toggles itself. The
 * window is re-read on every `TimeChanged`, which is what HLS needs (its
 * `maxTimeShift` can read `0` until the buffer fills).
 */
export class LiveButton extends ToggleButton<LiveButtonConfig> {
  private readonly liveEdgeEpsilon: number;

  constructor(config: LiveButtonConfig = {}) {
    super({
      cssClass: "ui-livebutton",
      text: "LIVE",
      // Button defaults to icon-only; render the text label.
      buttonStyle: ButtonStyle.Text,
      onClass: "at-live-edge",
      offClass: "behind-live",
      onAriaLabel: "Playing at the live edge",
      offAriaLabel: "Jump to the live edge",
      ...config,
    });
    this.liveEdgeEpsilon = config.liveEdgeEpsilon ?? DEFAULT_LIVE_EDGE_EPSILON;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    const { PlayerEvent } = player.exports;

    const update = (): void => {
      const state = deriveLiveButtonState(player.isLive(), player.getTimeShift(), this.liveEdgeEpsilon);
      if (state === "hidden") {
        this.hide();
        return;
      }
      this.show();
      if (state === "at-edge") this.on();
      else this.off();
    };

    this.onClick.subscribe(() => {
      // timeShift(0) returns to the live edge.
      player.timeShift(0, "ui-livebutton");
    });

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
