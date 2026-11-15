import { expect, test, type Page } from "@playwright/test";

async function readLifecycle(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/browser/ui-lifecycle-harness.ts";
    const harness = await import(modulePath);
    return harness.readUiLifecycle() as {
      subscribers: number;
      layouts: { main: number; smallScreen: number; tv: number };
      roots: number;
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/src/main.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import "/browser/ui-lifecycle-harness.ts";\n${await response.text()}`,
    });
  });
});

test("constructs only the selected content layout", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  const initial = await readLifecycle(page);
  const compact = page.viewportSize()!.width < 800;
  expect(initial.layouts).toEqual({ main: compact ? 0 : 1, smallScreen: compact ? 1 : 0, tv: 0 });
});

test("keeps localization listeners bounded and gives later layouts the current graph state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#player-status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#data-status")).toHaveAttribute("data-state", "ready");
  const compact = page.viewportSize()!.width < 800;

  // Warm any lazily rendered localized labels before checking repeated updates.
  await page.locator("#language").click();
  const baseline = await readLifecycle(page);
  const assertPlayLabel = async () => {
    const japanese = await page.locator("html").getAttribute("lang") === "ja";
    await expect(page.locator(".bmpui-ui-uicontainer:visible .bmpui-ui-playbacktogglebutton").first())
      .toHaveAccessibleName(japanese ? "再生" : "Play");
  };
  await assertPlayLabel();
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await page.locator("#language").click();
    const current = await readLifecycle(page);
    expect(current.subscribers).toBe(baseline.subscribers);
    expect(current.roots).toBe(baseline.roots);
    await assertPlayLabel();
  }

  // A variant first constructed after resizing must inherit the latest graph state.
  await page.locator("#profile").selectOption("single");
  await expect(page.locator("#session-count")).toContainText("1");
  await page.locator('input[name="metric"][value="reach"]').check();
  await page.locator("#show-graph").uncheck();
  await page.setViewportSize({ width: compact ? 1024 : 640, height: 900 });
  const activeGraph = page.locator(".bmpui-ui-uicontainer:visible .pl-engagement-timeline");
  await expect(activeGraph).toHaveCount(1);
  await expect(activeGraph).toHaveAttribute("data-sessions", "1");
  await expect(activeGraph).toHaveAttribute("data-metric", "reach");
  await expect(activeGraph).not.toBeVisible();
  await page.locator("#show-graph").check();
  await expect(activeGraph).toBeVisible();
  await expect(activeGraph.locator(".pl-engagement-fill")).not.toHaveCount(0);

  // Language updates remain bounded after both content layouts have been used.
  await page.locator("#language").click();
  const resizedBaseline = await readLifecycle(page);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await page.locator("#language").click();
    const current = await readLifecycle(page);
    expect(current.subscribers).toBe(resizedBaseline.subscribers);
    expect(current.roots).toBe(resizedBaseline.roots);
  }
});
