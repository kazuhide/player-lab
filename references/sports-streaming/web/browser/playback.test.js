import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const engine = process.env.BROWSER || 'chromium';
const format = process.env.FORMAT || (engine === 'webkit' ? 'hls' : 'dash');
const launch = () => (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
test('prepared clip playback, controls, precise seeking and event change', { timeout: 85000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ locale: 'en-US' });
    await page.goto(process.env.APP_URL || 'http://localhost:5182');
    await page.locator('#assets button').first().waitFor();
    await page.selectOption('#format', format);
    await page.locator('#assets button[data-id="SP-CLIP-A"]').click();
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.3);
    const video = await page.locator('video').elementHandle();
    await page.selectOption('#mode', 'custom');
    assert.ok(await video.evaluate((v) => v === document.querySelector('video') && !v.paused));
    await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('video').paused);
    await page.locator('#forward').click();
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 15);
    await page.selectOption('#captions', 'ja');
    await page.selectOption('#speed', '1.5');
    await page.selectOption('#mode', 'standard');
    assert.ok(
      await video.evaluate(
        (v) => v === document.querySelector('video') && v.paused && v.playbackRate === 1.5
      )
    );
    await page.locator('#events button').nth(1).click();
    assert.equal(await page.locator('#assets button[data-id="SP-CLIP-A"]').count(), 0);
    assert.equal(await page.locator('#play').isDisabled(), true);
  } finally {
    await browser.close();
  }
});
