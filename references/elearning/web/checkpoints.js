import { parseRecord } from './learning.js';

// All tabs use a readwrite transaction on the same object store. IndexedDB
// serializes overlapping transactions, including on HTTP origins without
// Web Locks. The payload stays under its existing Web Storage key.
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
    transaction.objectStore('bookmarks').get(key).onsuccess = () => {
      try {
        result = operation();
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
    this.owns = false;
  }
  #replace(record) {
    const value =
      record === null
        ? null
        : JSON.stringify({
            ...record,
            revision: crypto.getRandomValues(new Uint32Array(4)).join('.')
          });
    if (value === null) localStorage.removeItem(this.key);
    else localStorage.setItem(this.key, value);
    this.expected = value;
    this.owns = value !== null;
  }
  select(initial) {
    return serialized(this.key, () => {
      const previous = parseRecord(localStorage.getItem(this.key));
      if (previous?.seconds > 0) return previous;
      this.#replace(initial);
      return null;
    });
  }
  write(record, claim = false) {
    return serialized(this.key, () => {
      const current = localStorage.getItem(this.key);
      if (!claim && (!this.owns || current !== this.expected)) return false;
      this.#replace(record);
      return true;
    });
  }
  // Natural playlist progression may start an empty bookmark. Only an
  // explicit viewer action takes over an existing bookmark.
  startIfEmpty(record) {
    return serialized(this.key, () => {
      if (localStorage.getItem(this.key) !== null) return false;
      this.#replace(record);
      return true;
    });
  }
}
