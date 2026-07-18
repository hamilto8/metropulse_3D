import { SAVE_SLOTS } from './SaveSchema.js';

export const SAVE_DATABASE_NAME = 'metropulse3d:saves';
export const SAVE_DATABASE_VERSION = 1;
export const SAVE_OBJECT_STORE = 'slots';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => {};
  });
}

function defaultIndexedDB() {
  try {
    return globalThis.indexedDB;
  } catch {
    return null;
  }
}

export class IndexedDbSaveRepository {
  #databasePromise = null;

  constructor({
    indexedDBRef = defaultIndexedDB(),
    databaseName = SAVE_DATABASE_NAME
  } = {}) {
    this.indexedDB = indexedDBRef;
    this.databaseName = databaseName;
  }

  open() {
    if (this.#databasePromise) return this.#databasePromise;
    if (!this.indexedDB?.open) return Promise.reject(new Error('IndexedDB save storage is unavailable.'));
    this.#databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = this.indexedDB.open(this.databaseName, SAVE_DATABASE_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SAVE_OBJECT_STORE)) {
          request.result.createObjectStore(SAVE_OBJECT_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the save database.'));
      request.onblocked = () => reject(new Error('The save database is blocked by another MetroPulse tab.'));
    }).catch(error => {
      this.#databasePromise = null;
      throw error;
    });
    return this.#databasePromise;
  }

  async read(slot) {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readonly');
    return requestResult(transaction.objectStore(SAVE_OBJECT_STORE).get(slot));
  }

  async readSlots() {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readonly');
    const store = transaction.objectStore(SAVE_OBJECT_STORE);
    const [current, recovery] = await Promise.all([
      requestResult(store.get(SAVE_SLOTS.CURRENT)),
      requestResult(store.get(SAVE_SLOTS.RECOVERY))
    ]);
    return Object.freeze({ current, recovery });
  }

  /**
   * Replaces current and copies the prior current to recovery in one
   * transaction. If any request fails, IndexedDB rolls the whole operation
   * back, preserving both known-good slots.
   */
  async commitCurrent(document) {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    const store = transaction.objectStore(SAVE_OBJECT_STORE);
    const prior = await requestResult(store.get(SAVE_SLOTS.CURRENT));
    if (prior != null) store.put(prior, SAVE_SLOTS.RECOVERY);
    store.put(document, SAVE_SLOTS.CURRENT);
    await transactionComplete(transaction);
    return document;
  }

  async putRecovery(document) {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    transaction.objectStore(SAVE_OBJECT_STORE).put(document, SAVE_SLOTS.RECOVERY);
    await transactionComplete(transaction);
    return document;
  }

  async putCurrent(document) {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    transaction.objectStore(SAVE_OBJECT_STORE).put(document, SAVE_SLOTS.CURRENT);
    await transactionComplete(transaction);
    return document;
  }

  async promoteRecovery() {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    const store = transaction.objectStore(SAVE_OBJECT_STORE);
    const recovery = await requestResult(store.get(SAVE_SLOTS.RECOVERY));
    if (recovery == null) {
      transaction.abort();
      throw new Error('No recovery save is available.');
    }
    // Do not rotate a corrupt current value over the selected recovery save.
    store.put(recovery, SAVE_SLOTS.CURRENT);
    await transactionComplete(transaction);
    return recovery;
  }

  async clearCurrent({ preserveAsRecovery = true } = {}) {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    const store = transaction.objectStore(SAVE_OBJECT_STORE);
    if (preserveAsRecovery) {
      const prior = await requestResult(store.get(SAVE_SLOTS.CURRENT));
      if (prior != null) store.put(prior, SAVE_SLOTS.RECOVERY);
    }
    store.delete(SAVE_SLOTS.CURRENT);
    await transactionComplete(transaction);
    return true;
  }

  async clearAll() {
    const database = await this.open();
    const transaction = database.transaction(SAVE_OBJECT_STORE, 'readwrite');
    transaction.objectStore(SAVE_OBJECT_STORE).clear();
    await transactionComplete(transaction);
    return true;
  }

  async close() {
    const database = await this.#databasePromise;
    database?.close?.();
    this.#databasePromise = null;
  }
}

export default IndexedDbSaveRepository;
