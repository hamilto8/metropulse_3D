import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYER_VEHICLE_RECOVERY,
  resolvePlayerVehicleDriveForces,
  resolvePlayerVehicleControls,
  updateVehicleMobilityTimer
} from '../src/entities/PlayerVehicleControls.js';

test('vehicle controls sanitize malformed analog values and resolve opposing pedals', () => {
  assert.deepEqual(resolvePlayerVehicleControls({}, {
    throttle: Number.NaN,
    brake: Infinity,
    steer: Number.NaN,
    handbrake: false
  }), {
    throttle: 0,
    reverse: 0,
    steer: 0,
    handbrake: false
  });

  assert.deepEqual(resolvePlayerVehicleControls({ w: true, s: true }), {
    throttle: 0,
    reverse: 0,
    steer: 0,
    handbrake: false
  });
  assert.equal(resolvePlayerVehicleControls({}, { throttle: 0.2, brake: 0.9 }).reverse, 0.9);
});

test('wheel commands use cannon-es drive direction without competing brake force', () => {
  const profile = {
    forwardEngineForce: 6000,
    reverseEngineForce: 5000,
    maxBrakeForce: 200,
    maxForwardSpeed: 40,
    maxReverseSpeed: 15
  };

  assert.deepEqual(resolvePlayerVehicleDriveForces({ throttle: 1 }, 0, profile), {
    engineForce: -6000,
    brakeForce: 0
  });
  assert.deepEqual(resolvePlayerVehicleDriveForces({ reverse: 1 }, 0, profile), {
    engineForce: 5000,
    brakeForce: 0
  });
  assert.deepEqual(resolvePlayerVehicleDriveForces({ reverse: 0.5 }, 8, profile), {
    engineForce: 0,
    brakeForce: 100
  });
  assert.deepEqual(resolvePlayerVehicleDriveForces({ throttle: 1, handbrake: true }, 0, profile), {
    engineForce: 0,
    brakeForce: 500
  });
});

test('sustained drive intent recovers a motionless vehicle even without wheel contact', () => {
  let elapsed = 0;
  let result = null;
  for (let frame = 0; frame < 300; frame += 1) {
    result = updateVehicleMobilityTimer(elapsed, {
      throttle: 1,
      reverse: 0,
      handbrake: false,
      horizontalSpeed: 0
    }, 1 / 120);
    elapsed = result.elapsed;
    if (result.shouldRecover) break;
  }

  assert.equal(result.shouldRecover, true);
  assert.ok(elapsed >= PLAYER_VEHICLE_RECOVERY.delaySeconds);
});

test('intentional handbraking and ordinary motion never trigger stuck recovery', () => {
  const braking = updateVehicleMobilityTimer(2, {
    throttle: 1,
    handbrake: true,
    horizontalSpeed: 0
  }, 0.25);
  assert.equal(braking.shouldRecover, false);
  assert.ok(braking.elapsed < 2);

  const moving = updateVehicleMobilityTimer(2, {
    reverse: 1,
    horizontalSpeed: 3
  }, 0.25);
  assert.equal(moving.shouldRecover, false);
  assert.ok(moving.elapsed < 2);

  const malformed = updateVehicleMobilityTimer(Number.NaN, {
    throttle: 1,
    horizontalSpeed: Number.NaN
  }, Number.NaN);
  assert.deepEqual(malformed, { elapsed: 0, shouldRecover: false });
});
