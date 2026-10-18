import { expect, test } from "@playwright/test";
import { PROVISIONED } from "../src/streams";

// Subtitles via SourceConfig.subtitleTracks (sideloaded WebVTT — the player fetches
// the .vtt directly, no manifest involvement). The player lists the track, enable()
// activates it, and CueEnter fires with the cue text once playback reaches a cue.
// Asserting the cue text is the real guard: it proves the .vtt was fetched, parsed,
// and rendered — a broken URL or unparseable VTT would yield a track object but no
// cue, and the toBeTruthy()/contains check would fail.
test.describe("Subtitles — sideloaded WebVTT track", () => {
  test("lists the en track, enables it, and a cue renders", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (s) =>
        window.harness.load({
          hls: s.hls,
          title: "subtitles",
          subtitleTracks: [{ url: s.vtt, id: "sub-en", lang: "en", label: "English", kind: "subtitle" }],
        }),
      { hls: PROVISIONED.vodBaselineHls, vtt: PROVISIONED.subtitleVttEn },
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const result = await page.evaluate(async () => {
      const tracks = window.player!.subtitles.list().map((t) => ({ id: t.id, lang: t.lang, label: t.label }));
      // on() is per-event overloaded; widen it to attach a cueenter listener.
      const onAny = window.player!.on.bind(window.player!) as unknown as (
        event: string,
        cb: (ev: { text?: string }) => void,
      ) => void;
      const cueText = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 15_000);
        onAny("cueenter", (ev) => {
          clearTimeout(timer);
          resolve(ev.text ?? "");
        });
        window.player!.subtitles.enable("sub-en");
        // Restart from 0 so playback deterministically re-enters the first cue (~1s),
        // regardless of how far autoplay advanced before the listener attached (slow CI).
        window.player!.seek(0);
        if (window.player!.isPaused()) void window.player!.play();
      });
      return { tracks, cueText };
    });

    expect(result.tracks.length, `expected 1 subtitle track, got ${JSON.stringify(result.tracks)}`).toBe(1);
    expect(result.tracks[0]?.lang).toBe("en");
    expect(result.cueText, "no subtitle cue rendered — VTT failed to load/parse?").toBeTruthy();
    // The first Sintel cue is "This blade has a dark past."
    expect(result.cueText?.toLowerCase()).toContain("blade");
  });
});
