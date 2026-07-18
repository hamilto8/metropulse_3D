import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CameraClearanceQuery } from '../src/camera/CameraClearanceQuery.js';

function createQuery({ obstacles = [], terrain = () => 0, water = () => false } = {}) {
  return new CameraClearanceQuery({
    getTerrainHeight: terrain,
    isWater: water,
    getObstacles: () => obstacles,
    searchStep: 1,
    samplesPerRing: 8,
    maxSearchRadius: 12
  });
}

test('camera clearance lifts a spawn above terrain and slopes', () => {
  const query = createQuery({ terrain: (x, z) => 2 + x * 0.25 + z * 0.1 });
  const resolved = query.resolve(new THREE.Vector3(4, -20, 3), {
    radius: 0.75,
    terrainClearance: 1
  });

  assert.equal(resolved.x, 4);
  assert.equal(resolved.z, 3);
  assert.equal(resolved.y, 4.3);
  assert.equal(query.inspect(resolved, { radius: 0.75, terrainClearance: 1 }).clear, true);
});

test('camera clearance moves deterministic spawns outside buildings and tree trunks', () => {
  const building = {
    kind: 'building',
    position: { x: 0, y: 5, z: 0 },
    size: { x: 8, y: 10, z: 8 }
  };
  const tree = {
    kind: 'tree-trunk',
    position: { x: 5, y: 2.5, z: 0 },
    size: { x: 1.2, y: 5, z: 1.2 }
  };
  const query = createQuery({ obstacles: [building, tree] });
  const desired = new THREE.Vector3(0, 3, 0);
  const first = query.resolve(desired, { radius: 0.8 });
  const second = query.resolve(desired, { radius: 0.8 });

  assert.deepEqual(first.toArray(), second.toArray());
  assert.equal(query.inspect(first, { radius: 0.8 }).clear, true);
  assert.ok(first.distanceTo(desired) >= 4.8);
});

test('camera clearance rejects vehicle volumes but can ignore its follow target', () => {
  const vehicle = {
    entity: { id: 'vehicle-1' },
    position: { x: 10, y: 1.5, z: 10 },
    size: { x: 4, y: 3, z: 8 },
    kind: 'vehicle'
  };
  const query = createQuery({ obstacles: [vehicle] });
  const inside = new THREE.Vector3(10, 2, 10);

  assert.equal(query.inspect(inside).reason, 'OBSTACLE');
  assert.equal(query.inspect(inside, { ignore: [vehicle.entity] }).clear, true);
});

test('camera clearance searches away from water volumes', () => {
  const query = createQuery({
    water: position => position.x >= -1 && position.x <= 1 && position.z >= -20 && position.z <= 20
  });
  const desired = new THREE.Vector3(0, 1, 0);
  const resolved = query.resolve(desired, {
    preferredDirection: new THREE.Vector3(1, 0, 0),
    radius: 0.5
  });

  assert.ok(resolved.x > 1);
  assert.equal(query.inspect(resolved, { radius: 0.5 }).clear, true);
});

test('camera clearance fails closed when no safe spawn exists', () => {
  const query = createQuery({ water: () => true });
  assert.throws(
    () => query.resolve(new THREE.Vector3(0, 1, 0), { maxSearchRadius: 3 }),
    /No safe camera position/
  );
});
