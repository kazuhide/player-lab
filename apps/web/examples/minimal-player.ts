import { Player, PlayerEvent, type ErrorEvent, type PlayerAPI } from "bitmovin-player";
import { UIFactory, type UIManager } from "bitmovin-player-ui";
import "bitmovin-player-ui/dist/css/bitmovinplayer-ui.css";

export function mountMinimalPlayer(licenseKey: string, hlsUrl: string) {
  const container = document.createElement("div");
  container.style.aspectRatio = "16 / 9";
  document.body.append(container);
  let player: PlayerAPI;
  try {
    player = new Player(container, {
      key: licenseKey,
      ui: false,
      playback: { autoplay: false, muted: true },
    });
  } catch (error) {
    container.remove();
    throw error;
  }
  let ui: UIManager | undefined;
  let released = false;
  let cleanup: Promise<void> | undefined;
  const onError = (event: ErrorEvent) => {
    if (!released) console.error(`Player error ${event.code}`);
  };
  player.on(PlayerEvent.Error, onError);

  function release(): Promise<void> {
    if (cleanup) return cleanup;
    released = true;
    window.removeEventListener("pagehide", onPageHide);
    player.off(PlayerEvent.Error, onError);
    cleanup = Promise.resolve().then(async () => {
      try {
        ui?.release();
      } finally {
        try {
          await player.destroy();
        } finally {
          container.remove();
        }
      }
    });
    return cleanup;
  }
  function onPageHide() {
    void release().catch(() => console.error("Player cleanup failed."));
  }
  window.addEventListener("pagehide", onPageHide, { once: true });

  const ready = Promise.resolve().then(async () => {
    if (released) return;
    ui = UIFactory.buildUI(player);
    await player.load({ hls: hlsUrl });
  }).catch(async (error: unknown) => {
    await release();
    throw error;
  });
  return { player, ready, release };
}
