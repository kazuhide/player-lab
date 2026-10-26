import { test, expect } from "../src/browser-test";

test("the failure report excludes private input from real browser events", async ({ page }) => {
  await page.route("https://diagnostic-fixture.invalid/**", route => route.abort("failed"));
  await page.setContent("<p>Diagnostic fixture</p>");
  const request = page.waitForEvent("requestfailed");
  await page.evaluate(async () => {
    try { await fetch("https://diagnostic-fixture.invalid/private-fixture-marker?token=private-fixture-marker"); }
    catch { /* The failed request is the diagnostic input. */ }
  });
  await request;
  const error = page.waitForEvent("pageerror");
  await page.evaluate(() => { setTimeout(() => { throw new Error("licensing impression private-fixture-marker"); }, 0); });
  await error;
  expect("intentional fixture failure").toBe("the parent runner must verify the saved diagnostics");
});
