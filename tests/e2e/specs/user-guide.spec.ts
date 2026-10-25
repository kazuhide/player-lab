import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expectMovingVideo } from "../src/playback-observation";

type Language = "en" | "ja";
interface Setting { scope: string; path: string }
interface SettingGroup { id: string; title: string; fields: Setting[] }
interface Control { id: string; group: string; label: string; description: string }
interface GuideDocument {
  id: string; title: string; groups?: SettingGroup[]; controls?: Control[];
  blocks?: { type: string; id?: string; text?: string; summary?: string; items?: string[];
    file?: string; caption?: string; source?: { path: string } }[];
}
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
interface GapReason {
  kind: "implementation" | "input-contract";
  en: { reason: string; action: string };
  ja: { reason: string; action: string };
  references: string[];
}
interface GapReport {
  reasons: Record<string, GapReason>;
  applications: { id: string; groups: { reason: string; apis: string[] }[] }[];
}
interface HeldHashChanges {
  pending: { oldURL: string; newURL: string }[];
  releaseNext: () => void;
}
declare global {
  interface Window { __guideHashChangeTest?: HeldHashChanges }
}

const languages: Language[] = ["en", "ja"];
const implementationGuides = ["web-implementation", "apple-implementation", "android-implementation",
  "react-native-implementation", "vega-implementation"];
const implementationSections = ["integration", "player-source-config", "ui-customization", "useful-features",
  "faq", "analytics-observability"];
// Published fragments use authored IDs or their original English headings in both languages.
const screenGuideSections: Record<string, string[]> = {
  "web-screen-controls": ["screen", "themes", "sources-tracks", "player-source-settings", "sdk-settings",
    "applied-code", "ui-settings", "external-displays"],
  "native-apple": ["preparation-and-build", "suggested-screen-workflow", "edit-source-and-playback-configuration",
    "additional-sdk-settings", "editable-callbacks", "initial-tracks-and-video-scaling", "when-something-does-not-work",
    "use-the-sdk-default-player-controls", "run-apis-and-read-their-results", "choose-the-video-presentation",
    "playlist-drafts", "shareplay-sessions", "offline-hls-on-ios-and-ipados", "google-cast-on-ios-and-ipados",
    "applied-configuration-code", "analytics-observability"],
  "native-android": ["preparation-and-build", "suggested-screen-workflow", "configuration-drafts-and-applying-changes",
    "audio-language-external-subtitles-and-retries", "additional-sdk-settings", "sdk-operations-state-and-events",
    "offline-downloads-and-playback", "android-tv-workspace"],
  "native-react-native": ["react-native-and-expo", "source-and-apply", "playback-tracks-ui", "applied-code",
    "react-native-additional-configuration-and-lists", "react-native-callbacks-and-native-ui-handlers",
    "react-native-operations-state-and-events", "react-native-cast-startup-settings"],
  "native-vega": ["vega-os-and-kepler", "source-and-apply", "playback-and-subtitles", "applied-code",
    "vega-typed-configuration-and-callbacks", "vega-operations-state-and-events", "vega-hls-interstitials"],
};
type CaptureProfile = "ios-phone" | "android-phone" | "ipad" | "tv" | "tv-dense";
const captureProfiles: Record<CaptureProfile, { width: number; height: number; top: number; bottom: number; displayWidth?: number }> = {
  "ios-phone": { width: 1206, height: 2622, top: 186, bottom: 0, displayWidth: 400 },
  "android-phone": { width: 1080, height: 2400, top: 63, bottom: 63, displayWidth: 360 },
  ipad: { width: 1640, height: 2360, top: 48, bottom: 40, displayWidth: 768 },
  tv: { width: 1920, height: 1080, top: 0, bottom: 0, displayWidth: 640 },
  "tv-dense": { width: 1920, height: 1080, top: 0, bottom: 0 },
};
const nativeCaptureSets: { slug: string; profile: CaptureProfile; files: string[] }[] = [
  { slug: "native-apple", profile: "ios-phone", files: ["ios-playback-tracks", "ios-applied-code",
    "ios-subtitle-array-editor", "ios-subtitle-array-sdk-state", "ios-callback-editor", "ios-callback-sdk-status",
    "ios-api-operation", "ios-api-volume-state", "ios-offline-track-selection", "ios-cast-options", "ios-cast-sdk-state"] },
  { slug: "native-apple", profile: "ipad", files: ["ios-initial-tracks", "ios-video-scaling"] },
  { slug: "native-apple", profile: "tv-dense", files: ["tvos-playback-tracks", "tvos-applied-code", "tvos-initial-tracks",
    "tvos-video-scaling", "tvos-api-state"] },
  { slug: "native-android", profile: "android-phone", files: ["android-source-settings", "android-player-settings",
    "android-applied-code", "android-api-callback", "android-api-operation", "android-api-state", "android-api-events",
    "android-media-session", "android-offline-tracks"] },
  { slug: "native-android", profile: "tv", files: ["android-tv-workspace", "android-tv-api"] },
  { slug: "native-react-native", profile: "ios-phone", files: ["rn-ios-subtitles", "rn-ios-caption", "rn-ios-code",
    "rn-ios-api-callback", "rn-ios-api-events"] },
  { slug: "native-react-native", profile: "android-phone", files: ["rn-android-subtitles", "rn-android-caption",
    "rn-android-api-operation", "rn-android-cast-startup"] },
  { slug: "native-vega", profile: "tv-dense", files: ["vega-subtitles", "vega-caption", "vega-code",
    "vega-api-callback", "vega-api-operation", "vega-api-volume"] },
];
const representativeCaptures: { slug: string; file: string; profile: CaptureProfile }[] = [
  { slug: "native-apple", file: "ios-applied-code", profile: "ios-phone" },
  { slug: "native-android", file: "android-applied-code", profile: "android-phone" },
  { slug: "native-apple", file: "ios-initial-tracks", profile: "ipad" },
  { slug: "native-android", file: "android-tv-workspace", profile: "tv" },
  { slug: "native-apple", file: "tvos-applied-code", profile: "tv-dense" },
  { slug: "native-vega", file: "vega-code", profile: "tv-dense" },
];
const contentRoot = resolve(__dirname, "../../../docs/guide");
const coverage = JSON.parse(readFileSync(resolve(contentRoot, "../api-coverage/coverage.json"), "utf8")) as CoverageReport;
const gapReport = JSON.parse(readFileSync(resolve(contentRoot, "../api-coverage/gaps.json"), "utf8")) as GapReport;
const gapAssessments = Object.fromEntries(gapReport.applications.map((app) => [app.id,
  Object.fromEntries(app.groups.flatMap((group) => group.apis.map((api) =>
    [api, { id: group.reason, ...gapReport.reasons[group.reason]! }]))),
]));
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

function nativeCapture(page: Page, language: Language, file: string): Locator {
  return page.locator("figure.guide-figure-capture").filter({
    has: page.locator(`img[src$="/${file}-${language}.png"]`),
  });
}

async function expectCaptureBounds(figure: Locator, profile: CaptureProfile): Promise<void> {
  const source = captureProfiles[profile];
  const bounds = await figure.evaluate((element) => {
    const link = element.querySelector<HTMLAnchorElement>(":scope > a.guide-capture-link")!;
    const viewport = link.querySelector<HTMLElement>(":scope > .guide-capture-viewport")!;
    const image = viewport.querySelector<HTMLImageElement>(":scope > img")!;
    return { figure: element.getBoundingClientRect().toJSON(), link: link.getBoundingClientRect().toJSON(),
      viewport: viewport.getBoundingClientRect().toJSON(), image: image.getBoundingClientRect().toJSON(),
      available: element.parentElement!.getBoundingClientRect().width,
      maxHeight: getComputedStyle(image).maxHeight, overflow: getComputedStyle(viewport).overflow,
      scrollTop: viewport.scrollTop, scrollLeft: viewport.scrollLeft };
  });
  const expectedWidth = Math.min(source.displayWidth ?? bounds.available, bounds.available);
  expect(Math.abs(bounds.figure.width - expectedWidth), `${profile} display width`).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.link.width - bounds.figure.width), `${profile} full-size link width`).toBeLessThanOrEqual(1);
  expect(bounds.maxHeight, `${profile} images must retain their width-based scale`).toBe("none");
  expect(bounds.overflow).toBe("clip");
  expect(bounds.scrollTop).toBe(0);
  expect(bounds.scrollLeft).toBe(0);
  const scale = bounds.image.width / source.width;
  expect(scale).toBeGreaterThan(0);
  expect(Math.abs(bounds.image.height / scale - source.height), `${profile} original aspect ratio`).toBeLessThanOrEqual(0.5);
  const visible = {
    left: (bounds.viewport.left - bounds.image.left) / scale,
    right: (bounds.viewport.right - bounds.image.left) / scale,
    top: (bounds.viewport.top - bounds.image.top) / scale,
    bottom: (bounds.viewport.bottom - bounds.image.top) / scale,
  };
  for (const [edge, expected] of Object.entries({ left: 0, right: source.width,
    top: source.top, bottom: source.height - source.bottom })) {
    expect(Math.abs(visible[edge as keyof typeof visible] - expected), `${profile} source-pixel ${edge} crop`)
      .toBeLessThanOrEqual(0.5);
  }
  if (profile === "android-phone") {
    expect(visible.bottom, "the last applied-code source pixel at y=2336 remains visible").toBeGreaterThan(2336);
    expect(visible.bottom).toBeLessThanOrEqual(2337.5);
  }
  if (["ios-phone", "android-phone", "ipad"].includes(profile) && expectedWidth >= source.displayWidth! - 1) {
    expect(bounds.image.height, `${profile} capture should exceed the former 38rem height cap`).toBeGreaterThan(608);
  }
}

async function expectCurrentGuideLink(page: Page, language: Language, slug: string, section?: string): Promise<void> {
  const destination = new URL(guidePath(language, slug) + (section ? `#${section}` : ""), page.url());
  for (const navigation of [page.locator(".guide-sidebar nav"), page.locator(".guide-mobile-contents nav")]) {
    const current = navigation.locator("a[aria-current]");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", section ? "location" : "page");
    await expect.poll(async () => new URL((await current.getAttribute("href"))!, page.url()).href)
      .toBe(destination.href);
  }
}

async function wheelToDocumentY(page: Page, destination: number): Promise<void> {
  const destinationY = await page.evaluate((target) => Math.max(0, Math.min(Math.round(target),
    document.documentElement.scrollHeight - innerHeight)), destination);
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width - 100, viewport.height / 2);
  const initialY = await page.evaluate(() => scrollY);
  const distance = destinationY - initialY;
  // Firefox caps one wheel event at one page; use separate, bounded gestures.
  const maximumStep = Math.floor(viewport.height / 2);
  const steps = Math.ceil(Math.abs(distance) / maximumStep);
  for (let index = 0; index < steps; index++) {
    const nextY = Math.round(initialY + Math.sign(distance) * Math.min((index + 1) * maximumStep, Math.abs(distance)));
    const currentY = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, nextY - currentY);
    await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - nextY)).toBeLessThanOrEqual(2);
  }
}

async function wheelToGuideHeading(page: Page, heading: Locator): Promise<void> {
  const destination = await heading.evaluate((element) => scrollY + element.getBoundingClientRect().top
    - document.querySelector(".guide-header")!.getBoundingClientRect().bottom - 4);
  await wheelToDocumentY(page, destination);
  await expect(heading).toBeInViewport();
}

async function expectSeparateChapterTargets(root: Locator, summary: Locator): Promise<void> {
  await root.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const rootBounds = await root.boundingBox();
  const summaryBounds = await summary.boundingBox();
  expect(rootBounds).not.toBeNull();
  expect(summaryBounds).not.toBeNull();
  const overlapWidth = Math.min(rootBounds!.x + rootBounds!.width, summaryBounds!.x + summaryBounds!.width)
    - Math.max(rootBounds!.x, summaryBounds!.x);
  const overlapHeight = Math.min(rootBounds!.y + rootBounds!.height, summaryBounds!.y + summaryBounds!.height)
    - Math.max(rootBounds!.y, summaryBounds!.y);
  expect(overlapWidth <= 0 || overlapHeight <= 0, "chapter navigation and disclosure need separate tap targets").toBe(true);
  for (const target of [root, summary]) {
    expect(await target.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit === element || (hit !== null && element.contains(hit));
    }), "each navigation target must receive a tap at its center").toBe(true);
  }
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
    test("each platform has unnumbered Screen and controls and Implementation guide chapters", async ({ page }) => {
      const pairs: [string, string][] = [
        ["web-screen-controls", "web-implementation"], ["native-apple", "apple-implementation"],
        ["native-android", "android-implementation"], ["native-react-native", "react-native-implementation"],
        ["native-vega", "vega-implementation"],
      ];
      for (const [operations, implementation] of pairs) {
        await page.goto(guidePath(language));
        const group = page.locator("main .guide-topic-group").filter({has: page.locator(`a[href="${operations}/"]`)});
        const links = group.locator(":scope > ul > li > a");
        await expect(links).toHaveText(language === "ja"
          ? ["\u753b\u9762\u3068\u64cd\u4f5c", "\u5b9f\u88c5\u30ac\u30a4\u30c9"]
          : ["Screen and controls", "Implementation guide"]);
        expect(await links.evaluateAll((elements) => elements.map(element => element.getAttribute("href"))))
          .toEqual([operations + "/", implementation + "/"]);
        await expect(group.locator("ol, li > ul")).toHaveCount(0);
        await links.first().click();
        await expect(page.locator("main > h1")).toHaveText(content[language][operations]!.title);
        await expect(page.locator(".guide-onpage")).toBeVisible();
        await expectHeadingStructure(page);
      }
    });

    test("all platform Screen menus can be inspected and collapsed before navigating", async ({ page }) => {
      for (const [slug, sections] of Object.entries(screenGuideSections)) {
        await test.step(slug, async () => {
          await page.goto(guidePath(language));
          const overviewURL = page.url();
          const menu = page.locator(`.guide-sidebar details[data-guide-chapter="${slug}"]`);
          const root = menu.locator("..").locator(":scope > a.guide-chapter-link");
          const summary = menu.locator(":scope > summary");
          const links = menu.locator(":scope > ul.guide-section-links > li > a");
          const headings = content[language][slug]!.blocks!.filter((block) => block.type === "h2");
          expect(headings).toHaveLength(sections.length);
          await expect(menu).not.toHaveAttribute("open", "");
          await expect(links).toHaveText(headings.map((heading) => heading.text!));
          await expect(links.first()).toBeHidden();
          await expect(summary).toHaveAccessibleName(language === "ja"
            ? /画面と操作の見出しを開閉$/ : /Screen and controls sections$/);
          expect(await links.evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href)))
            .toEqual(sections.map((section) => new URL(`${guidePath(language, slug)}#${section}`, overviewURL).href));

          await root.focus();
          await page.keyboard.press(navigationKey("Tab"));
          await expect(summary).toBeFocused();
          await page.keyboard.press("Enter");
          await expect(menu).toHaveAttribute("open", "");
          await expect(page).toHaveURL(overviewURL);
          await expect(links.first()).toBeVisible();
          await page.keyboard.press(navigationKey("Tab"));
          await expect(links.first()).toBeFocused();
          await summary.focus();
          await page.keyboard.press("Space");
          await expect(menu).not.toHaveAttribute("open", "");
          await expect(links.first()).toBeHidden();
          await expect(page).toHaveURL(overviewURL);

          await root.click();
          await expect(page).toHaveURL((url) => url.pathname === guidePath(language, slug) && url.hash === "");
          await expect(page.locator("main > h1")).toHaveText(content[language][slug]!.title);
          await expect(menu).toHaveAttribute("open", "");
          await links.nth(1).click();
          await expect(page).toHaveURL(guidePath(language, slug) + `#${sections[1]}`);
          const heading = page.locator(`main h2[id="${sections[1]}"]`);
          await expect(heading).toHaveText(headings[1]!.text!);
          await expect(heading).toBeInViewport();
          await expectCurrentGuideLink(page, language, slug, sections[1]);
        });
      }
    });

    test("noncurrent Implementation menus expose all child pages without opening the parent page", async ({ page }) => {
      for (const guide of implementationGuides) {
        await test.step(guide, async () => {
          await page.goto(guidePath(language));
          const overviewURL = page.url();
          const menu = page.locator(`.guide-sidebar details[data-guide-chapter="${guide}"]`);
          const root = menu.locator("..").locator(":scope > a.guide-chapter-link");
          const links = menu.locator(":scope > ul.guide-section-links > li > a");
          await expect(menu).not.toHaveAttribute("open", "");
          await expect(links).toHaveCount(6);
          await expect(links.first()).toBeHidden();
          await menu.locator(":scope > summary").focus();
          await page.keyboard.press("Enter");
          await expect(menu).toHaveAttribute("open", "");
          await expect(page).toHaveURL(overviewURL);
          expect(await links.evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href)))
            .toEqual(implementationSections.map((section) => new URL(guidePath(language, `${guide}/${section}`), overviewURL).href));
          await links.nth(4).focus();
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(guidePath(language, `${guide}/faq`));
          await expect(page.locator("main > h1")).toHaveText(content[language][guide]!.blocks!
            .find((block) => block.type === "h2" && block.id === "faq")!.text!);
          await expect(menu).toHaveAttribute("open", "");
          await expect(root).toHaveAttribute("data-section-current", "true");
          await expect(root).not.toHaveAttribute("aria-current", "page");
          for (const navigation of [page.locator(".guide-sidebar nav"), page.locator(".guide-mobile-contents nav")]) {
            await expect(navigation.locator('a[aria-current]')).toHaveCount(1);
            const current = navigation.locator('a[aria-current="page"]');
            await expectProjectLink(page, current, guidePath(language, `${guide}/faq`));
          }
          await root.click();
          await expect(page).toHaveURL(guidePath(language, guide));
          await expect(page.locator("main > h1")).toHaveText(content[language][guide]!.title);
        });
      }
    });

    test("current sections follow reading position while fragments, history and closed menus are preserved", async ({ page }) => {
      const slug = "web-screen-controls";
      const sections = screenGuideSections[slug]!;
      const path = guidePath(language, slug);
      await page.goto(path);
      await expectCurrentGuideLink(page, language, slug);
      const menu = page.locator(`.guide-sidebar details[data-guide-chapter="${slug}"]`);
      const links = menu.locator(":scope > ul.guide-section-links > li > a");
      const expectSection = async (index: number): Promise<void> => {
        await expect(page).toHaveURL(path + `#${sections[index]}`);
        await expect(page.locator(`main h2[id="${sections[index]}"]`)).toBeInViewport();
        await expectCurrentGuideLink(page, language, slug, sections[index]);
      };
      await links.nth(1).click();
      await expectSection(1);
      await links.nth(2).click();
      await expectSection(2);
      await page.goBack();
      await expectSection(1);
      await page.goForward();
      await expectSection(2);
      const bookmarkedURL = page.url();
      const historyLength = await page.evaluate(() => history.length);
      await wheelToGuideHeading(page, page.locator(`main h2[id="${sections[3]}"]`));
      await expectCurrentGuideLink(page, language, slug, sections[3]);
      await expect(page).toHaveURL(bookmarkedURL);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);

      await menu.locator(":scope > summary").focus();
      await page.keyboard.press("Enter");
      await expect(menu).not.toHaveAttribute("open", "");
      await wheelToGuideHeading(page, page.locator(`main h2[id="${sections[4]}"]`));
      await expectCurrentGuideLink(page, language, slug, sections[4]);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expectCurrentGuideLink(page, language, slug, sections[4]);
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(page).toHaveURL(bookmarkedURL);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
      await wheelToDocumentY(page, 0);
      await expectCurrentGuideLink(page, language, slug);
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(page).toHaveURL(bookmarkedURL);

      await page.locator("a[data-guide-language]").click();
      const other = language === "en" ? "ja" : "en";
      await expect(page).toHaveURL(guidePath(other, slug) + `#${sections[2]}`);
      await expect(page.locator("html")).toHaveAttribute("lang", other);
      await expect(page.locator(`main h2[id="${sections[2]}"]`)).toBeInViewport();
      await expectCurrentGuideLink(page, other, slug, sections[2]);
      await page.goBack();
      await expect(page).toHaveURL(bookmarkedURL);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
    });

    test("mobile contents and chapter disclosures have separate usable navigation targets", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(guidePath(language));
      const overviewURL = page.url();
      const contents = page.locator(".guide-mobile-contents");
      await contents.locator(":scope > summary").click();
      await expect(contents).toHaveAttribute("open", "");
      const slug = "native-android";
      const menu = contents.locator(`details[data-guide-chapter="${slug}"]`);
      const root = menu.locator("..").locator(":scope > a.guide-chapter-link");
      const summary = menu.locator(":scope > summary");
      const links = menu.locator(":scope > ul.guide-section-links > li > a");
      await expectSeparateChapterTargets(root, summary);
      await summary.click();
      await expect(menu).toHaveAttribute("open", "");
      await expect(links.first()).toBeVisible();
      await expect(page).toHaveURL(overviewURL);
      await expectNoDocumentOverflow(page);
      await summary.click();
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(links.first()).toBeHidden();
      await expect(page).toHaveURL(overviewURL);
      await root.click();
      await expect(page).toHaveURL(guidePath(language, slug));
      await expect(page.locator("main > h1")).toHaveText(content[language][slug]!.title);
      await contents.locator(":scope > summary").click();
      await expect(menu).toHaveAttribute("open", "");
      await expectSeparateChapterTargets(root, summary);
      await links.nth(1).click();
      const section = screenGuideSections[slug]![1]!;
      await expect(page).toHaveURL(guidePath(language, slug) + `#${section}`);
      await expect(page.locator(`main h2[id="${section}"]`)).toHaveText(content[language][slug]!.blocks!
        .filter((block) => block.type === "h2")[1]!.text!);
      await expect(page.locator(`main h2[id="${section}"]`)).toBeInViewport();
      await expectCurrentGuideLink(page, language, slug, section);
      await expectNoDocumentOverflow(page);
    });

    for (const slug of new Set(nativeCaptureSets.map((capture) => capture.slug))) {
      test(`${slug} captures preserve source content and readable responsive framing`, async ({ page, request }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(guidePath(language, slug));
        const sets = nativeCaptureSets.filter((capture) => capture.slug === slug);
        const fixtures = sets.flatMap(({ profile, files }) => files.map((file) => ({ file, profile })));
        const authored = content[language][slug]!.blocks!.filter((block) => block.type === "figure");
        expect(fixtures.map(({ file }) => file).sort()).toEqual(authored.map((block) => block.file).sort());
        await expect(page.locator("figure.guide-figure-capture")).toHaveCount(fixtures.length);
        for (const { file, profile } of fixtures) {
          await test.step(file, async () => {
            const figure = nativeCapture(page, language, file);
            const link = figure.locator(":scope > a.guide-capture-link");
            const viewport = link.locator(":scope > span.guide-capture-viewport");
            const image = viewport.locator(":scope > img");
            const source = captureProfiles[profile];
            const caption = authored.find((block) => block.file === file)!.caption!;
            await expect(figure).toHaveAttribute("data-guide-capture", profile);
            await expect(link).toHaveCount(1);
            await expect(viewport).toHaveCount(1);
            await expect(image).toHaveCount(1);
            expect(await figure.getAttribute("style")).toBeNull();
            await expect(figure.locator("[style]")).toHaveCount(0);
            await expect(image).toHaveAttribute("width", String(source.width));
            await expect(image).toHaveAttribute("height", String(source.height));
            await expect(image).toHaveAttribute("alt", caption);
            await expect(figure.locator(":scope > figcaption")).toHaveText(caption);
            await expect(link).toHaveAccessibleName(`${language === "en" ? "Open full-size image" : "元のサイズの画像を開く"}: ${caption}`);
            const src = (await image.getAttribute("src"))!;
            await expect(link).toHaveAttribute("href", src);
            const destination = new URL(src, page.url());
            expect(destination.pathname).toBe(`/player-lab/assets/guide/${file}-${language}.png`);
            const original = await request.get(destination.href);
            expect(original.status()).toBe(200);
            expect((await original.body()).equals(readFileSync(resolve(contentRoot,
              "../../site/assets/guide", `${file}-${language}.png`))), `${file} served bytes must match the original asset`).toBe(true);
            await figure.scrollIntoViewIfNeeded();
            await expect(image).toHaveJSProperty("naturalWidth", source.width);
            await expect(image).toHaveJSProperty("naturalHeight", source.height);
            await expectCaptureBounds(figure, profile);
            await image.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
            await expectCaptureBounds(figure, profile);
            for (const offset of [100, -100]) {
              await viewport.evaluate((element, value) => { element.scrollTop = value; element.scrollLeft = value; }, offset);
              await expectCaptureBounds(figure, profile);
            }
          });
        }
        for (const width of [320, 375, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          for (const { profile, files } of sets) await expectCaptureBounds(nativeCapture(page, language, files[0]!), profile);
          await expectNoDocumentOverflow(page);
        }
      });
    }

    for (const guide of implementationGuides) {
      test(`${guide} opens independent sections and keeps Analytics last`, async ({ page }) => {
        await page.goto(guidePath(language));
        await page.locator(`.guide-topic-group a[href="${guide}/"]`).click();
        await expect(page.locator("main > h1")).toHaveText(content[language][guide]!.title);
        expect(await page.locator(".guide-implementation-contents h2").evaluateAll((headings) =>
          headings.map((heading) => heading.id))).toEqual([
          "integration", "player-source-config", "ui-customization", "useful-features", "faq",
          "analytics-observability",
        ]);
        await expect(page.locator(".guide-code, .guide-figure")).toHaveCount(0);
        const sectionLinks = page.locator(".guide-implementation-contents h2 > a");
        expect(await sectionLinks.evaluateAll(elements => elements.map(element => element.getAttribute("href"))))
          .toEqual(implementationSections.map(section => section + "/"));
        const authored = content[language][guide]!.blocks!;
        for (const section of implementationSections) {
          const start = authored.findIndex(block => block.type === "h2" && block.id === section);
          expect(start).toBeGreaterThanOrEqual(0);
          const next = authored.findIndex((block, index) => index > start && block.type === "h2");
          const blocks = authored.slice(start + 1, next === -1 ? authored.length : next);
          await page.goto(guidePath(language, `${guide}/${section}`));
          await expect(page.locator("main > h1")).toHaveText(authored[start]!.text!);
          await expect(page.locator("main > .guide-lead")).toHaveText(authored[start]!.summary!);
          await expect(page.locator(".guide-breadcrumb")).toContainText(content[language][guide]!.title);
          await expect(page.locator(`.guide-sidebar details[data-guide-chapter="${guide}"] > ul > li`)).toHaveCount(6);
          await expect(page.locator('.guide-sidebar a[aria-current="page"]')).toHaveCount(1);
          await expect(page.locator('.guide-sidebar a[aria-current="page"]')).toHaveAttribute("href", "./");
          await expectHeadingStructure(page);
          const excerpts = page.locator(".guide-code");
          await expect(excerpts).toHaveCount(blocks.filter(block => block.type === "code").length);
          const sourceLinks = excerpts.locator("figcaption a");
          await expect(sourceLinks).toHaveCount(blocks.filter(block => block.type === "code" && block.source).length);
          for (const source of await sourceLinks.all()) {
            await expect(source).toHaveAttribute("href",
              /^https:\/\/github\.com\/kazuhide\/player-lab\/blob\/[a-f0-9]{40}\/.+#L[1-9][0-9]*$/);
          }
          for (const excerpt of await excerpts.all()) await expect(excerpt.locator("pre")).toHaveAttribute("tabindex", "0");
          await page.waitForLoadState("load");
          await page.evaluate(() => document.fonts.ready);
          for (const width of [320, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await expectNoDocumentOverflow(page);
          }
          for (const image of await page.locator(".guide-figure img").all()) {
            await image.scrollIntoViewIfNeeded();
            await expect.poll(() => image.evaluate(element =>
              element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
          }
          if (await sourceLinks.count()) {
            await sourceLinks.first().focus();
            await expect(sourceLinks.first()).toBeFocused();
          }
        }
        await page.goto(guidePath(language, guide));
        const faq = page.locator('.guide-implementation-contents a[href="faq/"]');
        await faq.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/faq\/$/);
        await expect(page.locator("h1#faq")).toBeInViewport();
      });
    }

    test("old implementation subheadings open the matching child section and retain their language", async ({ page }) => {
      for (const guide of implementationGuides) {
        const blocks = content[language][guide]!.blocks!;
        const index = blocks.findIndex(block => block.type === "h3");
        expect(index).toBeGreaterThanOrEqual(0);
        const heading = blocks[index]!;
        const previous = blocks.slice(0, index).filter(block => block.type === "h2");
        const section = previous[previous.length - 1]!;
        await page.goto(guidePath(language, guide) + "#" + heading.id);
        const link = page.locator(`a[id="${heading.id}"]`);
        await expect(link).toBeInViewport();
        await link.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(guidePath(language, `${guide}/${section.id}`) + "#" + heading.id);
        await expect(page.locator(`h2#${heading.id}`)).toBeInViewport();
        await page.locator("[data-guide-language]").click();
        const other = language === "en" ? "ja" : "en";
        await expect(page).toHaveURL(guidePath(other, `${guide}/${section.id}`) + "#" + heading.id);
        await expect(page.locator(`h2#${heading.id}`)).toBeInViewport();
      }
    });

    test("API gap reasons open with the keyboard and remain readable on narrow screens", async ({ page }) => {
      await page.goto(guidePath(language, "api-coverage/web-ui"));
      const [api, assessment] = Object.entries(gapAssessments["web-ui"]!)
        .find(([, item]) => item.kind === "input-contract")!;
      const row = page.getByText(api, { exact: true }).locator("xpath=ancestor::tr");
      const panel = row.locator(".guide-api-gap");
      await panel.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(panel).toHaveAttribute("open", "");
      await expect(panel.locator("dd").first()).toHaveText(assessment[language].reason);
      await expect(panel.locator("dd").last()).toHaveText(assessment[language].action);
      await expect(panel.locator("a").first()).toHaveAttribute("href", assessment.references[0]!);
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoDocumentOverflow(page);
        expect(await panel.locator("dd").first().evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("normal");
        expect(await row.locator("[data-api-id]").evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
      }
    });

    test("controls remain readable by group on desktop and mobile", async ({ page }) => {
      await page.goto(guidePath(language, "controls"));
      const controls = content[language].controls!.controls!;
      const rows = page.locator(".guide-controls > div");
      await expect(rows).toHaveCount(controls.length);
      expect(await rows.evaluateAll((elements) => elements.map((element) => ({
        id: element.id,
        label: element.querySelector(".guide-control-label")?.textContent,
        description: element.querySelector("dd")?.textContent,
      })))).toEqual(controls.map(({ id, label, description }) => ({ id, label, description })));
      await expect(page.locator(".guide-control-kind")).toHaveCount(controls.length);
      await expect(page.locator(".guide-control-group > h2")).toHaveText(language === "ja"
        ? ["ソース", "再生位置", "再生動作", "プレイヤーUI", "外部画面への出力"]
        : ["Source presets", "Playback position", "Playback behavior", "Player UI", "External displays"]);
      for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const layout = await rows.first().evaluate((element) => {
          const term = element.querySelector("dt")!, detail = element.querySelector("dd")!;
          const name = term.getBoundingClientRect(), description = detail.getBoundingClientRect();
          return { name: { top: name.top, right: name.right, bottom: name.bottom },
            description: { top: description.top, left: description.left },
            weight: Number(getComputedStyle(term).fontWeight),
            descriptionWeight: Number(getComputedStyle(detail).fontWeight),
            padding: parseFloat(getComputedStyle(element).paddingTop) };
        });
        expect(layout.weight).toBeGreaterThan(layout.descriptionWeight);
        expect(layout.padding).toBeGreaterThanOrEqual(12);
        if (width === 320) expect(layout.description.top).toBeGreaterThan(layout.name.bottom);
        else {
          expect(Math.abs(layout.name.top - layout.description.top)).toBeLessThan(1);
          expect(layout.description.left).toBeGreaterThan(layout.name.right);
        }
        await expectNoDocumentOverflow(page);
      }
      const jump = page.locator('.guide-control-nav a[href="#controls-ui"]');
      await jump.focus();
      await expect(jump).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#controls-ui$/);
      await expect(page.locator("h2#controls-ui")).toBeInViewport();
      const search = page.locator("[data-guide-search]");
      const control = controls.find((item) => item.id === "localization.language")!;
      await search.fill(control.label);
      await page.locator("[data-search-results]").getByRole("link", { name: control.label, exact: true }).click();
      await expect(page).toHaveURL(/#localization\.language$/);
      await expect(page.locator('[id="localization.language"]')).toBeInViewport();
    });

    test("Analytics attribute names remain readable without splitting a word", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(guidePath(language, "analytics-metrics"));
      const attribute = page.locator(".guide-table td").getByText("avg(VIDEO_STARTUPTIME)", { exact: true });
      const lines = await attribute.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
      });
      expect(lines, "A short API expression should fit on one line at desktop width").toBe(1);
      await expectNoDocumentOverflow(page);
    });

    test("retired workflow bookmarks open current help in the same language", async ({ page }) => {
      const routes = { measurement: "test-results", media: "web-sources-tracks",
        "cloud-encoding": "web-sources-tracks", "live-finalization": "troubleshooting" };
      for (const [old, destination] of Object.entries(routes)) {
        await page.goto(guidePath(language, old));
        await expect(page).toHaveURL((url) => url.pathname === guidePath(language, destination));
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("main > h1")).toHaveText(content[language][destination]!.title);
      }
      await page.goto(guidePath(language));
      for (const slug of Object.keys(routes)) {
        await expect(page.locator(`.guide-nav a[href="${slug}/"]`)).toHaveCount(0);
      }
      for (const slug of ["analytics-metrics", "analytics-queries", "analytics-visualization", "analytics-ai"]) {
        await expect(page.locator(`.guide-topic-group a[href="${slug}/"]`)).toBeVisible();
      }
    });

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
        for (const slug of ["start", "web-screen-controls", ...implementationGuides, "web-player-config", "web-ui-customization", "native-apple", "native-android", "native-react-native", "native-vega", "analytics-metrics", "analytics-queries", "analytics-visualization", "analytics-ai", "test-results", "settings/tweaks", "controls", "themes",
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
    for (const slug of ["start", "web-screen-controls", "web-sources-tracks", "web-player-config", "themes", "native-apple", "native-android", "native-react-native", "native-vega",
      "web-qoe-analytics", "analytics-visualization"]) {
      await page.goto(guidePath(language, slug));
      const fullSizeImages = slug !== "themes";
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
        expect(new URL(decoded.src).pathname).toMatch(/^\/player-lab\/assets\/guide\/[^/]+\.(?:jpg|png)$/);
        await expect(image).toHaveAttribute("width", String(decoded.width));
        await expect(image).toHaveAttribute("height", String(decoded.height));
        if (fullSizeImages) {
          const fullSize = image.locator("xpath=ancestor::a[1]");
          await expect(fullSize).toHaveAttribute("href", await image.getAttribute("src") as string);
          await expect(fullSize).toHaveAccessibleName(/\S/);
        }
      }
      if (fullSizeImages) {
        const fullSize = images.first().locator("xpath=ancestor::a[1]");
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
    for (const width of [375, 1440]) {
      test(`${language} native chapter disclosures navigate without JavaScript at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(guidePath(language));
        const overviewURL = page.url();
        const contents = page.locator(".guide-mobile-contents");
        if (width === 375) {
          await contents.locator(":scope > summary").focus();
          await page.keyboard.press("Enter");
          await expect(contents).toHaveAttribute("open", "");
        }
        const navigation = page.locator(width === 375 ? ".guide-mobile-contents nav" : ".guide-sidebar nav");
        const slug = "native-apple";
        const menu = navigation.locator(`details[data-guide-chapter="${slug}"]`);
        const links = menu.locator(":scope > ul.guide-section-links > li > a");
        await expect(menu).not.toHaveAttribute("open", "");
        await expect(links).toHaveCount(screenGuideSections[slug]!.length);
        await expect(links.first()).toBeHidden();
        await menu.locator(":scope > summary").focus();
        await page.keyboard.press("Enter");
        await expect(menu).toHaveAttribute("open", "");
        await expect(page).toHaveURL(overviewURL);
        await expect(links.first()).toBeVisible();
        await expectNoDocumentOverflow(page);
        const section = screenGuideSections[slug]![1]!;
        await links.nth(1).click();
        await expect(page).toHaveURL(guidePath(language, slug) + `#${section}`);
        await expect(page.locator("main > h1")).toHaveText(content[language][slug]!.title);
        await expect(page.locator(`main h2[id="${section}"]`)).toHaveText(content[language][slug]!.blocks!
          .filter((block) => block.type === "h2")[1]!.text!);
        await expect(page.locator(`main h2[id="${section}"]`)).toBeInViewport();
        await expect(menu).toHaveAttribute("open", "");

        if (width === 375) {
          await contents.locator(":scope > summary").click();
          await expect(contents).toHaveAttribute("open", "");
        }
        const guide = "vega-implementation";
        const implementation = navigation.locator(`details[data-guide-chapter="${guide}"]`);
        const children = implementation.locator(":scope > ul.guide-section-links > li > a");
        const screenURL = page.url();
        await expect(implementation).not.toHaveAttribute("open", "");
        await expect(children).toHaveCount(6);
        await implementation.locator(":scope > summary").click();
        await expect(implementation).toHaveAttribute("open", "");
        await expect(page).toHaveURL(screenURL);
        await children.nth(4).click();
        await expect(page).toHaveURL(guidePath(language, `${guide}/faq`));
        await expect(page.locator("main > h1")).toHaveText(content[language][guide]!.blocks!
          .find((block) => block.type === "h2" && block.id === "faq")!.text!);
        await expect(implementation).toHaveAttribute("open", "");
        await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
        await expectProjectLink(page, navigation.locator('a[aria-current="page"]'), guidePath(language, `${guide}/faq`));
        await expectNoDocumentOverflow(page);
      });

      test(`${language} native captures open original images with the keyboard without JavaScript at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        for (const { slug, file, profile } of representativeCaptures) {
          await test.step(profile, async () => {
            await page.goto(guidePath(language, slug));
            const figure = nativeCapture(page, language, file);
            const image = figure.locator(".guide-capture-viewport > img");
            const link = figure.locator(":scope > a.guide-capture-link");
            const source = captureProfiles[profile];
            await figure.scrollIntoViewIfNeeded();
            await expect(figure).toHaveAttribute("data-guide-capture", profile);
            await expect(image).toHaveJSProperty("naturalWidth", source.width);
            await expect(image).toHaveJSProperty("naturalHeight", source.height);
            await expectCaptureBounds(figure, profile);
            await page.keyboard.press(navigationKey("Tab"));
            await link.focus();
            await expect(link).toBeFocused();
            await expect(link).toHaveCSS("outline-style", "solid");
            await expectCaptureBounds(figure, profile);
            await expectNoDocumentOverflow(page);
            const destination = new URL((await link.getAttribute("href"))!, page.url());
            expect(destination.pathname).toBe(`/player-lab/assets/guide/${file}-${language}.png`);
            await page.keyboard.press("Enter");
            await expect(page).toHaveURL(destination.href);
            await expect(page.locator("img")).toHaveJSProperty("naturalWidth", source.width);
            await expect(page.locator("img")).toHaveJSProperty("naturalHeight", source.height);
          });
        }
      });
    }

    test(`${language} control groups and item bookmarks work without JavaScript`, async ({ page }) => {
      await page.goto(guidePath(language, "controls"));
      await expect(page.locator(".guide-controls > div")).toHaveCount(content[language].controls!.controls!.length);
      await page.locator('.guide-control-nav a[href="#controls-casting"]').click();
      await expect(page).toHaveURL(/#controls-casting$/);
      await expect(page.locator("h2#controls-casting")).toBeInViewport();
      await page.goto(guidePath(language, "controls") + "#localization.language");
      await expect(page.locator('[id="localization.language"]')).toBeInViewport();
    });

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
          const assessments = gapAssessments[app.id]!;
          await expect(page.locator(".guide-api-gap")).toHaveCount(Object.keys(assessments).length);
          const reasonPanels = await page.locator(".guide-api-gap").evaluateAll((elements) => elements.map((element) => ({
            api: element.closest("tr")?.querySelector("[data-api-id]")?.getAttribute("data-api-id"),
            reason: element.querySelector("dd")?.textContent,
            action: element.querySelector("dd:last-child")?.textContent,
          })));
          expect(Object.fromEntries(reasonPanels.map(({ api, ...reason }) => [api, reason])))
            .toEqual(Object.fromEntries(Object.entries(assessments).map(([api, item]) =>
              [api, { reason: item[language].reason, action: item[language].action }])));
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
      const steps = content[language].start!.blocks!.filter(block => block.type === "steps");
      await expect(page.locator("main > ol")).toHaveCount(steps.length);
      for (let index = 0; index < steps.length; index++) {
        await expect(page.locator("main > ol").nth(index).locator("li")).toHaveText(steps[index]!.items!);
      }
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
