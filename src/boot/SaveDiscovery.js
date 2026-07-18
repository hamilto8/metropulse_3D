import { IndexedDbSaveRepository } from '../save/IndexedDbSaveRepository.js';
import {
  LEGACY_LOCAL_STORAGE_SAVE_KEY,
  SAVE_SLOTS,
  convertLegacyV1Save,
  inspectSaveDocument
} from '../save/SaveSchema.js';
import { validateGameState } from '../save/SaveGameState.js';

export const RECOVERY_SAVE_KEY = 'metropulse3d:city-session:v1:recovery';
export const SAVE_KEY = LEGACY_LOCAL_STORAGE_SAVE_KEY;

export const BOOT_ACTIONS = Object.freeze({
  NEW_GAME: 'NEW_GAME',
  CONTINUE: 'CONTINUE',
  RECOVER: 'RECOVER'
});

function getDefaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function invalidLegacy(slot, reason = null, present = false) {
  return Object.freeze({ slot, source: 'localStorage-v1', present, valid: false, savedAt: null, reason, raw: null, document: null });
}

export function inspectLegacySave(raw, slot = SAVE_SLOTS.CURRENT) {
  if (typeof raw !== 'string' || !raw.trim()) return invalidLegacy(slot, null, false);
  try {
    const document = validateSaveDocumentForDiscovery(convertLegacyV1Save(JSON.parse(raw)));
    return Object.freeze({
      slot,
      source: 'localStorage-v1',
      present: true,
      valid: true,
      savedAt: document.metadata.savedAt,
      reason: null,
      raw,
      document
    });
  } catch (error) {
    return invalidLegacy(slot, error?.userMessage || error?.message || String(error), true);
  }
}

function validateSaveDocumentForDiscovery(document) {
  // Conversion already validates the envelope; discovery additionally checks
  // domain shapes without requiring live runtime content to exist yet.
  validateGameState(document.data);
  return document;
}

export class SaveDiscovery {
  constructor({
    storage = getDefaultStorage(),
    repository = new IndexedDbSaveRepository()
  } = {}) {
    this.storage = storage;
    this.repository = repository;
  }

  async discover() {
    const slots = await this.repository.readSlots();
    let current = inspectSaveDocument(slots.current, SAVE_SLOTS.CURRENT, { validateDomains: validateGameState });
    let recovery = inspectSaveDocument(slots.recovery, SAVE_SLOTS.RECOVERY, { validateDomains: validateGameState });

    // LocalStorage is never written by P2.2. It is consulted only when the
    // matching IndexedDB slot is absent, then removed after a successful copy.
    if (!current.present) current = inspectLegacySave(this.storage?.getItem?.(SAVE_KEY), SAVE_SLOTS.CURRENT);
    if (!recovery.present) recovery = inspectLegacySave(this.storage?.getItem?.(RECOVERY_SAVE_KEY), SAVE_SLOTS.RECOVERY);

    return Object.freeze({
      current,
      recovery,
      actions: Object.freeze({
        [BOOT_ACTIONS.NEW_GAME]: true,
        [BOOT_ACTIONS.CONTINUE]: current.valid,
        [BOOT_ACTIONS.RECOVER]: recovery.valid
      })
    });
  }

  async prepare(action, discovery) {
    if (!Object.values(BOOT_ACTIONS).includes(action)) throw new RangeError(`Unknown boot action: ${action}`);
    if (!discovery?.actions?.[action]) throw new Error(`Boot action ${action} is not available for this profile.`);

    if (action === BOOT_ACTIONS.NEW_GAME) {
      if (discovery.current.valid && discovery.current.source === 'localStorage-v1') {
        await this.repository.putRecovery(discovery.current.document);
      }
      await this.repository.clearCurrent({
        preserveAsRecovery: discovery.current.valid && discovery.current.source === 'indexedDB'
      });
      this.storage?.removeItem?.(SAVE_KEY);
      if (discovery.current.source === 'localStorage-v1') {
        // The migrated current document is now the authoritative recovery
        // source, so an older legacy recovery value must not linger as a
        // shadow persistence path.
        this.storage?.removeItem?.(RECOVERY_SAVE_KEY);
      }
      return Object.freeze({ action, restore: false, saveDocument: null, saveRepository: this.repository });
    }

    const selected = action === BOOT_ACTIONS.CONTINUE ? discovery.current : discovery.recovery;
    if (selected.source === 'localStorage-v1') {
      await this.repository.putCurrent(selected.document);
      this.storage?.removeItem?.(action === BOOT_ACTIONS.CONTINUE ? SAVE_KEY : RECOVERY_SAVE_KEY);
    } else if (action === BOOT_ACTIONS.RECOVER) {
      await this.repository.promoteRecovery();
    }
    return Object.freeze({
      action,
      restore: true,
      saveDocument: selected.document,
      saveRepository: this.repository
    });
  }
}

export default SaveDiscovery;
