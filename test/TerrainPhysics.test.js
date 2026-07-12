import test from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { PhysicsWorld, PHYSICS_GROUPS } from '../src/physics/PhysicsWorld.js';
import { CityBuilder } from '../src/world/CityBuilder.js';
import { PlayerVehicle } from '../src/entities/PlayerVehicle.js';

function createTerrainModel() {
  const builder = Object.create(CityBuilder.prototype);
  builder.app = null;
  builder.drivableDecks = [];
  builder.surfaceColliders = [];
  builder.sceneryColliders = [];
  return builder;
}

test('countryside physics rays hit the unified terrain across both Z hemispheres', () => {
  const builder = createTerrainModel();
  const physics = new PhysicsWorld();
  physics.initCountrysideTerrain(builder);

  const samples = [
    [425, -250], [450, -100], [500, 75], [550, -75],
    [650, 0], [700, -200], [750, 100], [800, 250]
  ];
  for (const [x, z] of samples) {
    const result = new CANNON.RaycastResult();
    physics.world.raycastClosest(
      new CANNON.Vec3(x, 100, z),
      new CANNON.Vec3(x, -100, z),
      {},
      result
    );
    assert.equal(result.hasHit, true, `missing terrain at ${x},${z}`);
    assert.equal(result.body, physics.countrysideTerrainBody, `wrong surface at ${x},${z}`);
    assert.ok(
      Math.abs(result.hitPointWorld.y - builder.getHillHeight(x, z)) < 0.3,
      `physics/render height mismatch at ${x},${z}`
    );
  }
});

test('translated static bodies update broad-phase bounds at their visible positions', () => {
  const physics = new PhysicsWorld();
  const samples = [[0, physics.groundBodies[0]], [330, physics.groundBodies[1]]];

  for (const [x, expectedBody] of samples) {
    const result = new CANNON.RaycastResult();
    physics.world.raycastClosest(
      new CANNON.Vec3(x, 10, 0),
      new CANNON.Vec3(x, -10, 0),
      { collisionFilterGroup: PHYSICS_GROUPS.PLAYER, collisionFilterMask: PHYSICS_GROUPS.SURFACE },
      result
    );
    assert.equal(result.hasHit, true, `missing ground at x=${x}`);
    assert.equal(result.body, expectedBody);
  }

  const obstacle = physics.addStaticBoxCollider(
    { x: 300, y: 2, z: 50 },
    { x: 4, y: 4, z: 4 }
  );
  assert.ok(obstacle.aabb.lowerBound.x >= 298);
  assert.ok(obstacle.aabb.upperBound.x <= 302);
});

test('built-in bridge decks are traversable and open water remains hazardous', () => {
  const builder = createTerrainModel();
  for (const z of [-100, -50, 0, 50, 100]) {
    builder.registerDrivableDeck(110, 210, z - 8, z + 8, 0.05);
    builder.registerDrivableDeck(380, 420, z - 7, z + 7, 0.05);
  }

  for (const z of [-100, -50, 0, 50, 100]) {
    assert.equal(builder.isInWater(new THREE.Vector3(160, 0.05, z)), false);
    assert.equal(builder.isInWater(new THREE.Vector3(400, 0.05, z)), false);
  }
  assert.equal(builder.isInWater(new THREE.Vector3(160, 0.05, 25)), true);
  assert.equal(builder.isInWater(new THREE.Vector3(400, 0.05, 25)), true);
});

test('authored countryside routes stay continuous and within the road grade budget', () => {
  const builder = createTerrainModel();
  const routes = [];
  for (const z of [-100, -50, 0, 50, 100]) {
    routes.push(Array.from({ length: 381 }, (_, index) => [420 + index, z]));
  }
  for (const x of [450, 550, 650, 700, 750]) {
    routes.push(Array.from({ length: 201 }, (_, index) => [x, -100 + index]));
  }
  routes.push(Array.from({ length: 181 }, (_, index) => [700, -100 - index]));
  routes.push(Array.from({ length: 36 }, (_, index) => [700 + index, -245]));

  let maximumGrade = 0;
  for (const route of routes) {
    for (let index = 1; index < route.length; index++) {
      const [previousX, previousZ] = route[index - 1];
      const [x, z] = route[index];
      maximumGrade = Math.max(
        maximumGrade,
        Math.abs(builder.getHillHeight(x, z) - builder.getHillHeight(previousX, previousZ))
      );
    }
  }
  assert.ok(maximumGrade <= 0.18, `road grade exceeded 18%: ${maximumGrade}`);
});

test('suburban houses publish colliders aligned to their visible walls', () => {
  const builder = new CityBuilder(new THREE.Scene(), null, null);
  builder.createSuburbanHouse(500, 25);

  assert.equal(builder.sceneryColliders.length, 1);
  const collider = builder.sceneryColliders[0];
  assert.equal(collider.kind, 'suburban-house');
  assert.deepEqual(collider.size, { x: 10, y: 6, z: 8 });
  assert.equal(collider.position.y, builder.getHillHeight(500, 25) + 3);
  assert.ok(Math.abs(collider.rotationY) <= 0.075);
});

test('a physics vehicle maintains wheel contact while driving a countryside route', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  try {
    const builder = createTerrainModel();
    const physics = new PhysicsWorld();
    physics.terrainSystem = builder;
    physics.initCountrysideTerrain(builder);

    const mesh = new THREE.Group();
    mesh.position.set(430, builder.getTerrainHeight(430, -50), -50);
    mesh.rotation.y = Math.PI / 2;
    const vehicle = new PlayerVehicle(mesh, physics);
    let supportedFrames = 0;
    let minimumClearance = Infinity;

    for (let frame = 0; frame < 900; frame++) {
      vehicle.applyInput({ w: true }, 1 / 120);
      physics.step(1 / 120);
      vehicle.syncMesh();
      if (vehicle.raycastVehicle.wheelInfos.some(wheel => wheel.isInContact)) supportedFrames++;
      const terrainHeight = builder.getTerrainHeight(
        vehicle.chassisBody.position.x,
        vehicle.chassisBody.position.z
      );
      minimumClearance = Math.min(minimumClearance, vehicle.chassisBody.position.y - terrainHeight);
    }

    assert.ok(mesh.position.x > 560, `vehicle did not progress along route: ${mesh.position.x}`);
    assert.ok(supportedFrames / 900 > 0.9, 'vehicle lost sustained wheel contact');
    assert.ok(minimumClearance > 0.35, `chassis penetrated terrain: ${minimumClearance}`);
    vehicle.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
});

test('a user-driven vehicle crosses the city-to-countryside bridge without snagging', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  try {
    const builder = createTerrainModel();
    builder.registerDrivableDeck(380, 420, -7, 7, 0);
    const physics = new PhysicsWorld();
    physics.terrainSystem = builder;
    physics.initCountrysideTerrain(builder);

    const mesh = new THREE.Group();
    mesh.position.set(330, 0, 0);
    mesh.rotation.y = Math.PI / 2;
    const vehicle = new PlayerVehicle(mesh, physics);
    let supportedFrames = 0;
    let waterFrames = 0;
    let maximumTilt = 0;

    for (let frame = 0; frame < 700; frame++) {
      vehicle.applyInput({ w: true }, 1 / 120);
      physics.step(1 / 120);
      vehicle.syncMesh();
      if (vehicle.raycastVehicle.wheelInfos.some(wheel => wheel.isInContact)) supportedFrames++;
      if (builder.isInWater(mesh.position)) waterFrames++;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
      maximumTilt = Math.max(maximumTilt, Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
    }

    assert.ok(mesh.position.x > 450, `vehicle failed to cross bridge: ${mesh.position.x}`);
    assert.ok(supportedFrames / 700 > 0.95, 'bridge crossing lost wheel support');
    assert.equal(waterFrames, 0);
    assert.ok(maximumTilt < 0.2, `bridge seam destabilized chassis: ${maximumTilt}`);
    vehicle.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
});

test('city traffic lanes override overlapping sidewalk terrain', () => {
  const builder = createTerrainModel();
  assert.equal(builder.getTerrainHeight(-96.5, -75), 0);
  assert.equal(builder.getTerrainHeight(-75, -75), 0.7);
});
