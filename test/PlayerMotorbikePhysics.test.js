import test from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import {
  PlayerVehicle,
  getWheelIndicesForAxle
} from '../src/entities/PlayerVehicle.js';
import { getVehicleProfile } from '../src/entities/VehicleProfiles.js';

function countWheelContacts(vehicle) {
  return vehicle.raycastVehicle.wheelInfos.reduce(
    (count, wheel) => count + (wheel.isInContact ? 1 : 0),
    0
  );
}

function getChassisUpY(vehicle) {
  const up = new CANNON.Vec3(0, 1, 0);
  vehicle.chassisBody.quaternion.vmult(up, up);
  return up.y;
}

function withMotorbike(run) {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  const physics = new PhysicsWorld();
  const mesh = new THREE.Group();
  const vehicle = new PlayerVehicle(mesh, physics, null, null, 'MOTORBIKE');
  try {
    return run({ physics, mesh, vehicle });
  } finally {
    vehicle.destroy();
    globalThis.window = previousWindow;
  }
}

test('motorbike uses a rear-drive tune and a stable virtual support track', () => {
  withMotorbike(({ vehicle }) => {
    const profile = getVehicleProfile('MOTORBIKE');
    const wheelInfos = vehicle.raycastVehicle.wheelInfos;

    assert.equal(profile.playerDynamics.drivenAxle, 'rear');
    assert.ok(profile.drive.forwardEngineForce < getVehicleProfile('SEDAN').drive.forwardEngineForce);
    assert.deepEqual(getWheelIndicesForAxle(wheelInfos, 'front'), [0, 1]);
    assert.deepEqual(getWheelIndicesForAxle(wheelInfos, 'rear'), [2, 3]);
    assert.deepEqual([...vehicle.drivenWheelIndices], [2, 3]);
    assert.ok(
      Math.abs(wheelInfos[0].chassisConnectionPointLocal.x) > profile.width * 0.5,
      'virtual support wheels should sit beyond the narrow visual chassis'
    );

    vehicle.applyInput({ w: true }, 1 / 60);
    assert.deepEqual(
      wheelInfos.map(wheel => wheel.engineForce),
      [0, 0, -profile.drive.forwardEngineForce, -profile.drive.forwardEngineForce]
    );
  });
});

test('motorbike acceleration remains smooth and supported on a flat road', () => {
  withMotorbike(({ physics, mesh, vehicle }) => {
    const rideHeights = [];
    let fullySupportedFrames = 0;
    let sampledFrames = 0;
    let recoveries = 0;

    for (let frame = 0; frame < 420; frame += 1) {
      // Match the production frame order: advance the prior wheel command,
      // then collect input for the next fixed physics interval.
      physics.step(1 / 60);
      if (vehicle.applyInput({ w: true }, 1 / 60)) recoveries += 1;
      vehicle.syncMesh();

      if (frame >= 90) {
        sampledFrames += 1;
        rideHeights.push(mesh.position.y);
        if (countWheelContacts(vehicle) === 4) fullySupportedFrames += 1;
      }
    }

    const verticalTravel = Math.max(...rideHeights) - Math.min(...rideHeights);
    assert.equal(recoveries, 0);
    assert.ok(mesh.position.z > 100, `motorbike barely progressed: z=${mesh.position.z}`);
    assert.ok(verticalTravel < 0.04, `motorbike wheel-hop travel was ${verticalTravel}`);
    assert.ok(
      fullySupportedFrames / sampledFrames > 0.98,
      `motorbike lost full road contact for ${sampledFrames - fullySupportedFrames} frames`
    );
  });
});

test('motorbike stays upright and planted during sustained steering', () => {
  withMotorbike(({ physics, mesh, vehicle }) => {
    let minimumUpY = 1;
    let supportedFrames = 0;
    let sampledFrames = 0;

    for (let frame = 0; frame < 600; frame += 1) {
      physics.step(1 / 60);
      vehicle.applyInput({
        w: true,
        a: frame >= 150 && frame < 390
      }, 1 / 60);
      vehicle.syncMesh();

      if (frame >= 90) {
        sampledFrames += 1;
        minimumUpY = Math.min(minimumUpY, getChassisUpY(vehicle));
        if (countWheelContacts(vehicle) >= 2) supportedFrames += 1;
      }
    }

    assert.ok(Math.abs(mesh.position.x) > 20, 'steering did not change the motorbike path');
    assert.ok(minimumUpY > 0.95, `motorbike chassis leaned too far: up.y=${minimumUpY}`);
    assert.ok(
      supportedFrames / sampledFrames > 0.99,
      `motorbike lost usable road contact for ${sampledFrames - supportedFrames} frames`
    );
  });
});
