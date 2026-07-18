const PROBE_DATABASE_NAME = 'metropulse3d:capability-probe';
const PROBE_STORE_NAME = 'probe';
const PROBE_STORAGE_KEY = 'metropulse3d:capability-probe';

function safeGlobal(name) {
  try {
    return globalThis[name];
  } catch {
    return null;
  }
}

export const CAPABILITY_IDS = Object.freeze({
  WEBGL2: 'webgl2',
  LOCAL_STORAGE: 'localStorage',
  INDEXED_DB: 'indexedDB'
});

export const CAPABILITY_GUIDANCE = Object.freeze({
  [CAPABILITY_IDS.WEBGL2]: 'Enable browser hardware acceleration, update your graphics driver, then reload MetroPulse.',
  [CAPABILITY_IDS.LOCAL_STORAGE]: 'Allow this site to store local data. Private-browsing or strict storage settings may need to be disabled.',
  [CAPABILITY_IDS.INDEXED_DB]: 'Allow persistent site storage and reload. MetroPulse needs IndexedDB for safe saves and recovery.'
});

function result(id, available, detail = '') {
  return Object.freeze({
    id,
    available: Boolean(available),
    detail: detail || (available ? 'Available' : 'Unavailable'),
    guidance: available ? null : CAPABILITY_GUIDANCE[id]
  });
}

export function checkWebGL2(documentRef = safeGlobal('document')) {
  try {
    const canvas = documentRef?.createElement?.('canvas');
    const context = canvas?.getContext?.('webgl2', {
      failIfMajorPerformanceCaveat: true
    });
    if (!context) return result(CAPABILITY_IDS.WEBGL2, false, 'WebGL 2 could not create a hardware-accelerated context.');
    context.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return result(CAPABILITY_IDS.WEBGL2, true, 'Hardware-accelerated WebGL 2 is available.');
  } catch (error) {
    return result(CAPABILITY_IDS.WEBGL2, false, error?.message);
  }
}

export function checkLocalStorage(storage = safeGlobal('localStorage')) {
  try {
    if (!storage) return result(CAPABILITY_IDS.LOCAL_STORAGE, false);
    storage.setItem(PROBE_STORAGE_KEY, '1');
    const persisted = storage.getItem(PROBE_STORAGE_KEY) === '1';
    storage.removeItem(PROBE_STORAGE_KEY);
    return result(
      CAPABILITY_IDS.LOCAL_STORAGE,
      persisted,
      persisted ? 'Local profile storage is writable.' : 'A local profile value could not be read back.'
    );
  } catch (error) {
    return result(CAPABILITY_IDS.LOCAL_STORAGE, false, error?.message);
  }
}

export async function checkIndexedDB(indexedDBRef = safeGlobal('indexedDB')) {
  if (!indexedDBRef?.open) return result(CAPABILITY_IDS.INDEXED_DB, false);

  return new Promise(resolve => {
    let settled = false;
    let request;
    const timeout = setTimeout(() => {
      finish(false, 'IndexedDB did not respond to a write check within 3 seconds.');
    }, 3_000);
    const finish = (available, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result(CAPABILITY_IDS.INDEXED_DB, available, detail));
    };

    try {
      request = indexedDBRef.open(PROBE_DATABASE_NAME, 1);
    } catch (error) {
      finish(false, error?.message);
      return;
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROBE_STORE_NAME)) {
        request.result.createObjectStore(PROBE_STORE_NAME);
      }
    };
    request.onerror = () => finish(false, request.error?.message || 'IndexedDB could not be opened.');
    request.onblocked = () => finish(false, 'IndexedDB is blocked by another browser session.');
    request.onsuccess = () => {
      const database = request.result;
      try {
        const transaction = database.transaction(PROBE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(PROBE_STORE_NAME);
        store.put('ready', 'status');
        transaction.onabort = () => {
          database.close();
          finish(false, transaction.error?.message || 'IndexedDB writes are blocked.');
        };
        transaction.onerror = () => {};
        transaction.oncomplete = () => {
          database.close();
          try {
            indexedDBRef.deleteDatabase?.(PROBE_DATABASE_NAME);
          } catch {
            // A failed probe cleanup does not invalidate a successful write.
          }
          finish(true, 'Transactional save storage is writable.');
        };
      } catch (error) {
        database.close();
        finish(false, error?.message);
      }
    };
  });
}

export class CompatibilityError extends Error {
  constructor(failures) {
    super('MetroPulse cannot safely start because required browser capabilities are unavailable.');
    this.name = 'CompatibilityError';
    this.code = 'INCOMPATIBLE_BROWSER';
    this.userMessage = 'This browser is missing a capability MetroPulse needs to render and protect your city.';
    this.failures = Object.freeze([...failures]);
    this.actions = Object.freeze(failures.map(item => item.guidance).filter(Boolean));
  }
}

export class CapabilityChecker {
  constructor({
    documentRef = safeGlobal('document'),
    storage = safeGlobal('localStorage'),
    indexedDBRef = safeGlobal('indexedDB'),
    forceUnavailable = []
  } = {}) {
    this.documentRef = documentRef;
    this.storage = storage;
    this.indexedDBRef = indexedDBRef;
    this.forceUnavailable = new Set(forceUnavailable);
  }

  async check() {
    const checks = [
      checkWebGL2(this.documentRef),
      checkLocalStorage(this.storage),
      await checkIndexedDB(this.indexedDBRef)
    ].map(item => this.forceUnavailable.has(item.id)
      ? result(item.id, false, 'Unavailable in this startup profile.')
      : item);
    const failures = checks.filter(item => !item.available);
    return Object.freeze({
      compatible: failures.length === 0,
      checks: Object.freeze(checks),
      failures: Object.freeze(failures)
    });
  }

  async assertCompatible() {
    const report = await this.check();
    if (!report.compatible) throw new CompatibilityError(report.failures);
    return report;
  }
}

export default CapabilityChecker;
