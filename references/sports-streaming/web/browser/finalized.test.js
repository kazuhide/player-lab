import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test(
  'finalized DVR survives HLS/DASH switches and a later archive error keeps the current checkpoint',
  { skip: process.env.RUN_FINALIZED !== '1', timeout: 90000 },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.waitForFunction(
        () =>
          document.querySelector('#status').textContent.includes('ended') &&
          document.querySelector('#status').textContent.includes('ready')
      );
      await page.locator('#assets button[data-id="SP-LIVE-S"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.4);
      await page.locator('#play').click();
      const seek = async (s) => {
        await page.locator('#seek').evaluate((i, t) => {
          i.value = t;
          i.dispatchEvent(new Event('change'));
        }, s);
        await page.waitForFunction(
          (t) => Math.abs(document.querySelector('video').currentTime - t) <= 0.25,
          s
        );
      };
      const retained = await page.locator('video').evaluate((v) => v.duration);
      await seek(12);
      for (const [format, expected] of [
        ['dash', 180 - retained + 12],
        ['hls', 12]
      ]) {
        await page.selectOption('#format', format);
        await page.waitForFunction(
          (t) =>
            !document.querySelector('#controls').disabled &&
            document.querySelector('video')?.paused &&
            Math.abs(document.querySelector('video').currentTime - t) < 1,
          expected
        );
        assert.equal(await page.locator('#message').textContent(), '');
      }
      await page.locator('#targets button').first().click();
      await page.locator('summary').click();
      await page.locator('#log [data-event=HandoffConfirmed]').waitFor();
      await seek(160);
      // Invalid media bytes cause the HTML decoder to deliver an actual fatal
      // SDK playback error after this archive's original handoff has finished.
      await page.locator('video').evaluate((v) => {
        v.src = 'data:video/mp4;base64,AAAA';
        v.load();
      });
      await page.locator('#retry').waitFor();
      await page.locator('#retry').click();
      await page.waitForFunction(
        () =>
          !document.querySelector('#controls').disabled &&
          document.querySelector('video')?.paused &&
          Math.abs(document.querySelector('video').currentTime - 160) < 1
      );
      assert.equal(
        await page.locator('#assets button[aria-current=true]').getAttribute('data-id'),
        'SP-ARCH-S'
      );
      const downloading = page.waitForEvent('download');
      await page.locator('#export').click();
      const data = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
      assert.equal(data.records.length, 1);
      assert.equal(data.records[0].confirmed.videoId, 'sports:SP-ARCH-S');
      const end = await page.locator('video').evaluate((v) => v.duration);
      await seek(Math.floor(end) - 2);
      await page.locator('#play').click();
      await page.waitForFunction(() => document.querySelector('video').ended);
      await page.selectOption('#format', 'dash');
      await page.waitForFunction(
        () =>
          !document.querySelector('#controls').disabled &&
          document.querySelector('#message').textContent.includes('replay') &&
          document.querySelector('video')?.paused
      );
      assert.ok(await page.locator('#retry').isHidden());
      await page.locator('#play').click();
      await page.waitForFunction(
        () =>
          document.querySelector('video').currentTime > 0.2 &&
          document.querySelector('video').currentTime < 4
      );
    } finally {
      await browser.close();
    }
  }
);

test(
  'a seek during the first playing observation leaves the handoff unconfirmed',
  { skip: process.env.RUN_FINALIZED !== '1', timeout: 60000 },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.waitForFunction(
        () =>
          document.querySelector('#status').textContent.includes('ended') &&
          document.querySelector('#status').textContent.includes('ready')
      );
      await page.locator('#assets button[data-id="SP-LIVE-S"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.6);
      await page.evaluate(() => {
        const observer = new MutationObserver((records) => {
          if (document.querySelector('#title').textContent !== 'Practice replay') return;
          if (
            records.some((record) => [...record.addedNodes].some((n) => n.dataset?.event === 'Playing'))
          ) {
            observer.disconnect();
            document.querySelector('#forward').click();
          }
        });
        observer.observe(document.querySelector('#log'), { childList: true });
      });
      await page.locator('#targets button').first().click();
      await page.waitForFunction(
        () =>
          document.querySelector('#title').textContent === 'Practice replay' &&
          document.querySelector('video')?.currentTime > 135 &&
          !document.querySelector('video').paused
      );
      await page.locator('summary').click();
      const downloading = page.waitForEvent('download');
      await page.locator('#export').click();
      const data = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
      assert.equal(data.records.length, 1);
      assert.equal(data.records[0].requested.playWhenReady, true);
      assert.equal(data.records[0].confirmed, null);
    } finally {
      await browser.close();
    }
  }
);
