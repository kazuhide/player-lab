import { expect, test } from "@playwright/test";

test("short methods and bilingual feature terms find the intended SDK entries", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("command");
  const search = page.getByRole("searchbox", { name: "Search APIs" });
  const entries = page.getByRole("listbox", { name: "SDK entry", exact: true });
  await search.fill("play");
  await expect(entries.locator("option").first()).toHaveAttribute("value", "PlayerAPI.play");
  await expect(entries).toHaveValue("PlayerAPI.play");
  await search.fill("seek");
  await expect(entries.locator("option").first()).toHaveAttribute("value", "PlayerAPI.seek");
  await search.fill("音量");
  await expect(entries.locator('option[value="PlayerAPI.setVolume"]')).toBeAttached();
  await search.fill("no-such-operation");
  await expect(page.locator(".api-search-status")).toHaveText("No matching items.");
});

test("reverted Web field values clear differences and leave no pending original-panel patch", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const row = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) });
  const input = row.locator("input");
  await input.fill("Changed title"); await input.dispatchEvent("change");
  await expect(row.locator(".config-draft-status")).toHaveText("Before: Applied title → After: Changed title");
  await input.fill("Applied title"); await input.dispatchEvent("change");
  await expect(row.locator(".config-draft-status")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reload the source to apply", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("secret replacements stay visible as redacted differences and exact reverts clear them", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerConfig.key");
  await page.getByRole("listbox", { name: "SDK entry", exact: true }).selectOption("PlayerConfig.key");
  const input = page.locator(".api-explorer-form input[type=text]");
  await input.fill("first-private-value");
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(page.locator(".api-draft-status")).toBeHidden();
  await input.fill("second-private-value");
  await expect(page.locator(".api-draft-status")).toBeVisible();
  await expect(page.locator(".api-draft-status")).toHaveText("Before: [redacted] → After: [redacted]");
  await input.fill("first-private-value");
  await expect(page.locator(".api-draft-status")).toBeHidden();
});

test("callback differences show markers and never execute preview bodies", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerConfig.network.preprocessHttpRequest");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "(type: HttpRequestType, request: HttpRequest) => Promise<HttpRequest>" });
  const body = page.getByRole("textbox", { name: "JavaScript callback body" });
  const first = "window.previewExecuted = 'first'; return Promise.resolve(request);";
  await body.fill(first);
  await page.getByRole("checkbox", { name: "Allow this callback to run in this page after Apply" }).check();
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await page.evaluate(() => window.settingsFixture.resolve());
  await body.fill("window.previewExecuted = 'second'; return Promise.resolve(request);");
  await expect(page.locator(".api-draft-status")).toBeVisible();
  await expect(page.locator(".api-draft-status")).toContainText("[callback]");
  await expect(page.locator(".api-draft-status")).not.toContainText("previewExecuted");
  expect(await page.evaluate(() => Reflect.get(window, "previewExecuted"))).toBeUndefined();
  await body.fill(first);
  await expect(page.locator(".api-draft-status")).toBeHidden();
});
