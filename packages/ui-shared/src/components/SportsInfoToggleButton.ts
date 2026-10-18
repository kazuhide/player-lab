import { ButtonStyle, Component, ToggleButton } from "bitmovin-player-ui";
import type { ComponentConfig, ToggleButtonConfig, UIInstanceManager } from "bitmovin-player-ui";
import type { PlayerAPI } from "bitmovin-player";

export interface SportsInfoToggleButtonConfig extends ToggleButtonConfig {
  /** Auto-hide the overlays this many ms after they're shown (default 6000). */
  autoHideMs?: number | undefined;
}

/**
 * A control-bar button that shows/hides the sports info overlays (the scoreboard strip and the
 * player-info card). It holds references to the exact overlay instances built alongside it in the
 * same UI tree, so toggling is self-contained — no app-level state and no UI rebuild.
 *
 * The overlays appear briefly then AUTO-HIDE after {@link autoHideMs} (like a broadcast scorebug),
 * so they don't sit over the video permanently. Clicking INFO re-shows them (restarting the timer)
 * or hides them immediately.
 */
export class SportsInfoToggleButton extends ToggleButton<SportsInfoToggleButtonConfig> {
  private readonly targets: Component<ComponentConfig>[];
  private readonly autoHideMs: number;
  private overlaysVisible = true;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(targets: Component<ComponentConfig>[], config: SportsInfoToggleButtonConfig = {}) {
    super({
      cssClass: "ui-sportsinfo-toggle",
      text: "INFO",
      buttonStyle: ButtonStyle.Text,
      onClass: "info-shown",
      offClass: "info-hidden",
      onAriaLabel: "Hide the game info overlays",
      offAriaLabel: "Show the game info overlays",
      ...config,
    });
    this.targets = targets;
    this.autoHideMs = config.autoHideMs ?? 6000;
  }

  override configure(player: PlayerAPI, uimanager: UIInstanceManager): void {
    super.configure(player, uimanager);

    const setVisible = (visible: boolean): void => {
      this.overlaysVisible = visible;
      for (const t of this.targets) {
        if (visible) t.show();
        else t.hide();
      }
      if (visible) this.on();
      else this.off();
    };
    const clearTimer = (): void => {
      if (this.hideTimer !== undefined) {
        clearTimeout(this.hideTimer);
        this.hideTimer = undefined;
      }
    };
    const startAutoHide = (): void => {
      clearTimer();
      this.hideTimer = setTimeout(() => setVisible(false), this.autoHideMs);
    };

    // Overlays start visible, then auto-hide after a few seconds.
    setVisible(true);
    startAutoHide();

    this.onClick.subscribe(() => {
      if (this.overlaysVisible) {
        clearTimer();
        setVisible(false); // manual hide
      } else {
        setVisible(true);
        startAutoHide(); // re-show, and auto-hide again later
      }
    });

    uimanager.onRelease.subscribe(clearTimer);
  }
}
