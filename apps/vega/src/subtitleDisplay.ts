import type { PlayerAPI, SubtitleCueEvent } from "bitmovin-player";
import { PlayerEvent } from "bitmovin-player/modules/bitmovinplayer-core";

/** Vega has no HTML UI. Render the public SDK's plain WebVTT cue text in a native Text view. */
export function attachSubtitleDisplay(player: PlayerAPI, isActive: () => boolean, show: (text: string) => void): { dispose(): void } {
  const cues = new Map<string, string>();
  const key = (cue: SubtitleCueEvent) => JSON.stringify([cue.subtitleId, cue.start, cue.end, cue.text]);
  const enter = (cue: SubtitleCueEvent) => {
    if (!isActive()) return;
    cues.set(key(cue), cue.text);
    show([...cues.values()].join("\n"));
  };
  const exit = (cue: SubtitleCueEvent) => {
    if (!isActive()) return;
    cues.delete(key(cue));
    show([...cues.values()].join("\n"));
  };
  const clear = () => { if (isActive()) { cues.clear(); show(""); } };
  player.on(PlayerEvent.CueEnter, enter);
  player.on(PlayerEvent.CueExit, exit);
  player.on(PlayerEvent.SubtitleDisabled, clear);
  return { dispose() {
    player.off(PlayerEvent.CueEnter, enter);
    player.off(PlayerEvent.CueExit, exit);
    player.off(PlayerEvent.SubtitleDisabled, clear);
    cues.clear();
  } };
}
