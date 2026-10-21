import { Button, ButtonStyle, PlayerUtils } from "bitmovin-player-ui";
import type { ButtonConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";

export interface NextEpisodeButtonConfig extends ButtonConfig {
  /** Load the next episode. Provided by the app, which owns the playlist + `player.load`. */
  onPlayNext?: (() => void) | undefined;
  /** Reveal the button when the remaining time drops to/below this many seconds. Default 10. */
  leadSeconds?: number | undefined;
}

/**
 * A control-bar "Next episode" button that appears DYNAMICALLY near the end of a clip (the last
 * {@link leadSeconds}), the way a streaming service surfaces "next episode" — not a permanent
 * control. The advance is an app concern (the playlist + `player.load` live in the app), so this
 * is thin glue: on click it calls the injected `onPlayNext`. Hidden when no handler is wired, for
 * live/infinite-duration sources, or away from the end.
 */
export class NextEpisodeButton extends Button<NextEpisodeButtonConfig> {
  private readonly onPlayNext: (() => void) | undefined;
  private readonly leadSeconds: number;

  constructor(config: NextEpisodeButtonConfig = {}) {
    super({
      cssClass: "ui-nextepisode-button",
      text: "Next ▶",
      buttonStyle: ButtonStyle.Text,
      ariaLabel: "Play the next episode",
      hidden: true,
      ...config,
    });
    this.onPlayNext = config.onPlayNext;
    this.leadSeconds = config.leadSeconds ?? 10;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    if (!this.onPlayNext) {
      this.hide();
      return;
    }
    this.onClick.subscribe(() => this.onPlayNext?.());

    const { PlayerEvent } = player.exports;
    const update = (): void => {
      const duration = player.getDuration();
      if (player.isLive() || !Number.isFinite(duration)) {
        this.hide();
        return;
      }
      // Clamp at 0 so the button stays available at the exact end of the clip (remaining === 0),
      // not only strictly before it: manual "next" must still work once the playhead reaches the
      // finish (e.g. paused at the end with autoplay-next off, where the Next-up card is informational).
      const remaining = Math.max(0, duration - PlayerUtils.getCurrentTimeRelativeToSeekableRange(player));
      if (remaining <= this.leadSeconds) this.show();
      else this.hide();
    };
    const events = [
      PlayerEvent.TimeChanged,
      PlayerEvent.Seeked,
      PlayerEvent.SourceLoaded,
      PlayerEvent.SourceUnloaded,
    ];
    for (const event of events) player.on(event, update);
    uimanager.onRelease.subscribe(() => {
      for (const event of events) player.off(event, update);
    });
    update();
  }
}
