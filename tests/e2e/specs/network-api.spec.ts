import { expect, test } from "@playwright/test";
import { PROVISIONED, requireProvisionedStreams } from "../src/streams";

// §16 Network API — the player exposes NetworkConfig.preprocessHttpRequest, a hook
// to inspect/rewrite every HTTP request. The harness wires it to record URLs.
test.describe("Network API — preprocessHttpRequest interception", () => {
  test.beforeAll(() => requireProvisionedStreams());

  test("intercepts the player's manifest + segment requests", async ({ page }) => {
    await page.goto("/");
    const res = await page.evaluate(
      (url) => window.harness.load({ hls: url, title: "net" }, {}, { spyNetwork: true }),
      PROVISIONED.vodBaselineHls,
    );
    expect(res.loaded, res.error ?? "load failed").toBe(true);

    // Let the player fetch the manifest chain + start playback (a media segment).
    await page.evaluate(() => window.harness.waitFor("TimeChanged", 20_000));

    const reqs = await page.evaluate(() => window.harness.network());
    expect(reqs.length).toBeGreaterThan(0);
    // The HLS manifest(s) were requested through the hook.
    expect(reqs.some((u) => u.includes(".m3u8"))).toBe(true);
    // …as was an init/media segment.
    expect(reqs.some((u) => u.includes(".m4s") || u.includes(".mp4") || u.includes("video_"))).toBe(true);
  });
});
