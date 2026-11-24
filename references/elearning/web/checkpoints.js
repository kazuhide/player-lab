import { parseRecord } from './learning.js';

// All tabs use a readwrite transaction on the same object store. IndexedDB
// serializes overlapping transactions, including on HTTP origins without
// Web Locks. The store retains only the last revision, including after EOF.
// Bookmark data stays under its existing Web Storage key.
let connection;
let opening;

function openDatabase() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('reference.elearning.checkpoints', 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('bookmarks');
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Bookmark database blocked'));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        connection = db;
        db.onversionchange = () => {
          db.close();
          connection = opening = undefined;
        };
        resolve(db);
      };
    }).catch((error) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

function serialized(key, operation) {
  if (!connection) return openDatabase().then((db) => transact(db, key, operation));
  // Enqueue from the originating gesture as soon as the connection is ready.
  return transact(connection, key, operation);
}

function transact(db, key, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('bookmarks', 'readwrite');
    let result;
    let error;
    const store = transaction.objectStore('bookmarks');
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        result = operation(store, request.result);
      } catch (exception) {
        error = exception;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(error ?? transaction.error);
  });
}

export class CheckpointWriter {
  constructor(key) {
    this.key = key;
    this.expected = null;
    this.revision = undefined;
    this.owns = false;
  }
  #replace(record, store) {
    const revision = crypto.getRandomValues(new Uint32Array(4)).join('.');
    const value =
      record === null
        ? null
        : JSON.stringify({
            ...record,
            revision
          });
    // If IndexedDB denies the write, keep the previous readable bookmark.
    store.put(revision, this.key).onsuccess = () => {
      try {
        if (value === null) localStorage.removeItem(this.key);
        else localStorage.setItem(this.key, value);
        this.expected = value;
        this.revision = revision;
        this.owns = value !== null;
      } catch {
        store.transaction.abort();
      }
    };
  }
  enter(initial, intent) {
    return serialized(this.key, (store, revision) => {
      const current = localStorage.getItem(this.key);
      const previous = parseRecord(current);
      if (intent === 'catalog' && previous?.seconds > 0) return previous;
      if (intent === 'automatic') {
        // Adopt the record seen on entry. The next real progress update succeeds
        // only if no other window replaced it while the new lesson was loading.
        this.expected = current;
        this.revision = revision;
        this.owns = true;
      } else {
        // Reserve the bookmark at the gesture. Keep its last playable position
        // until this source actually starts, including across a failed load.
        this.#replace(previous ?? initial, store);
      }
      return null;
    });
  }
  write(record, claim = false) {
    return serialized(this.key, (store, revision) => {
      const current = localStorage.getItem(this.key);
      if (!claim && (!this.owns || current !== this.expected || revision !== this.revision)) return false;
      this.#replace(record, store);
      return true;
    });
  }
}
