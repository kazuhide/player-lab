import { expect, test, type Page } from "@playwright/test";
import { PROFILE_STORAGE_KEY } from "../../../apps/web/src/configurationProfiles";

const errors = new WeakMap<Page, string[]>();
interface StoredRecord { schemaVersion: number; platform: string; profiles: { id: string; sdkVersion: string; values: Record<string, unknown> }[] }
test.beforeEach(({ page }) => { const observed: string[] = []; errors.set(page, observed); page.on("pageerror", error => observed.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });
async function openProfiles(page: Page): Promise<void> { await page.locator(".config-profiles > summary").click(); }
async function field(page: Page, label: RegExp) {
  const row = page.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: label }) });
  await row.locator("..").locator("..").evaluate(element => { if (element instanceof HTMLDetailsElement) element.open = true; });
  return row.locator("input,select");
}
const name = (page: Page) => page.locator(".config-profiles input");
const selector = (page: Page) => page.locator(".config-profiles select");
const status = (page: Page) => page.locator(".config-profile-status");
async function storage(page: Page): Promise<string> { return page.evaluate(key => localStorage.getItem(key) ?? "", PROFILE_STORAGE_KEY); }

test("profiles save and restore through existing drafts, survive restart and delete independently", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  const autoplay = await field(page, /^autoplay\b/); await autoplay.uncheck();
  const offset = await field(page, /^options.startOffset \(s\)/); await offset.fill("-7"); await offset.dispatchEvent("change");
  await name(page).fill("Baseline"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status(page)).toContainText("Saved the supported basic settings");
  const saved = JSON.parse(await storage(page));
  expect(saved.profiles).toHaveLength(1); expect(saved.profiles[0].values["PlayerConfig.playback.autoplay"]).toBe(false);
  expect(saved.profiles[0].values["SourceConfig.options.startOffset"]).toBe(-7);
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await autoplay.check(); await offset.fill("22"); await offset.dispatchEvent("change");
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(autoplay).not.toBeChecked(); await expect(offset).toHaveValue("-7");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.reload(); await openProfiles(page);
  await expect(selector(page)).toHaveValue(""); await expect(page.getByRole("button", { name: "Restore draft", exact: true })).toBeDisabled();
  const restartedAutoplay = await field(page, /^autoplay\b/); const restartedOffset = await field(page, /^options.startOffset \(s\)/);
  await expect(restartedAutoplay).toBeChecked(); await expect(restartedOffset).toHaveValue("");
  await selector(page).selectOption(saved.profiles[0].id);
  await expect(restartedAutoplay).toBeChecked(); await expect(restartedOffset).toHaveValue("");
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(restartedAutoplay).not.toBeChecked(); await expect(restartedOffset).toHaveValue("-7");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect(JSON.parse(await storage(page)).profiles).toHaveLength(0);
  await expect(restartedOffset).toHaveValue("-7"); expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.reload(); await openProfiles(page); await expect(selector(page).locator("option")).toHaveCount(1);
});

test("unsupported source text, URLs and detailed callback drafts are excluded and preserved on restoration", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  const title = await field(page, /^title\b/); await title.fill("PRIVATE_SENTINEL"); await title.dispatchEvent("change");
  const poster = await field(page, /^poster \(URL\)/); await poster.fill("https://user:PRIVATE_SENTINEL@example.invalid/image?token=PRIVATE_SENTINEL#PRIVATE_SENTINEL"); await poster.dispatchEvent("change");
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerConfig.network.preprocessHttpRequest");
  await page.locator(".api-explorer-form > .api-value > select").selectOption({ label: "(type: HttpRequestType, request: HttpRequest) => Promise<HttpRequest>" });
  const callback = page.getByRole("textbox", { name: "JavaScript callback body" }); await callback.fill("return PRIVATE_SENTINEL;");
  await name(page).fill("Private fields omitted"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status(page)).toContainText("Saved the supported"); expect(await storage(page)).not.toContain("PRIVATE_SENTINEL");
  expect(await storage(page)).not.toMatch(/preprocessHttpRequest|SourceConfig\.poster|SourceConfig\.title|licenseKey|Authorization/);
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(title).toHaveValue("PRIVATE_SENTINEL");
  await expect(poster).toHaveValue(/PRIVATE_SENTINEL/); await expect(callback).toHaveValue("return PRIVATE_SENTINEL;");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("restoration clears absent supported fields and saved unsets while preserving excluded drafts", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  await name(page).fill("Unset baseline"); await page.getByRole("button", { name: "Save", exact: true }).click();
  const record = JSON.parse(await storage(page));
  expect(record.profiles[0].values["SourceConfig.options.startOffset"]).toBeNull();
  delete record.profiles[0].values["PlayerConfig.playback.autoplay"];
  delete record.profiles[0].values["PlayerConfig.logs.level"];
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROFILE_STORAGE_KEY, value: JSON.stringify(record) });
  const offset = await field(page, /^options.startOffset \(s\)/); await offset.fill("19"); await offset.dispatchEvent("change");
  const title = await field(page, /^title\b/); await title.fill("Excluded draft"); await title.dispatchEvent("change");
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await expect(offset).toHaveValue(""); await expect(title).toHaveValue("Excluded draft");
  await expect(await field(page, /^autoplay\b/)).toHaveJSProperty("indeterminate", true);
  const logs = page.locator(".config-band-static .config-group").filter({ has: page.locator(".config-group-title", { hasText: /^Logs$/ }) });
  await logs.locator("summary").click();
  await expect(logs.locator(".config-field").filter({ has: page.locator(".config-field-label", { hasText: /^level\b/ }) }).locator("select")).toHaveValue("");
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.getByRole("button", { name: "Recreate the player to apply", exact: true }).click();
  expect(await page.evaluate(() => {
    const submitted = window.settingsFixture.submissions[0]?.value as { playback?: { autoplay?: boolean }; logs?: { level?: string } };
    return submitted?.playback && Object.prototype.hasOwnProperty.call(submitted.playback, "autoplay") && submitted.playback.autoplay === undefined
      && submitted.logs && Object.prototype.hasOwnProperty.call(submitted.logs, "level") && submitted.logs.level === undefined;
  })).toBe(true);
  await page.evaluate(() => window.settingsFixture.reject());
  await expect(page.locator(".config-band-static [role=status]")).toContainText("Fixture load failed");
  await expect(await field(page, /^autoplay\b/)).toHaveJSProperty("indeterminate", true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Replace configuration", exact: true }).click();
  expect(JSON.parse(await storage(page)).profiles[0].values["PlayerConfig.playback.autoplay"]).toBeNull();
  await page.locator(".config-band-static").getByRole("button", { name: "Reset draft", exact: true }).click();
  await expect(await field(page, /^autoplay\b/)).toHaveJSProperty("indeterminate", false);
  await expect(title).toHaveValue("Excluded draft");
});

for (const [description, mutate, message] of [
  ["old schema", (value: StoredRecord) => { value.schemaVersion = 0; }, "format"],
  ["future schema", (value: StoredRecord) => { value.schemaVersion = 2; }, "format"],
  ["other platform", (value: StoredRecord) => { value.platform = "android"; }, "another platform"],
  ["unsupported field", (value: StoredRecord) => { value.profiles[0]!.values["PlayerConfig.key"] = "PRIVATE_SENTINEL"; }, "unsupported"],
] as const) test(`stored ${description} is rejected visibly without restoring or overwriting it`, async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page); await name(page).fill("Baseline");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(status(page)).toContainText("Saved the supported");
  const record = JSON.parse(await storage(page)); mutate(record); const invalid = JSON.stringify(record);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROFILE_STORAGE_KEY, value: invalid });
  await page.reload(); await openProfiles(page);
  await expect(status(page)).toContainText(message); await expect(status(page)).not.toContainText("PRIVATE_SENTINEL");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Restore draft", exact: true })).toBeDisabled();
  expect(await storage(page)).toBe(invalid); expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.getByRole("button", { name: "Clear saved profiles", exact: true }).click();
  expect(await storage(page)).toBe(""); await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("a different SDK version requires confirmation before restoring only a draft", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page); await name(page).fill("Older SDK");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(status(page)).toContainText("Saved the supported");
  const record = JSON.parse(await storage(page)); record.profiles[0].sdkVersion = "8.280.0";
  record.profiles[0].values["PlayerConfig.playback.autoplay"] = false;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROFILE_STORAGE_KEY, value: JSON.stringify(record) });
  await page.reload(); await openProfiles(page); await selector(page).selectOption(record.profiles[0].id);
  await expect(status(page)).toContainText("Saved with SDK 8.280.0");
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Revalidate and restore", exact: true });
  await expect(confirm).toBeVisible();
  await expect(await field(page, /^autoplay\b/)).toBeChecked();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(await field(page, /^autoplay\b/)).toBeChecked();
  await page.getByRole("button", { name: "Restore draft", exact: true }).click();
  await confirm.click();
  await expect(status(page)).toContainText("Validated SDK 8.280.0");
  await expect(await field(page, /^autoplay\b/)).not.toBeChecked();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("replacing a saved name requires confirmation and cancellation preserves stored data and drafts", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  await name(page).fill("Baseline"); await page.getByRole("button", { name: "Save", exact: true }).click();
  const original = await storage(page);
  const autoplay = await field(page, /^autoplay\b/); await autoplay.uncheck();
  await name(page).fill("baseline"); await page.getByRole("button", { name: "Save", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Replace configuration", exact: true });
  await expect(confirm).toBeVisible(); expect(await storage(page)).toBe(original);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await storage(page)).toBe(original); await expect(autoplay).not.toBeChecked();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await confirm.click();
  const replaced = JSON.parse(await storage(page)); const before = JSON.parse(original);
  expect(replaced.profiles).toHaveLength(1); expect(replaced.profiles[0].id).toBe(before.profiles[0].id);
  expect(replaced.profiles[0].values["PlayerConfig.playback.autoplay"]).toBe(false);
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

for (const kind of ["replacement", "SDK restoration"] as const) test(`a pending ${kind} cannot overwrite newer stored data`, async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page); await name(page).fill("Baseline");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  if (kind === "SDK restoration") {
    const older = JSON.parse(await storage(page)); older.profiles[0].sdkVersion = "8.280.0";
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROFILE_STORAGE_KEY, value: JSON.stringify(older) });
    await page.reload(); await openProfiles(page); await selector(page).selectOption(older.profiles[0].id);
  }
  const autoplay = await field(page, /^autoplay\b/); await autoplay.uncheck();
  await page.getByRole("button", { name: kind === "replacement" ? "Save" : "Restore draft", exact: true }).click();
  const newer = JSON.parse(await storage(page)); newer.profiles[0].name = "Newer saved data";
  const bytes = JSON.stringify(newer);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: PROFILE_STORAGE_KEY, value: bytes });
  await page.getByRole("button", { name: kind === "replacement" ? "Replace configuration" : "Revalidate and restore", exact: true }).click();
  await expect(status(page)).toContainText("unsupported"); expect(await storage(page)).toBe(bytes);
  await expect(autoplay).not.toBeChecked(); expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("Japanese confirmation uses the existing controls and Escape cancels without changing data", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await page.evaluate(() => window.settingsFixture.language("ja"));
  await openProfiles(page); await name(page).fill("ソース");
  await page.getByRole("button", { name: "保存", exact: true }).click(); const original = await storage(page);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "操作の確認", exact: true });
  await expect(confirmation).toBeVisible(); await expect(confirmation.getByRole("button", { name: "設定を置き換える", exact: true })).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "キャンセル", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(confirmation).toBeHidden();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeFocused(); expect(await storage(page)).toBe(original);
});

test("an absent configured value is saved as unset rather than the form's fallback checkbox value", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page); await name(page).fill("SDK defaults");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = JSON.parse(await storage(page));
  expect(saved.profiles[0].values["PlayerConfig.playback.autoplay"]).toBeNull();
  expect(saved.profiles[0].values["SourceConfig.options.persistentPoster"]).toBeNull();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("storage denial leaves the rest of the settings usable", async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = function(key) { if (key === "player-lab.web.configuration-profiles.v1") throw new Error("PRIVATE_SENTINEL"); return null; }; });
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  await expect(status(page)).toContainText("Browser storage is unavailable"); await expect(status(page)).not.toContainText("PRIVATE_SENTINEL");
  const offset = await field(page, /^options.startOffset \(s\)/); await offset.fill("3"); await offset.dispatchEvent("change");
  await expect(page.getByRole("button", { name: "Reload the source to apply", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});

test("invalid names do not write profiles and a valid name can be saved afterward", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page);
  for (const invalid of ["", "a".repeat(49)]) {
    await name(page).fill(invalid); await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(status(page)).toContainText("1–48 characters"); expect(await storage(page)).toBe("");
  }
  await name(page).fill("Valid name"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status(page)).toContainText("Saved the supported"); expect(JSON.parse(await storage(page)).profiles).toHaveLength(1);
});

test("pending Apply blocks profile mutations and a quota failure does not invent persistence", async ({ page }) => {
  await page.goto("/settings-fixture.html"); await openProfiles(page); await name(page).fill("Baseline");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(status(page)).toContainText("Saved the supported");
  const saved = await storage(page);
  const offset = await field(page, /^options.startOffset \(s\)/); await offset.fill("4"); await offset.dispatchEvent("change");
  await page.getByRole("button", { name: "Reload the source to apply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore draft", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Restore draft", exact: true }).dispatchEvent("click");
  await expect(offset).toHaveValue("4"); expect(await page.evaluate(() => window.settingsFixture.submissions)).toHaveLength(1);
  await page.evaluate(() => window.settingsFixture.resolve());
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "player-lab.web.configuration-profiles.v1") throw new Error("PRIVATE_SENTINEL"); original.call(this, key, value); }; });
  await name(page).fill("Cannot be saved"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status(page)).toContainText("Browser storage is unavailable"); await expect(status(page)).not.toContainText("PRIVATE_SENTINEL");
  expect(await storage(page)).toBe(saved);
});

test("the real SDK remains unchanged on restoration and receives settings only after explicit Apply", async ({ page }) => {
  let manifests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith(".m3u8")) manifests++; });
  await page.goto("/"); await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4);
  const owner = await page.locator("#player video").elementHandle();
  const forward = await field(page, /^video.forwardduration/); await forward.fill("12"); await forward.dispatchEvent("change");
  await openProfiles(page); await name(page).fill("Buffer comparison"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(status(page)).toContainText("Saved the supported");
  await forward.fill("19"); await forward.dispatchEvent("change"); const before = manifests;
  await page.getByRole("button", { name: "Restore draft", exact: true }).click(); await expect(forward).toHaveValue("12");
  expect(await owner!.evaluate(element => document.querySelector("#player video") === element)).toBe(true); expect(manifests).toBe(before);
  await page.getByRole("button", { name: "Recreate the player to apply", exact: true }).click();
  await expect(page.locator(".config-band-static [role=status]")).toHaveText("Applied.");
  await expect(page.locator("#player video")).toHaveJSProperty("readyState", 4); expect(manifests).toBeGreaterThan(before);
  await page.locator(".api-explorer > summary").click();
  await page.getByRole("combobox", { name: "API category", exact: true }).selectOption("observation");
  await page.getByRole("searchbox", { name: "Search APIs" }).fill("PlayerAPI.getConfig");
  await page.getByRole("listbox", { name: "SDK entry", exact: true }).selectOption("PlayerAPI.getConfig");
  await page.getByRole("button", { name: "Read state", exact: true }).click();
  const config = JSON.parse(await page.locator(".api-result").textContent() ?? "null"); expect(config.buffer.video.forwardduration).toBe(12);
});

for (const language of ["en", "ja"] as const) test(`profile controls keep names and drafts through ${language} localization at mobile width`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 }); await page.goto("/settings-fixture.html");
  await openProfiles(page); await name(page).fill("Evaluation");
  const offset = await field(page, /^options.startOffset \(s\)/); await offset.fill("5"); await offset.dispatchEvent("change");
  await page.evaluate(language => window.settingsFixture.language(language), language);
  await expect(name(page)).toHaveValue("Evaluation"); await expect(offset).toHaveValue("5");
  await page.getByRole("button", { name: language === "ja" ? "保存" : "Save", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(status(page)).toContainText(language === "ja" ? "対象設定を保存" : "Saved the supported");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.settingsFixture.submissions)).toEqual([]);
});
