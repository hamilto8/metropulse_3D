import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { CityBuilder } from '../src/world/CityBuilder.js';
import { Vehicle } from '../src/entities/Vehicle.js';
import { getVehicleProfile } from '../src/entities/VehicleProfiles.js';
import {
  approachTrafficTargetSpeed,
  createPedestrianTrafficState,
  getPedestrianYieldKinematics
} from '../src/systems/TrafficPedestrianBehavior.js';
import { DEFAULT_HIT_AND_RUN_PURSUIT } from '../src/systems/HitAndRunPursuit.js';

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

test('impatient traffic waits briefly, honks once, then proceeds', () => {
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
  traffic.random = () => 0.1;
  let honks = 0;
  assert.equal(traffic.updatePedestrianYield(vehicle, 0.1), true);
  assert.equal(honks, 0);
  assert.equal(traffic.updatePedestrianYield(vehicle, 3.5), false);
  assert.equal(honks, 1);
  assert.equal(traffic.updatePedestrianYield(vehicle, 1), false);
  assert.equal(honks, 1);
  assert.equal(vehicle.pedestrianYieldState.released, true);
});

test('patient traffic remains stopped until the pedestrian corridor clears', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = { mesh: new THREE.Group(), isParked: false, info: {} };
  const pedestrian = { mesh: new THREE.Group(), knockedDown: false, isHijacking: false };
  pedestrian.mesh.position.set(0, 0, 3);
  let honks = 0;
  traffic.app = {
    pedestrianSystem: { pedestrians: [pedestrian] },
    audioSystem: { playHonk() { honks += 1; } }
  };
  traffic.random = () => 0.9;
  assert.equal(traffic.updatePedestrianYield(vehicle, 0.1), true);
  assert.equal(traffic.updatePedestrianYield(vehicle, 30), true);
  assert.equal(vehicle.pedestrianYieldState.impatient, false);
  assert.equal(honks, 0);

  pedestrian.mesh.position.set(10, 0, 10);
  assert.equal(traffic.updatePedestrianYield(vehicle, 0.1), false);
  assert.equal(vehicle.pedestrianYieldState, null);
});

test('pedestrian detection distance includes reaction time, braking, and safe clearance', () => {
  for (const fixture of [
    { vType: 'SEDAN', speed: 20, acceleration: 12, targetSpeed: 0 },
    { vType: 'SPORTS_CAR', speed: 32, acceleration: 18, targetSpeed: 0 },
    { vType: 'BUS', speed: 15, acceleration: 12, targetSpeed: 0 },
    { vType: 'POLICE', speed: 42, acceleration: 12, targetSpeed: 0 }
  ]) {
    const kinematics = getPedestrianYieldKinematics(fixture);
    assert.ok(kinematics.detectionDistance > kinematics.stoppingDistance);

    let remainingDistance = kinematics.detectionDistance;
    while (fixture.speed > 0) {
      fixture.speed = approachTrafficTargetSpeed(fixture, 1 / 60, true);
      remainingDistance -= fixture.speed / 60;
    }
    assert.ok(remainingDistance >= 3.1, `${fixture.vType} stopped with only ${remainingDistance}m clearance`);
  }
});

test('moving traffic detects a user-controlled pedestrian beyond the former fixed look-ahead', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const car = {
    mesh: new THREE.Group(),
    vType: 'SEDAN',
    speed: 20,
    acceleration: 12,
    info: {}
  };
  const pedestrian = {
    mesh: new THREE.Group(),
    userControlled: true,
    knockedDown: false,
    isHijacking: false
  };
  pedestrian.mesh.position.set(0, 0, 10);
  traffic.app = { pedestrianSystem: { pedestrians: [pedestrian] } };

  const blocker = traffic.findBlockingPedestrian(car);
  assert.equal(blocker?.pedestrian, pedestrian);
  assert.equal(blocker?.forwardDistance, 10);
});

test('seated cafe patrons do not permanently block an adjacent traffic lane', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const car = {
    mesh: new THREE.Group(),
    vType: 'SEDAN',
    speed: 8,
    acceleration: 12,
    info: {}
  };
  const reader = {
    mesh: new THREE.Group(),
    archetype: 'CAFE_READER',
    cafeSeat: { x: 0, z: 3 },
    behaviorState: { mode: 'SITTING_READING' },
    knockedDown: false,
    isHijacking: false
  };
  reader.mesh.position.set(0, 0, 3);
  traffic.app = { pedestrianSystem: { pedestrians: [reader] } };

  assert.equal(traffic.findBlockingPedestrian(car), null);
  assert.equal(traffic.updatePedestrianYield(car, 1), false);
});

test('patient drivers apply a close-range fail-safe before pedestrian contact', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const car = {
    mesh: new THREE.Group(),
    vType: 'SEDAN',
    isParked: false,
    speed: 20,
    acceleration: 12,
    info: {}
  };
  const pedestrian = { mesh: new THREE.Group(), knockedDown: false, isHijacking: false };
  pedestrian.mesh.position.set(0, 0, 3);
  traffic.app = { pedestrianSystem: { pedestrians: [pedestrian] } };
  traffic.random = () => 0.9;

  assert.equal(traffic.updatePedestrianYield(car, 1 / 60), true);
  assert.equal(car.speed, 0);
  assert.equal(car.info.Status, 'Yielding to pedestrian');
});

test('NPC hit-and-run assigns only nearby available police and accelerates the offender', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const offender = new Vehicle('SEDAN', 0xcc3300, 'Test Offender');
  const nearbyPolice = new Vehicle('POLICE', 0xffffff, 'Nearby Unit');
  const farPolice = new Vehicle('POLICE', 0xffffff, 'Far Unit');
  const busyPolice = new Vehicle('POLICE', 0xffffff, 'Busy Unit');
  const pedestrian = { mesh: new THREE.Group() };
  offender.mesh.position.set(0, 0, 0);
  pedestrian.mesh.position.set(0, 0, 1);
  nearbyPolice.mesh.position.set(20, 0, 0);
  farPolice.mesh.position.set(100, 0, 0);
  busyPolice.mesh.position.set(10, 0, 0);
  busyPolice.emergencyTarget = new THREE.Vector3(5, 0, 5);
  offender.normalMaxSpeed = offender.maxSpeed;
  nearbyPolice.normalMaxSpeed = nearbyPolice.maxSpeed;
  farPolice.normalMaxSpeed = farPolice.maxSpeed;
  busyPolice.normalMaxSpeed = busyPolice.maxSpeed;
  traffic.vehicles = [offender, nearbyPolice, farPolice, busyPolice];
  traffic.hitAndRunPursuitConfig = { ...DEFAULT_HIT_AND_RUN_PURSUIT };
  const alerts = [];
  traffic.app = { uiManager: { addAlert(message, level) { alerts.push({ message, level }); } } };

  assert.equal(traffic.handleNpcPedestrianHit(offender, pedestrian), true);
  assert.ok(offender.maxSpeed > offender.normalMaxSpeed);
  assert.equal(offender.targetSpeed, offender.maxSpeed);
  assert.equal(nearbyPolice.pursuitTarget, offender);
  assert.equal(nearbyPolice.sirenActive, true);
  assert.equal(farPolice.pursuitTarget, undefined);
  assert.equal(busyPolice.pursuitTarget, undefined);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 'danger');
  assert.match(alerts[0].message, /1 nearby police unit pursuing/);
});

test('hit-and-run police tracks the moving offender and pursuit cleanup restores traffic state', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const offender = new Vehicle('SEDAN', 0xcc3300, 'Moving Offender');
  const police = new Vehicle('POLICE', 0xffffff, 'Pursuit Unit');
  offender.normalMaxSpeed = offender.maxSpeed;
  police.normalMaxSpeed = police.maxSpeed;
  offender.mesh.position.set(0, 0, 20);
  police.mesh.position.set(0, 0, 0);
  traffic.vehicles = [offender, police];
  traffic.hitAndRunPursuitConfig = {
    ...DEFAULT_HIT_AND_RUN_PURSUIT,
    pursuitDuration: 0.2
  };
  traffic.app = {
    pedestrianSystem: { getTerrainHeight() { return 0; } },
    uiManager: { addAlert() {} }
  };

  assert.equal(traffic.handleNpcPedestrianHit(offender, null), true);
  offender.mesh.position.set(0, 0, 24);
  traffic.updateHitAndRunPursuits(0.1);
  assert.deepEqual(police.emergencyTarget.toArray(), [0, 0, 24]);
  assert.equal(traffic.updatePoliceEmergencyResponse(police, 0.1), true);
  assert.ok(police.mesh.position.z > 0);
  assert.equal(police.sirenActive, true);

  traffic.updateHitAndRunPursuits(0.2);
  assert.equal(offender.hitAndRunState, null);
  assert.equal(offender.maxSpeed, offender.normalMaxSpeed);
  assert.equal(police.pursuitTarget, null);
  assert.equal(police.emergencyTarget, null);
  assert.equal(police.sirenActive, false);
});

test('hit-and-run pursuit chooses the road-graph branch closest to the fleeing vehicle', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const police = new Vehicle('POLICE', 0xffffff, 'Routing Unit');
  const west = { pos: new THREE.Vector3(-20, 0, 10), nextNodes: [] };
  const north = { pos: new THREE.Vector3(0, 0, 20), nextNodes: [] };
  const junction = {
    pos: new THREE.Vector3(0, 0, 0),
    nextNodes: [west, north]
  };
  police.mesh.position.set(0, 0, 0);
  police.targetNode = junction;

  const navigationTarget = traffic.getPursuitNavigationTarget(
    police,
    new THREE.Vector3(0, 0, 40)
  );
  assert.equal(police.currentNode, junction);
  assert.equal(police.targetNode, north);
  assert.equal(navigationTarget, north.pos);
});

test('driver disposition policy assigns approximately twenty percent as impatient', () => {
  const pedestrian = {};
  const sampleSize = 1000;
  let impatient = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const state = createPedestrianTrafficState(
      pedestrian,
      () => (index + 0.5) / sampleSize,
      { impatienceProbability: 0.2 }
    );
    if (state.impatient) impatient += 1;
  }
  assert.equal(impatient, 200);

  const sanitized = createPedestrianTrafficState(
    pedestrian,
    () => { throw new Error('bad random source'); },
    { impatienceProbability: Number.NaN }
  );
  assert.equal(sanitized.impatient, false);
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
