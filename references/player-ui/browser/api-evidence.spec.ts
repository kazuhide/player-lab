import { expect, test } from "@playwright/test";
import { computeObservedReplay } from "../src/observed-replay.ts";

const SOURCE = "https://kazuhide.github.io/player-lab/web/media/vod-baseline/master.m3u8";

function observedPack(includeEvidence = true, empty = false) {
  const evidence = {
    schemaVersion: 1, videoId: "demo-video", sourceUrl: SOURCE,
    sessions: [
      { id: "record-a", expectedLastSequence: 2, fetchedAt: "2026-01-01T00:11:00.000Z", response: { status: "SUCCESS", data: { result: [
        { sequence_number: 0, state: "playing", played: 20_000, seeked: 0, videotime_start: 0, videotime_end: 20_000 },
        { sequence_number: 1, state: "seeking", played: 0, seeked: 125, videotime_start: 20_000, videotime_end: 10_000 },
        { sequence_number: 2, state: "playing", played: 20_000, seeked: 0, videotime_start: 10_000, videotime_end: 30_000 },
      ].map((sample, index) => ({ ...sample, client_time: Date.parse("2026-01-01T00:01:00.000Z") + index,
        ad: 0, video_duration: 60_000, video_id: "demo-video", m3u8_url: SOURCE })) } } },
      { id: "record-b", expectedLastSequence: 0, fetchedAt: "2026-01-01T00:11:00.000Z", response: { status: "SUCCESS", data: { result: [
        { sequence_number: 0, state: "playing", played: 20_000, seeked: 0, videotime_start: 0, videotime_end: 20_000,
          client_time: Date.parse("2026-01-01T00:01:00.000Z"), ad: 0, video_duration: 60_000, video_id: "demo-video", m3u8_url: SOURCE },
      ] } } },
    ],
  };
  const samples = evidence.sessions[0].response.data.result;
  evidence.sessions[0].response.data.result = [samples[2], samples[0], samples[1], { ...samples[1] }];
  if (empty) for (const session of evidence.sessions) for (const sample of session.response.data.result) {
    sample.state = "startup";
    sample.played = sample.seeked = sample.videotime_start = sample.videotime_end = 0;
  }
  const snapshot = { ...computeObservedReplay({
    content: { id: "demo-clip", revision: "demo-v1", durationMs: 60_000 },
    period: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T00:10:00.000Z" },
    videoId: evidence.videoId, sourceUrl: SOURCE,
    sessions: evidence.sessions.map(session => ({ id: session.id, expectedLastSequence: session.expectedLastSequence,
      samples: session.response.data.result.map(sample => ({
        sequenceNumber: sample.sequence_number, clientTime: sample.client_time, state: sample.state,
        played: sample.played, seeked: sample.seeked, ad: sample.ad, videotimeStart: sample.videotime_start,
        videotimeEnd: sample.videotime_end, videoDuration: sample.video_duration, videoId: sample.video_id, sourceUrl: sample.m3u8_url,
      })),
    })),
  }, 10_000), generatedAt: "2026-01-01T00:12:00.000Z" };
  return { schemaVersion: 1, kind: "observability-replay-demo", source: { hls: SOURCE },
    profiles: ["focused", "other"].map(id => ({ id, title: { en: id, ja: id }, snapshot,
      ...(includeEvidence ? { evidence } : {}) })),
  };
}

test("inspects original API values and canonical bucket arithmetic without restarting playback", async ({ page }, testInfo) => {
  const accountRequests: string[] = [];
  page.on("request", request => { if (request.url().startsWith("https://api.bitmovin.com/")) accountRequests.push(request.url()); });
  await page.route("**/__private/query-data", route => route.fulfill({ json: observedPack() }));
  await page.goto("/?data=private");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  const panel = page.locator("#api-evidence");
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("open", "");
  await expect(page.locator("#evidence-json")).toHaveText("");
  await page.locator("#api-evidence-link").click();
  await expect(panel).toHaveAttribute("open", "");
  await expect(panel).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#evidence-bucket")).toHaveValue("1");
  await expect(page.locator("#evidence-sequence")).toHaveValue("2");
  await expect(page.locator("#evidence-replay-formula")).toHaveText("10,000 / (10,000 × 2) = 50.0%");
  await expect(page.locator("#evidence-reach-formula")).toHaveText("20,000 / (10,000 × 2) = 100.0%");
  await page.locator("#evidence-sequence").selectOption("1");
  await expect(page.locator('#evidence-fields tr[data-field="seeked"] td').last()).toHaveText("125");
  await expect(page.locator("#evidence-json")).toContainText('"videotime_start": 20000');
  await expect(page.locator("#evidence-json")).not.toContainText("videotimeStart");
  const response = JSON.parse((await page.locator("#evidence-json").textContent())!);
  expect(response.data.result.map((sample: { sequence_number: number }) => sample.sequence_number)).toEqual([2, 0, 1, 1]);
  expect(response.data.result).toHaveLength(4);
  await expect(page.locator("#evidence-decision")).toContainText(/Backward seek|後方シーク/);
  await expect(page.locator("#evidence-passes")).toContainText("10,000–30,000 ms");
  await expect(page.locator('[data-i18n="apiRangeRule"]')).toContainText("state");
  await expect(page.locator('[data-i18n="apiRangeRule"]')).toContainText("played");
  await expect(page.locator('[data-i18n="apiRangeRule"]')).toContainText("seeked");
  await panel.screenshot({ path: testInfo.outputPath("api-evidence.png") });
  await page.locator("#evidence-contributions button").last().click();
  await expect(page.locator("#evidence-record")).toHaveValue("record-b");
  await expect(page.locator("#evidence-sequence")).toHaveValue("0");
  await page.locator("#evidence-contributions button").first().click();
  await expect(page.locator("#evidence-sequence")).toHaveValue("2");
  await page.locator("#evidence-contributions button").last().click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await page.evaluate(() => { (window as unknown as { evidenceVideo: Element | null }).evidenceVideo = document.querySelector("video"); });
  for (const language of ["ja", "en"]) {
    if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language").click();
    await expect(page.locator("#evidence-record")).toHaveValue("record-b");
    await expect(page.locator("#evidence-bucket")).toHaveValue("1");
    await expect(panel.locator("summary").first()).toHaveText(language === "ja" ? "API応答と計算過程" : "API response and calculation");
  }
  await page.locator("#profile").selectOption("other");
  await expect(panel).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#evidence-record")).toHaveValue("record-a");
  expect(await page.evaluate(() => document.querySelector("video") === (window as unknown as { evidenceVideo: Element | null }).evidenceVideo)).toBe(true);
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await page.locator("#evidence-bucket").selectOption("5");
  await expect(page.locator("#evidence-replay-formula")).toContainText("No record");
  expect(accountRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("shows no eligible records without displaying a zero denominator", async ({ page }) => {
  await page.route("**/__private/query-data", route => route.fulfill({ json: observedPack(true, true) }));
  await page.goto("/?data=private#api-evidence");
  await expect(page.locator("#api-evidence")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#evidence-replay-formula")).toHaveText(/No eligible playback records|集計対象の再生記録なし/);
  await expect(page.locator("#evidence-reach-formula")).not.toContainText("/");
});

test("keeps full-length record labels inside their table buttons on narrow screens", async ({ page }) => {
  const pack = observedPack();
  pack.profiles[0].evidence!.sessions.forEach((session, index) => {
    session.id = `demo-record-${String(index + 1).padStart(3, "0")}`;
  });
  await page.route("**/__private/query-data", route => route.fulfill({ json: pack }));
  await page.goto("/?data=private#api-evidence");
  await expect(page.locator("#api-evidence")).toHaveAttribute("data-state", "ready");
  const bounds = await page.locator("#evidence-contributions button").evaluateAll(buttons => buttons.map(button => ({
    content: button.scrollWidth, visible: button.clientWidth,
  })));
  expect(bounds.length).toBeGreaterThan(0);
  expect(bounds.every(bound => bound.content <= bound.visible + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("opens the inspector from its URL and reports missing evidence without hiding the graph", async ({ page }) => {
  await page.route("**/__private/query-data", route => route.fulfill({ json: observedPack(false) }));
  await page.goto("/?data=private#api-evidence");
  await expect(page.locator("#api-evidence")).toHaveAttribute("open", "");
  await expect(page.locator("#api-evidence")).toHaveAttribute("data-state", "missing");
  await expect(page.locator("#evidence-state")).toContainText(/not included|含まれていません/);
  await expect(page.locator('input[value="replay"]')).toBeEnabled();
  await expect(page.locator("#preview-replay")).toHaveAttribute("data-state", "populated");
});
