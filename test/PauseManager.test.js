import test from 'node:test';
import assert from 'node:assert/strict';

import { PauseManager, PAUSE_MANAGER_EVENTS, PAUSE_REASONS } from '../src/core/PauseManager.js';
import {
  CLOCK_POLICIES,
  CONTROL_KINDS,
  GAME_STATES,
  GameManager,
  getStatePolicy
} from '../src/core/GameManager.js';
import { TransitionCoordinator } from '../src/core/TransitionCoordinator.js';
import { SimulationScheduler } from '../src/core/SimulationScheduler.js';

function contextFor(state) {
  if (state === GAME_STATES.STREET_ON_FOOT) {
    return { controlledEntityCount: 1, controlledEntityKind: CONTROL_KINDS.PEDESTRIAN };
  }
  if (state === GAME_STATES.STREET_VEHICLE) {
    return { controlledEntityCount: 1, controlledEntityKind: CONTROL_KINDS.VEHICLE };
  }
  return { controlledEntityCount: 0, controlledEntityKind: CONTROL_KINDS.NONE };
}

function harness(initialState, { mayhemEnabled = false } = {}) {
  const scheduler = new SimulationScheduler({
    initialClockPolicy: getStatePolicy(initialState).clock
  });
  const gameManager = new GameManager({
    initialState,
    mayhemEnabled,
    contextProvider: () => contextFor(gameManager.resumeState || gameManager.state)
  });
  let clears = 0;
  const coordinator = new TransitionCoordinator({
    gameManager,
    runtime: {
      configureSimulation({ transition }) {
        scheduler.setClockPolicy(transition.effects.simulationClock.to);
      }
    }
  });
  const pauseManager = new PauseManager({
    gameManager,
    transitionCoordinator: coordinator,
    clearHeldActions: () => { clears += 1; }
  });
  return { gameManager, pauseManager, scheduler, get clears() { return clears; } };
}

test('every gameplay state pauses and resumes to its exact source contract', () => {
  for (const state of [
    GAME_STATES.MANAGEMENT,
    GAME_STATES.BUILDER,
    GAME_STATES.STREET_ON_FOOT,
    GAME_STATES.STREET_VEHICLE,
    GAME_STATES.RESULT
  ]) {
    const subject = harness(state);
    const hold = subject.pauseManager.acquire(PAUSE_REASONS.MENU, { source: 'test' });

    assert.equal(subject.gameManager.state, GAME_STATES.PAUSED, state);
    assert.equal(subject.gameManager.resumeState, state, state);
    assert.equal(subject.scheduler.clockPolicy, CLOCK_POLICIES.PAUSED, state);
    assert.deepEqual(subject.pauseManager.snapshot().reasons, [PAUSE_REASONS.MENU]);

    assert.equal(subject.pauseManager.release(hold, { source: 'test' }), true);
    assert.equal(subject.gameManager.state, state, state);
    assert.equal(subject.gameManager.resumeState, null, state);
    assert.equal(subject.scheduler.clockPolicy, getStatePolicy(state).clock, state);
    assert.equal(subject.clears, 2, state);
  }
});

test('nested modal holds cannot resume each other', () => {
  const subject = harness(GAME_STATES.STREET_VEHICLE);
  const events = [];
  subject.pauseManager.subscribe(event => events.push(event));

  const dialogue = subject.pauseManager.acquire(PAUSE_REASONS.DIALOGUE);
  const menu = subject.pauseManager.openMenu();
  assert.equal(subject.pauseManager.holdCount, 2);
  assert.equal(subject.pauseManager.menuOpen, true);
  assert.deepEqual(subject.pauseManager.snapshot().reasons, [
    PAUSE_REASONS.DIALOGUE,
    PAUSE_REASONS.MENU
  ]);

  subject.pauseManager.release(menu);
  assert.equal(subject.gameManager.state, GAME_STATES.PAUSED);
  assert.equal(subject.pauseManager.menuOpen, false);
  assert.equal(subject.pauseManager.holdCount, 1);

  subject.pauseManager.release(dialogue);
  assert.equal(subject.gameManager.state, GAME_STATES.STREET_VEHICLE);
  assert.deepEqual(events.map(event => event.type), [
    PAUSE_MANAGER_EVENTS.PAUSED,
    PAUSE_MANAGER_EVENTS.CHANGED,
    PAUSE_MANAGER_EVENTS.CHANGED,
    PAUSE_MANAGER_EVENTS.RESUMED
  ]);
});

test('rapid menu toggles are idempotent and stale releases are harmless', () => {
  const subject = harness(GAME_STATES.BUILDER);
  const first = subject.pauseManager.openMenu();
  assert.equal(subject.pauseManager.openMenu(), first);
  assert.equal(subject.pauseManager.holdCount, 1);
  assert.equal(subject.pauseManager.toggleMenu(), false);
  assert.equal(subject.gameManager.state, GAME_STATES.BUILDER);
  assert.equal(subject.pauseManager.release(first), false);

  assert.equal(subject.pauseManager.toggleMenu(), true);
  assert.equal(subject.gameManager.state, GAME_STATES.PAUSED);
  assert.equal(subject.pauseManager.toggleMenu(), false);
  assert.equal(subject.gameManager.state, GAME_STATES.BUILDER);
});

test('Mayhem remains an overlay and cannot advance or reset through pause ownership', () => {
  const subject = harness(GAME_STATES.MANAGEMENT, { mayhemEnabled: true });
  const hold = subject.pauseManager.acquire(PAUSE_REASONS.SYSTEM);
  subject.scheduler.advanceFrame(5);

  assert.equal(subject.gameManager.mayhemEnabled, true);
  assert.equal(subject.scheduler.snapshot().clocks.GAMEPLAY_REAL_TIME.elapsed, 0);
  assert.equal(subject.scheduler.snapshot().clocks.CITY_LOGICAL.elapsed, 0);

  subject.pauseManager.release(hold);
  assert.equal(subject.gameManager.mayhemEnabled, true);
});

test('pause requests fail closed outside stable gameplay states', () => {
  for (const state of [GAME_STATES.BOOT, GAME_STATES.LOAD, GAME_STATES.MENU]) {
    const subject = harness(state);
    assert.throws(
      () => subject.pauseManager.acquire(PAUSE_REASONS.MENU),
      new RegExp(`Cannot pause from ${state}`)
    );
    assert.equal(subject.pauseManager.holdCount, 0);
    assert.equal(subject.gameManager.state, state);
  }
  assert.throws(
    () => harness(GAME_STATES.MANAGEMENT).pauseManager.acquire('CUTSCENE'),
    /Unknown pause reason/
  );
});
