import { SAVE_KEY } from '../systems/PersistenceSystem.js';

export const RECOVERY_SAVE_KEY = 'metropulse3d:city-session:v1:recovery';

export const BOOT_ACTIONS = Object.freeze({
  NEW_GAME: 'NEW_GAME',
  CONTINUE: 'CONTINUE',
  RECOVER: 'RECOVER'
});

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function invalidSlot(slot, reason = null, present = false) {
  return Object.freeze({
    slot,
    present,
    valid: false,
    savedAt: null,
    reason,
    raw: null
  });
}

export function inspectLegacySave(raw, slot = 'current') {
  if (typeof raw !== 'string' || !raw.trim()) return invalidSlot(slot, null, false);
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || value.version !== 1) {
      throw new Error(`Unsupported save version: ${value?.version ?? '<missing>'}`);
    }
    for (const field of ['economy', 'world', 'mission', 'settings']) {
      if (!value[field] || typeof value[field] !== 'object' || Array.isArray(value[field])) {
        throw new Error(`Save is missing a valid ${field} record.`);
      }
    }
    const savedAt = typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt))
      ? value.savedAt
      : null;
    return Object.freeze({ slot, present: true, valid: true, savedAt, reason: null, raw });
  } catch (error) {
    return invalidSlot(slot, error?.message || String(error), true);
  }
}

export class SaveDiscovery {
  constructor({ storage = getDefaultStorage() } = {}) {
    this.storage = storage;
  }

  discover() {
    if (!this.storage) throw new Error('Local save storage is unavailable.');
    const current = inspectLegacySave(this.storage?.getItem?.(SAVE_KEY), 'current');
    const recovery = inspectLegacySave(this.storage?.getItem?.(RECOVERY_SAVE_KEY), 'recovery');
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

  prepare(action, discovery) {
    if (!this.storage) throw new Error('Local save storage is unavailable.');
    if (!Object.values(BOOT_ACTIONS).includes(action)) {
      throw new RangeError(`Unknown boot action: ${action}`);
    }
    if (!discovery?.actions?.[action]) {
      throw new Error(`Boot action ${action} is not available for this profile.`);
    }

    if (action === BOOT_ACTIONS.NEW_GAME) {
      // Starting over remains recoverable: the last known-valid current save
      // becomes the recovery source before the active slot is cleared.
      if (discovery.current.valid) {
        this.storage.setItem(RECOVERY_SAVE_KEY, discovery.current.raw);
      }
      this.storage.removeItem(SAVE_KEY);
    } else if (action === BOOT_ACTIONS.RECOVER) {
      this.storage.setItem(SAVE_KEY, discovery.recovery.raw);
    }
    return Object.freeze({ action, restore: action !== BOOT_ACTIONS.NEW_GAME });
  }
}

export default SaveDiscovery;
