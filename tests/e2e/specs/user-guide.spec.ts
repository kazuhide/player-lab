import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expectMovingVideo } from "../src/playback-observation";

type Language = "en" | "ja";
interface Setting { scope: string; path: string }
interface SettingGroup { id: string; title: string; fields: Setting[] }
interface GuideDocument { id: string; title: string; groups?: SettingGroup[]; blocks?: { type: string }[] }
interface SearchEntry { kind: string; title: string; url: string }
interface CoverageRow {
  id: string; category: string; scope: string; status: string; deprecated: boolean; officialReference: string;
  evidence: { kind: string; file: string; sha256: string; package?: string; version?: string }[];
}
interface CoverageApplication { id: string; sdkId: string; rows: CoverageRow[] }
interface CoverageReport {
  sourceRevision: string;
  sdks: { id: string; version: string; latestVersion: string; latestCheckedAt: string }[];
  applications: CoverageApplication[];
}
interface HeldHashChanges {
  pending: { oldURL: string; newURL: string }[];
  releaseNext: () => void;
}
declare global {
  interface Window { __guideHashChangeTest?: HeldHashChanges }
}

const languages: Language[] = ["en", "ja"];
const contentRoot = resolve(__dirname, "../../../docs/guide");
const coverage = JSON.parse(readFileSync(resolve(contentRoot, "../api-coverage/coverage.json"), "utf8")) as CoverageReport;
const uiCoverage = coverage.applications.find((app) => app.id === "web-ui")!;
const longUIField = uiCoverage.rows.filter((row) => row.category === "configuration")
  .reduce((longest, row) => row.id.length > longest.id.length ? row : longest);
const content = Object.fromEntries(languages.map((language) => [language,
  Object.fromEntries(readdirSync(resolve(contentRoot, language)).filter((name) => name.endsWith(".json"))
    .map((name) => {
      const document = JSON.parse(readFileSync(resolve(contentRoot, language, name), "utf8")) as GuideDocument;
      return [document.id, document];
    })),
])) as Record<Language, Record<string, GuideDocument>>;
const messages = {
  en: { overview: "User guide", error: "Search could not load. Use the contents or try again.",
    noScript: "The chapters and references work without JavaScript." },
  ja: { overview: "ユーザーガイド", error: "検索データを読み込めませんでした。目次を使うか、もう一度検索してください。",
    noScript: "本文と参照資料はJavaScriptを使わずに読めます。" },
};

function guidePath(language: Language, slug = ""): string {
  return `/player-lab/${language === "ja" ? "ja/" : ""}guide/${slug ? `${slug}/` : ""}`;
}

function groups(language: Language): SettingGroup[] {
  return content[language].settings!.groups!;
}

async function expectProjectLink(page: Page, link: Locator, path: string): Promise<void> {
  const destination = new URL((await link.getAttribute("href"))!, page.url());
  expect(destination.origin).toBe(new URL(page.url()).origin);
  expect(destination.pathname).toBe(path);
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document - dimensions.viewport, JSON.stringify(dimensions)).toBeLessThanOrEqual(1);
}

async function expectCompleteTweakCatalog(page: Page): Promise<void> {
  await expect(page.locator("[data-setting-filter], .guide-settings-filter")).toHaveCount(0);
  await expect(page.locator("article[data-setting]")).toHaveCount(65);
  await expect(page.locator("article[data-setting]:visible")).toHaveCount(65);
}

async function expectHeadingStructure(page: Page): Promise<void> {
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
  const headings = await main.getByRole("heading").evaluateAll((elements) => elements.map((element) => ({
    level: Number(element.tagName.slice(1)), text: element.textContent?.trim(),
  })));
  expect(headings[0]?.level).toBe(1);
  for (let index = 0; index < headings.length; index++) {
    expect(headings[index]?.text).toBeTruthy();
    if (index > 0) expect(headings[index]!.level).toBeLessThanOrEqual(headings[index - 1]!.level + 1);
  }
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press(navigationKey("Tab"));
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

function navigationKey(key: "Tab" | "ArrowRight"): string {
  // macOS WebKit follows the platform's Option-key navigation behavior.
  return process.platform === "darwin" && test.info().project.name === "webkit" ? `Alt+${key}` : key;
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const observed: string[] = [];
  errors.set(page, observed);
  page.on("pageerror", (error) => observed.push(error.message));
});
test.afterEach(({ page }) => {
  expect(errors.get(page), "the static guide must not raise uncaught errors").toEqual([]);
});

for (const language of languages) {
  test.describe(`user guide (${language})`, () => {
    test("the landing call to action, app language and return links stay within the project", async ({ page }) => {
      await page.route(/analytics-ingress[^/]*\.bitmovin\.com/i, (route) => route.fulfill({
        status: 204, headers: { "Access-Control-Allow-Origin": "*" },
      }));
      await page.goto(`/player-lab/${language === "ja" ? "ja/" : ""}`);
      const callToAction = page.locator(".hero .actions").getByRole("link", {
        name: language === "ja" ? "ユーザーガイド" : "User guide", exact: true,
      });
      await expectProjectLink(page, callToAction, guidePath(language));
      await callToAction.click();
      await expect(page).toHaveURL((url) => url.pathname === guidePath(language));
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expectProjectLink(page, page.locator(".guide-header nav a").first(), "/player-lab/web/");
      await page.locator(".guide-header nav a").first().click();
      await expect(page).toHaveURL(/\/player-lab\/web\/$/);
      await page.getByRole("button", { name: language === "ja" ? "日本語" : "English", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expectMovingVideo(page);
      const guide = page.locator("#user-guide-link");
      await expect(guide).toHaveAttribute("hreflang", language);
      await expect(guide).toHaveText(language === "ja" ? "ユーザーガイド" : "User guide");
      const destination = new URL((await guide.getAttribute("href"))!, page.url());
      expect(destination.origin).toBe(new URL(page.url()).origin);
      expect(destination.pathname).toBe(guidePath(language));
      await guide.click();
      await expect(page).toHaveURL((url) => url.pathname === guidePath(language));
      await expect(page.locator("main > h1")).toHaveText(messages[language].overview);
      await expectProjectLink(page, page.locator(".guide-header nav a").first(), "/player-lab/web/");
      await page.locator(".guide-header nav a").first().click();
      await expect(page).toHaveURL(/\/player-lab\/web\/$/);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expectMovingVideo(page);
    });

    test("all chapters and reference routes serve their own localized content", async ({ page }) => {
      const routes = [
        { slug: "", title: messages[language].overview },
        ...Object.values(content[language]).map((document) => ({ slug: document.id, title: document.title })),
        ...groups(language).map((group) => ({ slug: `settings/${group.id}`, title: group.title })),
      ];
      expect(new Set(routes.map((route) => route.slug)).size).toBe(routes.length);
      for (const route of routes) {
        await test.step(route.slug || "overview", async () => {
          const response = await page.goto(guidePath(language, route.slug));
          expect(response?.status()).toBe(200);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(page.locator("main > h1")).toHaveText(route.title);
          await expect(page.locator("[data-guide-search]")).toBeVisible();
          await expectHeadingStructure(page);
        });
      }
    });

    test("all 144 setting identifiers can be found and lead to existing setting articles", async ({ page, request }) => {
      const response = await request.get(`${guidePath(language)}search-index.json`);
      expect(response.status()).toBe(200);
      const index = await response.json() as SearchEntry[];
      const settings = index.filter((entry) => entry.kind === "setting");
      const expected = groups(language).flatMap((group) => group.fields.map((field) => ({
        title: `${field.scope}.${field.path}`, group: group.id, path: field.path,
      })));
      expect(settings).toHaveLength(144);
      expect(settings.map((entry) => entry.title).sort()).toEqual(expected.map((field) => field.title).sort());
      await page.goto(guidePath(language));
      const input = page.locator("[data-guide-search]");
      const results = page.locator("[data-search-results]");
      await input.fill("tweaks");
      await expect(results.locator("a")).toHaveCount(12);
      for (const field of expected) {
        await input.fill(field.title);
        const link = results.locator("a").first();
        await expect(link).toHaveText(field.title);
        const target = new URL((await link.getAttribute("href"))!);
        expect(target.pathname).toBe(guidePath(language, `settings/${field.group}`));
        expect(target.hash).not.toBe("");
      }
      await input.fill("ＰｌａｙｅｒＡＰＩ．ｖｏｌｕｍｅ");
      await expect(results.locator("a").first()).toHaveText("PlayerAPI.volume");
      for (const group of groups(language)) {
        await page.goto(guidePath(language, `settings/${group.id}`));
        const articles = await page.locator("article[data-setting]").evaluateAll((elements) => elements.map((element) => ({
          id: element.id, path: element.querySelector("h2 code")?.textContent,
        })));
        expect(articles.map((article) => article.path).sort()).toEqual(group.fields.map((field) => field.path).sort());
        const targets = settings.filter((entry) => entry.url.startsWith(`settings/${group.id}/#`));
        expect(targets).toHaveLength(group.fields.length);
        for (const entry of targets) expect(articles.map((article) => article.id)).toContain(entry.url.split("#")[1]);
      }
    });

    test("language navigation retains chapter and setting fragments below the sticky header", async ({ page }) => {
      const other: Language = language === "en" ? "ja" : "en";
      await page.goto(guidePath(language, "native-overview"));
      const section = await page.locator("main > h2[id]").nth(1).getAttribute("id");
      await page.goto(`${guidePath(language, "native-overview")}#${section}`);
      await page.locator("a[data-guide-language]").click();
      await expect(page).toHaveURL((url) => url.pathname === guidePath(other, "native-overview") && url.hash === `#${section}`);
      await expect(page.locator("html")).toHaveAttribute("lang", other);
      await expect.poll(() => page.locator(`#${section}`).evaluate((element) => {
        const header = document.querySelector(".guide-header")!;
        const top = element.getBoundingClientRect().top;
        return top >= header.getBoundingClientRect().bottom - 1 && top < window.innerHeight;
      })).toBe(true);
      const nextSection = await page.locator("main > h2[id]").nth(2).getAttribute("id");
      await page.goto(`${guidePath(other, "native-overview")}#${nextSection}`);
      await page.locator("a[data-guide-language]").click();
      await expect(page).toHaveURL((url) => url.pathname === guidePath(language, "native-overview") && url.hash === `#${nextSection}`);
      await page.goto(guidePath(language, "settings/tweaks"));
      const setting = await page.locator("article[data-setting]").nth(10).getAttribute("id");
      await page.goto(`${guidePath(language, "settings/tweaks")}#${setting}`);
      await page.locator("a[data-guide-language]").click();
      await expect(page).toHaveURL((url) => url.pathname === guidePath(other, "settings/tweaks") && url.hash === `#${setting}`);
      await expect(page.locator(`#${setting}`)).toBeVisible();
    });

    test("the complete catalog stays visible while global searches change", async ({ page }) => {
      await page.goto(guidePath(language, "settings/tweaks"));
      await expectCompleteTweakCatalog(page);
      const search = page.locator("[data-guide-search]");
      const results = page.locator("[data-search-results]");
      for (const field of ["max_buffer_level", "stop_download_on_pause"]) {
        const title = `PlayerConfig.tweaks.${field}`;
        await search.fill(title);
        await expect(results.locator("a").first()).toHaveText(title);
        await expectCompleteTweakCatalog(page);
      }
      await search.fill("no-such-setting-8b2d");
      await expect(results).toBeHidden();
      await expectCompleteTweakCatalog(page);
      await search.clear();
      await expect(results.locator("a")).toHaveCount(0);
      await expectCompleteTweakCatalog(page);
    });

    test("setting links support repeated fragments, history and direct navigation", async ({ page }) => {
      const path = guidePath(language, "settings/tweaks");
      await page.goto(path);
      await expectCompleteTweakCatalog(page);
      const search = page.locator("[data-guide-search]");
      const title = "PlayerConfig.tweaks.stop_download_on_pause";
      await search.fill(title);
      const matches = page.locator("[data-search-results]").getByRole("link", { name: title, exact: true });
      await expect(matches).toHaveCount(1 + coverage.applications.filter((app) =>
        app.rows.some((row) => row.id === title)).length);
      const firstId = await page.locator("article[data-setting]").filter({
        has: page.getByRole("heading", { name: "tweaks.stop_download_on_pause", exact: true }),
      }).getAttribute("id");
      expect(firstId).toBeTruthy();
      const expected = new URL(`#${firstId}`, page.url());
      const result = page.locator(`[data-search-results] a[href="${expected.href}"]`);
      await expect(result).toHaveText(title);
      await expect(result).toBeVisible();
      const first = new URL((await result.getAttribute("href"))!, page.url());
      const secondId = await page.locator("article[data-setting]").filter({
        has: page.getByRole("heading", { name: "tweaks.max_buffer_level", exact: true }),
      }).getAttribute("id");
      const second = new URL(`#${secondId}`, first);
      const expectAtFragment = async (destination: URL): Promise<void> => {
        await expect(page).toHaveURL(destination.href);
        await expectCompleteTweakCatalog(page);
        const target = page.locator(`article[id="${destination.hash.slice(1)}"]`);
        await expect(target).toBeVisible();
        await expect.poll(() => target.evaluate((element) => {
          const top = element.getBoundingClientRect().top;
          return top >= document.querySelector(".guide-header")!.getBoundingClientRect().bottom - 1 && top < window.innerHeight;
        })).toBe(true);
      };
      await result.click();
      await expectAtFragment(first);
      await search.fill("PlayerConfig.tweaks.stop_download_on_pause");
      await result.click();
      await expectAtFragment(first);
      await page.goto(second.href);
      await expectAtFragment(second);
      await page.goBack();
      await expectAtFragment(first);
      await page.goForward();
      await expectAtFragment(second);
    });

    test("delayed fragment events preserve the latest search and reading position", async ({ page }) => {
      await page.addInitScript(() => {
        const pending: { oldURL: string; newURL: string }[] = [];
        let replaying = false;
        window.__guideHashChangeTest = {
          pending,
          releaseNext: () => {
            const event = pending.shift();
            if (!event) throw new Error("No captured hashchange is ready.");
            replaying = true;
            try {
              window.dispatchEvent(new HashChangeEvent("hashchange", event));
            } finally {
              replaying = false;
            }
          },
        };
        window.addEventListener("hashchange", (event) => {
          if (replaying) return;
          event.stopImmediatePropagation();
          pending.push({ oldURL: event.oldURL, newURL: event.newURL });
        }, true);
      });
      const path = guidePath(language, "settings/tweaks");
      const thirdField = "tweaks.segment_encryption_transition_handling";
      const scenarios = ["one search navigation", "repeated search navigation", "mixed repeated navigation"] as const;
      for (const scenario of scenarios) {
        await test.step(scenario, async () => {
          await page.goto(path);
          await page.reload();
          const search = page.locator("[data-guide-search]");
          const results = page.locator("[data-search-results]");
          const thirdId = await page.locator("article[data-setting]").filter({
            has: page.getByRole("heading", { name: thirdField, exact: true }),
          }).getAttribute("id");
          if (scenario === "mixed repeated navigation") {
            await page.goto(`${path}#${thirdId}`);
            await page.reload();
          }
          const transitions: { oldURL: string; newURL: string }[] = [];
          const selectSetting = async (field: string): Promise<URL> => {
            const title = `PlayerConfig.tweaks.${field}`;
            await search.fill(title);
            const id = await page.locator("article[data-setting]").filter({
              has: page.getByRole("heading", { name: `tweaks.${field}`, exact: true }),
            }).getAttribute("id");
            expect(id).toBeTruthy();
            const expected = new URL(`#${id}`, page.url());
            const result = results.locator(`a[href="${expected.href}"]`);
            await expect(result).toHaveText(title);
            await expect(result).toBeVisible();
            const destination = new URL((await result.getAttribute("href"))!, page.url());
            const oldURL = page.url();
            await result.click();
            await expect(page).toHaveURL(destination.href);
            transitions.push({ oldURL, newURL: destination.href });
            return destination;
          };
          const navigateDirectly = async (destination: URL): Promise<void> => {
            const oldURL = page.url();
            await page.goto(destination.href);
            await expect(page).toHaveURL(destination.href);
            transitions.push({ oldURL, newURL: destination.href });
          };
          const firstId = await page.locator("article[data-setting]").filter({
            has: page.getByRole("heading", { name: "tweaks.stop_download_on_pause", exact: true }),
          }).getAttribute("id");
          let final = new URL(`#${firstId}`, page.url());
          if (scenario === "mixed repeated navigation") await navigateDirectly(final);
          else final = await selectSetting("stop_download_on_pause");
          if (scenario !== "one search navigation") {
            await selectSetting("max_buffer_level");
            if (scenario === "mixed repeated navigation") await navigateDirectly(new URL(`#${thirdId}`, page.url()));
            final = await selectSetting("stop_download_on_pause");
          }
          await expect.poll(() => page.evaluate(() => window.__guideHashChangeTest!.pending.length)).toBe(transitions.length);
          expect(await page.evaluate(() => window.__guideHashChangeTest!.pending)).toEqual(transitions);
          await search.fill("PlayerAPI.volume");
          await expect(results.locator("a").first()).toHaveText("PlayerAPI.volume");
          await page.locator(`article[id="${thirdId}"]`).scrollIntoViewIfNeeded();
          const readingPosition = await page.evaluate(() => window.scrollY);
          for (let index = 0; index < transitions.length; index++) {
            await page.evaluate(() => window.__guideHashChangeTest!.releaseNext());
            await expect(page).toHaveURL(final.href);
            await expectCompleteTweakCatalog(page);
            await expect(search).toHaveValue("PlayerAPI.volume");
            await expect(results.locator("a").first()).toHaveText("PlayerAPI.volume");
            const languageURL = new URL((await page.locator("a[data-guide-language]").getAttribute("href"))!, page.url());
            expect(languageURL.hash).toBe(final.hash);
            expect(Math.abs(await page.evaluate(() => window.scrollY) - readingPosition)).toBeLessThanOrEqual(1);
          }
          expect(await page.evaluate(() => window.__guideHashChangeTest!.pending.length)).toBe(0);
        });
      }
    });

    test("a failed search index can be retried through the next input", async ({ page }) => {
      let attempts = 0;
      await page.route("**/search-index.json", async (route) => {
        attempts++;
        if (attempts === 1) await route.fulfill({ status: 503, body: "Unavailable" });
        else await route.continue();
      });
      await page.goto(guidePath(language, "native-apple"));
      const input = page.locator("[data-guide-search]");
      const results = page.locator("[data-search-results]");
      await input.fill("PlayerAPI.volume");
      await expect(page.locator("[data-search-status]")).toHaveText(messages[language].error);
      await expect(results).toBeHidden();
      await expect(page.locator("[data-guide-search-container]")).not.toHaveAttribute("aria-busy", "true");
      await input.fill("PlayerAPI.mute");
      await expect(results.locator("a").first()).toHaveText("PlayerAPI.mute");
      expect(attempts).toBe(2);
      await expect(page.locator("[data-search-status]")).not.toHaveText(messages[language].error);
    });

    test("a held index response only publishes results for the latest input", async ({ page }) => {
      let release!: () => void;
      let started!: () => void;
      const held = new Promise<void>((resolveRequest) => { release = resolveRequest; });
      const requested = new Promise<void>((resolveRequest) => { started = resolveRequest; });
      await page.route("**/search-index.json", async (route) => {
        started();
        await held;
        await route.continue();
      });
      await page.goto(guidePath(language));
      const input = page.locator("[data-guide-search]");
      const results = page.locator("[data-search-results]");
      await input.fill("PlayerAPI.volume");
      await requested;
      await expect(page.locator("[data-guide-search-container]")).toHaveAttribute("aria-busy", "true");
      await input.fill("PlayerAPI.mute");
      release();
      await expect(results.locator("a").first()).toHaveText("PlayerAPI.mute");
      await expect(results.getByRole("link", { name: "PlayerAPI.volume", exact: true })).toHaveCount(0);
      await expect(page.locator("[data-guide-search-container]")).not.toHaveAttribute("aria-busy", "true");
      await input.fill("x");
      await expect(results).toBeHidden();
      await expect(results.locator("a")).toHaveCount(0);
      await expect(page.locator("[data-search-status]")).toBeEmpty();
    });

    test("skip navigation and the mobile contents work with the keyboard", async ({ page }) => {
      await page.goto(guidePath(language, "start"));
      await page.keyboard.press(navigationKey("Tab"));
      await expect(page.locator(".skip-link")).toBeFocused();
      await expect(page.locator(".skip-link")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toBeFocused();
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(guidePath(language));
      await page.keyboard.press(navigationKey("Tab"));
      const skip = page.locator(".skip-link");
      await expect(skip).toBeFocused();
      const hit = await skip.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return { unobscured: top !== null && (top === element || element.contains(top)),
          topTag: top?.tagName, topClass: top?.getAttribute("class"), bounds: bounds.toJSON() };
      });
      expect(hit.unobscured, JSON.stringify(hit)).toBe(true);
      const summary = page.locator(".guide-mobile-contents > summary");
      await tabTo(page, summary);
      await expect(summary).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await expect(page.locator(".guide-mobile-contents")).toHaveAttribute("open", "");
      await page.keyboard.press(navigationKey("Tab"));
      const firstChapter = page.locator(".guide-mobile-contents nav a").first();
      await expect(firstChapter).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL((url) => url.pathname === guidePath(language, "start"));
      await expect(page.locator("main > h1")).toHaveText(content[language].start!.title);
    });

    for (const width of [320, 375, 768, 1024, 1440]) {
      test(`long text, code, tables and images fit a ${width}px document`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        for (const slug of ["start", "native-apple", "native-android", "native-integrations", "cloud-encoding", "settings/tweaks", "controls", "themes",
          "api-coverage", "api-coverage/web-ui"]) {
          await test.step(slug, async () => {
            await page.goto(guidePath(language, slug));
            await expectNoDocumentOverflow(page);
            await expectHeadingStructure(page);
            if ((slug === "settings/tweaks" && [320, 1440].includes(width))
                || (slug === "api-coverage" && width === 1440)
                || (slug === "api-coverage/web-ui" && width === 320)) {
              if (slug === "api-coverage/web-ui") {
                const anchor = await page.locator("[data-api-id]").evaluateAll((elements, id) =>
                  elements.find((element) => element.getAttribute("data-api-id") === id)?.id, longUIField.id);
                expect(anchor).toMatch(/^api-[a-f0-9]+$/);
                await page.goto(`${guidePath(language, slug)}#${anchor}`);
                await expect(page.locator(`#${anchor}`)).toHaveText(longUIField.id);
                const lines = await page.locator(`#${anchor}`).evaluate((element) => {
                  const range = document.createRange();
                  range.selectNodeContents(element);
                  return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
                });
                expect(lines, "Long API identifiers remain on one line inside the scrollable table").toBe(1);
                await expectNoDocumentOverflow(page);
              }
              const name = `guide-${language}-${width}-${slug.replaceAll("/", "-")}`;
              const image = testInfo.outputPath(`${name}.png`);
              await page.screenshot({ path: image });
              await testInfo.attach(name, { path: image, contentType: "image/png" });
            }
          });
        }
      });
    }
  });
}

test("localized guide figures and representative theme images decode", async ({ page }) => {
  for (const language of languages) {
    for (const slug of ["start", "web-sources-tracks", "web-player-config", "themes", "native-apple", "native-android"]) {
      await page.goto(guidePath(language, slug));
      const images = slug === "themes"
        ? page.locator("#default img, #custom-premiere img")
        : page.locator(".guide-figure img");
      const expected = slug === "themes" ? 2
        : content[language][slug]!.blocks!.filter((block) => block.type === "figure").length;
      expect(expected).toBeGreaterThan(0);
      await expect(images).toHaveCount(expected);
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        // Firefox can reject decode() before a lazy image request has started.
        await expect.poll(() => image.evaluate((element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0)).toBe(true);
        const decoded = await image.evaluate(async (element: HTMLImageElement) => {
          await element.decode();
          return { complete: element.complete, width: element.naturalWidth, height: element.naturalHeight, src: element.currentSrc };
        });
        expect(decoded.complete).toBe(true);
        expect(decoded.width).toBeGreaterThan(0);
        expect(decoded.height).toBeGreaterThan(0);
        expect(new URL(decoded.src).pathname).toMatch(/^\/player-lab\/assets\/guide\/[^/]+\.jpg$/);
        await expect(image).toHaveAttribute("width", String(decoded.width));
        await expect(image).toHaveAttribute("height", String(decoded.height));
        if (slug.startsWith("native-")) {
          const fullSize = image.locator("..");
          await expect(fullSize).toHaveAttribute("href", await image.getAttribute("src") as string);
          await expect(fullSize).toHaveAccessibleName(/\S/);
        }
      }
      if (slug.startsWith("native-")) {
        const fullSize = images.first().locator("..");
        const destination = new URL((await fullSize.getAttribute("href"))!, page.url()).href;
        const width = Number(await images.first().getAttribute("width"));
        await fullSize.click();
        await expect(page).toHaveURL(destination);
        await expect(page.locator("img")).toHaveJSProperty("naturalWidth", width);
      }
    }
  }
});

test.describe("guide without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const language of languages) {
    test(`${language} API inventories contain every report row and native evidence without JavaScript`, async ({ page }, testInfo) => {
      await page.goto(guidePath(language, "api-coverage"));
      await expect(page.locator("[data-guide-search-container]")).toBeHidden();
      const revision = page.getByRole("link", { name: coverage.sourceRevision, exact: true });
      await expect(revision).toHaveAttribute("href", `https://github.com/kazuhide/player-lab/tree/${coverage.sourceRevision}`);
      const versions = await page.locator("#versions + .guide-table tbody tr").evaluateAll((rows) => rows.map((row) => {
        const cells = row.querySelectorAll("td");
        return [cells[1]?.textContent?.trim(), cells[2]?.textContent?.trim(), cells[4]?.textContent?.trim()].join("|");
      }));
      expect(versions.sort()).toEqual(coverage.sdks.map((sdk) =>
        [sdk.version, sdk.latestVersion, sdk.latestCheckedAt].join("|")).sort());
      expect(coverage.applications.map((app) => app.id).sort())
        .toEqual(["web", "web-ui", "ios", "tvos", "android", "react-native", "vega"].sort());
      const expectConfigurationCounts = async (apps: typeof coverage.applications): Promise<void> => {
        const table = page.getByRole("region", { name: language === "ja" ? "設定" : "Configuration", exact:true });
        await expect(table.locator("thead th")).toHaveText(language === "ja"
          ? ["アプリ", "対象API ID数", "設定APIの使用数", "GUIで個別変更", "GUIで候補選択", "コード内のみ"]
          : ["Application", "Available IDs", "Configuration APIs used", "Individual GUI edit", "GUI preset", "Code only"]);
        const cells = await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) =>
          Array.from(row.querySelectorAll("td")).slice(1).map((cell) => cell.textContent?.trim())));
        expect(cells).toEqual(apps.map((app) => {
          const rows = app.rows.filter((row) => row.category === "configuration");
          const direct = rows.filter((row) => row.status === "direct").length;
          const preset = rows.filter((row) => row.status === "preset").length;
          const code = rows.filter((row) => row.status === "code-only").length;
          const used = direct + preset + code;
          return [String(rows.length), `${used} / ${rows.length} · ${(100 * used / rows.length).toFixed(2)}%`,
            String(direct), String(preset), String(code)];
        }));
      };
      await expectConfigurationCounts(coverage.applications);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height:900 });
        const table = page.getByRole("region", { name: language === "ja" ? "設定" : "Configuration", exact:true });
        const layout = await table.evaluate((element) => ({
          scrollWidth:element.scrollWidth, clientWidth:element.clientWidth,
          nowrap:Array.from(element.querySelectorAll("th, td")).every((cell) => getComputedStyle(cell).whiteSpace === "nowrap"),
        }));
        expect(layout.nowrap).toBe(true);
        if (width === 375) {
          expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
          await table.focus();
          await page.keyboard.press(navigationKey("ArrowRight"));
          await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        }
        await expectNoDocumentOverflow(page);
      }
      for (const app of coverage.applications) {
        await test.step(app.id, async () => {
          const response = await page.goto(guidePath(language, `api-coverage/${app.id}`));
          expect(response?.status()).toBe(200);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(page.locator("[data-api-id]:visible")).toHaveCount(app.rows.length);
          const sdk = coverage.sdks.find((item) => item.id === app.sdkId)!;
          await expect(page.locator("main > p code").first()).toHaveText(sdk.version);
          await expectConfigurationCounts([app]);
          const rows = await page.locator("[data-api-id]").evaluateAll((elements) => elements.map((element) => {
            const row = element.closest("tr")!;
            const group = element.closest("details.guide-api-group")!;
            let heading = group.previousElementSibling;
            while (heading && heading.tagName !== "H2") heading = heading.previousElementSibling;
            return { id:element.getAttribute("data-api-id")!, anchor:element.id, category:heading?.id,
              scope:row.children[1]?.textContent?.trim(), status:row.querySelector("[data-api-status]")?.getAttribute("data-api-status"),
              deprecated:row.children[3]?.textContent?.trim(),
              reference:row.querySelector("td:last-child > a")?.getAttribute("href") };
          }));
          expect(new Set(rows.map((row) => row.id)).size).toBe(app.rows.length);
          expect(Object.fromEntries(rows.map(({ anchor, ...row }) => [row.id, row])))
            .toEqual(Object.fromEntries(app.rows.map((row) => [row.id,
              { id:row.id, category:row.category, scope:row.scope, status:row.status,
                deprecated:language === "ja" ? (row.deprecated ? "該当" : "非該当") : (row.deprecated ? "Yes" : "No"),
                reference:row.officialReference }])));
          for (const category of new Set(app.rows.map((row) => row.category))) {
            await expect(page.locator(`main > h2[id="${category}"]`)).toHaveCount(1);
          }
          const scopeRows = await page.locator("#scopes + .guide-table tbody tr").evaluateAll((elements) =>
            elements.map((row) => row.querySelector("td:first-child code")?.textContent));
          expect(scopeRows.sort()).toEqual([...new Set(app.rows.map((row) => row.scope))].sort());
          for (const row of rows) expect(row.anchor).toMatch(/^api-[a-f0-9]+$/);
          await expectNoDocumentOverflow(page);
          if (app.id === "ios") {
            const image = testInfo.outputPath(`api-coverage-${language}-native.png`);
            await page.screenshot({ path: image });
            await testInfo.attach(`api-coverage-${language}-native`, { path: image, contentType: "image/png" });
            const native = app.rows.flatMap((row) => row.evidence.filter((item) =>
              item.kind === "sdk" && item.file.includes("%3A")).map((evidence) => ({ row, evidence })))[0]!;
            const anchor = rows.find((row) => row.id === native.row.id)!.anchor;
            const proof = page.locator(`#${anchor}`).locator("xpath=ancestor::tr").locator("details.guide-evidence");
            await proof.locator("summary").focus();
            await page.keyboard.press("Enter");
            await expect(proof).toHaveAttribute("open", "");
            await expect(proof.getByText(`${native.evidence.package}@${native.evidence.version} / ${native.evidence.file}`,
              { exact:true })).toBeVisible();
            await expect(proof.getByText(native.evidence.sha256, { exact:true })).toBeVisible();
            const proofLinks = await proof.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
            expect(proofLinks.every((href) => href?.startsWith(
              `https://github.com/kazuhide/player-lab/blob/${coverage.sourceRevision}/`))).toBe(true);
          }
        });
      }
    });

    test(`${language} content and references remain navigable`, async ({ page }) => {
      await page.goto(guidePath(language));
      await expect(page.locator("noscript p")).toContainText(messages[language].noScript);
      await expect(page.locator("noscript p")).toBeVisible();
      await expect(page.locator("[data-guide-search-container]")).toBeHidden();
      const firstChapter = page.locator(".guide-sidebar a").filter({ hasText: content[language].start!.title });
      await firstChapter.click();
      await expect(page.locator("main > h1")).toHaveText(content[language].start!.title);
      await expect(page.locator("main > ol li")).toHaveCount(4);
      await page.goto(guidePath(language, "settings/tweaks"));
      await expectCompleteTweakCatalog(page);
      await expectHeadingStructure(page);
      await expectNoDocumentOverflow(page);
    });
  }
});

test("API search, bilingual fragments and table disclosure work with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width:375, height:900 });
  const android = coverage.applications.find((app) => app.id === "android")!;
  const targetRow = android.rows.filter((row) => row.category === "configuration")
    .reduce((longest, row) => row.id.length > longest.id.length ? row : longest);
  for (const language of languages) {
    await page.goto(guidePath(language, "api-coverage"));
    await page.locator("[data-guide-search]").fill(targetRow.id);
    const result = page.locator("[data-search-results]").getByRole("link", { name:targetRow.id, exact:true });
    await expect(result).toBeVisible();
    const destination = new URL((await result.getAttribute("href"))!, page.url());
    expect(destination.pathname).toBe(guidePath(language, "api-coverage/android"));
    expect(destination.hash).toMatch(/^#api-[a-f0-9]+$/);
    await result.click();
    await expect(page).toHaveURL(destination.href);
    const target = page.locator(destination.hash);
    await expect(target).toHaveAttribute("data-api-id", targetRow.id);
    await expect.poll(() => target.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return top >= document.querySelector(".guide-header")!.getBoundingClientRect().bottom - 1 && top < innerHeight;
    })).toBe(true);
    const group = target.locator("xpath=ancestor::details[contains(@class, 'guide-api-group')]");
    await group.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(group).not.toHaveAttribute("open", "");
    await expect(target).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("open", "");
    await expect(target).toBeVisible();
    const region = group.locator(".guide-coverage-table");
    expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await region.focus();
    await page.keyboard.press(navigationKey("ArrowRight"));
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expectNoDocumentOverflow(page);
    await page.locator("a[data-guide-language]").click();
    const other = language === "en" ? "ja" : "en";
    await expect(page).toHaveURL((url) => url.pathname === guidePath(other, "api-coverage/android")
      && url.hash === destination.hash);
    await expect(target).toHaveAttribute("data-api-id", targetRow.id);
    await expect.poll(() => target.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      return top >= document.querySelector(".guide-header")!.getBoundingClientRect().bottom - 1 && top < innerHeight;
    })).toBe(true);
  }
});
