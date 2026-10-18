import { expect, test } from "@playwright/test";
import { PROVISIONED } from "../src/streams";

// Sprite thumbnails (§12 scrubbing). The encoder produced a JPEG sprite sheet + a
// WebVTT index; the player loads the VTT as SourceConfig.thumbnailTrack, and
// getThumbnail(t) resolves the tile for time t — its url is the sheet and x/y/w/h
// index into it.
//
// Two layers of assertion, because they guard different things:
//  1. Geometry (url/x/y/w/h) proves the VTT parsed into the tiles the template
//     configured (160×90 every 5s). NOTE: getThumbnail() reads the cue text only —
//     it does NOT fetch the sheet — so geometry alone would still pass under the
//     %number% naming regression (VTT says sprite-0.jpg while the file is sprite.jpg).
//  2. So we also fetch the sheet URL the player resolved and assert it's a real
//     image. THIS is what actually guards the naming fix. The fetch runs in the
//     Playwright (Node) request context, not the page, to sidestep S3 CORS.
//
// The geometry picks (t=2 → tile 0, t=7 → tile 1) assume the provisioned clip is
// ≥10s with the 5s sprite interval (it is — the Sintel trailer, ~52s).
test.describe("Sprite thumbnails — thumbnailTrack + getThumbnail", () => {
  test("getThumbnail tiles parse AND the resolved sheet is fetchable", async ({ page, request }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (s) => window.harness.load({ hls: s.hls, title: "sprites", thumbnailTrack: { url: s.vtt } }),
      { hls: PROVISIONED.vodSpritesHls, vtt: PROVISIONED.vodSpritesVtt },
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    const tiles = await page.evaluate(async () => {
      const started = await window.harness.waitFor("TimeChanged", 20_000);
      const pick = (t: number) => {
        const th = window.player!.getThumbnail(t);
        return th ? { url: th.url, x: th.x, y: th.y, width: th.width, height: th.height } : null;
      };
      return { started, first: pick(2), second: pick(7) }; // 5s interval → tiles 0 and 1
    });

    expect(tiles.started, "stream never produced TimeChanged").toBe(true);
    expect(tiles.first, "getThumbnail(2) null — Thumbnails module / track not loaded?").not.toBeNull();
    expect(tiles.second, "getThumbnail(7) null").not.toBeNull();

    // (1) Geometry from the template: 160×90 tiles; distinct cues at the 5s boundary.
    expect(tiles.first!.url).toContain("sprite-0.jpg");
    expect(tiles.first!.width).toBe(160);
    expect(tiles.first!.height).toBe(90);
    expect(tiles.first!.x).toBe(0);
    expect(tiles.second!.x).toBe(160);

    // (2) The real guard: the sheet the cue points at must resolve to an image.
    // Resolve relative cue URLs against the VTT base; absolute URLs pass through.
    const sheetUrl = new URL(tiles.first!.url, PROVISIONED.vodSpritesVtt).href;
    const sheet = await request.get(sheetUrl);
    expect(sheet.status(), `sprite sheet not fetchable: ${sheetUrl}`).toBe(200);
    expect(sheet.headers()["content-type"] ?? "").toContain("image");
  });
});
