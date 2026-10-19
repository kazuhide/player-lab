import { expect, test, type Page } from "@playwright/test";
import { PROVISIONED, requireProvisionedStreams } from "../src/streams";

const APP = `http://localhost:${process.env.E2E_APP_PORT ?? "5175"}`;

async function openFeatureApp(page: Page): Promise<void> {
  // Expose the actual SDK instance only in this test response. No production hook
  // or alternate implementation is added to the application.
  await page.route("**/src/main.ts", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const constructor = /const instance = new Player\([^\n]+\);/g;
    expect(body.match(constructor)).toHaveLength(1);
    await route.fulfill({ response, body: body.replace(constructor, "$&\nwindow.player = instance;") });
  });
  // Keep the application's existing source selection and labels. Only the public
  // baseline URL is replaced in the test response, so this run uses our fixture.
  await page.route("**/src/sources.ts", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const reference = "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8";
    expect(body.split(reference)).toHaveLength(2);
    await route.fulfill({ response, body: body.replace(reference, PROVISIONED.vodBaselineHls) });
  });
  await page.goto(`${APP}/`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Default (Bitmovin)", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.player?.getCurrentTime() ?? 0)).toBeGreaterThan(0.1);
}

async function openSettings(page: Page): Promise<void> {
  await page.locator("#player").hover();
  await page.locator(".bmpui-ui-settingstogglebutton").click();
}

test.describe("Configured feature presets in the original Web application", () => {
  test.beforeAll(() => requireProvisionedStreams());

  test("the audio settings menu switches the configured track", async ({ page }) => {
    await openFeatureApp(page);
    await page.getByRole("button", { name: "VOD + Multi-audio", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getAvailableAudio().length)).toBe(2);
    await openSettings(page);
    await page.getByRole("menuitem", { name: /^Audio/ }).click();
    await page.getByRole("menuitem", { name: "German test track", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getAudio()?.lang)).toBe("de");
    await page.getByRole("menuitem", { name: "English test track", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getAudio()?.lang)).toBe("en");
  });

  test("the subtitle settings menu enables a visible cue", async ({ page }) => {
    await openFeatureApp(page);
    await page.getByRole("button", { name: "VOD + Subtitles", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.subtitles.list().length)).toBe(1);
    await openSettings(page);
    await page.getByRole("menuitem", { name: /^Subtitles/ }).click();
    await page.getByRole("menuitem", { name: "English", exact: true }).click();
    // Position playback inside the known cue; enabling the track above is a real
    // settings-menu action, and the assertion below checks the rendered overlay.
    await page.evaluate(() => window.player!.seek(1.5));
    const subtitles = page.locator(".bmpui-ui-subtitle-overlay");
    await expect(subtitles).toBeVisible();
    await expect(subtitles).toContainText("This blade has a dark past.");
    await expect.poll(() => page.evaluate(() => window.player?.subtitles.list().find((track) => track.id === "sub-en")?.enabled)).toBe(true);
  });

  test("hovering the seek bar fetches and displays the sprite preview", async ({ page }, testInfo) => {
    await openFeatureApp(page);
    await page.getByRole("button", { name: "VOD + Sprites", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.player?.getThumbnail(2)?.width)).toBe(160);
    const image = page.waitForResponse((response) => response.url().endsWith("/sprite-0.jpg") && response.status() === 200);
    const seekbar = page.locator(".bmpui-ui-seekbar .bmpui-seekbar");
    await seekbar.hover({ position: { x: 20, y: 2 } });
    await image;
    const preview = page.locator(".bmpui-seekbar-thumbnail");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveCSS("background-image", /sprite-0\.jpg/);
    await testInfo.attach("sprite-preview", { body: await page.screenshot(), contentType: "image/png" });
  });
});
