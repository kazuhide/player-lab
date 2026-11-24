import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const engine = process.env.BROWSER || 'chromium';
const format = process.env.FORMAT || (engine === 'webkit' ? 'hls' : 'dash');
const launch = () => (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
test(
  'lesson navigation, view continuity, transcript seek and private learner resume',
  { timeout: 95000 },
  async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5181');
      await page.selectOption('#format', format);
      // Select after the catalog arrives, so the delivery selector reflects the requested protocol.
      await page.locator('#lessons button').first().waitFor();
      await page.locator('#auto').check();
      await page.locator('#lessons button').first().click();
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.5);
      const video = await page.locator('video').elementHandle();
      await page.selectOption('#mode', 'custom');
      assert.ok(await video.evaluate((v) => v === document.querySelector('video') && !v.paused));
      await page.locator('#play').click();
      await page.waitForFunction(() => document.querySelector('video').paused);
      await page.selectOption('#captions', 'off');
      await page.selectOption('#speed', '1.5');
      await page.fill('#query', 'Read the numbers');
      await page.locator('#results button').click();
      await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 10) < 0.5);
      assert.equal(await page.inputValue('#captions'), 'off');
      await page.selectOption('#mode', 'standard');
      assert.ok(await video.evaluate((v) => v === document.querySelector('video') && v.paused));
      await page.selectOption('#mode', 'custom');
      await page.locator('#course').click();
      await page.locator('#lessons button').first().click();
      assert.ok(await page.locator('#resume').isVisible());
      await page.locator('#resume').click();
      await page.waitForFunction(() => !document.querySelector('#controls').disabled);
      assert.equal(await page.inputValue('#captions'), 'off');
      assert.equal(await page.inputValue('#speed'), '1.5');
      assert.equal(await page.inputValue('#mode'), 'custom');
      assert.ok(await page.locator('video').evaluate((v) => v.currentTime >= 9.5));
      await page.selectOption('#learner', 'b');
      await page.locator('#lessons button').first().click();
      await page.waitForFunction(() => !document.querySelector('#controls').disabled);
      assert.equal(await page.locator('#choices').isVisible(), false);
      assert.equal(await page.inputValue('#mode'), 'standard');
      assert.equal(await page.inputValue('#speed'), '1');
      assert.ok(await page.locator('video').evaluate((v) => v.currentTime < 8));
      await page.locator('#course').click();
      await page.locator('#auto').check();
      await page.locator('#lessons button').nth(1).click();
      await page.waitForFunction(() => !document.querySelector('#controls').disabled);
      await page.selectOption('#mode', 'custom');
      await page.locator('#seek').evaluate((input) => {
        input.value = Number(input.max) - 1;
        input.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#title').textContent === 'Summary' &&
          !document.querySelector('#controls').disabled
      );
      assert.equal(await page.locator('#next').isDisabled(), true);
    } finally {
      await browser.close();
    }
  }
);
