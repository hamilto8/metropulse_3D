import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMERA_POLICIES,
  CLOCK_POLICIES,
  CONTROL_KINDS,
  CONTROL_POLICIES,
  GAME_MANAGER_EVENTS,
  GAME_STATE_POLICIES,
  GAME_STATE_TRANSITIONS,
  GAME_STATES,
  GameManager,
  GameTransitionError,
  HEAT_POLICIES,
  MISSION_POLICIES,
  TRANSITION_REJECTION_CODES,
  getTransitionEffects,
  isStreetState
} from '../src/core/GameManager.js';

function context(overrides = {}) {
  return {
    missionActive: false,
    missionCritical: false,
    missionState: 'IDLE',
    handoffPending: false,
    controlledEntityCount: 0,
    controlledEntityKind: CONTROL_KINDS.NONE,
    heatActive: false,
    ...overrides
  };
}

function controlled(kind, overrides = {}) {
  return context({
    controlledEntityCount: 1,
    controlledEntityKind: kind,
    ...overrides
  });
}

test('GameManager starts in explicit BOOT state with immutable snapshots', () => {
  const manager = new GameManager();
  const snapshot = manager.snapshot();

  assert.equal(snapshot.state, GAME_STATES.BOOT);
  assert.equal(snapshot.mode, GAME_STATES.BOOT);
  assert.equal(snapshot.mayhemEnabled, false);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.activeTransition, null);
  assert.equal(snapshot.lastTransition, null);
  assert.equal(snapshot.resumeState, null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => new GameManager({ initialState: 'UNKNOWN' }), /initialState must be one of/);
  assert.throws(() => new GameManager({ initialState: GAME_STATES.TRANSITION }), /cannot be TRANSITION/);
  assert.throws(() => new GameManager({ mayhemEnabled: 1 }), /mayhemEnabled must be a boolean/);
});

test('state catalog contains every roadmap state and a policy for every state', () => {
  assert.deepEqual(Object.values(GAME_STATES), [
    'BOOT',
    'LOAD',
    'MANAGEMENT',
    'BUILDER',
    'TRANSITION',
    'STREET_ON_FOOT',
    'STREET_VEHICLE',
    'RESULT',
    'PAUSED',
    'MENU'
  ]);
  for (const state of Object.values(GAME_STATES)) {
    assert.ok(GAME_STATE_POLICIES[state], `${state} needs an ownership policy`);
    assert.ok(GAME_STATE_TRANSITIONS[state], `${state} needs a transition row`);
    assert.equal(Object.isFrozen(GAME_STATE_POLICIES[state]), true);
    assert.equal(Object.isFrozen(GAME_STATE_TRANSITIONS[state]), true);
  }
  assert.equal(isStreetState(GAME_STATES.STREET_ON_FOOT), true);
  assert.equal(isStreetState(GAME_STATES.STREET_VEHICLE), true);
  assert.equal(isStreetState(GAME_STATES.MANAGEMENT), false);
});

test('legal transition table is explicit and all omitted edges reject with a reason', () => {
  for (const from of Object.values(GAME_STATES)) {
    if (from === GAME_STATES.TRANSITION || from === GAME_STATES.PAUSED) continue;
    const manager = new GameManager({ initialState: from });
    assert.deepEqual(manager.getLegalTransitions(), GAME_STATE_TRANSITIONS[from]);

    for (const to of Object.values(GAME_STATES)) {
      const result = manager.evaluateTransition(to, { context: context() });
      if (to === from) {
        assert.equal(result.code, TRANSITION_REJECTION_CODES.SAME_STATE);
      } else if (to === GAME_STATES.TRANSITION) {
        assert.equal(result.code, TRANSITION_REJECTION_CODES.ILLEGAL_EDGE);
      } else if (!GAME_STATE_TRANSITIONS[from].includes(to)) {
        assert.equal(result.allowed, false, `${from} -> ${to} must reject`);
        assert.equal(result.code, TRANSITION_REJECTION_CODES.ILLEGAL_EDGE);
        assert.ok(result.reason);
      }
    }
  }
});

test('a transition exposes metadata and ownership effects before commit', () => {
  let now = 100;
  const currentContext = controlled(CONTROL_KINDS.VEHICLE, { heatActive: true });
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => currentContext,
    clock: () => ++now
  });
  const events = [];
  manager.subscribe(event => events.push(event));

  const transition = manager.beginTransition(GAME_STATES.STREET_VEHICLE, {
    reason: 'take-control',
    source: 'test',
    correlationId: 'request-7',
    target: { type: 'VEHICLE', id: 'taxi-7', mutable: true }
  });

  assert.equal(manager.state, GAME_STATES.TRANSITION);
  assert.equal(transition.id, 'transition-1');
  assert.equal(transition.from, GAME_STATES.MANAGEMENT);
  assert.equal(transition.to, GAME_STATES.STREET_VEHICLE);
  assert.equal(transition.metadata.reason, 'take-control');
  assert.equal(transition.metadata.source, 'test');
  assert.deepEqual(transition.metadata.target, { type: 'VEHICLE', id: 'taxi-7' });
  assert.equal(Object.isFrozen(transition), true);
  assert.deepEqual(transition.effects, getTransitionEffects(
    GAME_STATES.MANAGEMENT,
    GAME_STATES.STREET_VEHICLE
  ));
  assert.deepEqual(transition.effects.mission, {
    from: MISSION_POLICIES.REQUIRE_RESOLVED,
    to: MISSION_POLICIES.PRESERVE
  });
  assert.deepEqual(transition.effects.heat, {
    from: HEAT_POLICIES.PRESERVE_FROZEN,
    to: HEAT_POLICIES.PRESERVE_RUNNING
  });
  assert.deepEqual(transition.effects.controlledEntity, {
    from: CONTROL_POLICIES.REQUIRE_NONE,
    to: CONTROL_POLICIES.REQUIRE_VEHICLE
  });
  assert.deepEqual(transition.effects.camera, {
    from: CAMERA_POLICIES.MANAGEMENT,
    to: CAMERA_POLICIES.STREET_VEHICLE
  });
  assert.deepEqual(transition.effects.simulationClock, {
    from: CLOCK_POLICIES.CITY,
    to: CLOCK_POLICIES.STREET
  });
  assert.equal(events[0].type, GAME_MANAGER_EVENTS.TRANSITION_STARTED);

  const committed = manager.commitTransition();
  assert.equal(committed.state, GAME_STATES.STREET_VEHICLE);
  assert.equal(committed.activeTransition, null);
  assert.equal(committed.lastTransition.status, 'COMMITTED');
  assert.equal(manager.revision, 2);
  assert.deepEqual(events.map(event => event.type), [
    GAME_MANAGER_EVENTS.TRANSITION_STARTED,
    GAME_MANAGER_EVENTS.TRANSITION_COMMITTED,
    GAME_MANAGER_EVENTS.STATE_CHANGED
  ]);

  // Re-selecting the active state is an idempotent no-op.
  assert.deepEqual(manager.transitionTo(GAME_STATES.STREET_VEHICLE), committed);
  assert.equal(manager.revision, 2);
});

test('builder entry rejects unresolved handoffs, missions, and controlled entities', () => {
  let currentContext = context({ handoffPending: true });
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => currentContext
  });
  const events = [];
  manager.subscribe(event => events.push(event));

  let result = manager.evaluateTransition(GAME_STATES.BUILDER);
  assert.equal(result.code, TRANSITION_REJECTION_CODES.HANDOFF_UNRESOLVED);

  currentContext = context({
    missionActive: true,
    missionCritical: true,
    missionState: 'IN_PROGRESS'
  });
  result = manager.evaluateTransition(GAME_STATES.BUILDER);
  assert.equal(result.code, TRANSITION_REJECTION_CODES.MISSION_CRITICAL);

  currentContext = controlled(CONTROL_KINDS.PEDESTRIAN);
  assert.throws(
    () => manager.transitionTo(GAME_STATES.BUILDER),
    error => error instanceof GameTransitionError
      && error.code === TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_ACTIVE
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(events.at(-1).type, GAME_MANAGER_EVENTS.TRANSITION_REJECTED);
  assert.equal(events.at(-1).detail.code, TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_ACTIVE);

  const streetManager = new GameManager({
    initialState: GAME_STATES.STREET_ON_FOOT,
    contextProvider: () => controlled(CONTROL_KINDS.PEDESTRIAN, { handoffPending: true })
  });
  assert.equal(
    streetManager.evaluateTransition(GAME_STATES.BUILDER).code,
    TRANSITION_REJECTION_CODES.HANDOFF_UNRESOLVED
  );
});

test('mutating requests expose structured invalid-state rejection errors', () => {
  const manager = new GameManager({ initialState: GAME_STATES.MANAGEMENT });
  assert.throws(
    () => manager.transitionTo('ACTION'),
    error => error instanceof GameTransitionError
      && error.code === TRANSITION_REJECTION_CODES.INVALID_STATE
      && error.from === GAME_STATES.MANAGEMENT
      && error.to === 'ACTION'
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
});

test('street destinations require exactly one correctly typed controlled entity', () => {
  let currentContext = context();
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    contextProvider: () => currentContext
  });

  manager.beginTransition(GAME_STATES.STREET_ON_FOOT);
  assert.throws(
    () => manager.commitTransition(),
    error => error.code === TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_REQUIRED
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.lastTransition.status, 'FAILED');

  currentContext = controlled(CONTROL_KINDS.PEDESTRIAN);
  manager.transitionTo(GAME_STATES.STREET_ON_FOOT);
  assert.equal(manager.state, GAME_STATES.STREET_ON_FOOT);

  currentContext = controlled(CONTROL_KINDS.MULTIPLE, { controlledEntityCount: 2 });
  assert.throws(
    () => manager.transitionTo(GAME_STATES.STREET_VEHICLE),
    error => error.code === TRANSITION_REJECTION_CODES.MULTIPLE_CONTROLLED_ENTITIES
  );
  assert.equal(manager.state, GAME_STATES.MENU);
});

test('mission-critical street state may only enter RESULT or PAUSED', () => {
  const missionContext = controlled(CONTROL_KINDS.VEHICLE, {
    missionActive: true,
    missionCritical: true,
    missionState: 'IN_PROGRESS'
  });
  const manager = new GameManager({
    initialState: GAME_STATES.STREET_VEHICLE,
    contextProvider: () => missionContext
  });

  const management = manager.evaluateTransition(GAME_STATES.MANAGEMENT);
  assert.equal(management.code, TRANSITION_REJECTION_CODES.MISSION_CRITICAL);
  assert.equal(manager.canTransitionTo(GAME_STATES.RESULT), true);
  assert.equal(manager.canTransitionTo(GAME_STATES.PAUSED), true);
  assert.equal(manager.canTransitionTo(GAME_STATES.MENU), false);
});

test('commit failure recovers to source when valid and to a known safe fallback otherwise', () => {
  let currentContext = controlled(CONTROL_KINDS.VEHICLE);
  const manager = new GameManager({
    initialState: GAME_STATES.STREET_VEHICLE,
    contextProvider: () => currentContext
  });
  const events = [];
  manager.subscribe(event => events.push(event));

  manager.beginTransition(GAME_STATES.STREET_ON_FOOT);
  assert.throws(() => manager.commitTransition(), /controlled pedestrian/);
  assert.equal(manager.state, GAME_STATES.STREET_VEHICLE);
  assert.equal(manager.lastTransition.recoveryState, GAME_STATES.STREET_VEHICLE);

  manager.beginTransition(GAME_STATES.STREET_ON_FOOT);
  currentContext = context();
  assert.throws(() => manager.commitTransition(), /controlled pedestrian/);
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.lastTransition.recoveryState, GAME_STATES.MANAGEMENT);
  assert.ok(events.some(event => event.type === GAME_MANAGER_EVENTS.TRANSITION_FAILED));
});

test('pause records one legal resume target and rejects unrelated resume states', () => {
  const manager = new GameManager({ initialState: GAME_STATES.MANAGEMENT });
  manager.transitionTo(GAME_STATES.PAUSED);

  assert.equal(manager.state, GAME_STATES.PAUSED);
  assert.equal(manager.resumeState, GAME_STATES.MANAGEMENT);
  assert.deepEqual(manager.getLegalTransitions(), [GAME_STATES.MANAGEMENT, GAME_STATES.MENU]);
  assert.equal(
    manager.evaluateTransition(GAME_STATES.BUILDER).code,
    TRANSITION_REJECTION_CODES.INVALID_RESUME_TARGET
  );

  manager.transitionTo(GAME_STATES.MANAGEMENT);
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.resumeState, null);
});

test('custom guards are extensible and cannot corrupt state when they fail', () => {
  let phaseToReject = 'REQUEST';
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    guards: [({ phase }) => phase === phaseToReject
      ? { allowed: false, code: 'CITY_LOCKED', reason: 'City data is locked.' }
      : true]
  });

  assert.throws(
    () => manager.transitionTo(GAME_STATES.BUILDER),
    error => error.code === 'CITY_LOCKED'
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);

  phaseToReject = 'COMMIT';
  assert.throws(
    () => manager.transitionTo(GAME_STATES.BUILDER),
    error => error.code === 'CITY_LOCKED'
  );
  assert.equal(manager.state, GAME_STATES.MANAGEMENT);
  assert.equal(manager.lastTransition.status, 'FAILED');
});

test('Mayhem remains an independent overlay while explicit states change', () => {
  const manager = new GameManager({ initialState: GAME_STATES.MANAGEMENT });
  manager.setMayhem(true, { reason: 'comet-storm', source: 'test' });
  manager.transitionTo(GAME_STATES.BUILDER);

  assert.equal(manager.state, GAME_STATES.BUILDER);
  assert.equal(manager.mayhemEnabled, true);
  assert.equal(manager.mayhem, true);
  manager.toggleMayhem();
  assert.equal(manager.mayhemEnabled, false);
  assert.equal(manager.state, GAME_STATES.BUILDER);
  assert.throws(() => manager.setMayhem('yes'), /enabled must be a boolean/);
  assert.throws(() => manager.setMayhem(true, 42), /metadata must be an object/);
});

test('restore validates stable state, pause metadata, and destination ownership atomically', () => {
  const manager = new GameManager({ initialState: GAME_STATES.MANAGEMENT });
  const restored = manager.restore({
    state: GAME_STATES.BUILDER,
    mayhemEnabled: true,
    revision: 999
  });

  assert.equal(restored.state, GAME_STATES.BUILDER);
  assert.equal(restored.mayhemEnabled, true);
  assert.equal(restored.revision, 1);
  assert.equal(restored.lastTransition.status, 'RESTORED');
  assert.throws(() => manager.restore(null), /state must be an object/);
  assert.throws(
    () => manager.restore({ state: GAME_STATES.TRANSITION, mayhemEnabled: false }),
    /cannot restore transient/
  );
  assert.throws(
    () => manager.restore({ state: GAME_STATES.PAUSED, mayhemEnabled: false }),
    /resumeState must be one of/
  );
  assert.throws(
    () => manager.restore({ state: GAME_STATES.MANAGEMENT, mayhemEnabled: 0 }),
    /mayhemEnabled must be a boolean/
  );
});

test('subscriptions isolate observer failures and unsubscribe safely', () => {
  const observedErrors = [];
  const manager = new GameManager({
    initialState: GAME_STATES.MANAGEMENT,
    onListenerError: (error, event) => observedErrors.push([error.message, event.type])
  });
  manager.subscribe(() => { throw new Error('observer exploded'); });
  const events = [];
  const unsubscribe = manager.subscribe(event => events.push(event), { emitCurrent: true });

  manager.transitionTo(GAME_STATES.BUILDER);
  assert.equal(manager.state, GAME_STATES.BUILDER);
  assert.equal(observedErrors.length, 3);
  assert.equal(events[0].type, GAME_MANAGER_EVENTS.SNAPSHOT);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.throws(() => manager.subscribe(null), /listener must be a function/);
});
