import { Button, ButtonStyle, PlayerUtils } from "bitmovin-player-ui";
import type { ButtonConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";

export interface SkipIntroButtonConfig extends ButtonConfig {
  /** Start of the intro range (seconds). */
  introStart?: number | undefined;
  /** End of the intro range (seconds) — clicking seeks here. */
  introEnd?: number | undefined;
}

/**
 * A streaming-style "Skip Intro" button (VOD): it shows only while the playhead is inside the
 * configured intro range `[introStart, introEnd)` and, when clicked, seeks to `introEnd`. The
 * range is sample timing passed by the factory — a real build would read it from per-episode
 * metadata (e.g. chapter markers). Hidden for live and outside the range.
 */
export class SkipIntroButton extends Button<SkipIntroButtonConfig> {
  private readonly introStart: number;
  private readonly introEnd: number;

  constructor(config: SkipIntroButtonConfig = {}) {
    super({
      cssClass: "ui-skipintro-button",
      text: "Skip Intro",
      buttonStyle: ButtonStyle.Text,
      ariaLabel: "Skip the intro",
      hidden: true,
      ...config,
    });
    this.introStart = config.introStart ?? 0;
    this.introEnd = config.introEnd ?? 0;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    const { PlayerEvent } = player.exports;

    const update = (): void => {
      const t = PlayerUtils.getCurrentTimeRelativeToSeekableRange(player);
      const inRange = !player.isLive() && this.introEnd > this.introStart && t >= this.introStart && t < this.introEnd;
      if (inRange) this.show();
      else this.hide();
    };

    this.onClick.subscribe(() => {
      player.seek(PlayerUtils.getSeekableRangeStart(player, 0) + this.introEnd, "ui-skipintro");
    });

    const events = [
      PlayerEvent.TimeChanged,
      PlayerEvent.Seeked,
      PlayerEvent.SourceLoaded,
      PlayerEvent.SourceUnloaded,
      PlayerEvent.Play,
      PlayerEvent.Paused,
    ];
    for (const event of events) player.on(event, update);
    uimanager.onRelease.subscribe(() => {
      for (const event of events) player.off(event, update);
    });

    update();
  }
}
