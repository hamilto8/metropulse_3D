import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { CityBuilder } from '../src/world/CityBuilder.js';
import { getVehicleProfile } from '../src/entities/VehicleProfiles.js';

function vehicle({ x, z, speed = 10, parked = false, crashed = false, onFire = false } = {}) {
  return {
    mesh: { position: { x, z } },
    speed,
    isParked: parked,
    crashed,
    onFire,
    userControlled: false,
    info: { Status: 'Cruising' }
  };
}

test('bridge priority is stateful and marks bridge traffic', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const bridgeVehicle = vehicle({ x: 150, z: 0 });
  const cityVehicle = vehicle({ x: 20, z: 50 });
  traffic.vehicles = [bridgeVehicle, cityVehicle];
  traffic.bridgePriorityEnabled = false;

  assert.equal(traffic.toggleBridgePriority(), true);
  assert.equal(bridgeVehicle.info.Status, 'Bridge Priority Lane');
  assert.equal(cityVehicle.info.Status, 'Cruising');
  assert.equal(traffic.toggleBridgePriority(false), false);
  assert.equal(bridgeVehicle.info.Status, 'Cruising');
});

test('congestion metrics exclude parked traffic and expose bridge load', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.app = { trafficHeatmapSystem: { hotspots: [{ x: 150, z: 0, intensity: 1 }] } };
  traffic.vehicles = [
    vehicle({ x: 150, z: 0, speed: 0 }),
    vehicle({ x: 160, z: 0, speed: 8 }),
    vehicle({ x: 20, z: 50, speed: 0, crashed: true }),
    vehicle({ x: 30, z: 50, parked: true })
  ];

  const metrics = traffic.getCongestionMetrics();
  assert.equal(metrics.activeVehicles, 3);
  assert.equal(metrics.stoppedVehicles, 2);
  assert.equal(metrics.crashedVehicles, 1);
  assert.equal(metrics.index, 1);
  assert.deepEqual(metrics.bridge, { index: 0.5, vehicles: 2, stoppedVehicles: 1 });
  assert.equal(metrics.hotspots.length, 1);
});

test('user-to-AI contact resolves in the road plane without blocking adjacent lanes', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const playerMesh = new THREE.Group();
  const chassisBody = {
    position: new THREE.Vector3(0, 1, 0),
    velocity: new THREE.Vector3(0, 0, 8),
    angularVelocity: new THREE.Vector3(1, 0, 1),
    aabbNeedsUpdate: false
  };
  const player = {
    vType: 'SEDAN',
    mesh: playerMesh,
    physicsVehicle: { chassisBody }
  };
  const leadVehicle = {
    vType: 'SEDAN',
    mesh: new THREE.Group(),
    speed: 8
  };
  leadVehicle.mesh.position.set(0, 0, 3.5);

  const originalY = chassisBody.position.y;
  assert.equal(traffic.resolveUserVehicleContact(player, leadVehicle), true);
  assert.equal(chassisBody.position.y, originalY);
  assert.ok(chassisBody.position.z < 0);
  assert.ok(chassisBody.angularVelocity.x < 1);
  assert.equal(chassisBody.aabbNeedsUpdate, true);

  const adjacentVehicle = {
    vType: 'BUS',
    mesh: new THREE.Group(),
    speed: 8
  };
  adjacentVehicle.mesh.position.set(7, 0, 0);
  assert.equal(traffic.resolveUserVehicleContact(player, adjacentVehicle), false);
  assert.equal(getVehicleProfile('BUS').length, 10.5);
});

test('AI traffic yields and honks for most pedestrians, then proceeds after impatience timeout', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = {
    mesh: new THREE.Group(),
    isParked: false,
    speed: 8,
    info: {}
  };
  const pedestrian = { mesh: new THREE.Group(), knockedDown: false, isHijacking: false };
  vehicle.mesh.rotation.y = 0;
  pedestrian.mesh.position.set(0, 0, 3);
  traffic.app = {
    pedestrianSystem: { pedestrians: [pedestrian] },
    audioSystem: { playHonk() { honks += 1; } }
  };
  let honks = 0;
  const originalRandom = Math.random;
  Math.random = () => 0.1;
  try {
    assert.equal(traffic.updatePedestrianYield(vehicle, 0.1), true);
    assert.equal(honks, 1);
    assert.equal(traffic.updatePedestrianYield(vehicle, 1.2), true);
    assert.equal(honks, 2);
    assert.equal(traffic.updatePedestrianYield(vehicle, 2.3), false);
    assert.equal(vehicle.pedestrianYieldState.released, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('AI traffic can ignore a pedestrian encounter to preserve natural variation', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = { mesh: new THREE.Group(), isParked: false, info: {} };
  const pedestrian = { mesh: new THREE.Group(), knockedDown: false, isHijacking: false };
  pedestrian.mesh.position.set(0, 0, 3);
  traffic.app = { pedestrianSystem: { pedestrians: [pedestrian] }, audioSystem: { playHonk() {} } };
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    assert.equal(traffic.updatePedestrianYield(vehicle, 0.1), false);
    assert.equal(vehicle.pedestrianYieldState.shouldYield, false);
  } finally {
    Math.random = originalRandom;
  }
});

test('editor road segments join and leave the live traffic graph safely', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const existingNode = {
    id: 'EXISTING',
    pos: new THREE.Vector3(0, 0, 0),
    nextNodes: []
  };
  traffic.nodes = new Map([[existingNode.id, existingNode]]);
  traffic.vehicles = [];
  traffic.placedRoadSegments = new Map();

  const building = {
    id: 'road-1',
    plot: { x: 0, z: 20, width: 30, depth: 30 },
    group: { rotation: { y: 0 } },
    mesh: { position: new THREE.Vector3(0, 0, 20) }
  };
  const spec = {
    generatorType: 'ROAD_SEGMENT',
    roadType: 'STRAIGHT',
    footprint: { width: 30, depth: 30 }
  };

  const record = traffic.registerRoadSegment(building, spec);
  assert.equal(record.connected, true);
  assert.equal(record.nodes.length, 3);
  assert.ok(existingNode.nextNodes.some(node => record.nodes.includes(node)));
  assert.equal(traffic.unregisterRoadSegment(building), true);
  assert.equal(traffic.nodes.size, 1);
  assert.deepEqual(existingNode.nextNodes, []);
});

test('an intact editor bridge is a traversable river deck and destruction restores water hazard', () => {
  const bridge = {
    plot: { x: 160, y: 0, z: 50, width: 30, depth: 30 },
    group: { rotation: { y: 0 }, position: { y: 0 } },
    spec: { roadType: 'BRIDGE' },
    isDestroyed: false
  };
  const cityBuilder = Object.create(CityBuilder.prototype);
  cityBuilder.app = {
    trafficSystem: {
      placedRoadSegments: new Map([['bridge-1', { building: bridge, spec: bridge.spec }]])
    }
  };

  assert.equal(cityBuilder.getUserBridgeDeckHeight(160, 50), 0.45);
  assert.equal(cityBuilder.isInWater({ x: 160, y: 0.5, z: 50 }), false);
  assert.equal(cityBuilder.isInWater({ x: 160, y: -3, z: 50 }), true);

  bridge.isDestroyed = true;
  assert.equal(cityBuilder.getUserBridgeDeckHeight(160, 50), null);
  assert.equal(cityBuilder.isInWater({ x: 160, y: 0.5, z: 50 }), true);
});
