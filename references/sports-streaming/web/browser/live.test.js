import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against a freshly started short event. Pausing keeps the original UTC
// available when the archive is published; never use the device time for it.
test(
  'return from a clip to paused DVR, then continue at the mapped archive position',
  {
    skip: process.env.RUN_LIVE !== '1',
    timeout: 280000
  },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      const updates = [];
      page.on('response', async (response) => {
        if (new URL(response.url()).pathname.endsWith('/api/events/SP-EVENT-S') && response.ok()) {
          try {
            updates.push(await response.json());
          } catch {
            /* A replaced request can be cancelled. */
          }
        }
      });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.locator('#assets button[data-id="SP-LIVE-S"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
      await page.waitForFunction(() => Number(document.querySelector('#seek').min) < -5);
      await page.locator('#seek').evaluate((input) => {
        input.value = '-4';
        input.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(() => document.querySelector('#log [data-event="TimeShifted"]') !== null);
      await page.locator('#play').click();
      await page.waitForFunction(
        () => document.querySelector('video')?.paused && document.querySelector('video').readyState >= 2
      );
      const saved = await page.locator('video').evaluate((v) => v.currentTime);
      const origin = updates.find((update) => update.status === 'live')?.utcStartMs;
      assert.ok(
        Number.isSafeInteger(origin) && saved * 1000 >= origin,
        'Start the short live fixture before running this test.'
      );
      await page.locator('#assets button[data-id="SP-CLIP-A"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector('video')?.currentTime > 0.2 &&
          document.querySelector('video').currentTime < 20
      );
      await page.locator('#earlier').click();
      await page.waitForFunction((s) => {
        const v = document.querySelector('video');
        return (
          v?.paused &&
          !document.querySelector('#controls').disabled &&
          Math.abs(v.currentTime - s) <= 1.5 &&
          document.querySelector('#message').textContent === ''
        );
      }, saved);
      await page.locator('#auto').check();
      await page.waitForFunction(
        () =>
          document.querySelector('#title').textContent === 'Practice replay' &&
          !document.querySelector('#controls').disabled,
        null,
        { timeout: 230000 }
      );
      const archive = await page
        .locator('video')
        .evaluate((v) => ({ time: v.currentTime, paused: v.paused }));
      await page.locator('summary').click();
      // The SDK may report Seeked before the HTML video decodes its paused frame.
      await page.locator('#log [data-event="HandoffConfirmed"]').waitFor();
      const receiptDownload = page.waitForEvent('download');
      await page.locator('#export').click();
      const download = await receiptDownload;
      const receipt = JSON.parse(await readFile(await download.path(), 'utf8'));
      const row = receipt.records.at(-1);
      assert.equal(row.requested.videoId, 'sports:SP-ARCH-S');
      assert.equal(row.confirmed?.videoId, row.requested.videoId);
      assert.equal(row.confirmed?.playWhenReady, false);
      assert.equal(row.receiverQoe, null);
      assert.equal(archive.paused, true);
      assert.ok(Math.abs(archive.time - (saved - origin / 1000)) <= 1.5);
    } finally {
      await browser.close();
    }
  }
);
