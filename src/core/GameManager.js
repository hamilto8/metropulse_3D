/**
 * Canonical, renderer-agnostic game-session state for MetroPulse.
 *
 * GameManager decides whether a transition is legal and records its contract.
 * It deliberately does not manipulate Three.js, DOM, audio, or entity systems;
 * those declared effects are executed by the Phase 1 transition coordinator.
 */

import {
  CONTROL_KINDS,
  GAME_STATES,
  GAME_STATE_TRANSITIONS,
  GAME_STATE_VALUES,
  getTransitionEffects,
  isGameState,
  isStreetState
} from './GameState.js';
import {
  ALLOWED_TRANSITION as ALLOWED,
  GameTransitionError,
  TRANSITION_REJECTION_CODES,
  assertTransitionOptions as assertOptions,
  createTransitionRejection as rejection,
  isVehicleControl,
  normalizeTransitionContext as normalizeContext,
  normalizeTransitionMetadata as normalizeMetadata,
  validateDestinationContract
} from './GameTransition.js';

export {
  CAMERA_POLICIES,
  CLOCK_POLICIES,
  CONTROL_KINDS,
  CONTROL_POLICIES,
  GAME_MODES,
  GAME_STATES,
  GAME_STATE_POLICIES,
  GAME_STATE_TRANSITIONS,
  HEAT_POLICIES,
  MISSION_POLICIES,
  getStatePolicy,
  getTransitionEffects,
  isGameState,
  isStreetState
} from './GameState.js';
export {
  GameTransitionError,
  TRANSITION_REJECTION_CODES
} from './GameTransition.js';

export const GAME_MANAGER_EVENTS = Object.freeze({
  STATE_CHANGED: 'STATE_CHANGED',
  // Compatibility name for older integrations. There is now one state owner.
  MODE_CHANGED: 'STATE_CHANGED',
  TRANSITION_STARTED: 'TRANSITION_STARTED',
  TRANSITION_COMMITTED: 'TRANSITION_COMMITTED',
  TRANSITION_REJECTED: 'TRANSITION_REJECTED',
  TRANSITION_FAILED: 'TRANSITION_FAILED',
  MAYHEM_CHANGED: 'MAYHEM_CHANGED',
  STATE_RESTORED: 'STATE_RESTORED',
  SNAPSHOT: 'SNAPSHOT'
});

const RESTORABLE_STATES = new Set([
  GAME_STATES.MANAGEMENT,
  GAME_STATES.BUILDER,
  GAME_STATES.STREET_ON_FOOT,
  GAME_STATES.STREET_VEHICLE,
  GAME_STATES.RESULT,
  GAME_STATES.PAUSED,
  GAME_STATES.MENU
]);

function assertState(state, label = 'state') {
  if (!isGameState(state)) {
    throw new RangeError(
      `${label} must be one of ${GAME_STATE_VALUES.join(', ')}; received ${String(state)}`
    );
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

function createSnapshot({
  state,
  mayhemEnabled,
  revision,
  activeTransition,
  lastTransition,
  resumeState
}) {
  return Object.freeze({
    state,
    // Compatibility alias: the explicit state is also the canonical mode.
    mode: state,
    mayhemEnabled,
    revision,
    activeTransition,
    lastTransition,
    resumeState
  });
}

/**
 * Observable state machine with explicit guards, transition metadata, and
 * deterministic recovery. It has no DOM, Three.js, audio, or timing owner.
 */
export class GameManager {
  #state;
  #mayhemEnabled;
  #revision = 0;
  #listeners = new Set();
  #guards = new Set();
  #contextProvider;
  #clock;
  #onListenerError;
  #transitionSerial = 0;
  #activeTransition = null;
  #lastTransition = null;
  #resumeState = null;

  constructor({
    initialState,
    initialMode,
    mayhemEnabled = false,
    contextProvider = null,
    guards = [],
    clock = () => Date.now(),
    onListenerError = null
  } = {}) {
    const requestedInitialState = initialState ?? initialMode ?? GAME_STATES.BOOT;
    assertState(requestedInitialState, initialState === undefined ? 'initialMode' : 'initialState');
    if (requestedInitialState === GAME_STATES.TRANSITION) {
      throw new RangeError('initialState cannot be TRANSITION');
    }
    assertBoolean(mayhemEnabled, 'mayhemEnabled');
    if (contextProvider !== null && typeof contextProvider !== 'function') {
      throw new TypeError('contextProvider must be a function or null');
    }
    if (!Array.isArray(guards) || guards.some(guard => typeof guard !== 'function')) {
      throw new TypeError('guards must be an array of functions');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (onListenerError !== null && typeof onListenerError !== 'function') {
      throw new TypeError('onListenerError must be a function or null');
    }

    this.#state = requestedInitialState;
    this.#mayhemEnabled = mayhemEnabled;
    this.#contextProvider = contextProvider;
    this.#clock = clock;
    this.#onListenerError = onListenerError;
    guards.forEach(guard => this.#guards.add(guard));
  }

  get state() {
    return this.#state;
  }

  get mode() {
    return this.#state;
  }

  get mayhemEnabled() {
    return this.#mayhemEnabled;
  }

  get mayhem() {
    return this.#mayhemEnabled;
  }

  get revision() {
    return this.#revision;
  }

  get activeTransition() {
    return this.#activeTransition;
  }

  get lastTransition() {
    return this.#lastTransition;
  }

  get resumeState() {
    return this.#resumeState;
  }

  isState(state) {
    assertState(state);
    return this.#state === state;
  }

  isMode(state) {
    return this.isState(state);
  }

  addGuard(guard) {
    if (typeof guard !== 'function') throw new TypeError('guard must be a function');
    this.#guards.add(guard);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return this.#guards.delete(guard);
    };
  }

  setContextProvider(provider) {
    if (provider !== null && typeof provider !== 'function') {
      throw new TypeError('contextProvider must be a function or null');
    }
    this.#contextProvider = provider;
  }

  getContext(override) {
    if (override !== undefined) return normalizeContext(override);
    return normalizeContext(this.#contextProvider?.());
  }

  getLegalTransitions(state = this.#state) {
    assertState(state);
    if (state === GAME_STATES.PAUSED && this.#resumeState) {
      return Object.freeze([this.#resumeState, GAME_STATES.MENU]);
    }
    return GAME_STATE_TRANSITIONS[state];
  }

  evaluateTransition(destination, options = {}) {
    const safeOptions = assertOptions(options);
    if (!isGameState(destination)) {
      return rejection(
        TRANSITION_REJECTION_CODES.INVALID_STATE,
        `Unknown game state: ${String(destination)}`
      );
    }
    if (destination === GAME_STATES.TRANSITION) {
      return rejection(
        TRANSITION_REJECTION_CODES.ILLEGAL_EDGE,
        'TRANSITION is owned by GameManager and cannot be requested directly.'
      );
    }
    if (this.#activeTransition || this.#state === GAME_STATES.TRANSITION) {
      return rejection(
        TRANSITION_REJECTION_CODES.TRANSITION_IN_PROGRESS,
        'Another game-state transition is already in progress.',
        { transitionId: this.#activeTransition?.id || null }
      );
    }
    if (destination === this.#state) {
      return rejection(
        TRANSITION_REJECTION_CODES.SAME_STATE,
        `${destination} is already active.`
      );
    }

    const context = this.getContext(safeOptions.context);
    if (destination === GAME_STATES.BUILDER) {
      if (context.handoffPending) {
        return rejection(
          TRANSITION_REJECTION_CODES.HANDOFF_UNRESOLVED,
          'Builder entry is unavailable while a street handoff is unresolved.'
        );
      }
      const destinationResult = validateDestinationContract(destination, context);
      if (!destinationResult.allowed) return destinationResult;
    }

    const legalDestinations = this.getLegalTransitions();
    if (!legalDestinations.includes(destination)) {
      const code = this.#state === GAME_STATES.PAUSED
        ? TRANSITION_REJECTION_CODES.INVALID_RESUME_TARGET
        : TRANSITION_REJECTION_CODES.ILLEGAL_EDGE;
      return rejection(
        code,
        `Illegal game-state transition: ${this.#state} -> ${destination}`,
        { legalDestinations }
      );
    }

    if (
      isStreetState(this.#state)
      && context.missionCritical
      && destination !== GAME_STATES.RESULT
      && destination !== GAME_STATES.PAUSED
    ) {
      return rejection(
        TRANSITION_REJECTION_CODES.MISSION_CRITICAL,
        'The active mission must resolve before leaving street gameplay.',
        { missionState: context.missionState }
      );
    }

    const metadata = normalizeMetadata(safeOptions);
    for (const guard of this.#guards) {
      let result;
      try {
        result = guard(Object.freeze({
          from: this.#state,
          to: destination,
          phase: 'REQUEST',
          context,
          metadata
        }));
      } catch (error) {
        return rejection(
          TRANSITION_REJECTION_CODES.GUARD_ERROR,
          `Transition guard failed: ${error?.message || String(error)}`
        );
      }
      if (result === false) {
        return rejection(
          TRANSITION_REJECTION_CODES.CUSTOM_GUARD_REJECTED,
          'A transition guard rejected the request.'
        );
      }
      if (result && result.allowed === false) {
        return rejection(
          result.code || TRANSITION_REJECTION_CODES.CUSTOM_GUARD_REJECTED,
          result.reason || 'A transition guard rejected the request.',
          result.details
        );
      }
    }

    return ALLOWED;
  }

  canTransitionTo(destination, options = {}) {
    return this.evaluateTransition(destination, options).allowed;
  }

  beginTransition(destination, options = {}) {
    const safeOptions = assertOptions(options);
    const result = this.evaluateTransition(destination, safeOptions);
    if (!result.allowed) {
      const error = new GameTransitionError(result, { from: this.#state, to: destination });
      this.#emitRejection(error, normalizeMetadata(safeOptions));
      throw error;
    }

    const from = this.#state;
    const metadata = normalizeMetadata(safeOptions);
    const requestedAt = this.#clock();
    const transition = Object.freeze({
      id: `transition-${++this.#transitionSerial}`,
      from,
      to: destination,
      recoveryState: from,
      requestedAt,
      status: 'ACTIVE',
      metadata,
      effects: getTransitionEffects(from, destination)
    });
    const previous = this.snapshot();
    this.#activeTransition = transition;
    this.#state = GAME_STATES.TRANSITION;
    this.#revision += 1;
    const current = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.TRANSITION_STARTED, previous, current, transition);
    return transition;
  }

  commitTransition(options = {}) {
    const safeOptions = assertOptions(options);
    const transition = this.#activeTransition;
    if (!transition || this.#state !== GAME_STATES.TRANSITION) {
      throw new GameTransitionError(rejection(
        TRANSITION_REJECTION_CODES.TRANSITION_IN_PROGRESS,
        'There is no active transition to commit.'
      ));
    }

    const context = this.getContext(safeOptions.context);
    const destinationResult = validateDestinationContract(transition.to, context);
    if (!destinationResult.allowed) {
      const error = new GameTransitionError(destinationResult, {
        from: transition.from,
        to: transition.to,
        transitionId: transition.id
      });
      this.failTransition(error, { context });
      throw error;
    }

    for (const guard of this.#guards) {
      let result;
      try {
        result = guard(Object.freeze({
          from: transition.from,
          to: transition.to,
          phase: 'COMMIT',
          context,
          metadata: transition.metadata
        }));
      } catch (error) {
        result = rejection(
          TRANSITION_REJECTION_CODES.GUARD_ERROR,
          `Transition guard failed during commit: ${error?.message || String(error)}`
        );
      }
      if (result === false || result?.allowed === false) {
        const guardResult = result === false
          ? rejection(TRANSITION_REJECTION_CODES.CUSTOM_GUARD_REJECTED, 'A transition guard rejected commit.')
          : result;
        const error = new GameTransitionError(guardResult, {
          from: transition.from,
          to: transition.to,
          transitionId: transition.id
        });
        this.failTransition(error, { context });
        throw error;
      }
    }

    const previous = this.snapshot();
    this.#state = transition.to;
    this.#revision += 1;
    if (transition.to === GAME_STATES.PAUSED) {
      this.#resumeState = transition.from;
    } else if (transition.from === GAME_STATES.PAUSED) {
      this.#resumeState = null;
    }
    this.#lastTransition = Object.freeze({
      ...transition,
      status: 'COMMITTED',
      completedAt: this.#clock()
    });
    this.#activeTransition = null;
    const current = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.TRANSITION_COMMITTED, previous, current, this.#lastTransition);
    this.#emit(GAME_MANAGER_EVENTS.STATE_CHANGED, previous, current, this.#lastTransition);
    return current;
  }

  failTransition(cause, options = {}) {
    const safeOptions = assertOptions(options);
    const transition = this.#activeTransition;
    if (!transition || this.#state !== GAME_STATES.TRANSITION) return this.snapshot();

    const context = this.getContext(safeOptions.context);
    const recoveryState = this.#selectRecoveryState(transition.recoveryState, context);
    const previous = this.snapshot();
    this.#state = recoveryState;
    this.#revision += 1;
    const message = cause instanceof Error ? cause.message : String(cause || 'Unknown transition failure');
    this.#lastTransition = Object.freeze({
      ...transition,
      status: 'FAILED',
      recoveryState,
      failure: Object.freeze({ message, code: cause?.code || null }),
      completedAt: this.#clock()
    });
    this.#activeTransition = null;
    const current = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.TRANSITION_FAILED, previous, current, this.#lastTransition);
    this.#emit(GAME_MANAGER_EVENTS.STATE_CHANGED, previous, current, this.#lastTransition);
    return current;
  }

  transitionTo(destination, options = {}) {
    if (destination === this.#state && !this.#activeTransition) return this.snapshot();
    this.beginTransition(destination, options);
    return this.commitTransition(options);
  }

  tryTransitionTo(destination, options = {}) {
    try {
      return Object.freeze({ ok: true, snapshot: this.transitionTo(destination, options), error: null });
    } catch (error) {
      return Object.freeze({ ok: false, snapshot: this.snapshot(), error });
    }
  }

  setState(state, options) {
    return this.transitionTo(state, options);
  }

  setMode(state, options) {
    return this.transitionTo(state, options);
  }

  requestMode(state, options) {
    return this.transitionTo(state, options);
  }

  setMayhem(enabled, reasonOrMetadata = null) {
    assertBoolean(enabled, 'enabled');
    let metadata = {};
    if (typeof reasonOrMetadata === 'string') {
      metadata = { reason: reasonOrMetadata };
    } else if (reasonOrMetadata !== null && reasonOrMetadata !== undefined) {
      metadata = assertOptions(reasonOrMetadata, 'Mayhem metadata');
    }

    if (enabled === this.#mayhemEnabled) return this.snapshot();
    const previous = this.snapshot();
    this.#mayhemEnabled = enabled;
    this.#revision += 1;
    const current = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.MAYHEM_CHANGED, previous, current, {
      enabled,
      ...normalizeMetadata(metadata)
    });
    return current;
  }

  toggleMayhem(options) {
    return this.setMayhem(!this.#mayhemEnabled, options);
  }

  /**
   * Atomically restores a stable serializable state. Unsafe transient restore
   * targets are rejected before live state is changed.
   */
  restore(value, { reason = 'restore', context, fallbackState = GAME_STATES.MENU } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('state must be an object');
    }
    const restoredState = value.state ?? value.mode;
    assertState(restoredState, 'state.state');
    assertBoolean(value.mayhemEnabled, 'state.mayhemEnabled');
    if (!RESTORABLE_STATES.has(restoredState)) {
      throw new RangeError(`state.state cannot restore transient state ${restoredState}`);
    }
    if (restoredState === GAME_STATES.PAUSED) {
      assertState(value.resumeState, 'state.resumeState');
      if (value.resumeState === GAME_STATES.TRANSITION || value.resumeState === GAME_STATES.PAUSED) {
        throw new RangeError('state.resumeState must be a stable non-paused state');
      }
    }

    const safeContext = this.getContext(context);
    const destinationResult = validateDestinationContract(restoredState, safeContext);
    if (!destinationResult.allowed) {
      assertState(fallbackState, 'fallbackState');
      throw new GameTransitionError(destinationResult, { from: this.#state, to: restoredState });
    }
    if (this.#activeTransition) {
      this.failTransition('Restore interrupted an active transition.', { context: safeContext });
    }
    if (
      restoredState === this.#state
      && value.mayhemEnabled === this.#mayhemEnabled
      && (restoredState !== GAME_STATES.PAUSED || value.resumeState === this.#resumeState)
    ) return this.snapshot();

    const previous = this.snapshot();
    this.#state = restoredState;
    this.#mayhemEnabled = value.mayhemEnabled;
    this.#resumeState = restoredState === GAME_STATES.PAUSED ? value.resumeState : null;
    this.#activeTransition = null;
    this.#revision += 1;
    this.#lastTransition = Object.freeze({
      id: `restore-${++this.#transitionSerial}`,
      from: previous.state,
      to: restoredState,
      recoveryState: fallbackState,
      requestedAt: this.#clock(),
      completedAt: this.#clock(),
      status: 'RESTORED',
      metadata: normalizeMetadata({ reason }),
      effects: getTransitionEffects(previous.state, restoredState)
    });
    const current = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.STATE_RESTORED, previous, current, this.#lastTransition);
    return current;
  }

  snapshot() {
    return createSnapshot({
      state: this.#state,
      mayhemEnabled: this.#mayhemEnabled,
      revision: this.#revision,
      activeTransition: this.#activeTransition,
      lastTransition: this.#lastTransition,
      resumeState: this.#resumeState
    });
  }

  getSnapshot() {
    return this.snapshot();
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    assertBoolean(emitCurrent, 'emitCurrent');
    this.#listeners.add(listener);
    if (emitCurrent) {
      this.#deliver(listener, Object.freeze({
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

  #selectRecoveryState(source, context) {
    if (isStreetState(source)) {
      const sourceStillValid = source === GAME_STATES.STREET_ON_FOOT
        ? context.controlledEntityCount === 1 && context.controlledEntityKind === CONTROL_KINDS.PEDESTRIAN
        : context.controlledEntityCount === 1 && isVehicleControl(context.controlledEntityKind);
      if (sourceStillValid) return source;
      if (context.controlledEntityCount === 0 && !context.missionCritical) return GAME_STATES.MANAGEMENT;
      return GAME_STATES.MENU;
    }
    const sourceResult = validateDestinationContract(source, context);
    if (sourceResult.allowed) return source;
    if (context.controlledEntityCount === 0 && !context.missionCritical) return GAME_STATES.MANAGEMENT;
    return GAME_STATES.MENU;
  }

  #emitRejection(error, metadata) {
    const snapshot = this.snapshot();
    this.#emit(GAME_MANAGER_EVENTS.TRANSITION_REJECTED, snapshot, snapshot, {
      from: error.from,
      to: error.to,
      code: error.code,
      reason: error.message,
      metadata
    });
  }

  #emit(type, previous, current, detail) {
    const event = Object.freeze({
      type,
      previous,
      current,
      detail: Object.freeze({ ...detail })
    });
    for (const listener of [...this.#listeners]) this.#deliver(listener, event);
  }

  #deliver(listener, event) {
    try {
      listener(event);
    } catch (error) {
      if (this.#onListenerError) {
        try {
          this.#onListenerError(error, event);
        } catch {
          // Observers must never gain mutation authority over the state machine.
        }
      } else if (globalThis.console?.error) {
        console.error('GameManager listener failed.', error);
      }
    }
  }
}

export default GameManager;
