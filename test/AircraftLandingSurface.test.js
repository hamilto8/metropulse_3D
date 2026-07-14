import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  assessLandingSurface,
  classifyLandingSurface,
  getLandingFootprintSamples,
  LANDING_SURFACE_TYPES
} from '../src/systems/AircraftLandingSurface.js';
import { CityBuilder } from '../src/world/CityBuilder.js';

function createTerrain({ height = () => 0, water = () => false, bridge = () => null } = {}) {
  return {
    getTerrainHeight: height,
    isInWater: water,
    getUserBridgeDeckHeight: bridge,
    getBuiltInBridgeDeckHeight: () => null
  };
}

test('landing surfaces explicitly include the runway, roads, and clear suburban countryside', () => {
  const terrain = createTerrain();
  assert.equal(classifyLandingSurface({ x: -105, z: -260 }, terrain), LANDING_SURFACE_TYPES.RUNWAY);
  assert.equal(classifyLandingSurface({ x: 0, z: 50 }, terrain), LANDING_SURFACE_TYPES.ROAD);
  assert.equal(classifyLandingSurface({ x: 550, z: 0 }, terrain), LANDING_SURFACE_TYPES.ROAD);
  assert.equal(classifyLandingSurface({ x: 525, z: 25 }, terrain), LANDING_SURFACE_TYPES.COUNTRYSIDE);
});

test('a level road and open countryside produce safe footprint assessments', () => {
  const terrain = createTerrain({ height: (x, z) => x >= 420 ? Math.sin(x * 0.01) * 0.2 + z * 0.001 : 0 });
  const road = assessLandingSurface({ position: { x: 550, z: 0 }, heading: Math.PI / 2, cityBuilder: terrain });
  const countryside = assessLandingSurface({ position: { x: 525, z: 25 }, heading: 0, cityBuilder: terrain });

  assert.equal(road.allowed, true);
  assert.equal(road.type, LANDING_SURFACE_TYPES.ROAD);
  assert.equal(countryside.allowed, true);
  assert.equal(countryside.type, LANDING_SURFACE_TYPES.COUNTRYSIDE);
});

test('authored rolling suburb supports real road and grass touchdown profiles', () => {
  const builder = new CityBuilder(new THREE.Scene(), null, null);
  const road = assessLandingSurface({ position: { x: 550, z: 50 }, heading: Math.PI / 2, cityBuilder: builder });
  const countryside = assessLandingSurface({ position: { x: 525, z: 25 }, heading: 0, cityBuilder: builder });

  assert.equal(road.allowed, true);
  assert.equal(road.type, LANDING_SURFACE_TYPES.ROAD);
  assert.equal(countryside.allowed, true);
  assert.equal(countryside.type, LANDING_SURFACE_TYPES.COUNTRYSIDE);
  assert.ok(countryside.maxGrade > 0);
});

test('water, bridge decks, steep ground, and unsupported urban terrain are rejected', () => {
  const wetTerrain = createTerrain({ water: point => point.x >= 135 && point.x <= 185 });
  assert.equal(assessLandingSurface({ position: { x: 160, z: 0 }, cityBuilder: wetTerrain }).reason, 'water');

  const bridgeTerrain = createTerrain({ bridge: (x, z) => Math.abs(x - 160) < 10 && Math.abs(z) < 10 ? 5 : null });
  assert.equal(classifyLandingSurface({ x: 160, z: 0 }, bridgeTerrain), LANDING_SURFACE_TYPES.UNSUITABLE);

  const steepTerrain = createTerrain({ height: x => (x - 525) * 0.5 });
  assert.equal(assessLandingSurface({ position: { x: 525, z: 25 }, cityBuilder: steepTerrain }).reason, 'terrain-too-steep');
  assert.equal(classifyLandingSurface({ x: 250, z: 25 }, createTerrain()), LANDING_SURFACE_TYPES.UNSUITABLE);
});

test('landing footprint rotates with aircraft heading and guards more than its centre point', () => {
  const northbound = getLandingFootprintSamples({ x: 500, z: 25 }, 0);
  const eastbound = getLandingFootprintSamples({ x: 500, z: 25 }, Math.PI / 2);
  assert.equal(northbound.length, 7);
  assert.ok(northbound.some(point => point.x < 496));
  assert.ok(eastbound.some(point => point.z > 29));

  const bankTerrain = createTerrain({ water: point => point.x > 504 });
  const assessment = assessLandingSurface({ position: { x: 500, z: 25 }, heading: 0, cityBuilder: bankTerrain });
  assert.equal(assessment.reason, 'water');
});
