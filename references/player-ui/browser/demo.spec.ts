import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("keeps playback usable across persisted page transitions and browser back navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await page.locator("#profile").selectOption("single");
  await expect(page.locator("#session-count")).toContainText("1");
  // Exercise the browser's persisted lifecycle contract independently of cache eligibility.
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator("#profile")).toHaveValue("single");
  await expect(page.locator(".bmpui-ui-controlbar:visible")).toHaveCount(1);
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await page.goto("about:blank");
  await page.goBack();
  await expect(page.locator("#profile")).toHaveValue("single");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", /^(ready|paused|playing)$/, { timeout: 20_000 });
  await expect(page.locator("video")).toHaveCount(1);
  if (await page.locator("#player-status").getAttribute("data-state") !== "playing") await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await expect.poll(() => page.locator("video").evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);
});

test("loads a sparse synthetic snapshot without fetching raw session records", async ({ page }) => {
  const records: string[] = [];
  page.on("request", request => records.push(request.url()));
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#session-count")).toContainText("5");
  await expect(page.locator("#profile")).toHaveValue("sparse");
  expect(records.some(url => url.endsWith("sparse.snapshot.json"))).toBe(true);
  expect(records.some(url => url.endsWith(".samples.json"))).toBe(false);
  expect(records.some(url => /analytics\/queries|analytics\/impressions|analytics\.bitmovin/.test(url))).toBe(false);
});

test("plays the real source and keeps it running through data and language changes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const analytics: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/analytics\/queries|analytics\/impressions|analytics\.bitmovin/.test(request.url())) analytics.push(request.url()); });
  await page.goto("/");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  const video = page.locator("video").first();
  await page.evaluate(() => { (window as unknown as { originalVideo: HTMLVideoElement | null }).originalVideo = document.querySelector("video"); });
  await page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Play|再生)$/ }).click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.1);
  await expect(page.locator("#peaks button").first()).toBeEnabled();
  await page.locator("#peaks button").first().click();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(10);
  const at = await video.evaluate(element => (element as HTMLVideoElement).currentTime);
  await page.locator("#profile").selectOption("single");
  await expect(page.locator("#session-count")).toContainText("1");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  expect(await page.evaluate(() => (window as unknown as { originalVideo: HTMLVideoElement | null }).originalVideo === document.querySelector("video"))).toBe(true);
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(at);
  await page.locator("#language").click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
  expect(await page.evaluate(() => (window as unknown as { originalVideo: HTMLVideoElement | null }).originalVideo === document.querySelector("video"))).toBe(true);
  expect(await video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThanOrEqual(at);
  await page.locator("#language").click();
  await page.locator("#profile").selectOption("sparse");
  await expect(page.locator("#session-count")).toContainText("5");
  await page.locator(".player-frame").hover();
  const pause = page.locator(".bmpui-ui-controlbar:visible").getByRole("button", { name: /^(Pause|一時停止)$/ });
  await pause.click();
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "paused");
  const graph = page.locator(".pl-engagement-timeline:visible").first();
  await expect(graph).toBeVisible();
  await expect(graph.locator(".pl-engagement-fill")).not.toHaveCount(0);
  expect(await graph.evaluate(element => getComputedStyle(element).pointerEvents)).toBe("none");
  expect(await graph.locator("svg").evaluate(element => getComputedStyle(element).pointerEvents)).toBe("none");
  expect(await graph.locator(".pl-engagement-fill").first().evaluate(element => getComputedStyle(element).pointerEvents)).toBe("none");
  const controlBar = page.locator(".bmpui-ui-controlbar:visible").first();
  expect(await controlBar.evaluate(element => getComputedStyle(element).position)).toBe("absolute");
  const seekBar = page.getByRole("slider", { name: /^(Video timeline|再生位置)$/ }).first();
  const bounds = (await seekBar.boundingBox())!;
  await seekBar.click({ position: { x: bounds.width * .8, y: bounds.height / 2 } });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(45);
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).seeking)).toBe(false);
  await page.locator("#show-graph").uncheck();
  await expect(page.locator(".pl-engagement-timeline:visible")).toHaveCount(0);
  await page.locator("#show-graph").check();
  await expect(page.locator(".pl-engagement-timeline:visible").first()).toBeVisible();
  await page.locator("#accent").selectOption("white");
  await expect(page.locator(".player-frame")).toHaveAttribute("data-accent", "white");
  await page.locator("#accent").selectOption("blue");
  if (process.env.REFERENCE_CAPTURE_DIR && testInfo.project.name === "desktop-en") {
    await mkdir(process.env.REFERENCE_CAPTURE_DIR, { recursive: true });
    for (const language of ["en", "ja"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await page.locator("#language").click();
      await page.locator(".player-frame").hover();
      await expect(page.locator(".pl-engagement-timeline:visible").first()).toBeVisible();
      await page.screenshot({ path: path.join(process.env.REFERENCE_CAPTURE_DIR, `player-ui-${language}.png`), fullPage: true });
    }
  }
  expect(analytics).toEqual([]);
  expect(errors).toEqual([]);
});

test("distinguishes watched portions, no records, and a retryable loading failure", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await page.locator("#profile").selectOption("watched");
  await expect(page.locator('input[name="metric"][value="reach"]')).toBeChecked();
  await expect(page.locator("#metric-note")).toContainText(/No replay|再視聴の記録/);
  await page.locator("#profile").selectOption("empty");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "empty");
  await expect(page.locator("#session-count")).toContainText("0");
  await expect(page.locator(".pl-engagement-timeline:visible")).toHaveCount(0);
  await page.route("**/single.snapshot.json", route => route.fulfill({ status: 503, body: "temporarily unavailable" }));
  await page.locator("#profile").selectOption("single");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#session-count")).toHaveText("—");
  await expect(page.locator("#retry-data")).toBeVisible();
  await expect(page.locator("#peaks")).toHaveText("—");
  await page.unroute("**/single.snapshot.json");
  await page.locator("#retry-data").click();
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#session-count")).toContainText("1");
});

test("rejects a snapshot from a different content revision", async ({ page }) => {
  await page.route("**/sparse.snapshot.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.content.revision = "different-edit";
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#session-count")).toHaveText("—");
  await expect(page.locator(".pl-engagement-timeline:visible")).toHaveCount(0);
});

test("uses the latest selected dataset and lazily opens the corresponding records", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/single.snapshot.json", async route => {
    const response = await route.fetch();
    started();
    await pending;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator("#profile").selectOption("single");
  await intercepted;
  await page.locator("#profile").selectOption("broader");
  await expect(page.locator("#session-count")).toContainText("25");
  finish();
  await expect(page.locator("#profile")).toHaveValue("broader");
  await page.locator("#samples summary").click();
  await expect(page.locator("#samples-code")).toContainText('"synthetic": true');
  await expect(page.locator("#samples-code")).toContainText("broader");
  await page.locator("#configuration summary").click();
  await expect(page.locator("#configuration-code")).toContainText("./data/broader.snapshot.json");
});

test("fits narrow and wide screens without moving the stock control bar into the page layout", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator("#profile")).toBeVisible();
    const title = await page.locator("h1").boundingBox();
    expect(title?.height).toBeLessThan(40);
    const controls = page.locator(".bmpui-ui-controlbar:visible").first();
    expect(await controls.evaluate(element => getComputedStyle(element).position)).toBe("absolute");
    if (width === 320) {
      if (testInfo.project.name === "desktop-en") await expect(page.locator(".bmpui-ui-playbacktoggle-overlay:visible")).toHaveCount(0);
      else await expect(page.locator(".bmpui-ui-touch-control-overlay:visible").first()).toBeVisible();
      await controls.getByRole("button", { name: /^(Play|再生)$/ }).click();
      await expect(page.locator("#player-status")).toHaveAttribute("data-state", "playing");
      await controls.getByRole("button", { name: /^(Pause|一時停止)$/ }).click();
      await expect(page.locator("#player-status")).toHaveAttribute("data-state", "paused");
    }
  }
});
