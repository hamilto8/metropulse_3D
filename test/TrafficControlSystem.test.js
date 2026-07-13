import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TrafficControlSystem } from '../src/systems/TrafficControlSystem.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { movePedestrianWithCollisions } from '../src/systems/PedestrianCollision.js';
import {
  createDriverRuleProfile,
  createTrafficControlPlan,
  getSignalState,
  parseTrafficApproach,
  SIGNAL_STATES,
  TRAFFIC_RULES
} from '../src/systems/TrafficRules.js';

function makeVehicle(targetNode, { speed = 8, compliant = true } = {}) {
  return {
    mesh: new THREE.Group(),
    targetNode,
    speed,
    acceleration: 12,
    trafficRuleCompliant: compliant,
    info: {}
  };
}

test('signal cycle includes green, yellow, and all-red clearance phases', () => {
  assert.equal(getSignalState(0, 'NS'), SIGNAL_STATES.GREEN);
  assert.equal(getSignalState(9.5, 'NS'), SIGNAL_STATES.YELLOW);
  assert.equal(getSignalState(11.5, 'NS'), SIGNAL_STATES.RED);
  assert.equal(getSignalState(11.5, 'EW'), SIGNAL_STATES.RED);
  assert.equal(getSignalState(12.5, 'EW'), SIGNAL_STATES.GREEN);
  assert.equal(getSignalState(21.5, 'EW'), SIGNAL_STATES.YELLOW);
  assert.equal(getSignalState(23.5, 'EW'), SIGNAL_STATES.RED);
});

test('countryside plan uses four times as many stop signs as traffic lights', () => {
  const controls = createTrafficControlPlan([450, 550, 650, 750], [-100, -50, 0, 50, 100]);
  assert.equal(controls.filter(control => control.type === 'STOP').length, 16);
  assert.equal(controls.filter(control => control.type === 'SIGNAL').length, 4);
  assert.ok(controls.every(control => control.district === 'COUNTRYSIDE'));
});

test('driver profiles assign exactly eighty percent as rule-following', () => {
  const profiles = Array.from({ length: 100 }, (_, serial) => createDriverRuleProfile(serial));
  assert.equal(profiles.filter(profile => profile.compliant).length, 80);
  assert.equal(profiles.filter(profile => !profile.compliant).length, 20);
});

test('traffic approach parser resolves direction, axis, and intersection', () => {
  assert.deepEqual(parseTrafficApproach({ id: 'EB_IN:50,-100' }), {
    direction: 'EB', axis: 'EW', x: 50, z: -100
  });
  assert.deepEqual(parseTrafficApproach({ id: 'NB_IN:450,0' }), {
    direction: 'NB', axis: 'NS', x: 450, z: 0
  });
  assert.equal(parseTrafficApproach({ id: 'EB_OUT:50,-100' }), null);
});

test('compliant cars stop on red and proceed on green while reckless cars ignore it', () => {
  const system = new TrafficControlSystem({}, [0], [0], { buildVisuals: false });
  const targetNode = { id: 'EB_IN:0,0', pos: new THREE.Vector3(-10, 0, 3.5) };
  const compliant = makeVehicle(targetNode);
  compliant.mesh.position.set(-20, 0, 3.5);

  system.elapsed = 0; // EW red while NS is green.
  assert.deepEqual(system.evaluateVehicle(compliant, 0.1), { shouldStop: true, reason: 'RED' });
  system.elapsed = 12.5;
  assert.deepEqual(system.evaluateVehicle(compliant, 0.1), { shouldStop: false, reason: 'GREEN' });

  const reckless = makeVehicle(targetNode, { compliant: false });
  reckless.mesh.position.copy(compliant.mesh.position);
  system.elapsed = 0;
  assert.deepEqual(system.evaluateVehicle(reckless, 0.1), { shouldStop: false, reason: 'VIOLATION' });
});

test('yellow-light dilemma zone allows a close fast car to clear safely', () => {
  const system = new TrafficControlSystem({}, [0], [0], { buildVisuals: false });
  const targetNode = { id: 'EB_IN:0,0', pos: new THREE.Vector3(-10, 0, 3.5) };
  const vehicle = makeVehicle(targetNode, { speed: 20 });
  vehicle.mesh.position.set(-12, 0, 3.5);
  system.elapsed = 21.5;
  assert.deepEqual(system.evaluateVehicle(vehicle, 0.1), {
    shouldStop: false,
    reason: 'YELLOW_COMMIT'
  });
  system.elapsed = 23.5;
  assert.deepEqual(system.evaluateVehicle(vehicle, 0.1), {
    shouldStop: false,
    reason: 'CLEARING_INTERSECTION'
  });
});

test('four-way stop requires a complete timed stop before release', () => {
  const system = new TrafficControlSystem({}, [450], [50], { buildVisuals: false });
  const targetNode = { id: 'EB_IN:450,50', pos: new THREE.Vector3(440, 0, 53.5) };
  const vehicle = makeVehicle(targetNode, { speed: 5 });
  vehicle.mesh.position.set(430, 0, 53.5);
  assert.deepEqual(system.evaluateVehicle(vehicle, 0.2), { shouldStop: true, reason: 'STOP_SIGN' });
  vehicle.speed = 0;
  assert.equal(system.evaluateVehicle(vehicle, 0.55).shouldStop, true);
  assert.deepEqual(system.evaluateVehicle(vehicle, 0.55), {
    shouldStop: false,
    reason: 'STOP_COMPLETE'
  });
});

test('four-way stop releases vehicles in arrival order instead of simultaneously', () => {
  const system = new TrafficControlSystem({}, [450], [50], { buildVisuals: false });
  const eastTarget = { id: 'EB_IN:450,50', pos: new THREE.Vector3(440, 0, 53.5) };
  const northTarget = { id: 'NB_IN:450,50', pos: new THREE.Vector3(453.5, 0, 60) };
  const first = makeVehicle(eastTarget, { speed: 0 });
  const second = makeVehicle(northTarget, { speed: 0 });
  first.mesh.position.copy(eastTarget.pos);
  second.mesh.position.copy(northTarget.pos);

  assert.equal(system.evaluateVehicle(first, 0.6).shouldStop, true);
  assert.equal(system.evaluateVehicle(second, 0.6).shouldStop, true);
  assert.equal(system.evaluateVehicle(first, 0.6).reason, 'STOP_COMPLETE');
  assert.equal(system.evaluateVehicle(second, 0.6).shouldStop, true);
  assert.equal(system.evaluateVehicle(second, 0.6).reason, 'STOP_COMPLETE');
});

test('visual controls register solid posts outside the road corridor', () => {
  const colliders = [];
  const app = {
    sceneManager: { scene: new THREE.Scene() },
    cityBuilder: { getHillHeight: () => 0 },
    physicsWorld: {
      addStaticBoxCollider(position, size) { colliders.push({ position, size }); }
    }
  };
  const system = new TrafficControlSystem(app, [450], [50]);
  assert.equal(system.controls[0].type, 'STOP');
  assert.equal(system.posts.length, 4);
  assert.equal(colliders.length, 4);
  assert.ok(colliders.every(collider => collider.size.x >= 2.2));
  assert.ok(system.posts.every(post => Math.abs(post.x - 450) > 7 && Math.abs(post.z - 50) > 7));
  assert.equal(system.intersectsPost(new THREE.Vector3(441.4, 0, 58.6), 0.2), true);
  assert.equal(system.intersectsPost(new THREE.Vector3(450, 0, 50), 0.2), false);
  assert.equal(TRAFFIC_RULES.stopSignWaitDuration, 1.1);
});

test('pedestrian sweep cannot clip through a traffic-control post', () => {
  const physicsWorld = new PhysicsWorld();
  const app = {
    sceneManager: { scene: new THREE.Scene() },
    cityBuilder: { getHillHeight: () => 0 },
    physicsWorld
  };
  const system = new TrafficControlSystem(app, [450], [50]);
  const post = system.posts[0];
  const movement = movePedestrianWithCollisions(
    new THREE.Vector3(post.x - 2, 0, post.z),
    new THREE.Vector3(4, 0, 0),
    physicsWorld
  );
  assert.equal(movement.collided, true);
  assert.ok(movement.position.x < post.x - 0.3);
});
