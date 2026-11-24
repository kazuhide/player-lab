import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

test(
  'paused live UTC survives switching HLS to DASH and back',
  { skip: process.env.RUN_LIVE !== '1', timeout: 95000 },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.locator('#events button[data-id="SP-EVENT-30"]').click();
      await page.locator('#assets button[data-id="SP-LIVE-EVENT"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(
        () =>
          document.querySelector('#play').textContent === 'Pause' &&
          document.querySelector('video')?.readyState >= 2
      );
      await page.locator('#play').click();
      await page.waitForFunction(() => document.querySelector('video').paused);
      const origin = await page.locator('video').evaluate((v) => v.currentTime);
      for (const [format, suffix] of [
        ['dash', 'dash/manifest.mpd'],
        ['hls', 'hls/external.m3u8']
      ]) {
        const manifest = page.waitForResponse(
          (r) => new URL(r.url()).pathname.endsWith('/SP-LIVE-EVENT/' + suffix) && r.ok()
        );
        await page.selectOption('#format', format);
        await manifest;
        await page.waitForFunction(
          () =>
            !document.querySelector('#controls').disabled &&
            document.querySelector('video')?.paused &&
            document.querySelector('video').readyState >= 2
        );
        assert.equal(await page.locator('#message').textContent(), '');
        assert.equal(
          await page.locator('#assets button[aria-current=true]').getAttribute('data-id'),
          'SP-LIVE-EVENT'
        );
      }
      assert.ok(await page.locator('video').evaluate((v, t) => Math.abs(v.currentTime - t) <= 1.5, origin));
    } finally {
      await browser.close();
    }
  }
);

test(
  'live format stays paused when the selected source has no verified UTC',
  {
    skip: process.env.RUN_LIVE !== '1',
    timeout: 45000
  },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.route('**/catalog.json', async (route) => {
        const response = await route.fetch();
        const catalog = await response.json();
        catalog.assets.find((a) => a.id === 'SP-LIVE-EVENT').utcStartMs -= 10000;
        await route.fulfill({ response, json: catalog });
      });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.locator('#events button[data-id="SP-EVENT-30"]').click();
      await page.locator('#assets button[data-id="SP-LIVE-EVENT"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
      await page.selectOption('#format', 'dash');
      await page.waitForFunction(() =>
        document.querySelector('#message').textContent.includes('previous position is unavailable')
      );
      assert.ok(await page.locator('video').evaluate((v) => v.paused));
      assert.equal(
        await page.locator('#assets button[aria-current=true]').getAttribute('data-id'),
        'SP-LIVE-EVENT'
      );
      assert.ok(await page.locator('#edge').isEnabled());
    } finally {
      await browser.close();
    }
  }
);
