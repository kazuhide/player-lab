import { expect, test } from "@playwright/test";

const SOURCE = "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8";

function liveDemo(observed: boolean) {
  const profiles = [
    { id: "concentrated", title: { en: "Concentrated rewatching", ja: "見返しが集中する" }, peak: 10 },
    { id: "later", title: { en: "Rewatching a later section", ja: "後半を見返す" }, peak: 20 },
  ].map(({ id, title, peak }) => ({
    id, title,
    snapshot: {
      schemaVersion: 1,
      metricVersion: observed ? "observed-replay-coverage-v1" : "replay-coverage-v1",
      synthetic: !observed,
      content: { id: "simulated-live-window", revision: "fixture-v1", durationMs: 60_000 },
      period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" },
      generatedAt: "2026-01-02T00:00:00.000Z", sessionCount: 10, bucketWidthMs: 2_000,
      suggestedMode: "replay",
      points: Array.from({ length: 30 }, (_, index) => ({
        startMs: index * 2_000, endMs: (index + 1) * 2_000,
        reach: 1, replay: Math.max(0, .6 - Math.abs(index - peak) * .2), support: 10,
      })),
    },
  }));
  return { schemaVersion: 1, kind: observed ? "observability-replay-demo" : "synthetic-live-demo", source: { hls: SOURCE }, profiles };
}

for (const observed of [false, true]) {
  const labels = observed
    ? { en: "Demo viewing data · Observability API", ja: "Observability API · デモ視聴データ" }
    : { en: "Simulated live data", ja: "仮想ライブのデモデータ" };
  test(`shows ${observed ? "observed" : "simulated"} live rewatching and changes scenarios without reloading the video`, async ({ page }) => {
    const privateRequests: string[] = [];
    const mediaManifests: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/__private/query-data")) privateRequests.push(request.url());
      if (request.url() === SOURCE) mediaManifests.push(request.url());
    });
    await page.route("**/__private/query-data", route => route.fulfill({ json: liveDemo(observed) }));
    await page.goto("/?data=private");
    await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
    await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(page.locator(".data-badge")).toHaveText(await page.locator("html").getAttribute("lang") === "ja" ? labels.ja : labels.en);
    await expect(page.locator("#profile")).toBeEnabled();
    await expect(page.locator('input[value="replay"]')).toBeEnabled();
    await expect(page.locator('input[value="replay"]')).toBeChecked();
    await expect(page.locator("#preview-replay")).toHaveAttribute("data-state", "populated");
    const overlay = page.locator(".pl-engagement-timeline:visible").first();
    await expect(overlay).toHaveAttribute("data-metric", "replay");
    await expect(overlay).toHaveAttribute("data-empty", "false");
    await expect(page.locator(".metric-choice").first().locator("input")).toHaveValue("replay");
    await expect(page.locator("#samples")).toBeHidden();
    await expect(page.locator("#samples-link")).toBeHidden();
    const originalCurve = await page.locator("#preview-replay path").first().getAttribute("d");
    const originalOverlay = await overlay.locator("path").first().getAttribute("d");
    expect(originalCurve).toContain("C");
    await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
    await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
    await page.locator("#peaks button").first().click();
    await expect.poll(() => page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(15);
    await page.evaluate(() => { (window as unknown as { liveDemoVideo: Element | null }).liveDemoVideo = document.querySelector("video"); });
    const timeBefore = await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime);
    await page.locator("#profile").selectOption("later");
    await expect(page.locator("#profile")).toHaveValue("later");
    await expect(page.locator('input[value="replay"]')).toBeChecked();
    await expect.poll(() => page.locator("#preview-replay path").first().getAttribute("d")).not.toBe(originalCurve);
    await expect.poll(() => overlay.locator("path").first().getAttribute("d")).not.toBe(originalOverlay);
    await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
    expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(timeBefore);
    for (const language of ["ja", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language").click();
      await expect(page.locator(".data-badge")).toHaveText(labels[language as "ja" | "en"]);
      await expect(page.locator("#profile")).toHaveValue("later");
      await expect(page.locator('input[value="replay"]')).toBeEnabled();
      await expect(page.locator(".controls-panel")).not.toContainText(/非公開|未公開|Private query/);
      if (observed) {
        await expect(page.locator("#profile-hint")).toHaveText(language === "ja"
          ? "APIで取得した再生記録を集計しています。" : "Aggregated playback records retrieved through the API.");
        await expect(page.locator("footer")).not.toContainText(/Fictional|Simulated|仮想|架空/);
      }
    }
    expect(await page.evaluate(() => document.querySelector("video") === (window as unknown as { liveDemoVideo: Element | null }).liveDemoVideo)).toBe(true);
    await page.locator("#configuration summary").click();
    await expect(page.locator("#configuration-code")).toContainText("validatePrivateData");
    await expect(page.locator("#configuration-code")).toContainText("data.profiles[1].snapshot");
    await expect(page.locator("#configuration-code")).toContainText('"replay"');
    await expect(page.locator("#configuration-code")).not.toContainText(SOURCE);
    await expect(page.locator("#calculation-link")).toHaveAttribute("href", /live-demo-data\.md$/);
    await page.locator("#values summary").click();
    await expect(page.locator("#values-body tr").first().locator("td").nth(1)).toHaveText("0.0%");
    expect(privateRequests).toHaveLength(1);
    expect(mediaManifests).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });
}
