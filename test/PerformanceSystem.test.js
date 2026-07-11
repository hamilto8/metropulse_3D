import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PerformanceSystem, SpatialHashGrid, DETAIL_TIERS } from '../src/systems/PerformanceSystem.js';
import { Vehicle } from '../src/entities/Vehicle.js';
import { Pedestrian } from '../src/entities/Pedestrian.js';

function entityAt(x, z) {
  return { mesh: { position: new THREE.Vector3(x, 0, z) } };
}

test('spatial hash returns only local agents across cell boundaries', () => {
  const grid = new SpatialHashGrid(10);
  const origin = entityAt(0, 0);
  const adjacentCell = entityAt(9, 0);
  const far = entityAt(40, 0);
  grid.rebuild([origin, adjacentCell, far]);

  assert.deepEqual(grid.query(origin.mesh.position, 10), [origin, adjacentCell]);
  assert.deepEqual(grid.query(origin.mesh.position, 3), [origin]);
});

test('performance policy applies deterministic near, medium, and far detail tiers', () => {
  const levels = [];
  const vehicles = [entityAt(10, 0), entityAt(200, 0), entityAt(500, 0)];
  vehicles.forEach(vehicle => {
    vehicle.setDetailLevel = level => {
      vehicle.detailLevel = level;
      levels.push(level);
    };
  });
  const app = {
    trafficSystem: { vehicles, controlledVehicle: null },
    pedestrianSystem: { pedestrians: [], controlledPedestrian: null },
    sceneManager: { controls: { target: new THREE.Vector3(0, 0, 0) } }
  };
  const performance = new PerformanceSystem(app);
  performance.beginFrame();

  assert.deepEqual(levels, [DETAIL_TIERS.HIGH, DETAIL_TIERS.MEDIUM, DETAIL_TIERS.LOW]);
  assert.equal(performance.nearbyVehicles(new THREE.Vector3(), 20).length, 1);
  assert.equal(performance.shouldAnimate(vehicles[0], 0), true);
});

test('vehicle and pedestrian low-detail proxies preserve one interactive root', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'LOD Sedan');
  const pedestrian = new Pedestrian('CASUAL', 0x3b82f6, 'LOD Citizen');

  vehicle.setDetailLevel(DETAIL_TIERS.LOW);
  pedestrian.setDetailLevel(DETAIL_TIERS.LOW);
  assert.equal(vehicle.lowDetailProxy.visible, true);
  assert.equal(pedestrian.lowDetailProxy.visible, true);
  assert.equal(vehicle.highDetailParts.every(part => !part.visible), true);
  assert.equal(pedestrian.highDetailParts.every(part => !part.visible), true);
  assert.equal(vehicle.mesh.userData.entityData, vehicle);
  assert.equal(pedestrian.mesh.userData.entityData, pedestrian);

  vehicle.setDetailLevel(DETAIL_TIERS.HIGH);
  pedestrian.setDetailLevel(DETAIL_TIERS.HIGH);
  assert.equal(vehicle.lowDetailProxy.visible, false);
  assert.equal(pedestrian.lowDetailProxy.visible, false);
});
