import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Vehicle } from '../src/entities/Vehicle.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import {
  enforceLaneCorridor,
  findTrafficObstacleAhead,
  getNavigationSpeedLimit,
  hasReachedNavigationTarget,
  projectToNavigationSegment,
  TRAFFIC_NAVIGATION
} from '../src/systems/TrafficNavigation.js';
import { movePedestrianWithCollisions } from '../src/systems/PedestrianCollision.js';
import { createCafeSeating } from '../src/world/CafeSeating.js';

function node(x, z) {
  return { pos: new THREE.Vector3(x, 0, z), nextNodes: [] };
}

test('lane projection and enforcement keep moving AI inside the road corridor', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Lane Test');
  vehicle.currentNode = node(0, 0);
  vehicle.targetNode = node(0, 20);
  vehicle.mesh.position.set(7, 0, 10);

  const before = projectToNavigationSegment(vehicle.mesh.position, vehicle.currentNode, vehicle.targetNode);
  assert.equal(before.deviation, 7);
  assert.equal(enforceLaneCorridor(vehicle), true);
  assert.ok(Math.abs(vehicle.mesh.position.x) <= TRAFFIC_NAVIGATION.maxLaneCenterDeviation + 1e-9);
  assert.equal(vehicle.mesh.position.z, 10);
});

test('turn-aware speed limit slows a vehicle before a ninety-degree graph turn', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Turn Test');
  vehicle.mesh.position.set(0, 0, 0);
  vehicle.mesh.rotation.y = 0;
  vehicle.targetNode = node(10, 0);
  assert.ok(getNavigationSpeedLimit(vehicle) < vehicle.maxSpeed * 0.5);

  vehicle.targetNode = node(0, 30);
  assert.equal(getNavigationSpeedLimit(vehicle), Infinity);
});

test('navigation advances after crossing a target plane even if a frame overshoots it', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Overshoot Test');
  vehicle.currentNode = node(0, 0);
  vehicle.targetNode = node(0, 20);
  vehicle.mesh.position.set(0.5, 0, 24);
  assert.equal(hasReachedNavigationTarget(vehicle), true);

  vehicle.mesh.position.set(0.5, 0, 10);
  assert.equal(hasReachedNavigationTarget(vehicle), false);
});

test('traffic detects a static street obstacle ahead but ignores one outside its lane', () => {
  const physics = new PhysicsWorld();
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Obstacle Test');
  vehicle.mesh.position.set(0, 0, 0);
  vehicle.mesh.rotation.y = 0;
  vehicle.speed = 12;
  physics.addStaticBoxCollider(new THREE.Vector3(0, 1, 10), new THREE.Vector3(1.5, 2, 1.5));
  assert.ok(findTrafficObstacleAhead(vehicle, physics));

  const clearPhysics = new PhysicsWorld();
  clearPhysics.addStaticBoxCollider(new THREE.Vector3(6, 1, 10), new THREE.Vector3(1.5, 2, 1.5));
  assert.equal(findTrafficObstacleAhead(vehicle, clearPhysics), null);
});

test('cafe furniture registers solid chair and table colliders', () => {
  const physics = new PhysicsWorld();
  const scene = new THREE.Scene();
  const seats = createCafeSeating(scene, physics, [{ x: 0, z: 0, rotation: 0 }]);
  assert.equal(seats.length, 1);
  assert.equal(seats[0].colliders.length, 2);
  assert.equal(scene.children.length, 1);

  const movement = movePedestrianWithCollisions(
    new THREE.Vector3(-3, 0, 0),
    new THREE.Vector3(6, 0, 0),
    physics
  );
  assert.equal(movement.collided, true);
});

test('live AI traffic remains inside lane corridors through turns and overlap resolution', () => {
  const traffic = new TrafficSystem({
    funMode: false,
    sceneManager: { scene: { add() {} } },
    inspectorHud: null,
    physicsWorld: null
  });
  for (let frame = 0; frame < 180; frame += 1) traffic.update(1 / 30);

  for (const vehicle of traffic.vehicles) {
    if (vehicle.isParked || vehicle.crashed || !vehicle.currentNode || !vehicle.targetNode) continue;
    const projection = projectToNavigationSegment(
      vehicle.mesh.position,
      vehicle.currentNode,
      vehicle.targetNode
    );
    if (!projection) continue;
    assert.ok(
      projection.deviation <= TRAFFIC_NAVIGATION.maxLaneCenterDeviation + 1e-6,
      `${vehicle.name} left its lane by ${projection.deviation}m`
    );
  }
});
