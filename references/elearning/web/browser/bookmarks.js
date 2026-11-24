import { readFile } from 'node:fs/promises';

// Read through the application's checkpoint API, including for production bundles.
export async function installBookmarkReader(surface) {
  for (const name of ['checkpoints.js', 'learning.js']) {
    const body = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    await surface.route('**/__bookmark_test/' + name, (route) =>
      route.fulfill({ contentType: 'application/javascript', body })
    );
  }
  await surface.addInitScript(() => {
    window.readSaved = (key) =>
      import('/__bookmark_test/checkpoints.js').then((module) => module.readCheckpoint(key));
  });
}

export async function allowCommitAbort(surface) {
  await surface.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (
        this.name === 'bookmarks' &&
        window.abortNextBookmark &&
        this.transaction.db.name === 'reference.elearning.checkpoints'
      ) {
        window.abortNextBookmark = false;
        const transaction = this.transaction;
        request.addEventListener('success', () => transaction.abort(), { once: true });
      }
      return request;
    };
  });
}
