import { Component } from "bitmovin-player-ui";
import type { ComponentConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";

export interface NextUpCardConfig extends ComponentConfig {
  /** Title of the next episode, read each time the card appears (so it stays correct after an
   *  advance without a UI rebuild). Returns undefined/empty when there's no next episode. */
  getNextTitle?: (() => string | undefined) | undefined;
  /** When true, show a countdown and auto-advance on playback end. When false,
   *  show an informational prompt to use the control-bar Next button. */
  autoplay?: boolean | undefined;
  /** Show the card when the remaining time drops to/below this many seconds. Default 10. */
  leadSeconds?: number | undefined;
  /** Load the next episode (app-owned). */
  onPlayNext?: (() => void) | undefined;
}

/**
 * A streaming-style "Next up" card (VOD): in the final {@link leadSeconds} of a clip it slides in
 * showing the next episode's title. With {@link autoplay} on it shows a countdown and auto-advances
 * when playback finishes; with it off it just announces what's next (manual advance is the
 * control-bar Next-episode button). It's an INFORMATIONAL overlay — a direct UIContainer-child
 * overlay doesn't receive clicks (the container consumes them), so the actionable control lives in
 * the control bar. The next-episode title and the advance action are injected (the app owns the
 * playlist), so this stays a pure UI component. Hidden for live / infinite-duration sources.
 */
export class NextUpCard extends Component<NextUpCardConfig> {
  private readonly getNextTitle: (() => string | undefined) | undefined;
  private readonly autoplay: boolean;
  private readonly leadSeconds: number;
  private readonly onPlayNext: (() => void) | undefined;
  private advanced = false;

  constructor(config: NextUpCardConfig = {}) {
    super({ cssClass: "ui-nextup-card", hidden: true, ...config });
    this.getNextTitle = config.getNextTitle;
    this.autoplay = config.autoplay ?? true;
    this.leadSeconds = config.leadSeconds ?? 10;
    this.onPlayNext = config.onPlayNext;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);
    const { PlayerEvent } = player.exports;

    const el = this.getDomElement().get(0);
    el.innerHTML =
      `<div class="nextup-label">Next up</div>` +
      `<div class="nextup-title"></div>` +
      `<div class="nextup-count"></div>`;
    const titleEl = el.querySelector<HTMLElement>(".nextup-title");
    const countEl = el.querySelector<HTMLElement>(".nextup-count");

    const update = (): void => {
      const duration = player.getDuration();
      if (player.isLive() || !Number.isFinite(duration)) {
        this.hide();
        return;
      }
      const remaining = duration - player.getCurrentTime();
      const title = this.getNextTitle?.();
      if (title && remaining > 0 && remaining <= this.leadSeconds) {
        if (titleEl) titleEl.textContent = title;
        if (countEl) countEl.textContent = this.autoplay ? `Playing in ${Math.ceil(remaining)}s` : "Press Next ▶ to continue";
        this.show();
      } else {
        this.hide();
      }
    };

    const onFinished = (): void => {
      if (this.autoplay && !this.advanced) {
        this.advanced = true;
        this.onPlayNext?.();
      }
    };
    const onSourceLoaded = (): void => {
      this.advanced = false;
      update();
    };

    player.on(PlayerEvent.TimeChanged, update);
    player.on(PlayerEvent.Seeked, update); // re-evaluate after a manual seek near the end
    player.on(PlayerEvent.PlaybackFinished, onFinished);
    player.on(PlayerEvent.SourceLoaded, onSourceLoaded);
    player.on(PlayerEvent.SourceUnloaded, update);
    uimanager.onRelease.subscribe(() => {
      player.off(PlayerEvent.TimeChanged, update);
      player.off(PlayerEvent.Seeked, update);
      player.off(PlayerEvent.PlaybackFinished, onFinished);
      player.off(PlayerEvent.SourceLoaded, onSourceLoaded);
      player.off(PlayerEvent.SourceUnloaded, update);
    });

    update();
  }
}
