import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { movePedestrianWithCollisions } from '../src/systems/PedestrianCollision.js';

test('pedestrian sweep cannot tunnel through a static building collider', () => {
  const physics = new PhysicsWorld();
  physics.addStaticBoxCollider(
    new THREE.Vector3(0, 5, 0),
    new THREE.Vector3(4, 10, 8)
  );
  const movement = movePedestrianWithCollisions(
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(10, 0, 0),
    physics
  );
  assert.equal(movement.collided, true);
  assert.ok(movement.position.x <= -2.42, `pedestrian crossed wall at x=${movement.position.x}`);
});

test('pedestrian collision preserves tangential movement for wall sliding', () => {
  const physics = new PhysicsWorld();
  physics.addStaticBoxCollider(
    new THREE.Vector3(0, 5, 0),
    new THREE.Vector3(4, 10, 20)
  );
  const movement = movePedestrianWithCollisions(
    new THREE.Vector3(-3, 0, -4),
    new THREE.Vector3(3, 0, 5),
    physics
  );
  assert.equal(movement.collided, true);
  assert.ok(movement.position.x <= -2.42);
  assert.ok(movement.position.z > -1, `wall sliding lost tangential progress: z=${movement.position.z}`);
});

test('pedestrian collision respects rotated and removed static bodies', () => {
  const physics = new PhysicsWorld();
  const body = physics.addStaticBoxCollider(
    new THREE.Vector3(0, 5, 0),
    new THREE.Vector3(2, 10, 10),
    { rotationY: Math.PI / 4 }
  );
  const blocked = movePedestrianWithCollisions(
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(10, 0, 0),
    physics
  );
  assert.equal(blocked.collided, true);

  physics.removeStaticCollider(body);
  const unblocked = movePedestrianWithCollisions(
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(10, 0, 0),
    physics
  );
  assert.equal(unblocked.collided, false);
  assert.ok(Math.abs(unblocked.position.x - 5) < 1e-9);
});

test('pedestrian sweep treats active parked-vehicle kinematic bodies as solid', () => {
  const physics = new PhysicsWorld();
  const parkedBody = physics.addKinematicBoxCollider(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(2.1, 2, 4.4)
  );
  parkedBody.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  parkedBody.aabbNeedsUpdate = true;
  const blocked = movePedestrianWithCollisions(
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(10, 0, 0),
    physics
  );
  assert.equal(blocked.collided, true);
  assert.ok(blocked.position.x < -2.5, `pedestrian entered parked car at x=${blocked.position.x}`);

  physics.removeKinematicCollider(parkedBody);
  const clear = movePedestrianWithCollisions(
    new THREE.Vector3(-5, 0, 0),
    new THREE.Vector3(10, 0, 0),
    physics
  );
  assert.equal(clear.collided, false);
});

test('pedestrian movement sanitizes invalid values and bounds extreme displacement', () => {
  const physics = new PhysicsWorld();
  const movement = movePedestrianWithCollisions(
    new THREE.Vector3(Number.NaN, 0, 0),
    new THREE.Vector3(1000, Number.NaN, Number.POSITIVE_INFINITY),
    physics
  );
  assert.equal(Number.isFinite(movement.position.x), true);
  assert.equal(Number.isFinite(movement.position.y), true);
  assert.equal(Number.isFinite(movement.position.z), true);
  assert.ok(movement.position.x <= 12.8);
});
