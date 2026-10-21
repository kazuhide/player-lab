import { describe, expect, it, vi } from "vitest";
import type { Player, SourceConfig } from "bitmovin-player-react-native";
import { loadOwnedSource, unloadOwnedSource } from "../src/sourceOwnership";

describe("native source retirement", () => {
  it("releases every replaced source and leaves only the last source owned by Player", () => {
    const sources: Array<{ isDestroyed: boolean; destroy: ReturnType<typeof vi.fn> }> = [];
    const player = {
      source: undefined as unknown,
      unload: vi.fn(),
      load: vi.fn((_config: SourceConfig) => {
        const source = { isDestroyed: false, destroy: vi.fn(() => { source.isDestroyed = true; }) };
        sources.push(source); player.source = source;
      }),
    };
    const typed = player as unknown as Player;
    for (let index = 0; index < 3; index++) loadOwnedSource(typed, { url: "https://example.com/" + index + ".m3u8" });
    expect(sources.map(source => source.isDestroyed)).toEqual([true, true, false]);
    expect(sources[0]!.destroy).toHaveBeenCalledOnce();
    expect(sources[1]!.destroy).toHaveBeenCalledOnce();
    expect(player.source).toBe(sources[2]);
    unloadOwnedSource(typed);
    expect(sources[2]!.destroy).toHaveBeenCalledOnce();
    expect(player.source).toBeUndefined();
    unloadOwnedSource(typed);
    expect(sources[2]!.destroy).toHaveBeenCalledOnce();
  });
});
