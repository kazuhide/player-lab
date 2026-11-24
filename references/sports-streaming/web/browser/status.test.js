import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const app = process.env.APP_URL || 'http://localhost:5182';
const statusPath = '**/api/events/SP-EVENT-S';

test('refresh resumes live polling after restart and discards a delayed terminal response', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ locale: 'en-US' });
    const oldRead = Promise.withResolvers(),
      releaseOld = Promise.withResolvers();
    let calls = 0;
    await page.route(statusPath, async (route) => {
      const number = ++calls;
      const response = await route.fetch();
      const sampled = await response.json();
      if (number === 2) {
        oldRead.resolve();
        await releaseOld.promise;
      }
      const old = number < 3;
      await route.fulfill({
        response,
        json: {
          ...sampled,
          publisherStartedAtUs: old ? 100 : 200,
          mediaUtcNow: old ? 250000 : 10000 + number,
          archiveMapping: null,
          status: old ? 'ended' : 'live',
          archiveStatus: old ? 'ready' : 'not_ready'
        }
      });
    });
    await page.goto(app);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ended'));
    await page.locator('#refresh').click();
    await oldRead.promise;
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('live'));
    const delayed = page.waitForResponse(
      async (r) => r.url().endsWith('/api/events/SP-EVENT-S') && (await r.json()).publisherStartedAtUs === 100
    );
    releaseOld.resolve();
    await delayed;
    // A stale terminal response must not stop the next scheduled poll.
    await page.waitForResponse((r) => r.url().endsWith('/api/events/SP-EVENT-S') && calls >= 5, {
      timeout: 12000
    });
    assert.ok((await page.locator('#status').textContent()).includes('live'));
    assert.ok(await page.locator('#assets [data-id="SP-ARCH-S"]').isDisabled());
  } finally {
    await browser.close();
  }
});

test(
  'a refresh started after DVR return can veto the replacement of the clip',
  {
    skip: process.env.RUN_LIVE !== '1',
    timeout: 65000
  },
  async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(app);
      await page.locator('#assets [data-id="SP-LIVE-S"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => Number(document.querySelector('#seek').min) < -5);
      await page.locator('#seek').evaluate((i) => {
        i.value = -4;
        i.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(() => document.querySelector('#log [data-event=TimeShifted]'));
      await page.locator('#assets [data-id="SP-CLIP-A"]').click();
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return (
          !document.querySelector('#controls').disabled &&
          !document.querySelector('#earlier').hidden &&
          video?.currentTime > 0.2 &&
          video.currentTime < 20
        );
      });
      const clip = await page.locator('video').elementHandle();
      const returnRead = Promise.withResolvers(),
        releaseReturn = Promise.withResolvers();
      const refreshRead = Promise.withResolvers(),
        releaseRefresh = Promise.withResolvers();
      let count = 0;
      await page.route(statusPath, async (route) => {
        const number = ++count;
        const response = await route.fetch();
        const update = await response.json();
        if (number === 1) {
          returnRead.resolve();
          await releaseReturn.promise;
          await route.fulfill({ response });
        } else {
          refreshRead.resolve();
          await releaseRefresh.promise;
          await route.fulfill({ response, json: { ...update, seekableUtcStartMs: update.seekableUtcEndMs } });
        }
      });
      await page.locator('#earlier').click();
      await returnRead.promise;
      await page.locator('#refresh').click();
      await refreshRead.promise;
      const ret = page.waitForResponse((r) => r.url().endsWith('/api/events/SP-EVENT-S'));
      releaseReturn.resolve();
      await (await ret).finished();
      releaseRefresh.resolve();
      await page.waitForFunction(() =>
        document.querySelector('#message').textContent.includes('keep watching this clip')
      );
      assert.ok(await clip.evaluate((v) => v === document.querySelector('video')));
      assert.equal(await page.locator('#assets [aria-current=true]').getAttribute('data-id'), 'SP-CLIP-A');
    } finally {
      await browser.close();
    }
  }
);
