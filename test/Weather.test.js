import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNextWeatherMode,
  getWeatherDefinition,
  normalizeWeatherMode,
  stepWeatherCycle,
  WEATHER_SEQUENCE
} from '../src/systems/Weather.js';
import { Environment } from '../src/world/Environment.js';

test('weather definitions provide one canonical, extensible cycle', () => {
  assert.deepEqual(WEATHER_SEQUENCE, ['clear', 'mist', 'rain', 'thunderstorm']);
  assert.equal(normalizeWeatherMode('unknown'), 'clear');
  assert.equal(getNextWeatherMode('clear'), 'mist');
  assert.equal(getNextWeatherMode('thunderstorm'), 'clear');
  assert.equal(getWeatherDefinition('rain').gripMultiplier, 0.48);
});

test('weather clock advances through every mode and carries frame overflow', () => {
  let state = { mode: 'clear', remainingSeconds: 45 };

  for (const expectedMode of ['mist', 'rain', 'thunderstorm', 'clear']) {
    state = stepWeatherCycle(
      state.mode,
      state.remainingSeconds,
      state.remainingSeconds + 0.25
    );
    assert.equal(state.mode, expectedMode);
    assert.equal(state.transitions, 1);
    assert.equal(
      state.remainingSeconds,
      getWeatherDefinition(expectedMode).durationSeconds - 0.25
    );
  }
});

test('weather clock safely handles disabled, invalid, and very large deltas', () => {
  assert.deepEqual(stepWeatherCycle('clear', 10, 5, false), {
    mode: 'clear',
    remainingSeconds: 0,
    transitions: 0
  });
  assert.deepEqual(stepWeatherCycle('invalid', Number.NaN, Number.NaN), {
    mode: 'clear',
    remainingSeconds: 45,
    transitions: 0
  });

  const state = stepWeatherCycle('clear', 45, 45 + 143 + 30);
  assert.equal(state.mode, 'rain');
  assert.equal(state.remainingSeconds, 40);
  assert.equal(state.transitions, 6);
});

test('dynamic-weather setter keeps restored model and UI state synchronized', () => {
  const renderedStates = [];
  const environment = Object.create(Environment.prototype);
  environment.weatherMode = 'clear';
  environment.isDynamicWeather = true;
  environment.weatherCycleTimer = 45;
  environment.app = {
    uiManager: {
      syncDynamicWeatherControl(enabled) { renderedStates.push(enabled); }
    }
  };

  assert.equal(environment.setDynamicWeather(false), false);
  assert.equal(environment.weatherCycleTimer, 0);
  assert.equal(environment.setDynamicWeather(false), false);
  assert.equal(environment.setDynamicWeather(true), true);
  assert.equal(environment.weatherCycleTimer, 45);
  assert.deepEqual(renderedStates, [false, false, true]);
});

test('Environment delegates automatic transitions to the weather clock', () => {
  const environment = Object.create(Environment.prototype);
  environment.weatherMode = 'clear';
  environment.isDynamicWeather = true;
  environment.weatherCycleTimer = 0.1;
  environment.setWeather = function setWeather(mode) {
    this.weatherMode = mode;
  };

  assert.equal(environment.updateDynamicWeather(0.25), 1);
  assert.equal(environment.weatherMode, 'mist');
  assert.equal(environment.weatherCycleTimer, 29.85);
});
