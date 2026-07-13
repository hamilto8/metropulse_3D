import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  AdaptiveQualityController,
  DETAIL_TIERS,
  PerformanceSystem,
  RENDER_QUALITY_TIERS,
  SpatialHashGrid
} from '../src/systems/PerformanceSystem.js';
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

test('adaptive render quality ignores startup work then degrades sustained low FPS', () => {
  const changes = [];
  const quality = new AdaptiveQualityController({
    warmupSamples: 2,
    downgradeSamples: 2,
    onChange: (tier, previous) => changes.push([previous, tier])
  });

  quality.observe(20);
  quality.observe(20);
  assert.equal(quality.tier, RENDER_QUALITY_TIERS.HIGH);
  quality.observe(20);
  quality.observe(20);
  assert.equal(quality.tier, RENDER_QUALITY_TIERS.MEDIUM);
  quality.observe(20);
  quality.observe(20);
  assert.equal(quality.tier, RENDER_QUALITY_TIERS.LOW);
  assert.deepEqual(changes, [
    [RENDER_QUALITY_TIERS.HIGH, RENDER_QUALITY_TIERS.MEDIUM],
    [RENDER_QUALITY_TIERS.MEDIUM, RENDER_QUALITY_TIERS.LOW]
  ]);
});

test('adaptive render quality uses a longer healthy window to recover', () => {
  const quality = new AdaptiveQualityController({
    initialTier: RENDER_QUALITY_TIERS.LOW,
    warmupSamples: 0,
    upgradeSamples: 3
  });
  quality.observe(60);
  quality.observe(60);
  assert.equal(quality.tier, RENDER_QUALITY_TIERS.LOW);
  quality.observe(60);
  assert.equal(quality.tier, RENDER_QUALITY_TIERS.MEDIUM);
});

test('explicit render quality lock disables automatic changes', () => {
  const quality = new AdaptiveQualityController({
    initialTier: RENDER_QUALITY_TIERS.HIGH,
    locked: true,
    warmupSamples: 0,
    downgradeSamples: 1
  });
  assert.equal(quality.observe(10), RENDER_QUALITY_TIERS.HIGH);
});
