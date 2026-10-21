import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ApiSchema } from "../../../apps/web/src/api/types";

const catalog = JSON.parse(readFileSync(resolve(__dirname, "../../../apps/web/src/api/schema.json"), "utf8")) as ApiSchema;
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const observed: string[] = []; errors.set(page, observed);
  page.on("pageerror", error => observed.push(error.message));
  await page.route(/analytics-ingress[^/]*\.bitmovin\.com/i, route => route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.goto("./");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.locator(".api-explorer > summary").click();
  await expect(page.getByRole("searchbox", { name: "Search APIs" })).toBeVisible();
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function selectApi(page: Page, category: string, id: string): Promise<void> {
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption(category);
  await page.getByRole("searchbox", { name: "Search APIs" }).fill(id);
  await page.getByRole("listbox", { name: "SDK entry", exact: true }).selectOption(id);
}
async function branch(page: Page, id: string, kind: string): Promise<void> {
  const entry = catalog.rows.find(entry => entry.id === id)!;
  const schema = catalog.nodes[entry.schema!]!;
  if (schema.kind === "union") {
    const choice = schema.options!.find(key => catalog.nodes[key]!.kind === kind)!;
    await page.locator(".api-explorer-form > .api-value > select").selectOption(choice);
  }
}
async function apply(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toContainText("Configuration submitted");
}
async function readApi(page: Page, id: string): Promise<string> {
  await selectApi(page, "observation", id);
  await page.getByRole("button", { name: "Read state", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("SDK call completed.");
  return (await page.locator(".api-result").textContent())!;
}

test("typed source values reload the current source and API reads show the submitted value", async ({ page }) => {
  const id = "SourceConfig.title";
  await selectApi(page, "configuration", id); await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("Detailed API source");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getSource")).toContain("Detailed API source");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("a codec priority array and query dictionary reach the recreated Player", async ({ page }) => {
  let id = "PlayerConfig.playback.audioCodecPriority";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form input[type=text]").fill("mp4a.40.2");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getConfig")).toContain('"mp4a.40.2"');
  id = "PlayerConfig.tweaks.query_parameters";
  await selectApi(page, "configuration", id); await branch(page, id, "object");
  await page.getByRole("textbox", { name: "Property name", exact: true }).fill("lab_fixture");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await page.locator(".api-explorer-form fieldset input[type=text]").fill("enabled");
  await apply(page);
  expect(await readApi(page, "PlayerAPI.getConfig")).toContain('"lab_fixture": "enabled"');
});

test("a user-approved request callback runs in the real SDK after Player recreation", async ({ page }) => {
  const id = "PlayerConfig.network.preprocessHttpRequest";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return Promise.resolve(request);");
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  await expect(page.locator(".api-event-log")).toContainText("Callback invoked");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  await expect(page.locator(".api-explorer-content > pre").first()).toContainText("return Promise.resolve(request)");
});

test("component constructor overrides apply through every original theme", async ({ page }) => {
  const id = "UIComponentConfigMap.ControlBar.cssClasses";
  await selectApi(page, "configuration", id); await branch(page, id, "array");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form input[type=text]").fill("api-control-check");
  await apply(page);
  const themes = page.locator("#ui-theme-bar .theme-btn");
  const count = await themes.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index++) {
    await themes.nth(index).click();
    await expect(page.locator('#player [class*="api-control-check"]').first()).toBeAttached();
  }
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test("editing a marker inside the base array preserves its neighbours and exports usable edits", async ({ page }) => {
  const id = "UIConfig.metadata.markers[].title";
  await selectApi(page, "configuration", id);
  await page.getByRole("spinbutton", { name: "Array index 1", exact: true }).fill("2");
  await branch(page, id, "string");
  await page.locator(".api-explorer-form input[type=text]").fill("Edited third chapter");
  await apply(page);
  const config = await readApi(page, "UIManager.getConfig");
  expect(config).toContain("Chapter 1"); expect(config).toContain("Chapter 2"); expect(config).toContain("Edited third chapter");
});

test("a real language-change dispatcher is created and connected to UI localization", async ({ page }) => {
  const id = "UIConfig.localization.events.onLanguageChanged";
  await selectApi(page, "configuration", id);
  await page.locator(".api-explorer-form > .api-value > select").selectOption("factory:EventDispatcher");
  await apply(page);
  const config = await readApi(page, "UIManager.getConfig");
  expect(config).toContain("EventDispatcher");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("SDK-managed UI uses the configured factory and theme selection restores app ownership", async ({ page }) => {
  let id = "PlayerConfig.style.uiManagerFactory";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return lab.ui.UIFactory.buildUI(playerAPI, config);");
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await apply(page);
  id = "PlayerConfig.ui";
  await selectApi(page, "configuration", id);
  await page.getByRole("textbox", { name: "Data without an SDK type restriction" }).fill("{}");
  await apply(page);
  await expect(page.locator(".ui-theme-bar-note")).toContainText("SDK-managed UI");
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("Callback invoked")).toBe(true);
  expect(await readApi(page, "UIManager.getConfig")).toContain("metadata");
  await page.locator("#ui-theme-bar .theme-btn").filter({ hasText: /^Sports$/ }).click();
  await expect(page.locator(".ui-theme-bar-note")).not.toContainText("SDK-managed UI");
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("an unfinished request callback can be removed without waiting for its old load", async ({ page }) => {
  const id = "PlayerConfig.network.preprocessHttpRequest";
  await selectApi(page, "configuration", id); await branch(page, id, "function");
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return new Promise(() => {});");
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("Callback invoked")).toBe(true);
  await page.getByRole("button", { name: "Remove this override", exact: true }).click();
  await expect(page.locator(".api-explorer > p[role=status]")).toHaveText("Override removed.");
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});

test("runtime arguments change volume, state reads expose it, and event subscriptions record playback", async ({ page }) => {
  await selectApi(page, "command", "PlayerAPI.setVolume");
  await page.locator(".api-explorer-form fieldset input[type=text]").first().fill("37");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  expect(await readApi(page, "PlayerAPI.getVolume")).toBe("37");
  await expect.poll(() => page.locator("#player video").evaluate((video: HTMLVideoElement) => !video.paused && video.readyState >= 3)).toBe(true);
  await selectApi(page, "command", "PlayerAPI.pause");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect.poll(async () => (await page.locator(".api-event-log").textContent())!.includes("PlayerEvent.Paused")).toBe(true);
});

test("destroy and recreate use the application's owner lifecycle", async ({ page }) => {
  await selectApi(page, "command", "PlayerAPI.destroy");
  await page.getByRole("button", { name: "Run API", exact: true }).click();
  await expect(page.locator("#player video")).toHaveCount(0);
  await page.getByRole("button", { name: "Recreate Player", exact: true }).click();
  await expect(page.locator("#player video")).toHaveCount(1);
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
});
