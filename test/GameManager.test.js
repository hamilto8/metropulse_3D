import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAME_MANAGER_EVENTS,
  GAME_MODES,
  GameManager
} from '../src/core/GameManager.js';

test('GameManager starts in validated MANAGEMENT state with immutable snapshots', () => {
  const manager = new GameManager();
  const state = manager.snapshot();

  assert.deepEqual(state, {
    mode: GAME_MODES.MANAGEMENT,
    mayhemEnabled: false,
    revision: 0
  });
  assert.equal(Object.isFrozen(state), true);
  assert.throws(
    () => new GameManager({ initialMode: 'UNKNOWN' }),
    /initialMode must be one of/
  );
  assert.throws(
    () => new GameManager({ mayhemEnabled: 1 }),
    /mayhemEnabled must be a boolean/
  );
});

test('GameManager performs explicit mode transitions and emits previous/current state', () => {
  const manager = new GameManager();
  const events = [];
  manager.subscribe(event => events.push(event));

  assert.equal(manager.canTransitionTo(GAME_MODES.ACTION), true);
  const state = manager.transitionTo(GAME_MODES.ACTION, { reason: 'take-control' });

  assert.equal(state.mode, GAME_MODES.ACTION);
  assert.equal(state.revision, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, GAME_MANAGER_EVENTS.MODE_CHANGED);
  assert.equal(events[0].previous.mode, GAME_MODES.MANAGEMENT);
  assert.equal(events[0].current.mode, GAME_MODES.ACTION);
  assert.deepEqual(events[0].detail, {
    from: GAME_MODES.MANAGEMENT,
    to: GAME_MODES.ACTION,
    reason: 'take-control'
  });
  assert.equal(Object.isFrozen(events[0]), true);

  // Re-selecting the active mode is intentionally idempotent.
  manager.transitionTo(GAME_MODES.ACTION);
  assert.equal(manager.revision, 1);
  assert.equal(events.length, 1);
  assert.throws(() => manager.transitionTo('STREET'), /mode must be one of/);
});

test('Mayhem remains an independent overlay while modes change', () => {
  const manager = new GameManager({ initialMode: GAME_MODES.BUILDER });

  manager.setMayhem(true, 'comet-storm');
  manager.transitionTo(GAME_MODES.ACTION);

  assert.equal(manager.mode, GAME_MODES.ACTION);
  assert.equal(manager.mayhemEnabled, true);
  assert.equal(manager.mayhem, true);
  assert.equal(manager.revision, 2);

  manager.toggleMayhem();
  assert.equal(manager.mayhemEnabled, false);
  assert.equal(manager.mode, GAME_MODES.ACTION);
  assert.throws(() => manager.setMayhem('yes'), /enabled must be a boolean/);
  assert.throws(
    () => manager.setMayhem(true, 42),
    /metadata must be an object, string, or null/
  );
});

test('restore validates and atomically replaces serializable game state', () => {
  const manager = new GameManager();
  const events = [];
  manager.subscribe(event => events.push(event));

  const restored = manager.restore({
    mode: GAME_MODES.BUILDER,
    mayhemEnabled: true,
    revision: 999
  });

  assert.deepEqual(restored, {
    mode: GAME_MODES.BUILDER,
    mayhemEnabled: true,
    revision: 1
  });
  assert.equal(events[0].type, GAME_MANAGER_EVENTS.STATE_RESTORED);
  assert.throws(() => manager.restore(null), /state must be an object/);
  assert.throws(
    () => manager.restore({ mode: GAME_MODES.ACTION, mayhemEnabled: 0 }),
    /state.mayhemEnabled must be a boolean/
  );
});

test('subscriptions can emit current state and unsubscribe safely', () => {
  const manager = new GameManager();
  const events = [];
  const unsubscribe = manager.subscribe(event => events.push(event), {
    emitCurrent: true
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, GAME_MANAGER_EVENTS.SNAPSHOT);
  assert.equal(events[0].previous, null);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);

  manager.transitionTo(GAME_MODES.BUILDER);
  assert.equal(events.length, 1);
  assert.throws(() => manager.subscribe(null), /listener must be a function/);
});
