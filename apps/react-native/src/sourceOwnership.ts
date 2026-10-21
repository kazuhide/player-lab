import type { Player, SourceConfig } from "bitmovin-player-react-native";

/** The wrapper's unload/load methods do not dispose the previous native Source. */
export function unloadOwnedSource(player: Player): void {
  const previous = player.source;
  player.unload();
  if (previous && !previous.isDestroyed) previous.destroy();
  if (player.source === previous) delete player.source;
}

export function loadOwnedSource(player: Player, source: SourceConfig): void {
  if (player.source) unloadOwnedSource(player);
  player.load(source);
}

export const unloadSourceCode = "const previous = player.source;\nplayer.unload();\nprevious?.destroy();\nif (player.source === previous) delete player.source;";
