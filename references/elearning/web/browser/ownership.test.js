import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const native = process.env.BROWSER === 'webkit';
const launch = () => (native ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
const url = process.env.APP_URL || 'http://localhost:5181';
const key = 'reference.elearning.resume.a/EDU-FX-01';
const seed = { seconds: 10, speed: 1, caption: 'off', mode: 'custom', autoAdvance: false };
async function open(context) {
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('#lessons button').first().waitFor();
  await page.selectOption('#mode', 'custom');
  return page;
}
async function choose(page) {
  await page.locator('#lessons button').first().click();
}
async function pause(page) {
  await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
  await page.locator('#play').click();
  await page.waitForFunction(() => document.querySelector('video').paused);
}
async function seek(page, seconds) {
  await page.locator('#seek').evaluate((input, target) => {
    input.value = target;
    input.dispatchEvent(new Event('change'));
  }, seconds);
}
async function savedAt(page, seconds) {
  await page.waitForFunction(
    ([key, t]) => Math.abs(JSON.parse(localStorage.getItem(key))?.seconds - t) < 0.25,
    [key, seconds]
  );
}
function holdMedia(page, pattern) {
  let release, started;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const ready = page.route(pattern, async (route) => {
    started();
    await wait;
    await route.continue().catch(() => {});
  });
  return { ready, pending, release };
}

for (const choice of ['resume', 'restart'])
  test('a stale prompt claims at ' + choice + ' before loading', { timeout: 45000 }, async () => {
    const browser = await launch();
    let held;
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const first = await open(context);
      await first.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, seed]);
      await choose(first);
      await first.locator('#resume').waitFor();
      const second = await open(context);
      await choose(second);
      await second.locator('#resume').click();
      await pause(second);
      await seek(second, 25);
      await savedAt(second, 25);
      const previousRevision = await second.evaluate(
        (k) => JSON.parse(localStorage.getItem(k)).revision,
        key
      );
      held = holdMedia(first, '**/EDU-FX-01/hls/*.m3u8');
      await held.ready;
      await first.locator('#' + choice).click();
      await held.pending;
      await first.waitForFunction(
        ([k, previous]) => {
          const bookmark = JSON.parse(localStorage.getItem(k));
          return bookmark?.seconds === 25 && bookmark.revision !== previous;
        },
        [key, previousRevision]
      );
      await seek(second, 30);
      await savedAt(second, 30);
      held.release();
      await first.waitForFunction(
        () => !document.querySelector('#controls').disabled && !document.querySelector('video').paused
      );
      await pause(first);
      await savedAt(second, 30);
    } finally {
      held?.release();
      await browser.close();
    }
  });

test(
  'a Play request before buffering cannot take a subsequent user save on Playing',
  { skip: native, timeout: 45000 },
  async () => {
    const browser = await launch();
    let held;
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const first = await open(context);
      await choose(first);
      await pause(first);
      await seek(first, 10);
      await savedAt(first, 10);
      const second = await open(context);
      await choose(second);
      await second.locator('#resume').click();
      await pause(second);
      held = holdMedia(first, '**/EDU-FX-01/hls/*.ts');
      await held.ready;
      await seek(first, 140);
      await held.pending;
      const playingEvents = () =>
        first
          .locator('#log li')
          .filter({ hasText: / · Playing$/ })
          .count();
      const previous = await playingEvents();
      const old = await first.evaluate((k) => JSON.parse(localStorage.getItem(k)).revision, key);
      await first.locator('#play').click();
      await first.waitForFunction(
        ([k, rev]) => JSON.parse(localStorage.getItem(k)).revision !== rev,
        [key, old]
      );
      assert.equal(await playingEvents(), previous);
      await seek(second, 25);
      await savedAt(second, 25);
      held.release();
      await first.waitForFunction(() => document.querySelector('video').currentTime > 141);
      assert.ok((await playingEvents()) > previous);
      await pause(first);
      await savedAt(second, 25);
    } finally {
      held?.release();
      await browser.close();
    }
  }
);

test(
  'a blocked bookmark database preserves a legacy save and allows playback',
  { timeout: 40000 },
  async () => {
    const browser = await launch();
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      await context.addInitScript(() => {
        const open = IDBFactory.prototype.open;
        IDBFactory.prototype.open = function (name, ...args) {
          if (name === 'reference.elearning.checkpoints')
            throw new DOMException('Unavailable', 'SecurityError');
          return open.call(this, name, ...args);
        };
      });
      const page = await open(context);
      await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, seed]);
      await choose(page);
      await page.locator('#resume').click();
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 10.5);
      await pause(page);
      await seek(page, 25);
      await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 25) < 0.5);
      await page.locator('#storageStatus').waitFor();
      assert.match(await page.locator('#storageStatus').textContent(), /could not save/i);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), JSON.stringify(seed));
    } finally {
      await browser.close();
    }
  }
);

async function chooseById(page, id) {
  await page.locator('#lessons button[data-id="' + id + '"]').click();
}

test(
  'standard seek buttons and the focused timeline keyboard take a stale bookmark',
  { timeout: 40000 },
  async () => {
    const browser = await launch();
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const first = await open(context);
      await choose(first);
      await pause(first);
      await seek(first, 10);
      await savedAt(first, 10);
      await first.selectOption('#mode', 'standard');
      const second = await open(context);
      await choose(second);
      await second.locator('#resume').click();
      await second.selectOption('#mode', 'custom');
      await pause(second);
      for (const [action, seconds, otherPosition] of [
        ['forward', 20, 25],
        ['rewind', 10, 26],
        ['keyboard', 11, 27]
      ]) {
        await seek(second, otherPosition);
        await savedAt(second, otherPosition);
        await first.locator('#player').hover();
        if (action === 'keyboard') await first.locator('#player .bmpui-ui-seekbar').press('ArrowRight');
        else
          await first
            .locator('#player .bmpui-ui-quickseekbutton[data-bmpui-seek-direction="' + action + '"]')
            .click({ force: true });
        await first.waitForFunction(
          (t) => Math.abs(document.querySelector('video').currentTime - t) < 0.25,
          seconds
        );
        await savedAt(first, seconds);
      }
      await seek(second, 29);
      await savedAt(second, 29);
      const timeline = first.locator('#player .bmpui-ui-seekbar');
      await timeline.press('Space');
      await first.waitForFunction(() => document.querySelector('video').currentTime > 12.25);
      await timeline.press('Space');
      await first.waitForFunction((k) => {
        const video = document.querySelector('video');
        const seconds = JSON.parse(localStorage.getItem(k))?.seconds;
        return video.paused && Math.abs(seconds - video.currentTime) < 0.25;
      }, key);
      const position = await first.evaluate(
        (k) => Math.floor(JSON.parse(localStorage.getItem(k)).seconds),
        key
      );
      await first.locator('#course').click();
      await choose(first);
      await first.locator('#resume').waitFor();
      assert.equal(await first.locator('#resume').textContent(), 'Resume at 0:' + position);
    } finally {
      await browser.close();
    }
  }
);

test(
  'a failed Next preserves the existing bookmark until its source can play',
  { timeout: 45000 },
  async () => {
    const browser = await launch();
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const page = await open(context);
      const nextKey = 'reference.elearning.resume.a/EDU-FX-02';
      await page.evaluate(
        ([k, v]) => localStorage.setItem(k, JSON.stringify({ ...v, seconds: 25 })),
        [nextKey, seed]
      );
      await choose(page);
      await pause(page);
      await page.route('**/EDU-FX-02/hls/*.m3u8', (route) =>
        route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
      );
      await page.locator('#next').click();
      await page.locator('#retry').waitFor();
      await page.locator('#course').click();
      await chooseById(page, 'EDU-FX-02');
      await page.locator('#resume').waitFor();
      assert.match(await page.locator('#resume').textContent(), /0:25/);
    } finally {
      await browser.close();
    }
  }
);

for (const rival of [false, true])
  test(
    'automatic playlist entry ' +
      (rival
        ? 'preserves a newer gesture during loading'
        : 'saves on progress and protects a later save after EOF'),
    { timeout: 45000 },
    async () => {
      const browser = await launch();
      let held;
      try {
        const context = await browser.newContext({ locale: 'en-US' });
        const summaryKey = 'reference.elearning.resume.a/EDU-FX-03';
        const second = await open(context);
        await chooseById(second, 'EDU-FX-03');
        await pause(second);
        await seek(second, 4);
        await second.waitForFunction((k) => JSON.parse(localStorage.getItem(k))?.seconds === 4, summaryKey);
        const queue = await open(context);
        await queue.locator('#auto').check();
        await chooseById(queue, 'EDU-FX-02');
        await queue.waitForFunction(() => document.querySelector('video')?.currentTime > 0.25);
        held = holdMedia(queue, '**/EDU-FX-03/hls/*.m3u8');
        await held.ready;
        await seek(queue, 779);
        await held.pending;
        assert.equal(
          await queue.evaluate((k) => JSON.parse(localStorage.getItem(k)).seconds, summaryKey),
          4
        );
        if (rival) {
          await seek(second, 6);
          await second.waitForFunction(
            (k) => JSON.parse(localStorage.getItem(k))?.seconds === 6,
            summaryKey
          );
        }
        held.release();
        await queue.waitForFunction(
          () =>
            document.querySelector('#title').textContent === 'Summary' &&
            document.querySelector('video')?.currentTime > 1
        );
        if (!rival) {
          await pause(queue);
          await queue.waitForFunction((k) => {
            const seconds = JSON.parse(localStorage.getItem(k))?.seconds;
            return seconds >= 1 && seconds < 3.5;
          }, summaryKey);
          await queue.locator('#play').click();
        }
        await queue.waitForFunction(
          () => document.querySelector('#message').textContent === 'Lesson finished.'
        );
        if (!rival) {
          await queue.waitForFunction((k) => localStorage.getItem(k) === null, summaryKey);
          await seek(second, 6);
          await second.waitForFunction(
            (k) => JSON.parse(localStorage.getItem(k))?.seconds === 6,
            summaryKey
          );
        }
        await queue.selectOption('#mode', 'standard');
        await queue.selectOption('#mode', 'custom');
        await queue.locator('#course').click();
        await chooseById(queue, 'EDU-FX-03');
        await queue.locator('#resume').waitFor();
        assert.match(await queue.locator('#resume').textContent(), /0:06/);
      } finally {
        held?.release();
        await browser.close();
      }
    }
  );

test(
  'a pending automatic entry cannot revive a lesson completed in another window',
  { timeout: 45000 },
  async () => {
    const browser = await launch();
    let held;
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const key = 'reference.elearning.resume.a/EDU-FX-03';
      const queue = await open(context);
      await queue.locator('#auto').check();
      await chooseById(queue, 'EDU-FX-02');
      await queue.waitForFunction(() => document.querySelector('video')?.currentTime > 0.25);
      held = holdMedia(queue, '**/EDU-FX-03/hls/*.m3u8');
      await held.ready;
      await seek(queue, 779);
      await held.pending;
      assert.equal(await queue.evaluate((k) => localStorage.getItem(k), key), null);

      const finisher = await open(context);
      await chooseById(finisher, 'EDU-FX-03');
      await finisher.waitForFunction(() => document.querySelector('video')?.currentTime > 0.25);
      await seek(finisher, 7);
      await finisher.waitForFunction(
        () => document.querySelector('#message').textContent === 'Lesson finished.'
      );
      await finisher.waitForFunction((k) => localStorage.getItem(k) === null, key);
      held.release();
      await queue.waitForFunction(
        () =>
          document.querySelector('#title').textContent === 'Summary' &&
          document.querySelector('video')?.currentTime > 2
      );
      await queue.locator('#course').click();
      await chooseById(queue, 'EDU-FX-03');
      await queue.waitForFunction(
        () => !document.querySelector('#controls').disabled || !document.querySelector('#choices').hidden
      );
      assert.equal(await queue.locator('#choices').isVisible(), false);
    } finally {
      held?.release();
      await browser.close();
    }
  }
);
