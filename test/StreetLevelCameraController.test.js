import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  isStreetCameraAltitude,
  levelStreetLookDirection,
  rotateStreetLookDirection,
  STREET_CAMERA_PIVOT_DISTANCE,
  StreetLevelCameraController
} from '../src/camera/StreetLevelCameraController.js';

test('street camera altitude is measured relative to the local surface', () => {
  assert.equal(isStreetCameraAltitude(7.9, 0), true);
  assert.equal(isStreetCameraAltitude(14, 6), true);
  assert.equal(isStreetCameraAltitude(14.01, 6), false);
  assert.equal(isStreetCameraAltitude(15.5, 6, true), true);
  assert.equal(isStreetCameraAltitude(16.01, 6, true), false);
  assert.equal(isStreetCameraAltitude(Number.NaN, 0), false);
});

test('street look rotation supports yaw while ground contact locks pitch level', () => {
  const forward = new THREE.Vector3(0, -0.6, -0.8);
  const turned = rotateStreetLookDirection(forward, Math.PI / 2, 1, true);

  assert.ok(turned.x > 0.999);
  assert.ok(Math.abs(turned.y) < 1e-12);
  assert.ok(Math.abs(turned.z) < 1e-12);
});

test('ground leveling eases toward the horizon consistently across frame rates', () => {
  const source = new THREE.Vector3(0.2, -0.75, -0.63).normalize();
  const firstFrame = levelStreetLookDirection(source, 1 / 60);
  assert.ok(firstFrame.y > source.y);
  assert.ok(firstFrame.y < 0);

  let sixtyFps = source.clone();
  for (let frame = 0; frame < 60; frame += 1) {
    sixtyFps = levelStreetLookDirection(sixtyFps, 1 / 60);
  }
  let thirtyFps = source.clone();
  for (let frame = 0; frame < 30; frame += 1) {
    thirtyFps = levelStreetLookDirection(thirtyFps, 1 / 30);
  }

  assert.ok(sixtyFps.distanceTo(thirtyFps) < 1e-12);
  assert.ok(Math.abs(sixtyFps.y) < 0.02);
});

test('street controller preserves transitional pitch while yaw remains responsive', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0.75, 0);
  const controls = {
    target: new THREE.Vector3(0, -9, -10),
    minDistance: 5,
    enableRotate: true,
    enabled: true
  };
  const controller = new StreetLevelCameraController(camera, controls);

  const initialDirection = controller.getLookDirection();
  controller.setMode(true, {
    lockLevel: true,
    smoothLeveling: true,
    delta: 1 / 60
  });
  const firstFrameDirection = controller.getLookDirection();
  assert.ok(firstFrameDirection.y > initialDirection.y);
  assert.ok(firstFrameDirection.y < 0);

  controller.rotateLook(Math.PI / 4, 1);
  const turnedDirection = controller.getLookDirection();
  assert.ok(Math.abs(turnedDirection.y - firstFrameDirection.y) < 1e-12);
  assert.ok(turnedDirection.x > firstFrameDirection.x);

  for (let frame = 0; frame < 120; frame += 1) {
    controller.setMode(true, {
      lockLevel: true,
      smoothLeveling: true,
      delta: 1 / 60
    });
  }
  assert.ok(Math.abs(controller.getLookDirection().y) < 1e-4);
});

test('street controller turns in place and restores a safe macro orbit radius', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 3, 20);
  const originalPosition = camera.position.clone();
  const controls = {
    target: new THREE.Vector3(10, 3, -80),
    minDistance: 5,
    enableRotate: true,
    enabled: true
  };
  const controller = new StreetLevelCameraController(camera, controls);

  controller.setMode(true, { lockLevel: true });
  assert.equal(controls.enableRotate, false);
  assert.equal(controls.minDistance, STREET_CAMERA_PIVOT_DISTANCE);
  assert.ok(Math.abs(controls.target.distanceTo(camera.position) - STREET_CAMERA_PIVOT_DISTANCE) < 1e-12);

  controller.rotateLook(Math.PI / 2, 0.5);
  assert.deepEqual(camera.position.toArray(), originalPosition.toArray());
  assert.ok(controls.target.x > camera.position.x);
  assert.equal(controls.target.y, camera.position.y);

  controller.setMode(false);
  assert.equal(controls.enableRotate, true);
  assert.equal(controls.minDistance, 5);
  assert.ok(Math.abs(controls.target.distanceTo(camera.position) - 5) < 1e-12);
});
