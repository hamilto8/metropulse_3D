import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIRCRAFT_MODES,
  createAircraftFlightState,
  sanitizeAircraftControls,
  stepAircraftFlight
} from '../src/entities/AircraftFlightModel.js';

function simulate(state, controls, seconds, environment = { groundHeight: 0, inWater: false }) {
  let next = state;
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    next = stepAircraftFlight(next, controls, 1 / 60, environment);
  }
  return next;
}

test('aircraft controls reject non-finite values and clamp authority', () => {
  assert.deepEqual(sanitizeAircraftControls({
    roll: 4,
    pitch: -3,
    throttleUp: Number.NaN,
    throttleDown: 2,
    brake: -1
  }), {
    roll: 1,
    pitch: -1,
    throttleUp: 0,
    throttleDown: 1,
    brake: 0
  });
});

test('full throttle produces an assisted runway takeoff without teleporting', () => {
  const initial = createAircraftFlightState({
    position: { x: -105, y: 1.15, z: -168 },
    heading: Math.PI,
    grounded: true
  });
  const result = simulate(initial, { throttleUp: 1, pitch: 0 }, 7);

  assert.equal(result.crashed, false);
  assert.equal(result.grounded, false);
  assert.equal(result.mode, AIRCRAFT_MODES.AIRBORNE);
  assert.ok(result.speed > 24);
  assert.ok(result.position.y > 3);
  assert.ok(result.position.z < initial.position.z);
});

test('bank authority changes heading and remains within configured roll limits', () => {
  const initial = createAircraftFlightState({
    position: { x: 0, y: 60, z: 0 },
    speed: 38,
    throttle: 0.8,
    grounded: false,
    mode: AIRCRAFT_MODES.AIRBORNE
  });
  const result = simulate(initial, { roll: 1, throttleUp: 0.2 }, 2);

  assert.ok(result.heading > 0.2);
  assert.ok(result.roll > 0);
  assert.ok(result.roll < Math.PI / 2);
  assert.ok(result.position.x > 0);
});

test('low airspeed creates a visible stall warning and controlled sink', () => {
  const initial = createAircraftFlightState({
    position: { x: 0, y: 50, z: 0 },
    speed: 10,
    throttle: 0,
    grounded: false,
    mode: AIRCRAFT_MODES.AIRBORNE
  });
  const result = simulate(initial, {}, 0.5);

  assert.equal(result.stallWarning, true);
  assert.ok(result.verticalSpeed < 0);
  assert.ok(result.position.y < initial.position.y);
});

test('gentle touchdown transitions to taxi while hard or water landings crash', () => {
  const approach = createAircraftFlightState({
    position: { x: -105, y: 1.25, z: -300 },
    speed: 25,
    verticalSpeed: -3,
    throttle: 0,
    grounded: false,
    mode: AIRCRAFT_MODES.LANDING
  });
  const safe = stepAircraftFlight(approach, { brake: 1 }, 0.1, { groundHeight: 0, inWater: false });
  assert.equal(safe.crashed, false);
  assert.equal(safe.grounded, true);
  assert.equal(safe.mode, AIRCRAFT_MODES.TAXI);

  const hard = stepAircraftFlight({ ...approach, verticalSpeed: -16 }, {}, 0.1, { groundHeight: 0, inWater: false });
  assert.equal(hard.mode, AIRCRAFT_MODES.CRASHED);
  assert.equal(hard.crashed, true);

  const ditch = stepAircraftFlight(approach, {}, 0.1, { groundHeight: 0, inWater: true });
  assert.equal(ditch.crashed, true);

  const unsupported = stepAircraftFlight(approach, {}, 0.1, {
    groundHeight: 0,
    inWater: false,
    canLand: false,
    landingSurface: 'UNSUITABLE'
  });
  assert.equal(unsupported.crashed, true);
});
