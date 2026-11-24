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

test(
  'delivery changes preserve clip, play intent, position and settings',
  { skip: engine !== 'chromium', timeout: 65000 },
  async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5182');
      await page.selectOption('#format', 'hls');
      await page.locator('#assets button[data-id="SP-CLIP-A"]').click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
      await page.locator('#play').click();
      await page.locator('#seek').evaluate((i) => {
        i.value = '7';
        i.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 7) < 0.5);
      await page.selectOption('#speed', '1.5');
      await page.selectOption('#captions', 'ja');
      async function switchFormat(format, suffix) {
        const manifest = page.waitForResponse(
          (r) => new URL(r.url()).pathname.endsWith('/SP-CLIP-A/' + suffix) && r.ok()
        );
        await page.selectOption('#format', format);
        await manifest;
        await page.waitForFunction(
          () =>
            !document.querySelector('#controls').disabled && document.querySelector('video').readyState >= 2
        );
        assert.equal(
          await page.locator('#assets button[aria-current=true]').getAttribute('data-id'),
          'SP-CLIP-A'
        );
        assert.equal(await page.inputValue('#captions'), 'ja');
        assert.equal(await page.inputValue('#speed'), '1.5');
      }
      await switchFormat('dash', 'dash/manifest.mpd');
      assert.ok(await page.locator('video').evaluate((v) => v.paused && Math.abs(v.currentTime - 7) < 1));
      await page.locator('#play').click();
      await page.waitForFunction(() => document.querySelector('video').currentTime > 7.5);
      const before = await page.locator('video').evaluate((v) => v.currentTime);
      await switchFormat('hls', 'hls/external.m3u8');
      await page.waitForFunction(
        (s) =>
          !document.querySelector('video').paused && document.querySelector('video').currentTime >= s - 0.3,
        before
      );
      assert.ok(await page.locator('video').evaluate((v, pos) => v.currentTime < pos + 2, before));
    } finally {
      await browser.close();
    }
  }
);
test('unavailable delivery leaves the active clip in place', { skip: engine !== 'chromium' }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ locale: 'en-US' });
    await page.route('**/catalog.json', async (route) => {
      const res = await route.fetch();
      const catalog = await res.json();
      delete catalog.assets.find((a) => a.id === 'SP-CLIP-A').streams.dash;
      await route.fulfill({ response: res, json: catalog });
    });
    await page.goto(process.env.APP_URL || 'http://localhost:5182');
    await page.locator('#assets button[data-id="SP-CLIP-A"]').click();
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.2);
    const video = await page.locator('video').elementHandle();
    await page.selectOption('#format', 'dash');
    assert.equal(await page.inputValue('#format'), 'hls');
    assert.ok(await video.evaluate((v) => v === document.querySelector('video') && !v.paused));
    assert.match(await page.locator('#message').textContent(), /unavailable/);
  } finally {
    await browser.close();
  }
});
