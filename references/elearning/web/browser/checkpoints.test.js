import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

test(
  'two windows serialize bookmark saves and completion in either order',
  { timeout: 30000 },
  async () => {
    const browser =
      process.env.BROWSER === 'webkit'
        ? await webkit.launch()
        : await chromium.launch({ channel: 'chrome' });
    try {
      const context = await browser.newContext();
      const origin = 'http://localhost:18919';
      for (const name of ['checkpoints.js', 'learning.js']) {
        const body = await readFile(new URL('../' + name, import.meta.url), 'utf8');
        await context.route(origin + '/' + name, (route) =>
          route.fulfill({ contentType: 'application/javascript', body })
        );
      }
      await context.route(origin + '/', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<script type="module">import {CheckpointWriter} from "/checkpoints.js"; window.bookmark = new CheckpointWriter("test-key");</script>'
        })
      );
      const pages = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
      const [owner, other, gate] = pages;
      await Promise.all(
        pages.map(async (page) => {
          await page.goto(origin);
          await page.waitForFunction(() => window.bookmark !== undefined);
          await page.evaluate(() => bookmark.enter({ seconds: 11, speed: 1, caption: 'off' }, 'automatic'));
        })
      );
      // The first window entered an empty lesson and is still waiting for media.
      // A different window starts that lesson, saves, and finishes it before the first load completes.
      await other.evaluate(() => bookmark.enter({ seconds: 0, speed: 1, caption: 'off' }, 'catalog'));
      assert.equal(
        await other.evaluate(() => bookmark.write({ seconds: 3, speed: 1, caption: 'off' })),
        true
      );
      assert.equal(await other.evaluate(() => bookmark.write(null)), true);
      assert.equal(
        await owner.evaluate(() => bookmark.write({ seconds: 2, speed: 1, caption: 'off' })),
        false
      );
      assert.equal(await gate.evaluate(() => localStorage.getItem('test-key')), null);
      for (const otherFirst of [true, false]) {
        for (const terminal of [true, false]) {
          await owner.evaluate(() => bookmark.write({ seconds: 11, speed: 1, caption: 'off' }, true));
          // Keep a transaction open to guarantee both windows have enqueued their writes before either runs.
          await gate.evaluate(
            () =>
              new Promise((resolve) => {
                window.releaseGate = false;
                const request = indexedDB.open('reference.elearning.checkpoints');
                request.onsuccess = () => {
                  const db = request.result;
                  const transaction = db.transaction('bookmarks', 'readwrite');
                  transaction.oncomplete = () => db.close();
                  const store = transaction.objectStore('bookmarks');
                  const hold = () => {
                    store.get('test-key').onsuccess = () => {
                      resolve();
                      if (!window.releaseGate) hold();
                    };
                  };
                  hold();
                };
              })
          );
          const write = (page, record, claim) =>
            page.evaluate(
              ([record, claim]) => {
                window.pendingWrite = bookmark.write(record, claim);
              },
              [record, claim]
            );
          const passive = () =>
            write(owner, terminal ? null : { seconds: 12, speed: 1, caption: 'off' }, false);
          const active = () => write(other, { seconds: 25, speed: 1, caption: 'off' }, true);
          if (otherFirst) {
            await active();
            await passive();
          } else {
            await passive();
            await active();
          }
          assert.equal(await gate.evaluate(() => JSON.parse(localStorage.getItem('test-key')).seconds), 11);
          await gate.evaluate(() => {
            window.releaseGate = true;
          });
          const [saved] = await Promise.all([
            other.evaluate(() => window.pendingWrite),
            owner.evaluate(() => window.pendingWrite)
          ]);
          assert.equal(saved, true);
          assert.equal(await gate.evaluate(() => JSON.parse(localStorage.getItem('test-key')).seconds), 25);
        }
      }
    } finally {
      await browser.close();
    }
  }
);
