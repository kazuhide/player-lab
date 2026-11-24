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

test(
  'courses constrain sequencing and following scrolls only the transcript',
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.route('**/catalog.json', async (route) => {
        const res = await route.fetch();
        const catalog = await res.json();
        catalog.courses.push({ id: 'review', title: 'Review', lessonIds: ['EDU-FX-02', 'EDU-FX-01'] });
        await route.fulfill({ response: res, json: catalog });
      });
      await page.goto(process.env.APP_URL || 'http://localhost:5181');
      await page.locator('#courseSelect').selectOption('review');
      assert.deepEqual(
        await page.locator('#lessons button').evaluateAll((bs) => bs.map((b) => b.dataset.id)),
        ['EDU-FX-02', 'EDU-FX-01']
      );
      await page.locator('#auto').check();
      await page.locator('#lessons button').last().click();
      await page.selectOption('#mode', 'custom');
      await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
      await page.locator('#play').click();
      await page.selectOption('#captions', 'off');
      await page.locator('#results button').first().waitFor();
      await page.addStyleTag({ content: '#results {max-height: 4rem}' });
      const seek = async (seconds) => {
        await page.locator('#seek').evaluate((i, s) => {
          i.value = s;
          i.dispatchEvent(new Event('change'));
        }, seconds);
        await page.waitForFunction(
          (s) => Math.abs(document.querySelector('video').currentTime - s) < 0.5,
          seconds
        );
      };
      await seek(40);
      await page.waitForFunction(
        () =>
          document.querySelector('#results').scrollTop > 0 &&
          document.querySelector('#results [aria-current=true]')?.dataset.start === '40000'
      );
      await page.locator('#results').dispatchEvent('wheel', { deltaY: -40 });
      assert.equal(await page.locator('#follow').isChecked(), false);
      await page.locator('#results').evaluate((list) => (list.scrollTop = 0));
      await seek(20);
      assert.equal(await page.locator('#results').evaluate((l) => l.scrollTop), 0);
      await page.fill('#query', 'point');
      await page.locator('#follow').check();
      await seek(178);
      assert.equal(await page.locator('#results').evaluate((l) => l.scrollTop), 0);
      assert.equal(await page.inputValue('#captions'), 'off');
      assert.equal(await page.locator('#next').isDisabled(), true);
      await page.locator('#play').click();
      await page.waitForFunction(
        () => document.querySelector('#message').textContent === 'Lesson finished.'
      );
      assert.equal(await page.locator('#title').textContent(), 'Number-line basics');
      await page.selectOption('#learner', 'b');
      assert.equal(await page.inputValue('#courseSelect'), 'EDU-COURSE-01');
      assert.equal(await page.locator('#lessons button').count(), 3);
      await page.selectOption('#learner', 'a');
      assert.equal(await page.inputValue('#courseSelect'), 'review');
      assert.equal(await page.locator('#lessons button').count(), 2);
      await page.reload();
      await page.locator('#lessons button').first().waitFor();
      assert.equal(await page.inputValue('#courseSelect'), 'EDU-COURSE-01');
      assert.equal(await page.locator('#play').isDisabled(), true);
    } finally {
      await browser.close();
    }
  }
);

test(
  'hiding a pending Resume cancels autoplay and the prompt honors the final sequencing choice',
  { timeout: 60000 },
  async () => {
    const browser = await launch();
    try {
      const page = await browser.newPage({ locale: 'en-US' });
      await page.goto(process.env.APP_URL || 'http://localhost:5181');
      await page.locator('#lessons button').first().waitFor();
      await page.evaluate(() =>
        localStorage.setItem(
          'reference.elearning.resume.a/EDU-FX-02',
          JSON.stringify({ seconds: 12, speed: 1, caption: 'off', mode: 'custom', autoAdvance: true })
        )
      );
      await page.locator('#auto').check();
      await page.locator('#lessons button').nth(1).click();
      await page.locator('#resume').waitFor();
      await page.locator('#auto').uncheck();
      let resumeLoad;
      const release = new Promise((resolve) => {
        resumeLoad = resolve;
      });
      let reportLoad;
      const loading = new Promise((resolve) => {
        reportLoad = resolve;
      });
      await page.route('**/EDU-FX-02/hls/*.m3u8', async (route) => {
        reportLoad();
        await release;
        await route.continue();
      });
      await page.locator('#resume').click();
      await loading;
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      resumeLoad();
      await page.waitForFunction(
        () =>
          !document.querySelector('#controls').disabled &&
          document.querySelector('video')?.currentTime >= 11.5
      );
      assert.ok(await page.locator('video').evaluate((v) => v.paused));
      assert.equal(await page.locator('#log [data-event="Playing"]').count(), 0);
      await page.locator('#seek').evaluate((input) => {
        input.value = Number(input.max) - 1;
        input.dispatchEvent(new Event('change'));
      });
      await page.locator('#play').click();
      await page.waitForFunction(
        () => document.querySelector('#message').textContent === 'Lesson finished.'
      );
      assert.equal(await page.locator('#next').isEnabled(), true);
    } finally {
      await browser.close();
    }
  }
);

test(
  'closing an older paused tab preserves a newer same-learner checkpoint',
  { timeout: 65000 },
  async () => {
    const browser = await launch();
    try {
      const context = await browser.newContext({ locale: 'en-US' });
      const key = 'reference.elearning.resume.a/EDU-FX-01';
      const openLesson = async () => {
        const page = await context.newPage();
        await page.goto(process.env.APP_URL || 'http://localhost:5181');
        await page.locator('#lessons button').first().click();
        return page;
      };
      const saveAt = async (page, seconds) => {
        await page.selectOption('#mode', 'custom');
        await page.waitForFunction(() => document.querySelector('#play').textContent === 'Pause');
        await page.locator('#play').click();
        await page.locator('#seek').evaluate((input, s) => {
          input.value = s;
          input.dispatchEvent(new Event('change'));
        }, seconds);
        await page.waitForFunction(
          ([id, s]) => Math.abs(JSON.parse(localStorage.getItem(id))?.seconds - s) < 0.5,
          [key, seconds]
        );
      };
      const older = await openLesson();
      await saveAt(older, 10);
      const newer = await openLesson();
      await newer.locator('#resume').click();
      await saveAt(newer, 23);
      await older.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      await older.close();
      await newer.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.seconds >= 22.5, key);
      await newer.locator('#course').click();
      await newer.locator('#lessons button').first().click();
      assert.match(await newer.locator('#resume').textContent(), /0:23/);
    } finally {
      await browser.close();
    }
  }
);
