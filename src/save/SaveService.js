import {
  createSaveDocument,
  validateSaveDocument
} from './SaveSchema.js';
import {
  captureGameState,
  restoreRuntimeGameState,
  restoreStaticGameState,
  validateGameReferences,
  validateGameState
} from './SaveGameState.js';
import { IndexedDbSaveRepository } from './IndexedDbSaveRepository.js';

export const SAVE_STATUS = Object.freeze({
  IDLE: 'IDLE',
  SCHEDULED: 'SCHEDULED',
  SAVING: 'SAVING',
  SAVED: 'SAVED',
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  UNAVAILABLE: 'UNAVAILABLE'
});

export const AUTOSAVE_REASONS = Object.freeze({
  ECONOMY: 'economy-change',
  GAME_STATE: 'game-state-change',
  WORLD_EDIT: 'world-edit',
  MISSION: 'mission-progress',
  CHECKPOINT: 'checkpoint',
  PAGE_HIDDEN: 'page-hidden',
  MANUAL: 'manual'
});

function safeWindow() {
  try { return globalThis.window; } catch { return null; }
}

function safeDocument() {
  try { return globalThis.document; } catch { return null; }
}

export class SaveService {
  constructor(app, {
    repository = new IndexedDbSaveRepository(),
    debounceMs = 5_000,
    now = () => new Date(),
    idFactory,
    windowRef = safeWindow(),
    documentRef = safeDocument()
  } = {}) {
    if (!app) throw new TypeError('SaveService requires the MetroPulse app.');
    if (!repository?.commitCurrent) throw new TypeError('SaveService requires a save repository.');
    this.app = app;
    this.repository = repository;
    this.debounceMs = Math.max(0, debounceMs);
    this.now = now;
    this.idFactory = idFactory;
    this.window = windowRef;
    this.document = documentRef;
    this.status = SAVE_STATUS.IDLE;
    this.timer = null;
    this.restoring = false;
    this.saveInFlight = null;
    this.queuedSave = false;
    this.pendingReasons = new Set();
    this.pendingCheckpoint = null;
    this.pendingRestore = null;
    this.lastError = null;
    this.lastSavedAt = null;
    this.lastRestoreReport = null;
    this.listeners = new Set();

    this.unsubscribeEconomy = app.economySystem?.subscribe?.(() => this.scheduleSave(AUTOSAVE_REASONS.ECONOMY)) || null;
    this.unsubscribeGame = app.gameManager?.subscribe?.(() => this.scheduleSave(AUTOSAVE_REASONS.GAME_STATE)) || null;
    this.onPageHide = () => { void this.saveNow({ reason: AUTOSAVE_REASONS.PAGE_HIDDEN }); };
    this.onVisibilityChange = () => {
      if (this.document?.visibilityState === 'hidden') void this.saveNow({ reason: AUTOSAVE_REASONS.PAGE_HIDDEN });
    };
    this.window?.addEventListener?.('pagehide', this.onPageHide);
    this.document?.addEventListener?.('visibilitychange', this.onVisibilityChange);
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Save status listener must be a function.');
    this.listeners.add(listener);
    if (emitCurrent) listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  #setStatus(status, error = null) {
    this.status = status;
    this.lastError = error;
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch (listenerError) { console.error('Save status listener failed.', listenerError); }
    }
  }

  createSnapshot({ reason = AUTOSAVE_REASONS.MANUAL, reasons = [reason], checkpoint = null } = {}) {
    return createSaveDocument(captureGameState(this.app), {
      now: this.now,
      idFactory: this.idFactory,
      reason,
      reasons,
      checkpoint
    });
  }

  scheduleSave(reason = AUTOSAVE_REASONS.WORLD_EDIT, { checkpoint = null } = {}) {
    if (this.restoring) return false;
    this.pendingReasons.add(reason);
    if (checkpoint != null) this.pendingCheckpoint = checkpoint;
    if (this.timer) return true;
    this.#setStatus(SAVE_STATUS.SCHEDULED);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow({ reason });
    }, this.debounceMs);
    return true;
  }

  saveCheckpoint(checkpointId, reason = AUTOSAVE_REASONS.CHECKPOINT) {
    if (typeof checkpointId !== 'string' || !checkpointId.trim()) {
      throw new TypeError('checkpointId must be a non-empty string.');
    }
    return this.saveNow({ reason, checkpoint: checkpointId });
  }

  async saveNow({ reason = AUTOSAVE_REASONS.MANUAL, checkpoint = null } = {}) {
    if (this.restoring) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.pendingReasons.add(reason);
    if (checkpoint != null) this.pendingCheckpoint = checkpoint;

    if (this.saveInFlight) {
      this.queuedSave = true;
      return this.saveInFlight;
    }

    const reasons = [...this.pendingReasons];
    const finalReason = reasons.includes(AUTOSAVE_REASONS.MANUAL) ? AUTOSAVE_REASONS.MANUAL : reason;
    const finalCheckpoint = this.pendingCheckpoint;
    this.pendingReasons.clear();
    this.pendingCheckpoint = null;
    this.#setStatus(SAVE_STATUS.SAVING);

    this.saveInFlight = (async () => {
      try {
        const document = this.createSnapshot({ reason: finalReason, reasons, checkpoint: finalCheckpoint });
        await this.repository.commitCurrent(document);
        this.lastSavedAt = document.metadata.savedAt;
        this.#setStatus(SAVE_STATUS.SAVED);
        return true;
      } catch (error) {
        this.#setStatus(SAVE_STATUS.ERROR, error);
        console.warn('MetroPulse could not save the city session.', error);
        return false;
      } finally {
        this.saveInFlight = null;
        if (this.queuedSave) {
          this.queuedSave = false;
          queueMicrotask(() => { void this.saveNow({ reason: 'queued-change' }); });
        }
      }
    })();
    return this.saveInFlight;
  }

  /** Validates the complete document before any live owner is mutated. */
  restore(document, { deferRuntime = true } = {}) {
    this.#setStatus(SAVE_STATUS.LOADING);
    let validated;
    try {
      validated = validateSaveDocument(document, {
        validateDomains: data => {
          validateGameState(data, { contentRegistry: this.app.contentRegistry });
          validateGameReferences(this.app, data);
        }
      });
    } catch (error) {
      this.#setStatus(SAVE_STATUS.ERROR, error);
      return false;
    }
    this.restoring = true;
    try {
      this.lastRestoreReport = restoreStaticGameState(this.app, validated.data);
      this.pendingRestore = deferRuntime ? validated : null;
      if (!deferRuntime) restoreRuntimeGameState(this.app, validated.data);
      this.lastSavedAt = validated.metadata.savedAt;
      this.#setStatus(SAVE_STATUS.IDLE);
      return true;
    } catch (error) {
      this.pendingRestore = null;
      this.#setStatus(SAVE_STATUS.ERROR, error);
      console.warn('MetroPulse could not restore the saved city session.', error);
      return false;
    } finally {
      this.restoring = false;
    }
  }

  restoreRuntime() {
    if (!this.pendingRestore) return false;
    const document = this.pendingRestore;
    this.restoring = true;
    try {
      restoreRuntimeGameState(this.app, document.data);
      this.pendingRestore = null;
      this.#setStatus(SAVE_STATUS.IDLE);
      this.app.uiManager?.addAlert?.('💾 Saved city session restored.', 'success');
      return true;
    } catch (error) {
      this.#setStatus(SAVE_STATUS.ERROR, error);
      console.warn('MetroPulse could not restore runtime control state.', error);
      return false;
    } finally {
      this.restoring = false;
    }
  }

  async clear({ preserveRecovery = true } = {}) {
    try {
      await this.repository.clearCurrent({ preserveAsRecovery: preserveRecovery });
      this.lastSavedAt = null;
      this.#setStatus(SAVE_STATUS.IDLE);
      return true;
    } catch (error) {
      this.#setStatus(SAVE_STATUS.ERROR, error);
      return false;
    }
  }

  getStatus() {
    return Object.freeze({
      status: this.status,
      available: Boolean(this.repository),
      pending: Boolean(this.timer || this.saveInFlight),
      restoring: this.restoring,
      lastSavedAt: this.lastSavedAt,
      error: this.lastError?.userMessage || this.lastError?.message || null
    });
  }

  destroy() {
    clearTimeout(this.timer);
    this.unsubscribeEconomy?.();
    this.unsubscribeGame?.();
    this.window?.removeEventListener?.('pagehide', this.onPageHide);
    this.document?.removeEventListener?.('visibilitychange', this.onVisibilityChange);
    this.listeners.clear();
    void this.repository.close?.();
  }
}

export default SaveService;
