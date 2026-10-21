import { expect, it, vi } from "vitest";
import type { PlayerAPI, SubtitleCueEvent } from "bitmovin-player";
vi.mock("bitmovin-player/modules/bitmovinplayer-core", () => ({
  PlayerEvent: { CueEnter: "cueenter", CueExit: "cueexit", SubtitleDisabled: "subtitledisabled" },
}));
import { attachSubtitleDisplay } from "../src/subtitleDisplay";

it("renders public cue text, preserves overlapping cues, and rejects retired-owner events", () => {
  const listeners = new Map<string, (event: SubtitleCueEvent) => void>();
  const player = { on: vi.fn((name, callback) => listeners.set(name, callback)), off: vi.fn((name) => listeners.delete(name)) };
  const text = vi.fn();
  let current = true;
  const display = attachSubtitleDisplay(player as unknown as PlayerAPI, () => current, text);
  const cue = (start: number, value: string) => ({ subtitleId: "track", start, end: start + 2, text: value } as SubtitleCueEvent);
  const enter = listeners.get("cueenter")!;
  const exit = listeners.get("cueexit")!;
  enter(cue(0, "First")); enter(cue(1, "Second"));
  expect(text).toHaveBeenLastCalledWith("First\nSecond");
  exit(cue(0, "First"));
  expect(text).toHaveBeenLastCalledWith("Second");
  listeners.get("subtitledisabled")!(cue(0, ""));
  expect(text).toHaveBeenLastCalledWith("");
  current = false;
  const calls = text.mock.calls.length;
  enter(cue(3, "Retired"));
  display.dispose();
  expect(text).toHaveBeenCalledTimes(calls);
  expect(listeners.size).toBe(0);
});
