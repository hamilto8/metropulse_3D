import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTROL_KINDS, GAME_STATES, GameManager } from '../src/core/GameManager.js';
import {
  TRANSITION_COORDINATOR_EVENTS,
  TRANSITION_PHASES,
  TransitionCoordinator,
  TransitionCoordinatorError
} from '../src/core/TransitionCoordinator.js';

function createHarness({ failPhase = null } = {}) {
  const runtimeState = {
    inputSuspended: false,
    heldActions: true,
    control: CONTROL_KINDS.NONE,
    camera: 'MANAGEMENT',
    clock: 'CITY',
    presentation: 'MANAGEMENT'
  };
  const calls = [];
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => ({
      controlledEntityCount: runtimeState.control === CONTROL_KINDS.NONE ? 0 : 1,
      controlledEntityKind: runtimeState.control,
      missionActive: false,
      missionCritical: false,
      missionState: 'IDLE',
      handoffPending: false,
      heatActive: false
    })
  });

  const run = (phase, mutation) => {
    calls.push(phase);
    if (failPhase === phase) throw new Error(`failed ${phase}`);
    mutation?.();
  };
  const runtime = {
    suspendInput() {
      run(TRANSITION_PHASES.SUSPEND_INPUT, () => { runtimeState.inputSuspended = true; });
      return { cleanup: () => { runtimeState.inputSuspended = false; } };
    },
    clearHeldActions() {
      run(TRANSITION_PHASES.CLEAR_HELD_ACTIONS, () => { runtimeState.heldActions = false; });
    },
    captureSourceState() {
      run(TRANSITION_PHASES.CAPTURE_SOURCE);
      return { state: { ...runtimeState } };
    },
    handoffEntityOwnership() {
      run(TRANSITION_PHASES.HANDOFF_ENTITY, () => { runtimeState.control = CONTROL_KINDS.VEHICLE; });
    },
    positionCamera() {
      run(TRANSITION_PHASES.POSITION_CAMERA, () => { runtimeState.camera = 'STREET_VEHICLE'; });
    },
    configureSimulation() {
      run(TRANSITION_PHASES.CONFIGURE_SIMULATION, () => { runtimeState.clock = 'STREET'; });
    },
    configurePresentation() {
      run(TRANSITION_PHASES.CONFIGURE_PRESENTATION, () => { runtimeState.presentation = 'STREET_VEHICLE'; });
    },
    validateDestination() {
      run(TRANSITION_PHASES.VALIDATE_DESTINATION);
    },
    restoreSourceState({ sourceState }) {
      calls.push('RESTORE_SOURCE');
      Object.assign(runtimeState, sourceState);
    }
  };

  return {
    calls,
    manager,
    runtimeState,
    coordinator: new TransitionCoordinator({ gameManager: manager, runtime })
  };
}

test('TransitionCoordinator executes the P1.2 phases in canonical order', () => {
  const { coordinator, manager, calls, runtimeState } = createHarness();
  const events = [];
  coordinator.subscribe(event => events.push(event));

  const snapshot = coordinator.transitionTo(GAME_STATES.STREET_VEHICLE, {
    reason: 'test',
    source: 'TransitionCoordinator.test'
  });

  assert.equal(snapshot.state, GAME_STATES.STREET_VEHICLE);
  assert.equal(manager.activeTransition, null);
  assert.deepEqual(calls, [
    TRANSITION_PHASES.SUSPEND_INPUT,
    TRANSITION_PHASES.CLEAR_HELD_ACTIONS,
    TRANSITION_PHASES.CAPTURE_SOURCE,
    TRANSITION_PHASES.HANDOFF_ENTITY,
    TRANSITION_PHASES.POSITION_CAMERA,
    TRANSITION_PHASES.CONFIGURE_SIMULATION,
    TRANSITION_PHASES.CONFIGURE_PRESENTATION,
    TRANSITION_PHASES.VALIDATE_DESTINATION
  ]);
  assert.equal(runtimeState.inputSuspended, false);
  assert.equal(runtimeState.heldActions, false);
  assert.equal(runtimeState.control, CONTROL_KINDS.VEHICLE);
  assert.deepEqual(events.map(event => event.type), [
    TRANSITION_COORDINATOR_EVENTS.STARTED,
    ...Array(8).fill(TRANSITION_COORDINATOR_EVENTS.PHASE_COMPLETED),
    TRANSITION_COORDINATOR_EVENTS.COMMITTED
  ]);
});

test('TransitionCoordinator compensates partial mutations and returns GameManager to source', () => {
  const { coordinator, manager, calls, runtimeState } = createHarness({
    failPhase: TRANSITION_PHASES.POSITION_CAMERA
  });

  assert.throws(
    () => coordinator.transitionTo(GAME_STATES.STREET_VEHICLE),
    error => error instanceof TransitionCoordinatorError
      && error.phase === TRANSITION_PHASES.POSITION_CAMERA
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.lastTransition.status, 'FAILED');
  assert.equal(runtimeState.control, CONTROL_KINDS.NONE);
  assert.equal(runtimeState.camera, 'MANAGEMENT');
  assert.equal(runtimeState.inputSuspended, false);
  assert.equal(calls.at(-1), 'RESTORE_SOURCE');
});

test('TransitionCoordinator compensates before recovery when a commit guard rejects', () => {
  const runtimeState = { control: CONTROL_KINDS.NONE };
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => ({
      controlledEntityCount: runtimeState.control === CONTROL_KINDS.NONE ? 0 : 1,
      controlledEntityKind: runtimeState.control
    }),
    guards: [({ phase }) => phase === 'COMMIT'
      ? { allowed: false, code: 'LATE_REJECTION', reason: 'late guard rejected' }
      : true]
  });
  const coordinator = new TransitionCoordinator({
    gameManager: manager,
    runtime: {
      captureSourceState: () => ({ state: { ...runtimeState } }),
      handoffEntityOwnership: () => { runtimeState.control = CONTROL_KINDS.VEHICLE; },
      restoreSourceState: ({ sourceState }) => Object.assign(runtimeState, sourceState)
    }
  });

  assert.throws(
    () => coordinator.transitionTo(GAME_STATES.STREET_VEHICLE),
    error => error.code === 'LATE_REJECTION'
  );
  assert.equal(runtimeState.control, CONTROL_KINDS.NONE);
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.lastTransition.recoveryState, GAME_STATES.MANAGEMENT);
});

test('TransitionCoordinator validates destination ownership before commit', () => {
  const { manager, runtimeState } = createHarness();
  const coordinator = new TransitionCoordinator({
    gameManager: manager,
    runtime: {
      captureSourceState: () => ({ state: { ...runtimeState } }),
      restoreSourceState: ({ sourceState }) => Object.assign(runtimeState, sourceState)
      // Deliberately omit the vehicle handoff.
    }
  });

  assert.throws(
    () => coordinator.transitionTo(GAME_STATES.STREET_VEHICLE),
    error => error.code === 'CONTROLLED_ENTITY_REQUIRED'
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
});

test('TransitionCoordinator is idempotent for the active stable state', () => {
  const { coordinator, manager, calls } = createHarness();
  const snapshot = coordinator.transitionTo(GAME_STATES.MANAGEMENT);
  assert.deepEqual(snapshot, manager.snapshot());
  assert.deepEqual(calls, []);
  assert.equal(manager.revision, 0);
});

test('TransitionCoordinator rejects reentrant requests without corrupting the outer transition', () => {
  const runtimeState = { control: CONTROL_KINDS.NONE };
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => ({
      controlledEntityCount: runtimeState.control === CONTROL_KINDS.NONE ? 0 : 1,
      controlledEntityKind: runtimeState.control
    })
  });
  let coordinator;
  coordinator = new TransitionCoordinator({
    gameManager: manager,
    runtime: {
      handoffEntityOwnership() {
        assert.throws(
          () => coordinator.transitionTo(GAME_STATES.BUILDER),
          error => error instanceof TransitionCoordinatorError
            && error.code === 'TRANSITION_IN_PROGRESS'
        );
        runtimeState.control = CONTROL_KINDS.VEHICLE;
      }
    }
  });

  coordinator.transitionTo(GAME_STATES.STREET_VEHICLE);
  assert.equal(manager.state, GAME_STATES.STREET_VEHICLE);
});
