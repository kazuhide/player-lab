import { expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const observed: string[] = []; errors.set(page, observed);
  page.on("pageerror", error => observed.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function explorer(page: Page, id: string): Promise<void> {
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("searchbox", { name: "Search APIs" }).fill(id);
  await page.getByRole("listbox", { name: "SDK entry", exact: true }).selectOption(id);
}

test("search preserves a typed draft without applying it", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "SourceConfig.title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  const input = page.locator(".api-explorer-form input[type=text]");
  await input.fill("Unapplied title");
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("SourceConfig.titl");
  await expect(input).toHaveValue("Unapplied title");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("entry changes and localization preserve array and invalid-number drafts", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "PlayerConfig.playback.audioCodecPriority");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string[]" });
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator(".api-explorer-form input[type=text]").fill("mp4a.40.2");
  const search = page.getByRole("searchbox", { name: "Search APIs" });
  await search.fill("PlayerConfig.network.defaultRequestTimeout");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "number" });
  await page.locator(".api-explorer-form input[type=text]").fill("not-a-number");
  await page.evaluate(() => window.settingsFixture.language("ja"));
  await expect(page.getByRole("searchbox", { name: "APIを検索" })).toHaveValue("PlayerConfig.network.defaultRequestTimeout");
  await expect(page.locator(".api-explorer-form input[type=text]")).toHaveValue("not-a-number");
  await page.getByRole("searchbox", { name: "APIを検索" }).fill("PlayerConfig.playback.audioCodecPriority");
  await expect(page.locator(".api-explorer-form input[type=text]")).toHaveValue("mp4a.40.2");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("language changes preserve the original panel's unapplied value", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator(".config-code summary")).toHaveText("Show applied configuration code");
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  await input.fill("Keep this draft");
  await input.dispatchEvent("change");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.locator(".config-code summary")).toHaveText("適用済み設定をコードで表示");
  await expect(input).toHaveValue("Keep this draft");
});

test("a failed Apply retains edits and allows retry without a duplicate pending request", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  const apply = page.getByRole("button", { name: "Reload the source to apply", exact: true });
  await input.fill("Retry title");
  await input.dispatchEvent("change");
  await apply.click();
  await expect(apply).toBeDisabled();
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Fixture load failed");
  await page.evaluate(() => window.settingsFixture.refresh());
  await expect(input).toHaveValue("Retry title");
  await expect(apply).toBeEnabled();
  await apply.click();
  expect(await page.evaluate(() => window.settingsFixture.submissions.length)).toBe(2);
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Applied");
});

test("a rejected detailed Apply retains its draft and reports one failed attempt", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "SourceConfig.title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  await page.locator(".api-explorer-form input[type=text]").fill("Detailed retry");
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".api-explorer > [role=status]")).toContainText("Fixture load failed");
  await expect(page.locator(".api-explorer-form input[type=text]")).toHaveValue("Detailed retry");
  expect(await page.evaluate(() => window.settingsFixture.submissions.length)).toBe(1);
});

test("the original panel resets unapplied edits explicitly", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const row = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) });
  await row.locator("input").fill("Unapplied value");
  await row.locator("input").dispatchEvent("change");
  await page.locator(".config-band-dynamic").getByRole("button", { name: "Reset draft", exact: true }).click();
  await expect(row.locator("input")).toHaveValue("Applied title");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("edits during Apply remain drafts and cannot submit a second concurrent request", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  const apply = page.getByRole("button", { name: "Reload the source to apply", exact: true });
  await input.fill("Submitted title"); await input.dispatchEvent("change");
  await apply.click();
  await input.fill("New draft"); await input.dispatchEvent("change");
  await apply.dispatchEvent("click");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(input).toHaveValue("New draft");
  await expect(apply).toBeEnabled();
  await apply.click();
  expect(await page.evaluate(() => window.settingsFixture.submissions[1]?.value)).toEqual({ title: "New draft" });
});

test("old owner completions preserve current edits and report superseded Apply", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "SourceConfig.title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  const input = page.locator(".api-explorer-form input[type=text]");
  await input.fill("Old request");
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await page.evaluate(() => window.settingsFixture.retire());
  await input.fill("Current draft");
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("The player or source changed. Apply again.");
  await expect(input).toHaveValue("Current draft");
  await expect(page.getByRole("button", { name: "Apply setting", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
});

test("raw JSON and callback bodies survive category changes and language switches", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "PlayerConfig.ui");
  await page.locator(".api-explorer-form textarea").fill('{"unfinished":');
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerConfig.network.preprocessHttpRequest");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "(type: HttpRequestType, request: HttpRequest) => Promise<HttpRequest>" });
  await page.getByRole("textbox", { name: "JavaScript callback body" }).fill("return unfinished(");
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("observation");
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("configuration");
  await page.evaluate(() => window.settingsFixture.language("ja"));
  await expect(page.getByRole("textbox", { name: "JavaScriptの関数本体" })).toHaveValue("return unfinished(");
  await page.getByRole("searchbox", { name: "APIを検索" }).fill("PlayerConfig.ui");
  await expect(page.locator(".api-explorer-form textarea")).toHaveValue('{"unfinished":');
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("a superseded original Apply retains the latest draft for another attempt", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  await input.fill("Submitted title"); await input.dispatchEvent("change");
  const apply = page.getByRole("button", { name: "Reload the source to apply", exact: true });
  await apply.click();
  await page.evaluate(() => window.settingsFixture.retire());
  await input.fill("Current title"); await input.dispatchEvent("change");
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(page.locator(".config-band-dynamic [role=status]")).toHaveText("The player or source changed. Apply again.");
  await expect(input).toHaveValue("Current title");
  await apply.click();
  expect(await page.evaluate(() => window.settingsFixture.submissions[1]?.value)).toEqual({ title: "Current title" });
});

test("actual SDK load errors reach both original Apply bands", async ({ page }) => {
  await page.route(/\.m3u8(?:\?|$)/, route => route.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: "invalid HLS manifest" }));
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const title = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) }).locator("input");
  await title.fill("Retry real SDK load"); await title.dispatchEvent("change");
  await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Could not apply settings.");
  await expect(title).toHaveValue("Retry real SDK load");
  const style = page.locator(".config-band-static .config-group").filter({ has: page.locator(".config-field-label", { hasText: /^width/ }) });
  await style.locator("summary").click();
  const width = style.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^width/ }) }).locator("input");
  await width.fill("99%"); await width.dispatchEvent("change");
  await page.getByRole("button", { name: "Recreate the player to apply", exact: true }).click();
  await expect(page.locator(".config-band-static [role=status]")).toContainText("Could not apply settings.");
  await expect(width).toHaveValue("99%");
});

test("settings actions fit narrow and desktop widths", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  const row = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^title/ }) });
  await row.locator("input").fill("Visible unapplied title"); await row.locator("input").dispatchEvent("change");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await row.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(row.locator("input")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`settings-draft-${width}.png`) });
  }
});

test("invalid native number input survives localization until Reset", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  const network = page.locator(".config-band-static .config-group").filter({ has: page.locator(".config-field-label", { hasText: /^defaultRequestTimeout/ }) });
  await network.locator("summary").click();
  const input = network.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^defaultRequestTimeout/ }) }).locator("input");
  await input.click(); await input.pressSequentially("-");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(await input.evaluate(element => element instanceof HTMLInputElement && element.validity.badInput)).toBe(true);
  await page.evaluate(() => window.settingsFixture.language("ja"));
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(await input.evaluate(element => element instanceof HTMLInputElement && element.validity.badInput)).toBe(true);
  await page.locator(".config-band-static").getByRole("button", { name: "編集をリセット", exact: true }).click();
  await expect(input).not.toHaveAttribute("aria-invalid");
  expect(await input.evaluate(element => element instanceof HTMLInputElement && element.validity.badInput)).toBe(false);
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("detailed edits during Apply remain available for Reset and retry", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "SourceConfig.title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  const input = page.locator(".api-explorer-form input[type=text]");
  await input.fill("Submitted title");
  const apply = page.getByRole("button", { name: "Apply setting", exact: true });
  await apply.click();
  await input.fill("Still a draft");
  await apply.dispatchEvent("click");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(input).toHaveValue("Still a draft");
  await page.locator(".api-explorer-form").getByRole("button", { name: "Reset draft", exact: true }).click();
  await expect(page.locator(".api-explorer-form > .api-value > select option:checked")).toHaveText("undefined");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
});

test("an empty array index stays a draft and cannot silently apply to index zero", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "UIConfig.metadata.markers[].title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  await page.locator(".api-explorer-form input[type=text]").fill("Unapplied marker");
  const index = page.getByRole("spinbutton", { name: "Array index 1", exact: true });
  await index.fill("");
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("Choose an array index from 0 to 255.");
  await expect(index).toHaveValue("");
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("UIConfig.metadata.markers");
  await expect(index).toHaveValue("");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("an invalid Remove keeps the existing Apply pending and blocks another submission", async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await explorer(page, "SourceConfig.title");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "string" });
  await page.locator(".api-explorer-form input[type=text]").fill("Pending title");
  await page.getByRole("button", { name: "Apply setting", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("UIConfig.metadata.markers[].title");
  await page.getByRole("spinbutton", { name: "Array index 1", exact: true }).fill("");
  await page.getByRole("button", { name: "Remove this override", exact: true }).click();
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("Choose an array index from 0 to 255.");
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("SourceConfig.title");
  const apply = page.getByRole("button", { name: "Apply setting", exact: true });
  await expect(apply).toBeDisabled();
  await apply.dispatchEvent("click");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(apply).toBeEnabled();
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("Configuration submitted.");
});

for (const scenario of [
  { name: "sibling", path: ["options", "persistentPoster"], value: false, options: { persistentPoster: false, startOffset: 3 } },
  { name: "same path", path: ["options", "startOffset"], value: 22, options: { persistentPoster: true, startOffset: 22 } },
  { name: "parent", path: ["options"], value: { startOffset: 22 }, options: { startOffset: 22 } },
]) test(`basic rollback preserves a newer ${scenario.name} write without replacing the root`, async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await page.evaluate(() => window.settingsFixture.external("SourceConfig", ["options"], { persistentPoster: true, startOffset: 3 }));
  await page.locator("#config details").evaluateAll(nodes => nodes.forEach(node => { if (node instanceof HTMLDetailsElement) node.open = true; }));
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^options.startOffset \(s\)/ }) }).locator("input");
  await input.fill("9"); await input.dispatchEvent("change");
  await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
  await page.evaluate(({ path, value }) => {
    window.settingsFixture.external("SourceConfig", path, value);
    window.settingsFixture.external("SourceConfig", ["description"], "New description");
  }, scenario);
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Fixture load failed");
  expect(await page.evaluate(() => window.settingsFixture.configuration("SourceConfig"))).toEqual({ options: scenario.options, description: "New description" });
});

for (const newerChild of [false, true]) test(`failed basic Apply preserves parent and child override layers when the ${newerChild ? "newer " : ""}child is removed`, async ({ page }) => {
  await page.goto("/settings-fixture.html");
  await page.evaluate(() => {
    window.settingsFixture.external("SourceConfig", ["options"], { persistentPoster: true, startOffset: 3 });
    window.settingsFixture.external("SourceConfig", ["options", "startOffset"], 4);
  });
  await page.locator("#config details").evaluateAll(nodes => nodes.forEach(node => { if (node instanceof HTMLDetailsElement) node.open = true; }));
  const input = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^options.startOffset \(s\)/ }) }).locator("input");
  await input.fill("9"); await input.dispatchEvent("change");
  await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
  if (newerChild) await page.evaluate(() => window.settingsFixture.external("SourceConfig", ["options", "startOffset"], 22));
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".config-band-dynamic [role=status]")).toContainText("Fixture load failed");
  expect(await page.evaluate(() => window.settingsFixture.configuration("SourceConfig"))).toEqual({ options: { persistentPoster: true, startOffset: newerChild ? 22 : 4 } });
  await explorer(page, "SourceConfig.options.startOffset");
  await page.getByRole("button", { name: "Remove this override", exact: true }).click();
  await page.evaluate(() => window.settingsFixture.resolve());
  await expect(page.locator(".api-explorer > [role=status]")).toHaveText("Override removed.");
  expect(await page.evaluate(() => window.settingsFixture.configuration("SourceConfig"))).toEqual({ options: { persistentPoster: true, startOffset: 3 } });
});
