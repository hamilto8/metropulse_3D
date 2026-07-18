import {
  GameTransitionError,
  TRANSITION_REJECTION_CODES,
  validateDestinationContract
} from './GameTransition.js';

export const TRANSITION_PHASES = Object.freeze({
  VALIDATE_REQUEST: 'VALIDATE_REQUEST',
  SUSPEND_INPUT: 'SUSPEND_INPUT',
  CLEAR_HELD_ACTIONS: 'CLEAR_HELD_ACTIONS',
  CAPTURE_SOURCE: 'CAPTURE_SOURCE',
  HANDOFF_ENTITY: 'HANDOFF_ENTITY',
  POSITION_CAMERA: 'POSITION_CAMERA',
  CONFIGURE_SIMULATION: 'CONFIGURE_SIMULATION',
  CONFIGURE_PRESENTATION: 'CONFIGURE_PRESENTATION',
  VALIDATE_DESTINATION: 'VALIDATE_DESTINATION',
  COMMIT: 'COMMIT'
});

export const TRANSITION_COORDINATOR_EVENTS = Object.freeze({
  STARTED: 'STARTED',
  PHASE_COMPLETED: 'PHASE_COMPLETED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED'
});

const RUNTIME_METHODS = Object.freeze({
  [TRANSITION_PHASES.SUSPEND_INPUT]: 'suspendInput',
  [TRANSITION_PHASES.CLEAR_HELD_ACTIONS]: 'clearHeldActions',
  [TRANSITION_PHASES.CAPTURE_SOURCE]: 'captureSourceState',
  [TRANSITION_PHASES.HANDOFF_ENTITY]: 'handoffEntityOwnership',
  [TRANSITION_PHASES.POSITION_CAMERA]: 'positionCamera',
  [TRANSITION_PHASES.CONFIGURE_SIMULATION]: 'configureSimulation',
  [TRANSITION_PHASES.CONFIGURE_PRESENTATION]: 'configurePresentation',
  [TRANSITION_PHASES.VALIDATE_DESTINATION]: 'validateDestination'
});

const EXECUTION_PHASES = Object.freeze([
  TRANSITION_PHASES.SUSPEND_INPUT,
  TRANSITION_PHASES.CLEAR_HELD_ACTIONS,
  TRANSITION_PHASES.CAPTURE_SOURCE,
  TRANSITION_PHASES.HANDOFF_ENTITY,
  TRANSITION_PHASES.POSITION_CAMERA,
  TRANSITION_PHASES.CONFIGURE_SIMULATION,
  TRANSITION_PHASES.CONFIGURE_PRESENTATION,
  TRANSITION_PHASES.VALIDATE_DESTINATION
]);

function assertObject(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function freezeRecord(value = {}) {
  return Object.freeze({ ...value });
}

export class TransitionCoordinatorError extends Error {
  constructor(message, {
    phase = null,
    transitionId = null,
    cause = null,
    code = 'TRANSITION_STEP_FAILED'
  } = {}) {
    super(message, cause === null ? undefined : { cause });
    this.name = 'TransitionCoordinatorError';
    this.code = code;
    this.phase = phase;
    this.transitionId = transitionId;
    if (cause !== null && this.cause === undefined) this.cause = cause;
  }
}

/**
 * Executes GameManager's renderer-independent transition contract against a
 * runtime adapter. The coordinator owns ordering and rollback; the adapter
 * owns domain mutations (entities, camera, clocks, DOM, and audio).
 */
export class TransitionCoordinator {
  #gameManager;
  #runtime;
  #listeners = new Set();
  #activeExecution = null;

  constructor({ gameManager, runtime = null } = {}) {
    if (!gameManager?.evaluateTransition || !gameManager?.beginTransition || !gameManager?.commitTransition) {
      throw new TypeError('gameManager must implement the GameManager transition lifecycle');
    }
    this.#gameManager = gameManager;
    this.setRuntime(runtime);
  }

  get gameManager() {
    return this.#gameManager;
  }

  get runtime() {
    return this.#runtime;
  }

  get activeExecution() {
    return this.#activeExecution;
  }

  setRuntime(runtime) {
    if (runtime !== null && (typeof runtime !== 'object' || Array.isArray(runtime))) {
      throw new TypeError('runtime must be an object or null');
    }
    if (this.#activeExecution) {
      throw new TransitionCoordinatorError('Cannot replace the runtime during a transition.', {
        transitionId: this.#activeExecution.transition.id,
        code: TRANSITION_REJECTION_CODES.TRANSITION_IN_PROGRESS
      });
    }
    this.#runtime = runtime || Object.freeze({});
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return this.#listeners.delete(listener);
    };
  }

  evaluateTransition(destination, options = {}) {
    return this.#gameManager.evaluateTransition(destination, options);
  }

  canTransitionTo(destination, options = {}) {
    return this.evaluateTransition(destination, options).allowed;
  }

  transitionTo(destination, options = {}) {
    const safeOptions = assertObject(options, 'options');
    if (destination === this.#gameManager.state && !this.#activeExecution) {
      return this.#gameManager.snapshot();
    }
    if (this.#activeExecution) {
      throw new TransitionCoordinatorError('Another coordinated transition is already in progress.', {
        transitionId: this.#activeExecution.transition.id,
        code: TRANSITION_REJECTION_CODES.TRANSITION_IN_PROGRESS
      });
    }

    const eligibility = this.evaluateTransition(destination, safeOptions);
    if (!eligibility.allowed) {
      // beginTransition owns canonical rejection events and typed errors.
      return this.#gameManager.beginTransition(destination, safeOptions);
    }

    const transition = this.#gameManager.beginTransition(destination, safeOptions);
    const execution = {
      transition,
      options: safeOptions,
      phase: TRANSITION_PHASES.VALIDATE_REQUEST,
      sourceState: null,
      compensation: [],
      cleanup: [],
      completedPhases: [TRANSITION_PHASES.VALIDATE_REQUEST]
    };
    this.#activeExecution = execution;
    this.#emit(TRANSITION_COORDINATOR_EVENTS.STARTED, execution);

    try {
      for (const phase of EXECUTION_PHASES) this.#executePhase(execution, phase);

      execution.phase = TRANSITION_PHASES.COMMIT;
      // Keep the active transaction available until runtime compensation has
      // restored source ownership if a commit guard rejects at the last step.
      const snapshot = this.#gameManager.commitTransition({ deferFailure: true });
      execution.completedPhases.push(TRANSITION_PHASES.COMMIT);
      this.#emit(TRANSITION_COORDINATOR_EVENTS.COMMITTED, execution, { snapshot });
      return snapshot;
    } catch (cause) {
      const error = cause instanceof TransitionCoordinatorError || cause instanceof GameTransitionError
        ? cause
        : new TransitionCoordinatorError(
          `Transition failed during ${execution.phase}: ${cause?.message || String(cause)}`,
          { phase: execution.phase, transitionId: transition.id, cause }
        );
      const compensationErrors = this.#compensate(execution);
      if (this.#gameManager.activeTransition) {
        this.#gameManager.failTransition(error);
      }
      this.#emit(TRANSITION_COORDINATOR_EVENTS.FAILED, execution, {
        error,
        compensationErrors: Object.freeze(compensationErrors)
      });
      throw error;
    } finally {
      this.#cleanup(execution);
      this.#activeExecution = null;
    }
  }

  tryTransitionTo(destination, options = {}) {
    try {
      return Object.freeze({
        ok: true,
        snapshot: this.transitionTo(destination, options),
        error: null
      });
    } catch (error) {
      return Object.freeze({ ok: false, snapshot: this.#gameManager.snapshot(), error });
    }
  }

  #executePhase(execution, phase) {
    execution.phase = phase;
    const methodName = RUNTIME_METHODS[phase];
    let result;

    if (phase === TRANSITION_PHASES.VALIDATE_DESTINATION) {
      const context = this.#gameManager.getContext();
      const contract = validateDestinationContract(execution.transition.to, context);
      if (!contract.allowed) {
        throw new GameTransitionError(contract, {
          from: execution.transition.from,
          to: execution.transition.to,
          transitionId: execution.transition.id
        });
      }
    }

    if (typeof this.#runtime[methodName] === 'function') {
      result = this.#runtime[methodName](this.#createRuntimeContext(execution));
      if (result && typeof result.then === 'function') {
        throw new TransitionCoordinatorError(
          `${methodName} returned a Promise; synchronous runtime phases are required.`,
          { phase, transitionId: execution.transition.id, code: 'ASYNC_PHASE_UNSUPPORTED' }
        );
      }
      if (result === false || result?.ok === false) {
        throw new TransitionCoordinatorError(
          result?.reason || `${methodName} could not complete.`,
          { phase, transitionId: execution.transition.id, code: result?.code || 'TRANSITION_STEP_FAILED' }
        );
      }
    }

    if (phase === TRANSITION_PHASES.CAPTURE_SOURCE) {
      execution.sourceState = result?.state ?? result ?? null;
      if (typeof this.#runtime.restoreSourceState === 'function') {
        execution.compensation.push(() => this.#runtime.restoreSourceState(
          this.#createRuntimeContext(execution)
        ));
      }
    }
    if (typeof result?.compensate === 'function') execution.compensation.push(result.compensate);
    if (typeof result?.cleanup === 'function') execution.cleanup.push(result.cleanup);

    execution.completedPhases.push(phase);
    this.#emit(TRANSITION_COORDINATOR_EVENTS.PHASE_COMPLETED, execution, { phase });
  }

  #createRuntimeContext(execution) {
    return Object.freeze({
      transition: execution.transition,
      options: execution.options,
      sourceState: execution.sourceState,
      completedPhases: Object.freeze([...execution.completedPhases])
    });
  }

  #compensate(execution) {
    const errors = [];
    for (let index = execution.compensation.length - 1; index >= 0; index -= 1) {
      try {
        execution.compensation[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  #cleanup(execution) {
    for (let index = execution.cleanup.length - 1; index >= 0; index -= 1) {
      try {
        execution.cleanup[index]();
      } catch (error) {
        globalThis.console?.error?.('Transition cleanup failed.', error);
      }
    }
  }

  #emit(type, execution, detail = {}) {
    const event = Object.freeze({
      type,
      transition: execution.transition,
      phase: execution.phase,
      completedPhases: Object.freeze([...execution.completedPhases]),
      detail: freezeRecord(detail)
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        globalThis.console?.error?.('TransitionCoordinator listener failed.', error);
      }
    }
  }
}

export default TransitionCoordinator;
