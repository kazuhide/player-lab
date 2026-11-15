import { Player, PlayerEvent, type PlayerAPI, type PlayerConfig } from "bitmovin-player";
import { createPlayerUi } from "./create-player-ui.ts";
import type { Locale } from "./i18n.ts";

export const SOURCE = {
  hls: "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8",
  title: "Big Buck Bunny",
};

export type PlaybackState = "loading" | "ready" | "playing" | "paused" | "error" | "mismatch";

export function playerConfiguration(): PlayerConfig {
  return {
    key: import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY ?? "",
    ui: false,
    analytics: false,
    playback: { autoplay: false, muted: true },
  };
}

export function createPlayback(onState: (state: PlaybackState) => void, locale: Locale) {
  const player: PlayerAPI = new Player(document.querySelector<HTMLElement>("#player")!, playerConfiguration());
  const ui = createPlayerUi(player, locale);
  let ready = false;
  let validTimeline = false;
  const checkTimeline = () => {
    const duration = player.getDuration();
    validTimeline = Number.isFinite(duration) && Math.abs(duration * 1000 - 60_000) <= 1000;
    return validTimeline;
  };
  player.on(PlayerEvent.Ready, () => {
    ready = true;
    onState(checkTimeline() ? "ready" : "mismatch");
  });
  player.on(PlayerEvent.Playing, () => onState(checkTimeline() ? "playing" : "mismatch"));
  player.on(PlayerEvent.Paused, () => onState(validTimeline ? "paused" : "mismatch"));
  player.on(PlayerEvent.Error, () => { ready = false; onState("error"); });

  async function load(): Promise<void> {
    ready = false;
    validTimeline = false;
    onState("loading");
    try { await player.load(SOURCE); }
    catch { onState("error"); }
  }

  return {
    player,
    get ui() { return ui; },
    get canSeek() { return ready && validTimeline; },
    load,
    setLocale(next: Locale) {
      ui.setLocale(next);
    },
    seek(milliseconds: number) {
      if (ready && validTimeline && Number.isFinite(milliseconds)) player.seek(Math.max(0, Math.min(59.9, milliseconds / 1000)));
    },
    destroy() { ui.manager.release(); void player.destroy(); },
  };
}

export type Playback = ReturnType<typeof createPlayback>;
