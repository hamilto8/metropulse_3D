import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeConfig,
  createSeededRandom
} from '../src/app/RuntimeConfig.js';

test('test mode cannot be enabled in a production runtime', () => {
  const config = createRuntimeConfig({
    search: '?testMode=1&features=aircraft',
    allowTestMode: false,
    allowFeatureOverrides: false
  });
  assert.equal(config.test, null);
  assert.equal(config.diagnosticsEnabled, false);
  assert.equal(config.featureFlags.isEnabled('aircraft'), false);
});

test('development test mode parses bounded deterministic scenario controls', () => {
  const config = createRuntimeConfig({
    search: '?testMode=1&seed=repeatable&traffic=999&pedestrians=-4'
      + '&time=30&weather=rain&mission=mission_executive&profile=clean'
      + '&features=aircraft',
    allowTestMode: true,
    allowFeatureOverrides: true
  });
  assert.deepEqual(config.test, {
    seed: 'repeatable',
    trafficCount: 48,
    pedestrianCount: 0,
    time: 24,
    weather: 'rain',
    missionId: 'mission_executive',
    cleanProfile: true
  });
  assert.equal(config.featureFlags.isEnabled('aircraft'), true);
  assert.equal(config.diagnosticsEnabled, true);
});

test('seeded random streams are repeatable and seed-sensitive', () => {
  const a = createSeededRandom('alpha');
  const b = createSeededRandom('alpha');
  const c = createSeededRandom('bravo');
  const valuesA = Array.from({ length: 8 }, () => a());
  assert.deepEqual(valuesA, Array.from({ length: 8 }, () => b()));
  assert.notDeepEqual(valuesA, Array.from({ length: 8 }, () => c()));
  assert.ok(valuesA.every(value => value >= 0 && value < 1));
});

