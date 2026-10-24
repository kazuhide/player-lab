import type { PlayerAPI, PlayerEvent } from "bitmovin-player";
import type { UIManager } from "bitmovin-player-ui";
import { DefaultUIFactory, LiveUIFactory } from "../src/liveUi";

/** Replace real UI managers while the real SDK is delivering playback events. */
export async function inspectQueuedUiEvents(player: PlayerAPI) {
  const source = player.getSource();
  if (!source) throw new Error("Load a source before checking UI event delivery.");
  const host = document.createElement("div");
  host.style.cssText = "width:640px;height:360px;position:relative";
  document.body.appendChild(host);
  const results = [];
  const observe = async (event: PlayerEvent, trigger: () => void | Promise<void>): Promise<void> => {
    let resolve!: () => void;
    const delivered = new Promise<void>(done => { resolve = done; });
    const received = () => resolve();
    player.on(event, received);
    try { await trigger(); await delivered; }
    finally { player.off(event, received); }
  };
  try {
    for (const event of [player.exports.PlayerEvent.SourceLoaded, player.exports.PlayerEvent.SourceUnloaded,
      player.exports.PlayerEvent.Playing]) {
      // Exercise a real transition, rather than depending on reloading a cached source.
      if (event === player.exports.PlayerEvent.SourceLoaded) {
        if (player.getSource()) await observe(player.exports.PlayerEvent.SourceUnloaded, () => player.unload());
      } else if (!player.getSource()) {
        await observe(player.exports.PlayerEvent.SourceLoaded, () => player.load(source));
      }
      if (event === player.exports.PlayerEvent.Playing) {
        if (!player.isPlaying()) await observe(player.exports.PlayerEvent.Playing, () => player.play());
        await observe(player.exports.PlayerEvent.Paused, () => player.pause());
      }
      let previous: UIManager | undefined;
      let replacement: UIManager | undefined;
      let oldRoot: HTMLElement | undefined;
      let replaced = false;
      let detachedDuringEvent = false;
      let resolve!: () => void;
      const delivered = new Promise<void>(done => { resolve = done; });
      const replace = (): void => {
        if (!previous || replaced) return;
        replaced = true;
        player.off(event, replace);
        oldRoot = previous.activeUi.getUI().getDomElement().get(0);
        previous.release();
        detachedDuringEvent = !oldRoot.isConnected;
        replacement = DefaultUIFactory.buildDefaultUI(player, { container: host });
        resolve();
      };
      player.on(event, replace);
      previous = LiveUIFactory.buildLiveUI(player, { container: host });
      try {
        if (event === player.exports.PlayerEvent.SourceLoaded) await player.load(source);
        else if (event === player.exports.PlayerEvent.SourceUnloaded) await player.unload();
        else await player.play();
        // load()/play() can settle before the SDK delivers their event listeners.
        await delivered;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        results.push({ event, replaced, detachedDuringEvent, oldRootReconnected: oldRoot?.isConnected,
          remainingRoots: host.querySelectorAll(".bmpui-ui-uicontainer").length });
      } finally {
        player.off(event, replace);
        previous.release();
        replacement?.release();
        host.replaceChildren();
      }
    }
    return results;
  } finally { host.remove(); }
}
