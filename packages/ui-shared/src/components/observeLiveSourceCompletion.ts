import type { PlayerAPI } from "bitmovin-player";
import type { UIInstanceManager } from "bitmovin-player-ui";

/** Keep completion tied to one load generation, including queued callbacks. */
export function observeLiveSourceCompletion(
  player: PlayerAPI, manager: UIInstanceManager, update: () => void,
): () => boolean {
  const { PlayerEvent } = player.exports;
  let present = Boolean(player.getSource());
  let finished = false;
  let released = false;
  let generation = 0;
  let completion: (() => void) | undefined;

  const unbind = (): void => {
    if (completion) player.off(PlayerEvent.PlaybackFinished, completion);
    completion = undefined;
  };
  const bind = (): void => {
    unbind();
    const owner = generation;
    completion = (): void => {
      if (released || !present || owner !== generation) return;
      finished = true;
      update();
    };
    player.on(PlayerEvent.PlaybackFinished, completion);
  };
  const loaded = (): void => {
    if (released) return;
    generation++; present = true; finished = false;
    bind(); update();
  };
  const unloaded = (): void => {
    if (released) return;
    generation++; present = false; finished = false;
    unbind(); update();
  };
  player.on(PlayerEvent.SourceLoaded, loaded);
  player.on(PlayerEvent.SourceUnloaded, unloaded);
  if (present) bind();
  manager.onRelease.subscribe(() => {
    released = true; generation++;
    unbind();
    player.off(PlayerEvent.SourceLoaded, loaded);
    player.off(PlayerEvent.SourceUnloaded, unloaded);
  });
  // Replay does not create a new moving live edge. Only a new load resets this.
  return () => !released && present && !finished;
}
