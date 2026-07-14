import test from 'node:test';
import assert from 'node:assert/strict';

import { getPropellerAudioProfile } from '../src/systems/AircraftAudio.js';

test('propeller audio rises smoothly with throttle and airspeed', () => {
  const idle = getPropellerAudioProfile({ throttle: 0, speed: 0, grounded: true });
  const takeoff = getPropellerAudioProfile({ throttle: 1, speed: 30, grounded: false });

  assert.ok(takeoff.rpmRatio > idle.rpmRatio);
  assert.ok(takeoff.engineFrequency > idle.engineFrequency);
  assert.ok(takeoff.bladeFrequency > idle.bladeFrequency);
  assert.ok(takeoff.engineGain > idle.engineGain);
  assert.ok(takeoff.airflowGain > idle.airflowGain);
});

test('propeller audio sanitizes telemetry and cuts power after a crash', () => {
  const malformed = getPropellerAudioProfile({ throttle: Number.NaN, speed: Infinity });
  for (const value of Object.values(malformed)) assert.equal(Number.isFinite(value), true);

  const crashed = getPropellerAudioProfile({ throttle: 1, speed: 50, grounded: false, crashed: true });
  assert.equal(crashed.rpmRatio, 0);
  assert.equal(crashed.engineGain, 0.001);
  assert.equal(crashed.propellerGain, 0.001);
  assert.equal(crashed.airflowGain, 0.001);
});
