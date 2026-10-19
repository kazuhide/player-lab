import { expect, test } from "@playwright/test";
import { PROVISIONED, requireProvisionedStreams } from "../src/streams";

// Multiple selectable audio tracks (language switch). The encoder produced two AAC
// renditions from distinct sources, exposed as two media.audio entries (en default
// + de) in one HLS group. getAvailableAudio() lists both and setAudio() switches —
// the real guard that the custom media.audio manifest is correct (a single-track or
// mislabelled manifest would fail the count/lang/switch assertions).
test.describe("Multi-audio — track list + switching", () => {
  test.beforeAll(() => requireProvisionedStreams());

  test("exposes en+de tracks and setAudio switches between them", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (url) => window.harness.load({ hls: url, title: "multiaudio" }),
      PROVISIONED.vodMultiAudioHls,
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const info = await page.evaluate(async () => {
      const started = await window.harness.waitFor("TimeChanged", 20_000);
      const tracks = window.player!.getAvailableAudio().map((t) => ({ id: t.id, label: t.label, lang: t.lang }));
      return { started, tracks, currentId: window.player!.getAudio()?.id ?? null };
    });

    expect(info.started, "stream never produced TimeChanged").toBe(true);
    expect(info.tracks.length, `expected 2 audio tracks, got ${JSON.stringify(info.tracks)}`).toBe(2);
    expect(info.tracks.map((t) => t.lang).sort()).toEqual(["de", "en"]);

    // The en rendition is isDefault:true (DEFAULT=YES) → it must be the track the
    // player selects at load. Guards a default-track regression the lang-set misses.
    const enTrack = info.tracks.find((t) => t.lang === "en");
    expect(info.currentId, "default track should be English (isDefault)").toBe(enTrack?.id);

    // Switch to the other track and confirm the selection actually changed.
    const switched = await page.evaluate(async (curId) => {
      const other = window.player!.getAvailableAudio().find((t) => t.id !== curId);
      if (!other) return { ok: false as const };
      const changed = window.harness.waitFor("AudioChanged", 10_000);
      window.player!.setAudio(other.id);
      const fired = await changed;
      return { ok: true as const, fired, newId: window.player!.getAudio()?.id ?? null, want: other.id };
    }, info.currentId);

    expect(switched.ok, "could not find a second track to switch to").toBe(true);
    if (!switched.ok) return;
    expect(switched.fired, "AudioChanged did not fire").toBe(true);
    expect(switched.newId, "selected track id did not update").toBe(switched.want);
  });
});
