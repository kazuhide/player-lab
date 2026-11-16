import { Player, PlayerEvent, type PlayerAPI, type PlayerConfig, type SourceConfig } from "bitmovin-player";
import { createPlayerUi } from "./create-player-ui.ts";
import type { Locale } from "./i18n.ts";
import { createViewerPlayback } from "./viewer-playback.ts";

export const SOURCE = {
  hls: "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8",
  title: "Big Buck Bunny",
  subtitleTracks: [
    { id: "player-lab-demo-en", lang: "en", label: "English (demo captions)", kind: "subtitle", enabled: false,
      url: `${import.meta.env.BASE_URL}captions/demo.en.vtt` },
    { id: "player-lab-demo-ja", lang: "ja", label: "Japanese (demo captions)", kind: "subtitle", enabled: false,
      url: `${import.meta.env.BASE_URL}captions/demo.ja.vtt` },
  ],
} satisfies SourceConfig;

export type PlaybackState = "loading" | "ready" | "playing" | "paused" | "error" | "mismatch";

export interface PlaybackOptions {
  source: SourceConfig;
  expectedDurationMs: number;
}

export function playerConfiguration(): PlayerConfig {
  return {
    key: import.meta.env.VITE_PUBLIC_PLAYER_LICENSE_KEY ?? "",
    ui: false,
    analytics: false,
    playback: { autoplay: false, muted: true },
  };
}

export function createPlayback(
  onState: (state: PlaybackState) => void,
  locale: Locale,
  options: PlaybackOptions = { source: SOURCE, expectedDurationMs: 60_000 },
) {
  const player: PlayerAPI = new Player(document.querySelector<HTMLElement>("#player")!, playerConfiguration());
  const ui = createPlayerUi(player, locale);
  let ready = false;
  let validTimeline = false;
  const checkTimeline = () => {
    const duration = player.getDuration();
    validTimeline = Number.isFinite(duration) && Math.abs(duration * 1000 - options.expectedDurationMs) <= 1000;
    return validTimeline;
  };
  player.on(PlayerEvent.Ready, () => {
    ready = true;
    onState(checkTimeline() ? "ready" : "mismatch");
  });
  player.on(PlayerEvent.Playing, () => onState(checkTimeline() ? "playing" : "mismatch"));
  player.on(PlayerEvent.Paused, () => onState(validTimeline ? "paused" : "mismatch"));
  player.on(PlayerEvent.Error, () => { ready = false; onState("error"); });
  const viewer = createViewerPlayback({
    getDuration: () => player.getDuration(),
    getCurrentTime: () => player.getCurrentTime(),
    getPlaybackSpeed: () => player.getPlaybackSpeed(),
    getSource: () => player.getSource(),
    isLive: () => player.isLive(),
    isCasting: () => player.isCasting(),
    isPaused: () => player.isPaused(),
    seek: (seconds, issuer) => player.seek(seconds, issuer),
    play: issuer => player.play(issuer),
    pause: issuer => player.pause(issuer),
    // The string event names are checked against the pinned SDK enum in the controller.
    on: (name, listener) => player.on(name as PlayerEvent, listener),
    off: (name, listener) => player.off(name as PlayerEvent, listener),
    getAudio: () => player.getAudio(),
    getAvailableAudio: () => player.getAvailableAudio(),
    setAudio: id => player.setAudio(id),
    subtitles: {
      list: () => player.subtitles.list(),
      enable: (id, exclusive) => player.subtitles.enable(id, exclusive),
      disable: id => player.subtitles.disable(id),
    },
    ads: { isLinearAdActive: () => player.ads?.isLinearAdActive() ?? false },
  }, { durationMs: options.expectedDurationMs, isAvailable: () => ready && validTimeline });

  async function load(): Promise<void> {
    ready = false;
    validTimeline = false;
    viewer.reset();
    onState("loading");
    try { await player.load(options.source); }
    catch { onState("error"); }
  }

  return {
    player,
    viewer,
    get ui() { return ui; },
    get canSeek() { return ready && validTimeline; },
    load,
    setLocale(next: Locale) {
      ui.setLocale(next);
    },
    seek(milliseconds: number) {
      if (ready && validTimeline && Number.isFinite(milliseconds)) {
        viewer.stopHighlights();
        const end = Math.max(0, Math.min(player.getDuration(), options.expectedDurationMs / 1000) - .1);
        player.seek(Math.max(0, Math.min(end, milliseconds / 1000)));
      }
    },
    destroy() { viewer.destroy(); ui.manager.release(); void player.destroy(); },
  };
}

export type Playback = ReturnType<typeof createPlayback>;
