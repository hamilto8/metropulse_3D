import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraRig } from '../src/camera/CameraRig.js';

test('camera shake is a render-only offset and never accumulates into the orbit pose', () => {
  const camera = new THREE.PerspectiveCamera();
  const controls = {
    enabled: true,
    target: new THREE.Vector3(),
    update() {}
  };
  const rig = new CameraRig(camera, controls);
  const originalRandom = Math.random;
  Math.random = () => 0.75;
  try {
    rig.triggerShake(1);
    rig.update(1 / 60);
    assert.ok(camera.position.lengthSq() > 0);
    assert.ok(rig.appliedShakeOffset.lengthSq() > 0);

    rig.removeAppliedShake();
    assert.deepEqual(camera.position.toArray(), [0, 0, 0]);
    assert.deepEqual(rig.appliedShakeOffset.toArray(), [0, 0, 0]);

    rig.update(1 / 60);
    const secondOffset = rig.appliedShakeOffset.clone();
    rig.removeAppliedShake();
    assert.deepEqual(camera.position.toArray(), [0, 0, 0]);
    assert.ok(secondOffset.lengthSq() > 0);
  } finally {
    Math.random = originalRandom;
  }
});

test('chase pose supports an independent mouse-look yaw around the target', () => {
  const camera = new THREE.PerspectiveCamera();
  const controls = {
    enabled: true,
    target: new THREE.Vector3(),
    update() {}
  };
  const rig = new CameraRig(camera, controls);
  rig.followTarget = {
    type: 'VEHICLE',
    userControlled: true,
    speed: 0,
    mesh: {
      position: new THREE.Vector3(),
      rotation: { y: 0 }
    }
  };

  const rearPose = rig.getDesiredChasePose();
  assert.ok(rearPose.camPos.z < -14);
  rig.chaseYaw = Math.PI / 2;
  const sidePose = rig.getDesiredChasePose();
  assert.ok(sidePose.camPos.x < -14);
  assert.ok(Math.abs(sidePose.camPos.z) < 1e-9);
});
