import { parseRecord } from './learning.js';

// IndexedDB commits the bookmark (or completion) and revision together.
const databaseName = 'reference.elearning.checkpoints';
let connection;
let opening;

function openDatabase() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
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

function legacyState(key, revision) {
  const raw = localStorage.getItem(key);
  const previous = parseRecord(raw);
  // The revision-only format removed the payload at EOF. A leftover or
  // mismatched Web Storage value cannot override that committed revision.
  const record = revision === undefined || previous?.revision === revision ? previous : null;
  const version = revision ?? record?.revision ?? null;
  if (record) delete record.revision;
  return { state: { record, revision: version }, raw };
}

function transact(db, key, operation, readonly) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('bookmarks', readonly ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('bookmarks');
    const read = store.get(key);
    let result, legacy, onCommit, error;
    read.onsuccess = () => {
      try {
        let state = read.result;
        if (state === undefined || typeof state === 'string') {
          const previous = legacyState(key, state);
          if (!readonly && (state !== undefined || previous.raw !== null)) {
            store.put(previous.state, key);
            legacy = previous.raw;
          }
          state = previous.state;
        }
        result = operation(state, store, (callback) => {
          onCommit = callback;
        });
      } catch (exception) {
        error = exception;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      onCommit?.();
      if (legacy != null) {
        try {
          if (localStorage.getItem(key) === legacy) localStorage.removeItem(key);
        } catch {
          // Once committed, every client read uses the IndexedDB record.
        }
      }
      resolve(result);
    };
    transaction.onabort = () => reject(error ?? transaction.error);
  });
}

function access(key, operation, readonly = false) {
  if (connection) return transact(connection, key, operation, readonly);
  return openDatabase().then((db) => transact(db, key, operation, readonly));
}

export async function readCheckpoint(key) {
  try {
    return await access(key, ({ record, revision }) => record && { ...record, revision }, true);
  } catch {
    // Only an origin that never created this database can safely read a
    // legacy-only save when IndexedDB is unavailable. Otherwise its latest
    // committed record may be a completion.
    try {
      const databases = await indexedDB.databases();
      if (!databases.some((db) => db.name === databaseName)) return parseRecord(localStorage.getItem(key));
    } catch {
      /* Storage may be blocked entirely. */
    }
    return null;
  }
}

export class CheckpointWriter {
  constructor(key) {
    this.key = key;
    this.revision = null;
    this.owns = false;
  }
  #replace(record, store, committed) {
    const revision = crypto.getRandomValues(new Uint32Array(4)).join('.');
    store.put({ record, revision }, this.key);
    committed(() => {
      this.revision = revision;
      this.owns = record !== null;
    });
  }
  enter(initial, intent) {
    return access(this.key, ({ record, revision }, store, committed) => {
      if (intent === 'catalog' && record?.seconds > 0) return record;
      if (intent === 'automatic') {
        committed(() => {
          this.revision = revision;
          this.owns = true;
        });
      } else {
        this.#replace(record ?? initial, store, committed);
      }
      return null;
    });
  }
  write(record, claim = false) {
    return access(this.key, ({ revision }, store, committed) => {
      if (!claim && (!this.owns || revision !== this.revision)) return false;
      this.#replace(record, store, committed);
      return true;
    });
  }
}
