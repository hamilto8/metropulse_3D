import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { AircraftSystem } from '../src/systems/AircraftSystem.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import {
  InteractionService,
  INTERACTION_PRIORITIES
} from '../src/systems/InteractionService.js';

function createHandoffFixture() {
  const scene = new THREE.Scene();
  const pedestrian = {
    type: 'PEDESTRIAN',
    name: 'Avery Quinn',
    mesh: new THREE.Group(),
    userControlled: true,
    knockedDown: false,
    hasBaseballBat: true,
    speed: 0,
    maxSpeed: 3.5,
    targetSpeed: 3.5,
    isJumping: false,
    jumpVelocity: 0,
    info: { Mood: '🎮 USER CONTROLLED', Activity: 'Walking streets' }
  };
  pedestrian.mesh.position.set(-102, 0, -190);
  scene.add(pedestrian.mesh);

  const followed = [];
  const audioCalls = [];
  const registered = new Set([pedestrian.mesh]);
  const app = {
    sceneManager: {
      scene,
      startFollowTarget(target) { followed.push(target); },
      stopFollowTarget() { followed.push(null); }
    },
    inspectorHud: {
      registerObject(mesh) { registered.add(mesh); },
      unregisterObject(mesh) { registered.delete(mesh); }
    },
    trafficSystem: { controlledVehicle: null, releaseControl() {} },
    cityBuilder: { getTerrainHeight: () => 0 },
    audioSystem: {
      startAircraftSound() { audioCalls.push('start'); },
      stopAircraftSound() { audioCalls.push('stop'); }
    },
    gameManager: { setState() {} },
    inputManager: { restoreGameplayFocus() {} },
    uiManager: {
      hideInspector() {}, updateActionHUD() {}, addAlert() {}, showToast() {}
    }
  };

  const pedestrianSystem = Object.create(PedestrianSystem.prototype);
  pedestrianSystem.app = app;
  pedestrianSystem.pedestrians = [pedestrian];
  pedestrianSystem.controlledPedestrian = pedestrian;
  pedestrianSystem.nodes = new Map();
  app.pedestrianSystem = pedestrianSystem;

  const aircraft = {
    mesh: new THREE.Group(),
    state: {
      position: { x: -105, y: 1.15, z: -190 },
      heading: Math.PI,
      speed: 0,
      throttle: 0,
      grounded: true,
      crashed: false
    },
    config: { gearHeight: 1.15, maxSpeed: 64 },
    isAirborne: false,
    isCrashed: false,
    setControlled(value) { this.userControlled = value; }
  };
  aircraft.mesh.position.set(-105, 1.15, -190);

  const system = Object.create(AircraftSystem.prototype);
  Object.assign(system, {
    app,
    aircraft,
    controlledAircraft: null,
    controlSession: null
  });
  app.aircraftSystem = system;
  return { system, pedestrianSystem, pedestrian, aircraft, scene, followed, audioCalls, registered };
}

test('pedestrian boarding preserves identity and restores the same controlled pedestrian after landing', () => {
  const fixture = createHandoffFixture();
  const { system, pedestrianSystem, pedestrian, aircraft, scene, audioCalls } = fixture;

  assert.equal(system.boardFromPedestrian(pedestrian), true);
  assert.equal(system.controlledAircraft, aircraft);
  assert.equal(system.controlSession.source, 'pedestrian');
  assert.equal(system.controlSession.pedestrian, pedestrian);
  assert.equal(pedestrianSystem.controlledPedestrian, null);
  assert.equal(pedestrianSystem.pedestrians.includes(pedestrian), false);
  assert.equal(pedestrian.mesh.parent, null);
  assert.equal(pedestrian.controlSuspended, true);
  assert.deepEqual(audioCalls, ['start']);

  aircraft.mesh.position.set(-105, 1.15, -250);
  aircraft.state.position = { x: -105, y: 1.15, z: -250 };
  assert.equal(system.releaseControl(), true);

  assert.equal(system.controlledAircraft, null);
  assert.equal(pedestrianSystem.controlledPedestrian, pedestrian);
  assert.equal(pedestrianSystem.pedestrians.includes(pedestrian), true);
  assert.equal(pedestrian.mesh.parent, scene);
  assert.equal(pedestrian.controlSuspended, false);
  assert.equal(pedestrian.userControlled, true);
  assert.equal(pedestrian.hasBaseballBat, true);
  assert.ok(pedestrian.mesh.position.distanceTo(aircraft.mesh.position) < 9);
  assert.deepEqual(audioCalls, ['start', 'stop']);
});

test('interaction service prioritizes a boardable aircraft over nearby traffic', () => {
  const pedestrian = { mesh: new THREE.Group() };
  const system = Object.create(PedestrianSystem.prototype);
  let boarded = null;
  system.controlledPedestrian = pedestrian;
  system.hijackTransition = null;
  system.pedestrians = [pedestrian];
  system.app = {
    aircraftSystem: {
      getBoardingEligibility: () => ({ allowed: true, distance: 2 }),
      boardFromPedestrian(target) { boarded = target; return true; }
    },
    trafficSystem: {
      vehicles: [{ mesh: { position: new THREE.Vector3(1, 0, 0) } }]
    }
  };
  const interactionService = new InteractionService();
  interactionService.registerProvider({
    id: 'aircraft',
    getCandidates: () => [{
      id: 'aircraft-board:test',
      kind: 'AIRCRAFT',
      priority: INTERACTION_PRIORITIES.AIRCRAFT_BOARD,
      prompt: 'board aircraft',
      action: () => system.app.aircraftSystem.boardFromPedestrian(pedestrian),
      eligibility: true,
      failureReason: null,
      distance: 2,
      accessibilityLabel: 'Board aircraft'
    }]
  });
  interactionService.registerProvider({
    id: 'pedestrians',
    getCandidates: () => system.getInteractionCandidates()
  });
  system.app.interactionService = interactionService;

  assert.equal(system.handlePedestrianActionKey(), true);
  assert.equal(boarded, pedestrian);
});

test('airborne exit is rejected without losing the suspended pedestrian session', () => {
  const fixture = createHandoffFixture();
  const { system, pedestrian, aircraft, audioCalls } = fixture;
  assert.equal(system.boardFromPedestrian(pedestrian), true);
  aircraft.isAirborne = true;
  aircraft.state.grounded = false;
  aircraft.state.speed = 30;

  assert.equal(system.releaseControl(), false);
  assert.equal(system.controlledAircraft, aircraft);
  assert.equal(system.controlSession.pedestrian, pedestrian);
  assert.equal(pedestrian.controlSuspended, true);
  assert.deepEqual(audioCalls, ['start']);
});

test('aircraft boarding eligibility requires proximity and a safely stopped plane', () => {
  const fixture = createHandoffFixture();
  const { system, pedestrian, aircraft } = fixture;
  assert.equal(system.getBoardingEligibility(pedestrian).allowed, true);

  pedestrian.mesh.position.x = -90;
  assert.equal(system.getBoardingEligibility(pedestrian).reason, 'too-far');
  pedestrian.mesh.position.x = -102;
  aircraft.state.speed = 4;
  assert.equal(system.getBoardingEligibility(pedestrian).reason, 'aircraft-moving');
});

test('population floor counts a suspended aircraft pilot as an active citizen', () => {
  const system = Object.create(PedestrianSystem.prototype);
  let spawned = 0;
  system.pedestrians = Array.from({ length: 59 }, () => ({}));
  system.targetPedestrianCount = 60;
  system.spawnPedestrians = count => { spawned += count; };
  system.app = { aircraftSystem: { controlSession: { source: 'pedestrian', pedestrian: {} } } };

  system.ensurePopulationFloor();
  assert.equal(spawned, 0);
});
