/**
 * Player-surface gestures for the custom themes: single click toggles play,
 * double click does fullscreen OR ±Ns seek depending on the runtime setting.
 *
 * Why intercept in the CAPTURE phase: the library's center button
 * (HugePlaybackToggleButton) has its OWN built-in double-click→fullscreen, baked
 * in via click-timing with no config to disable it. Listening on `#player` in the
 * capture phase and calling `stopPropagation()` means that button never receives
 * the click, so its built-in logic never runs — we own the surface outright
 * instead of fighting two handlers. The center play icon still renders and tracks
 * play state (it updates from player events, not clicks).
 *
 * The gesture is gated by `isActive()` so the stock "Default (Bitmovin)" theme
 * keeps its own built-in behavior untouched — that theme is the unmodified
 * baseline, and the custom themes are where this customization is demonstrated.
 */
import type { PlayerAPI } from "bitmovin-player";
import { PlayerUtils } from "@showcase/ui-shared";
import { clampToDuration, clampToWindow } from "./dvr/window";

export type DoubleClickMode = "fullscreen" | "seek";

export interface GestureHooks {
  /** The current player (it is recreated when DVR is toggled), read lazily. */
  getPlayer: () => PlayerAPI | undefined;
  /** The current double-click behavior. */
  getMode: () => DoubleClickMode;
  /** Only intercept when true — e.g. when a custom theme is active. */
  isActive: () => boolean;
  /** Seconds for the ±seek. Default 10. */
  seconds?: number;
}

/** Defer a single click so a double-click doesn't flip playback first. */
const SINGLE_CLICK_DELAY_MS = 250;

function togglePlay(player: PlayerAPI): void {
  if (player.isPlaying()) player.pause("ui");
  else player.play("ui");
}

/** Seek ±delta seconds: live shifts within the DVR window, VOD seeks the timeline. */
function seekBy(player: PlayerAPI, delta: number): void {
  if (player.isLive()) {
    player.timeShift(clampToWindow(player.getTimeShift() + delta, player.getMaxTimeShift()), "dblclick");
  } else {
    const start = PlayerUtils.getSeekableRangeStart(player, 0);
    const target = clampToDuration(PlayerUtils.getCurrentTimeRelativeToSeekableRange(player) + delta, player.getDuration());
    player.seek(start + target, "dblclick");
  }
}

function toggleFullscreen(player: PlayerAPI): void {
  const { ViewMode } = player.exports;
  const inFullscreen = player.getViewMode() === ViewMode.Fullscreen;
  player.setViewMode(inFullscreen ? ViewMode.Inline : ViewMode.Fullscreen);
}

/** Install the gesture on `element` (the player container). Returns a teardown fn. */
export function installPlayerGesture(element: HTMLElement, hooks: GestureHooks): () => void {
  const seconds = hooks.seconds ?? 10;
  let pendingClick: ReturnType<typeof setTimeout> | null = null;

  // Settings and recommendation overlays are siblings of the control bar.
  // Leave their entire interaction area to the UI, including labels and Replay.
  const withinControls = (e: Event): boolean =>
    e.target instanceof Element && e.target.closest(".bmpui-ui-controlbar, .bmpui-ui-settings-panel, .bmpui-ui-recommendation-overlay") !== null;

  const onClick = (e: MouseEvent): void => {
    const player = hooks.getPlayer();
    if (!player || !hooks.isActive() || withinControls(e)) return;
    e.stopPropagation();
    if (pendingClick !== null) return; // 2nd click of a double — dblclick handles it
    pendingClick = setTimeout(() => {
      pendingClick = null;
      togglePlay(player);
    }, SINGLE_CLICK_DELAY_MS);
  };

  const onDblClick = (e: MouseEvent): void => {
    const player = hooks.getPlayer();
    if (!player || !hooks.isActive() || withinControls(e)) return;
    e.stopPropagation();
    if (pendingClick !== null) {
      clearTimeout(pendingClick);
      pendingClick = null;
    }
    if (hooks.getMode() === "seek") {
      const rect = element.getBoundingClientRect();
      const back = e.clientX - rect.left < rect.width / 2; // left half = back, right = forward
      seekBy(player, back ? -seconds : seconds);
    } else {
      toggleFullscreen(player);
    }
  };

  element.addEventListener("click", onClick, true);
  element.addEventListener("dblclick", onDblClick, true);
  return () => {
    element.removeEventListener("click", onClick, true);
    element.removeEventListener("dblclick", onDblClick, true);
    if (pendingClick !== null) clearTimeout(pendingClick);
  };
}
