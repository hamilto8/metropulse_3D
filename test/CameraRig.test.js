import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraRig, getPlanarTargetHeading } from '../src/camera/CameraRig.js';

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

test('physics chase heading ignores the motorbike visual lean', () => {
  const heading = 0.72;
  const chassisQuaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    heading
  );
  const mesh = new THREE.Group();
  mesh.quaternion.setFromEuler(new THREE.Euler(0.18, heading, -0.4, 'YXZ'));
  const target = {
    mesh,
    physicsVehicle: {
      chassisBody: {
        quaternion: chassisQuaternion
      }
    }
  };

  assert.ok(Math.abs(mesh.rotation.y - heading) > 0.01);
  assert.ok(Math.abs(getPlanarTargetHeading(target) - heading) < 1e-9);
});

test('releasing chase control keeps the current local camera pose and orbit pivot', () => {
  const camera = new THREE.PerspectiveCamera(72);
  camera.position.set(640, 8, -175);
  const controls = {
    enabled: false,
    target: new THREE.Vector3(650, 1.4, -160),
    updateCount: 0,
    update() { this.updateCount += 1; }
  };
  const rig = new CameraRig(camera, controls);
  rig.state = 'CHASE_MICRO';
  rig.followTarget = { mesh: new THREE.Group() };
  rig.isPointerLooking = true;
  rig.currentFov = 72;
  const releasedPosition = camera.position.clone();
  const releasedTarget = controls.target.clone();

  rig.releaseToLocalOrbit();
  for (let frame = 0; frame < 120; frame += 1) rig.update(1 / 60);

  assert.deepEqual(camera.position.toArray(), releasedPosition.toArray());
  assert.deepEqual(controls.target.toArray(), releasedTarget.toArray());
  assert.equal(rig.state, 'ORBIT_MACRO');
  assert.equal(rig.followTarget, null);
  assert.equal(rig.isPointerLooking, false);
  assert.equal(controls.enabled, true);
  assert.equal(camera.fov, 60);
  assert.ok(controls.updateCount > 0);
});

test('a missing chase target cannot send the camera to a stale city pose', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(705, 7, -240);
  const controls = {
    enabled: false,
    target: new THREE.Vector3(700, 1.4, -225),
    update() {}
  };
  const rig = new CameraRig(camera, controls);
  rig.state = 'CHASE_MICRO';
  rig.followTarget = null;
  const localPosition = camera.position.clone();
  const localTarget = controls.target.clone();

  rig.update(1);

  assert.deepEqual(camera.position.toArray(), localPosition.toArray());
  assert.deepEqual(controls.target.toArray(), localTarget.toArray());
});
