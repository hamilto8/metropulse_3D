/**
 * Canonical, renderer-agnostic game-mode state for MetroPulse.
 *
 * Mayhem is deliberately modelled as an overlay instead of a mode so it can be
 * active while the player is managing the city, building, or in street-level
 * action.
 */

export const GAME_MODES = Object.freeze({
  MANAGEMENT: 'MANAGEMENT',
  BUILDER: 'BUILDER',
  ACTION: 'ACTION'
});

export const GAME_MANAGER_EVENTS = Object.freeze({
  MODE_CHANGED: 'MODE_CHANGED',
  MAYHEM_CHANGED: 'MAYHEM_CHANGED',
  STATE_RESTORED: 'STATE_RESTORED',
  SNAPSHOT: 'SNAPSHOT'
});

const MODE_VALUES = Object.freeze(Object.values(GAME_MODES));

/**
 * Legal mode transitions are explicit even though the current design permits
 * direct switching between every mode. This keeps transition policy in one
 * place when guards or intermediate modes are added later.
 */
export const MODE_TRANSITIONS = Object.freeze({
  [GAME_MODES.MANAGEMENT]: Object.freeze([
    GAME_MODES.BUILDER,
    GAME_MODES.ACTION
  ]),
  [GAME_MODES.BUILDER]: Object.freeze([
    GAME_MODES.MANAGEMENT,
    GAME_MODES.ACTION
  ]),
  [GAME_MODES.ACTION]: Object.freeze([
    GAME_MODES.MANAGEMENT,
    GAME_MODES.BUILDER
  ])
});

function assertMode(mode, label = 'mode') {
  if (!MODE_VALUES.includes(mode)) {
    throw new RangeError(
      `${label} must be one of ${MODE_VALUES.join(', ')}; received ${String(mode)}`
    );
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function createSnapshot(mode, mayhemEnabled, revision) {
  return Object.freeze({
    mode,
    mayhemEnabled,
    revision
  });
}

/**
 * Small observable state machine with no DOM, Three.js, or timing dependency.
 */
export class GameManager {
  #mode;
  #mayhemEnabled;
  #revision = 0;
  #listeners = new Set();

  constructor({
    initialMode = GAME_MODES.MANAGEMENT,
    mayhemEnabled = false
  } = {}) {
    assertMode(initialMode, 'initialMode');
    assertBoolean(mayhemEnabled, 'mayhemEnabled');

    this.#mode = initialMode;
    this.#mayhemEnabled = mayhemEnabled;
  }

  get mode() {
    return this.#mode;
  }

  get mayhemEnabled() {
    return this.#mayhemEnabled;
  }

  /** Compatibility/readability alias for integrations that use `mayhem`. */
  get mayhem() {
    return this.#mayhemEnabled;
  }

  get revision() {
    return this.#revision;
  }

  isMode(mode) {
    assertMode(mode);
    return this.#mode === mode;
  }

  /**
   * Returns true only when the requested mode is valid, different, and legal.
   * Invalid values return false here; mutating methods throw useful errors.
   */
  canTransitionTo(mode) {
    return MODE_VALUES.includes(mode)
      && mode !== this.#mode
      && MODE_TRANSITIONS[this.#mode].includes(mode);
  }

  /**
   * Changes the primary mode. Re-selecting the current mode is an idempotent
   * no-op and returns the existing immutable snapshot.
   */
  transitionTo(mode, { reason = null } = {}) {
    assertMode(mode);

    if (mode === this.#mode) {
      return this.snapshot();
    }

    if (!MODE_TRANSITIONS[this.#mode].includes(mode)) {
      throw new Error(`Illegal game-mode transition: ${this.#mode} -> ${mode}`);
    }

    const previous = this.snapshot();
    const from = this.#mode;
    this.#mode = mode;
    this.#revision += 1;
    const current = this.snapshot();

    this.#emit(GAME_MANAGER_EVENTS.MODE_CHANGED, previous, current, {
      from,
      to: mode,
      reason
    });

    return current;
  }

  /** Alias that reads naturally at integration call sites. */
  setMode(mode, options) {
    return this.transitionTo(mode, options);
  }

  /**
   * Enables or disables the independent Mayhem overlay.
   */
  setMayhem(enabled, reasonOrMetadata = null) {
    assertBoolean(enabled, 'enabled');
    let reason = null;
    let metadata = {};

    if (typeof reasonOrMetadata === 'string') {
      reason = reasonOrMetadata;
    } else if (reasonOrMetadata !== null && reasonOrMetadata !== undefined) {
      if (typeof reasonOrMetadata !== 'object' || Array.isArray(reasonOrMetadata)) {
        throw new TypeError('Mayhem metadata must be an object, string, or null');
      }
      metadata = { ...reasonOrMetadata };
      reason = metadata.reason ?? metadata.source ?? null;
    }

    if (enabled === this.#mayhemEnabled) {
      return this.snapshot();
    }

    const previous = this.snapshot();
    this.#mayhemEnabled = enabled;
    this.#revision += 1;
    const current = this.snapshot();

    this.#emit(GAME_MANAGER_EVENTS.MAYHEM_CHANGED, previous, current, {
      ...metadata,
      enabled,
      reason
    });

    return current;
  }

  toggleMayhem(options) {
    return this.setMayhem(!this.#mayhemEnabled, options);
  }

  /**
   * Atomically restores serializable state. Revision numbers are local change
   * counters and are intentionally not imported from a saved snapshot.
   */
  restore(state, { reason = 'restore' } = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new TypeError('state must be an object');
    }

    assertMode(state.mode, 'state.mode');
    assertBoolean(state.mayhemEnabled, 'state.mayhemEnabled');

    if (
      state.mode === this.#mode
      && state.mayhemEnabled === this.#mayhemEnabled
    ) {
      return this.snapshot();
    }

    const previous = this.snapshot();
    this.#mode = state.mode;
    this.#mayhemEnabled = state.mayhemEnabled;
    this.#revision += 1;
    const current = this.snapshot();

    this.#emit(GAME_MANAGER_EVENTS.STATE_RESTORED, previous, current, { reason });
    return current;
  }

  snapshot() {
    return createSnapshot(this.#mode, this.#mayhemEnabled, this.#revision);
  }

  /**
   * Subscribes to synchronous state-change events and returns an unsubscribe
   * function. A listener receives `{ type, previous, current, detail }`.
   */
  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    assertBoolean(emitCurrent, 'emitCurrent');

    this.#listeners.add(listener);

    if (emitCurrent) {
      listener(Object.freeze({
        type: GAME_MANAGER_EVENTS.SNAPSHOT,
        previous: null,
        current: this.snapshot(),
        detail: Object.freeze({})
      }));
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return false;
      subscribed = false;
      return this.#listeners.delete(listener);
    };
  }

  #emit(type, previous, current, detail) {
    const event = Object.freeze({
      type,
      previous,
      current,
      detail: Object.freeze({ ...detail })
    });

    // Snapshot the listeners so subscribe/unsubscribe calls during delivery do
    // not change which listeners receive the current event.
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }
}

export default GameManager;
