import { GAME_STATES } from './GameState.js';

export const PAUSE_REASONS = Object.freeze({
  MENU: 'MENU',
  DIALOGUE: 'DIALOGUE',
  SYSTEM: 'SYSTEM'
});

export const PAUSE_MANAGER_EVENTS = Object.freeze({
  CHANGED: 'CHANGED',
  PAUSED: 'PAUSED',
  RESUMED: 'RESUMED'
});

const PAUSABLE_STATES = new Set([
  GAME_STATES.MANAGEMENT,
  GAME_STATES.BUILDER,
  GAME_STATES.STREET_ON_FOOT,
  GAME_STATES.STREET_VEHICLE,
  GAME_STATES.RESULT
]);

function assertReason(reason) {
  if (!Object.values(PAUSE_REASONS).includes(reason)) {
    throw new RangeError(`Unknown pause reason: ${String(reason)}`);
  }
}

function immutableSnapshot(gameManager, holds) {
  const reasons = Object.freeze([...new Set([...holds.values()].map(hold => hold.reason))]);
  return Object.freeze({
    paused: gameManager.state === GAME_STATES.PAUSED,
    resumeState: gameManager.resumeState,
    menuOpen: reasons.includes(PAUSE_REASONS.MENU),
    reasons,
    holdCount: holds.size
  });
}

/**
 * Renderer-independent owner of pause intent.
 *
 * Multiple modal clients may hold pause concurrently. The first hold enters
 * PAUSED and the last release restores GameManager's exact resume state. This
 * keeps nested dialogue/pause-menu flows deterministic without introducing a
 * second simulation flag or time scale.
 */
export class PauseManager {
  #gameManager;
  #transitionCoordinator;
  #clearHeldActions;
  #holds = new Map();
  #listeners = new Set();
  #serial = 0;
  #menuToken = null;

  constructor({ gameManager, transitionCoordinator, clearHeldActions = () => {} } = {}) {
    if (!gameManager || typeof gameManager.state !== 'string') {
      throw new TypeError('gameManager is required');
    }
    if (!transitionCoordinator?.transitionTo) {
      throw new TypeError('transitionCoordinator must implement transitionTo');
    }
    if (typeof clearHeldActions !== 'function') {
      throw new TypeError('clearHeldActions must be a function');
    }
    this.#gameManager = gameManager;
    this.#transitionCoordinator = transitionCoordinator;
    this.#clearHeldActions = clearHeldActions;
  }

  get paused() {
    return this.#gameManager.state === GAME_STATES.PAUSED;
  }

  get menuOpen() {
    return this.#menuToken !== null;
  }

  get holdCount() {
    return this.#holds.size;
  }

  snapshot() {
    return immutableSnapshot(this.#gameManager, this.#holds);
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(Object.freeze({
      type: PAUSE_MANAGER_EVENTS.CHANGED,
      previous: null,
      current: this.snapshot(),
      reason: 'subscribe'
    }));
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return this.#listeners.delete(listener);
    };
  }

  acquire(reason, { source = 'PauseManager' } = {}) {
    assertReason(reason);
    const previous = this.snapshot();
    const state = this.#gameManager.state;
    if (state !== GAME_STATES.PAUSED && !PAUSABLE_STATES.has(state)) {
      throw new Error(`Cannot pause from ${state}.`);
    }

    this.#clearHeldActions();
    if (state !== GAME_STATES.PAUSED) {
      this.#transitionCoordinator.transitionTo(GAME_STATES.PAUSED, {
        reason: `pause:${reason.toLowerCase()}`,
        source
      });
    }

    const token = Object.freeze({
      id: `pause-hold-${++this.#serial}`,
      reason,
      source
    });
    this.#holds.set(token.id, token);
    if (reason === PAUSE_REASONS.MENU) this.#menuToken = token;
    this.#emit(
      previous.paused ? PAUSE_MANAGER_EVENTS.CHANGED : PAUSE_MANAGER_EVENTS.PAUSED,
      previous,
      reason
    );
    return token;
  }

  release(token, { source = 'PauseManager' } = {}) {
    if (!token?.id || !this.#holds.has(token.id)) return false;
    const previous = this.snapshot();
    const hold = this.#holds.get(token.id);
    this.#holds.delete(token.id);
    if (this.#menuToken?.id === token.id) this.#menuToken = null;
    this.#clearHeldActions();

    try {
      if (this.#holds.size === 0 && this.#gameManager.state === GAME_STATES.PAUSED) {
        const resumeState = this.#gameManager.resumeState;
        if (!resumeState) throw new Error('Paused session has no valid resume state.');
        this.#transitionCoordinator.transitionTo(resumeState, {
          reason: `resume:${hold.reason.toLowerCase()}`,
          source
        });
      }
    } catch (error) {
      // A failed resume must retain its hold so the paused session remains
      // coherent and the player can retry instead of becoming ownerless.
      this.#holds.set(hold.id, hold);
      if (hold.reason === PAUSE_REASONS.MENU) this.#menuToken = hold;
      throw error;
    }

    this.#emit(
      this.paused ? PAUSE_MANAGER_EVENTS.CHANGED : PAUSE_MANAGER_EVENTS.RESUMED,
      previous,
      hold.reason
    );
    return true;
  }

  openMenu(options = {}) {
    if (this.#menuToken) return this.#menuToken;
    return this.acquire(PAUSE_REASONS.MENU, options);
  }

  closeMenu(options = {}) {
    return this.#menuToken ? this.release(this.#menuToken, options) : false;
  }

  toggleMenu(options = {}) {
    if (this.#menuToken) {
      this.closeMenu(options);
      return false;
    }
    this.openMenu(options);
    return true;
  }

  #emit(type, previous, reason) {
    const event = Object.freeze({
      type,
      previous,
      current: this.snapshot(),
      reason
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        globalThis.console?.error?.('PauseManager listener failed.', error);
      }
    }
  }
}

export default PauseManager;
