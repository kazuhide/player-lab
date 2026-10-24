import type { PlayerAPI } from "bitmovin-player";
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
  try {
    for (const event of [player.exports.PlayerEvent.SourceLoaded, player.exports.PlayerEvent.SourceUnloaded,
      player.exports.PlayerEvent.Playing]) {
      let previous: UIManager | undefined;
      let replacement: UIManager | undefined;
      let oldRoot: HTMLElement | undefined;
      let replaced = false;
      let detachedDuringEvent = false;
      const replace = (): void => {
        if (!previous || replaced) return;
        replaced = true;
        player.off(event, replace);
        oldRoot = previous.activeUi.getUI().getDomElement().get(0);
        previous.release();
        detachedDuringEvent = !oldRoot.isConnected;
        replacement = DefaultUIFactory.buildDefaultUI(player, { container: host });
      };
      player.on(event, replace);
      previous = LiveUIFactory.buildLiveUI(player, { container: host });
      try {
        await player.load(source);
        if (event === player.exports.PlayerEvent.Playing && !replaced) await player.play();
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
