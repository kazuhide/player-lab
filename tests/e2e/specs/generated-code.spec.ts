import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatedCodeDiagnostics } from "../../../apps/web/test/generatedCodeCompiler";

function field(page: Page, label: RegExp) {
  return page.locator("#config-panel .config-field").filter({ has: page.locator(".config-field-label", { hasText: label }) });
}

test("GUI code typechecks and reproduces configuration, subtitles, UI and runtime playback", async ({ page, context }, testInfo) => {
  const errors: string[] = [];
  context.on("page", target => target.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const subtitles = page.getByRole("button", { name: "VOD + Subtitles", exact: true });
  await expect(subtitles).toBeEnabled();
  await subtitles.click();
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(3);
  await page.locator("#config-panel details").evaluateAll(nodes => nodes.forEach(node => { if (node instanceof HTMLDetailsElement) node.open = true; }));
  const reference = field(page, /^options.startOffsetTimelineReference/).locator("select");
  await reference.selectOption("start");
  await page.getByRole("button", { name: /Reload the source to apply/ }).click();
  await expect(page.locator("video")).toHaveCount(1);
  const volume = field(page, /^volume \(0/).locator("input");
  await volume.fill("37"); await volume.blur();
  const speed = page.locator("#config-panel .config-band-dynamic .config-field").filter({ has: page.locator(".config-field-label", { hasText: /^playbackSpeed/ }) }).locator("input");
  await speed.fill("1.25"); await speed.blur();
  await field(page, /^setLogLevel/).locator("select").selectOption("warn");
  const area = page.locator(".config-code textarea");
  await page.getByRole("button", { name: "Refresh code", exact: true }).click();
  const emitted = await area.inputValue();
  expect(emitted).toContain('"subtitleTracks"');
  expect(emitted).toContain("TimelineReferencePoint.Start");
  expect(emitted).toContain("player.setVolume(37)");
  expect(emitted).toContain("player.setPlaybackSpeed(1.25)");
  expect(emitted).toContain('player.setLogLevel(player.exports.LogLevel["WARN"])');
  const construction = await page.locator("#ui-construction .theme-diff .theme-diff-code").innerText();
  const prelude = 'import "@showcase/ui-shared/css";\n'
    + 'import { UIFactory, UIContainer, UIManager, UIVariantIdentifier } from "bitmovin-player-ui";\nconst hideDelay = -1;\n';
  const module = `${prelude}${emitted}\n${construction}`;
  expect(generatedCodeDiagnostics(module)).toEqual([]);
  expect(module).not.toMatch(/\bas (?:PlayerConfig|SourceConfig|UIConfig)\b/);
  // Localhost needs no license. Fill only the public placeholder, keeping all emitted statements intact.
  expect(module.split('"YOUR_PLAYER_KEY"')).toHaveLength(2);
  const replay = module.replace('"YOUR_PLAYER_KEY"', '""')
    + '\nObject.assign(window, { __generated: { player, playerConfig, sourceConfig, uiConfig } });\n';
  const id = createHash("sha256").update(replay).digest("hex");
  const directory = resolve(process.env.GENERATED_CODE_DIR ?? "node_modules/.cache/generated-code");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(directory, `${id}.ts`), replay);
  const emittedPath = testInfo.outputPath("emitted.ts");
  writeFileSync(emittedPath, module);
  await testInfo.attach("emitted-typescript", { path: emittedPath, contentType: "text/plain" });
  const replayPage = await context.newPage();
  await replayPage.goto(`/__generated__/index.html?case=${id}`);
  await expect.poll(() => replayPage.evaluate(() => window.__generated?.player.getSource()?.subtitleTracks?.length)).toBe(1);
  const actual = await replayPage.evaluate(() => {
    const p = window.__generated!.player;
    return { volume: p.getVolume(), speed: p.getPlaybackSpeed(), source: p.getSource(),
      autoplay: p.getConfig(false).playback?.autoplay, tracks: p.subtitles.list(),
      uiCount: document.querySelectorAll("#player .bmpui-ui-uicontainer").length };
  });
  expect(actual.volume).toBe(37);
  expect(actual.speed).toBe(1.25);
  expect(actual.autoplay).toBe(true);
  expect(actual.source?.options?.startOffsetTimelineReference).toBe("start");
  expect(actual.tracks.some(track => track.id === "sub-en" && track.lang === "en")).toBe(true);
  expect(actual.uiCount).toBe(1);
  await expect(replayPage.locator("#player .bmpui-ui-controlbar")).toBeVisible();
  await expect.poll(() => replayPage.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(3);
  await expect.poll(() => replayPage.locator("video").evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
  const start = await replayPage.evaluate(() => window.__generated!.player.getCurrentTime());
  await expect.poll(() => replayPage.evaluate(initial => window.__generated!.player.getCurrentTime() - initial, start)).toBeGreaterThan(0.3);
  await replayPage.evaluate(() => window.__generated!.player.subtitles.enable("sub-en"));
  await expect(replayPage.getByText("Generated subtitle fixture", { exact: true })).toBeVisible();
  const screenshot = testInfo.outputPath("replayed-ui.png");
  await replayPage.screenshot({ path: screenshot });
  await testInfo.attach("replayed-ui", { path: screenshot, contentType: "image/png" });
  await replayPage.evaluate(() => window.__generated!.player.destroy());
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    __generated?: { player: import("bitmovin-player").PlayerAPI };
  }
}
