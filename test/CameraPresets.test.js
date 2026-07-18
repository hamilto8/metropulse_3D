import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraRig } from '../src/camera/CameraRig.js';
import { createCameraPresets } from '../src/camera/CameraPresets.js';
import {
  CAMERA_GROUND_CLEARANCE,
  constrainCameraToGround
} from '../src/camera/CameraGroundConstraint.js';
import { SceneManager } from '../src/world/SceneManager.js';

const CITY_BLOCK_CENTERS_X = [-75, -25, 25, 75, 235, 285];
const CITY_BLOCK_CENTERS_Z = [-75, -25, 25, 75];
const BUILDING_HALF_EXTENT = 14;

function intersectsBuildingFootprint(position) {
  return CITY_BLOCK_CENTERS_X.some(centerX => (
    Math.abs(position.x - centerX) <= BUILDING_HALF_EXTENT
    && CITY_BLOCK_CENTERS_Z.some(centerZ => (
      Math.abs(position.z - centerZ) <= BUILDING_HALF_EXTENT
      && !(centerX === -75 && centerZ === -75)
    ))
  ));
}

function assertClearHorizontalSightline(preset) {
  for (let step = 0; step <= 40; step += 1) {
    const point = new THREE.Vector3().lerpVectors(preset.pos, preset.target, step / 40);
    assert.equal(
      intersectsBuildingFootprint(point),
      false,
      `preset sightline enters a building footprint at (${point.x}, ${point.z})`
    );
  }
}

test('street preset remains in the central avenue for its complete sightline', () => {
  const { street } = createCameraPresets();
  assert.ok(street.pos.y >= 3 && street.pos.y <= 5);
  assert.ok(Math.abs(street.pos.x) < 7);
  assertClearHorizontalSightline(street);
});

test('ground preset rests at the camera clearance and looks level down the avenue', () => {
  const { ground } = createCameraPresets();
  assert.equal(ground.pos.y, CAMERA_GROUND_CLEARANCE);
  assert.equal(ground.target.y, ground.pos.y);
  assert.ok(ground.pos.distanceTo(ground.target) >= 5);
  assertClearHorizontalSightline(ground);
});

test('ground constraint clamps and levels a camera below elevated terrain', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, -4, 20);
  const target = new THREE.Vector3(10, -10, -30);

  const result = constrainCameraToGround(camera, target, 3.25);

  assert.equal(result.constrained, true);
  assert.equal(camera.position.y, 3.25 + CAMERA_GROUND_CLEARANCE);
  assert.equal(target.y, camera.position.y);
  assert.ok(target.distanceTo(camera.position) >= 5);
});

test('ground constraint can clamp height while delegating visual leveling', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(8, -3, 12);
  const target = new THREE.Vector3(20, -10, -30);
  const originalTarget = target.clone();

  const result = constrainCameraToGround(
    camera,
    target,
    2.5,
    CAMERA_GROUND_CLEARANCE,
    { levelTarget: false }
  );

  assert.equal(result.constrained, true);
  assert.equal(camera.position.y, 2.5 + CAMERA_GROUND_CLEARANCE);
  assert.deepEqual(target.toArray(), originalTarget.toArray());
});

test('ground constraint derives a stable horizontal view from a vertical target', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(2, 0, 4);
  camera.lookAt(2, -10, 4);
  const target = new THREE.Vector3(2, -10, 4);

  constrainCameraToGround(camera, target, 0);

  assert.equal(camera.position.y, CAMERA_GROUND_CLEARANCE);
  assert.equal(target.y, camera.position.y);
  assert.ok(Number.isFinite(target.x));
  assert.ok(Number.isFinite(target.z));
  assert.ok(target.distanceTo(camera.position) >= 5);
});

test('ground constraint preserves an elevated camera pose', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 20, 20);
  const target = new THREE.Vector3(0, 0, 0);
  const originalTarget = target.clone();

  const result = constrainCameraToGround(camera, target, 3.25);

  assert.equal(result.constrained, false);
  assert.equal(camera.position.y, 20);
  assert.deepEqual(target.toArray(), originalTarget.toArray());
});

test('camera surface sampling follows hills but treats river beds as water level', () => {
  const manager = Object.create(SceneManager.prototype);
  manager.app = {
    cityBuilder: {
      getTerrainHeight(x) { return x < 0 ? -4 : 6.5; }
    }
  };

  assert.equal(manager.getCameraSurfaceHeight(-10, 0), 0);
  assert.equal(manager.getCameraSurfaceHeight(10, 0), 6.5);
});

test('structured alert focus creates a safe management camera destination', () => {
  const manager = Object.create(SceneManager.prototype);
  let prepared = 0;
  Object.assign(manager, {
    activePreset: 'birdseye',
    targetCameraPos: null,
    targetLookAt: null,
    releaseDirectControlForCamera: () => true,
    preparePresetOrbit: () => { prepared += 1; },
    getCameraSurfaceHeight: () => 5
  });

  assert.equal(manager.focusWorldPosition({ x: 160, y: 2, z: -20 }), true);
  assert.equal(prepared, 1);
  assert.equal(manager.activePreset, null);
  assert.deepEqual(manager.targetLookAt.toArray(), [160, 5, -20]);
  assert.ok(manager.targetCameraPos.y > manager.targetLookAt.y);
  assert.equal(manager.focusWorldPosition({ x: Number.NaN, z: 0 }), false);
});

test('downtown preset uses an elevated unobstructed road corridor', () => {
  const { downtown } = createCameraPresets();
  assert.ok(downtown.pos.y >= 45);
  assert.ok(Math.abs(downtown.pos.z) < 7);
  assertClearHorizontalSightline(downtown);
});

test('airfield preset frames the runway from the city-facing approach', () => {
  const { airfield } = createCameraPresets();
  assert.ok(airfield.pos.x > airfield.target.x);
  assert.ok(airfield.pos.z > airfield.target.z);
  assert.ok(airfield.pos.y >= 70);
  assert.ok(airfield.target.z < -200);
});

test('camera preset vectors are independent mutable instances', () => {
  const first = createCameraPresets();
  const second = createCameraPresets();
  first.street.pos.x = 999;
  assert.notEqual(first.street.pos.x, second.street.pos.x);
});

function createPresetTransitionFixture({
  vehicle = null,
  pedestrian = null,
  aircraft = null,
  aircraftReleaseResult = true
} = {}) {
  const released = [];
  const modeChanges = [];
  let inspectorHidden = 0;
  const cameraRig = {
    state: 'CHASE_MICRO',
    followTarget: vehicle || pedestrian || aircraft,
    isPointerLooking: true,
    removeAppliedShake() {}
  };
  const manager = Object.create(SceneManager.prototype);
  Object.assign(manager, {
    presets: createCameraPresets(),
    activePreset: null,
    followTarget: vehicle || pedestrian || aircraft,
    targetCameraPos: null,
    targetLookAt: null,
    controls: { enabled: false },
    cameraRig,
    app: {
      trafficSystem: {
        controlledVehicle: vehicle,
        vehicles: vehicle ? [vehicle] : [],
        releaseControl(target) {
          released.push(target);
          target.userControlled = false;
          this.controlledVehicle = null;
        }
      },
      pedestrianSystem: {
        controlledPedestrian: pedestrian,
        pedestrians: pedestrian ? [pedestrian] : [],
        releaseControl(target) {
          released.push(target);
          target.userControlled = false;
          this.controlledPedestrian = null;
        }
      },
      aircraftSystem: {
        controlledAircraft: aircraft,
        releaseControl() {
          if (!aircraftReleaseResult) return false;
          if (aircraft) {
            released.push(aircraft);
            aircraft.userControlled = false;
            this.controlledAircraft = null;
          }
          return Boolean(aircraft);
        }
      },
      gameManager: {
        setState(mode, metadata) { modeChanges.push({ mode, metadata }); }
      },
      uiManager: {
        hideInspector() { inspectorHidden += 1; }
      }
    }
  });
  return { manager, cameraRig, released, modeChanges, get inspectorHidden() { return inspectorHidden; } };
}

test('camera presets cannot pull the pilot out of an airborne aircraft', () => {
  const aircraft = { userControlled: true };
  const fixture = createPresetTransitionFixture({ aircraft, aircraftReleaseResult: false });

  assert.equal(fixture.manager.setCameraPreset('airfield'), false);
  assert.equal(aircraft.userControlled, true);
  assert.deepEqual(fixture.released, []);
  assert.deepEqual(fixture.modeChanges, []);
  assert.equal(fixture.manager.activePreset, null);
  assert.equal(fixture.cameraRig.state, 'CHASE_MICRO');
  assert.equal(fixture.manager.controls.enabled, false);
});

for (const kind of ['vehicle', 'pedestrian']) {
  test(`selecting a camera preset releases ${kind} control and restores orbit controls`, () => {
    const entity = { userControlled: true };
    const fixture = createPresetTransitionFixture({ [kind]: entity });

    const applied = fixture.manager.setCameraPreset('bridge');

    assert.equal(applied, true);
    assert.deepEqual(fixture.released, [entity]);
    assert.equal(entity.userControlled, false);
    assert.deepEqual(fixture.modeChanges.at(-1), {
      mode: 'MANAGEMENT',
      metadata: { reason: 'camera-preset', source: 'SceneManager' }
    });
    assert.equal(fixture.manager.activePreset, 'bridge');
    assert.deepEqual(
      fixture.manager.targetCameraPos.toArray(),
      fixture.manager.presets.bridge.pos.toArray()
    );
    assert.deepEqual(
      fixture.manager.targetLookAt.toArray(),
      fixture.manager.presets.bridge.target.toArray()
    );
    assert.equal(fixture.manager.followTarget, null);
    assert.equal(fixture.cameraRig.followTarget, null);
    assert.equal(fixture.cameraRig.isPointerLooking, false);
    assert.equal(fixture.cameraRig.state, 'ORBIT_MACRO');
    assert.equal(fixture.manager.controls.enabled, true);
    assert.equal(fixture.inspectorHidden, 1);
  });
}

test('an invalid camera preset is rejected without relinquishing active control', () => {
  const vehicle = { userControlled: true };
  const fixture = createPresetTransitionFixture({ vehicle });

  assert.equal(fixture.manager.setCameraPreset('not-a-preset'), false);
  assert.equal(vehicle.userControlled, true);
  assert.deepEqual(fixture.released, []);
  assert.deepEqual(fixture.modeChanges, []);
  assert.equal(fixture.cameraRig.state, 'CHASE_MICRO');
  assert.equal(fixture.manager.controls.enabled, false);
});

for (const kind of ['vehicle', 'pedestrian']) {
  test(`releasing ${kind} follow enters free orbit at its last chase location`, () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(515, 6, 88);
    const controls = {
      enabled: false,
      target: new THREE.Vector3(525, 1.4, 100),
      update() {}
    };
    const rig = new CameraRig(camera, controls);
    rig.state = 'CHASE_MICRO';
    rig.followTarget = { type: kind.toUpperCase(), mesh: new THREE.Group() };

    const manager = Object.create(SceneManager.prototype);
    Object.assign(manager, {
      camera,
      controls,
      cameraRig: rig,
      followTarget: rig.followTarget,
      activePreset: 'birdseye',
      targetCameraPos: new THREE.Vector3(80, 320, 15),
      targetLookAt: new THREE.Vector3(80, 0, 0)
    });
    const releasedPosition = camera.position.clone();
    const releasedTarget = controls.target.clone();

    manager.stopFollowTarget();

    assert.deepEqual(camera.position.toArray(), releasedPosition.toArray());
    assert.deepEqual(controls.target.toArray(), releasedTarget.toArray());
    assert.equal(manager.followTarget, null);
    assert.equal(manager.activePreset, null);
    assert.equal(manager.targetCameraPos, null);
    assert.equal(manager.targetLookAt, null);
    assert.equal(rig.state, 'ORBIT_MACRO');
    assert.equal(rig.followTarget, null);
    assert.equal(controls.enabled, true);
  });
}
