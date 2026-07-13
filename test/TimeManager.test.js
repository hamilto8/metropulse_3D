import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceSimulationTime,
  BASE_GAME_MINUTES_PER_REAL_SECOND,
  DEFAULT_TIME_SPEED,
  normalizeTimeSpeed,
  TimeManager
} from '../src/systems/TimeManager.js';

test('1x advances at the documented base rate and multipliers scale linearly', () => {
  assert.equal(BASE_GAME_MINUTES_PER_REAL_SECOND, 1);
  assert.equal(advanceSimulationTime(10, 60, 1), 11);
  assert.equal(advanceSimulationTime(10, 60, 0.5), 10.5);
  assert.equal(advanceSimulationTime(10, 60, 5), 15);
  assert.equal(advanceSimulationTime(10, 60, 15), 1);
});

test('time advancement wraps safely and rejects malformed timing input', () => {
  assert.equal(advanceSimulationTime(23.5, 60, 1), 0.5);
  assert.equal(advanceSimulationTime(Number.NaN, Number.NaN, 1), 0);
  assert.equal(advanceSimulationTime(12, -5, 1), 12);
  assert.equal(normalizeTimeSpeed(15), 15);
  assert.equal(normalizeTimeSpeed(999), DEFAULT_TIME_SPEED);
});

test('time setters keep restored model and controls synchronized', () => {
  const playingStates = [];
  const speedStates = [];
  let saves = 0;
  const manager = Object.create(TimeManager.prototype);
  manager.timeVal = 14.5;
  manager.isPlaying = true;
  manager.speed = DEFAULT_TIME_SPEED;
  manager.app = {
    uiManager: {
      syncTimePlayingControl(value) { playingStates.push(value); },
      syncTimeSpeedControl(value) { speedStates.push(value); }
    },
    persistenceSystem: {
      scheduleSave() { saves += 1; }
    }
  };

  assert.equal(manager.setSpeed(15), 15);
  assert.equal(manager.setSpeed(15), 15);
  assert.equal(manager.setPlaying(false), false);
  assert.equal(manager.setPlaying(false), false);
  assert.equal(manager.setTime(Number.NaN), 14.5);
  assert.deepEqual(speedStates, [15, 15]);
  assert.deepEqual(playingStates, [false, false]);
  assert.equal(saves, 2);
});
