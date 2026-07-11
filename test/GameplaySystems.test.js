import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { PlayerVehicle } from '../src/entities/PlayerVehicle.js';
import { Vehicle } from '../src/entities/Vehicle.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import { SceneManager } from '../src/world/SceneManager.js';

function installBrowserStubs() {
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
  globalThis.document = globalThis.document || {
    getElementById() { return null; },
    querySelector() { return null; }
  };
}

test('RaycastVehicle weather grip is explicit and physics cleanup is idempotent', () => {
  const physics = new PhysicsWorld();
  const mesh = new THREE.Group();
  const playerVehicle = new PlayerVehicle(mesh, physics, new THREE.Vector3(0, 1, 0));
  const chassis = playerVehicle.chassisBody;
  const dryGrip = playerVehicle.raycastVehicle.wheelInfos.map(wheel => wheel.frictionSlip);

  assert.equal(physics.playerVehicles.has(playerVehicle), true);
  assert.equal(physics.world.bodies.includes(chassis), true);

  physics.setWeatherFriction('rain');
  assert.equal(playerVehicle.gripMultiplier, 0.48);
  playerVehicle.raycastVehicle.wheelInfos.forEach((wheel, index) => {
    assert.equal(wheel.frictionSlip, dryGrip[index] * 0.48);
  });

  physics.setWeatherFriction('clear');
  playerVehicle.raycastVehicle.wheelInfos.forEach((wheel, index) => {
    assert.equal(wheel.frictionSlip, dryGrip[index]);
  });

  playerVehicle.destroy();
  assert.equal(physics.playerVehicles.has(playerVehicle), false);
  assert.equal(physics.world.bodies.includes(chassis), false);
  assert.doesNotThrow(() => playerVehicle.destroy());
});

test('static colliders can be removed for rubble and restored without duplication', () => {
  const physics = new PhysicsWorld();
  const collider = physics.addStaticBoxCollider(
    new THREE.Vector3(10, 5, 10),
    new THREE.Vector3(4, 10, 4)
  );

  physics.removeStaticCollider(collider);
  assert.equal(physics.world.bodies.includes(collider), false);

  physics.restoreStaticCollider(collider);
  physics.restoreStaticCollider(collider);
  assert.equal(physics.world.bodies.filter(body => body === collider).length, 1);
});

test('vehicle speed uses m/s internally and preserves high-priority status', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Unit Test Sedan');
  vehicle.speed = 10;
  vehicle.update(0);
  assert.equal(vehicle.info.Speed, '36 km/h');
  assert.equal(vehicle.info.Status, 'Cruising');

  vehicle.userControlled = true;
  vehicle.update(0);
  assert.equal(vehicle.info.Status, '🎮 USER CONTROLLED');

  vehicle.crashed = true;
  vehicle.update(0);
  assert.equal(vehicle.info.Status, '💥 CRASHED');

  vehicle.onFire = true;
  vehicle.update(0);
  assert.equal(vehicle.info.Status, '🔥 ON FIRE!');
});

test('police emergency state drives visible strobe lights independently of countdown', () => {
  const police = new Vehicle('POLICE', 0xffffff, 'Unit Test Cruiser');
  police.update(0);
  assert.equal(police.sirenLights[0].mesh.material.color.getHex(), 0x220000);

  police.emergencyTarget = new THREE.Vector3(10, 0, 10);
  police.update(0);
  assert.equal(police.sirenLights[0].mesh.material.color.getHex(), 0xff0000);
  assert.equal(police.sirenTimer, 0);
});

test('vehicle exit delegates terrain lookup and releases the vehicle exactly once', () => {
  installBrowserStubs();

  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Exit Test Sedan');
  vehicle.userControlled = true;
  vehicle.mesh.position.set(12, 0, 8);
  traffic.controlledVehicle = vehicle;
  traffic.nodes = new Map();

  let releaseCount = 0;
  let pedestrianControlCount = 0;
  traffic.releaseControl = target => {
    assert.equal(target, vehicle);
    releaseCount += 1;
    target.userControlled = false;
    traffic.controlledVehicle = null;
  };

  const sidewalkNode = {
    pos: new THREE.Vector3(10, 0.4, 10),
    nextNodes: []
  };
  traffic.app = {
    pedestrianSystem: {
      pedestrians: [],
      nodes: new Map([['sidewalk', sidewalkNode]]),
      getTerrainHeight: () => 0.4,
      toggleUserControl: () => { pedestrianControlCount += 1; }
    },
    sceneManager: { scene: { add() {} } },
    inspectorHud: { registerObject() {} }
  };

  assert.doesNotThrow(() => traffic.exitControlledVehicle());
  assert.equal(releaseCount, 1);
  assert.equal(pedestrianControlCount, 1);
  assert.equal(traffic.app.pedestrianSystem.pedestrians.length, 1);
  assert.equal(traffic.app.pedestrianSystem.pedestrians[0].mesh.position.y, 0.4);
});

test('wanted police response follows the player after switching into a vehicle', () => {
  installBrowserStubs();

  const system = Object.create(PedestrianSystem.prototype);
  const controlledVehicle = new Vehicle('SEDAN', 0x3366cc, 'Getaway Car');
  controlledVehicle.userControlled = true;
  controlledVehicle.mesh.position.set(25, 0, -10);
  const police = new Vehicle('POLICE', 0xffffff, 'Responder');
  police.normalMaxSpeed = police.maxSpeed;
  police.mesh.position.set(45, 0, -10);

  Object.assign(system, {
    app: {
      environment: { weatherMode: 'clear' },
      trafficSystem: {
        controlledVehicle,
        vehicles: [controlledVehicle, police]
      }
    },
    pedestrians: [],
    baseballBats: [],
    controlledPedestrian: null,
    isWanted: true,
    escapeTimer: 0,
    talkingBubbleTimer: 0,
    populationCheckTimer: 100,
    targetPedestrianCount: 0
  });
  system.updateWantedHud = () => {};
  system.updateProximityChecks = () => {};

  system.update(0.1);
  assert.deepEqual(police.emergencyTarget.toArray(), controlledVehicle.mesh.position.toArray());
  assert.equal(police.sirenActive, true);
  assert.equal(police.targetSpeed, 42);
});

test('reporting a player crime dispatches police and feeds the macro economy once', () => {
  const system = Object.create(PedestrianSystem.prototype);
  let dispatchedAt = null;
  let recordedIncident = null;
  let resolvedIncident = null;
  Object.assign(system, {
    app: {
      trafficSystem: { dispatchPolice(position) { dispatchedAt = position; } },
      economySystem: {
        recordIncident(incident) { recordedIncident = incident; },
        resolveIncident(id) { resolvedIncident = id; }
      }
    },
    isWanted: false,
    escapeTimer: 4,
    crimeSequence: 0,
    activeCrimeIncidentId: null
  });

  const crimePosition = new THREE.Vector3(3, 0, 7);
  system.reportCrime(crimePosition, 'Hit-and-run reported');
  system.reportCrime(crimePosition, 'Repeated report');

  assert.equal(system.isWanted, true);
  assert.equal(system.escapeTimer, 0);
  assert.notEqual(dispatchedAt, crimePosition);
  assert.deepEqual(dispatchedAt.toArray(), crimePosition.toArray());
  assert.equal(recordedIncident.type, 'CRIME');
  assert.equal(recordedIncident.id, 'player-crime-1');
  assert.deepEqual(recordedIncident.position, { x: 3, z: 7 });
  assert.equal(recordedIncident.influenceRadius, 40);
  assert.equal(system.crimeSequence, 1);

  system.resolveCrimeIncident();
  assert.equal(resolvedIncident, 'player-crime-1');
  assert.equal(system.activeCrimeIncidentId, null);
});

test('hijacking uses a timed approach animation before transferring vehicle control', () => {
  installBrowserStubs();
  const system = Object.create(PedestrianSystem.prototype);
  const pedestrian = {
    mesh: new THREE.Group(),
    info: {},
    userControlled: true,
    speed: 3,
    armL: { rotation: { x: 0 } },
    armR: { rotation: { x: 0 } }
  };
  pedestrian.mesh.position.set(0, 0, 0);
  const vehicle = {
    mesh: new THREE.Group(),
    name: 'Test Coupe',
    vType: 'SEDAN',
    speed: 4,
    targetSpeed: 12,
    maxSpeed: 20,
    crashed: false
  };
  vehicle.mesh.position.set(2, 0, 0);
  let followed = null;
  let inspected = null;
  let removed = null;
  Object.assign(system, {
    pedestrians: [pedestrian],
    controlledPedestrian: pedestrian,
    hijackTransition: null,
    app: {
      trafficSystem: {
        toggleUserControl(target) {
          assert.equal(target, vehicle);
          system.controlledPedestrian = null;
          pedestrian.userControlled = false;
          return true;
        }
      },
      sceneManager: {
        scene: { remove(target) { removed = target; } },
        startFollowTarget(target) { followed = target; }
      },
      inspectorHud: { unregisterObject() {} },
      uiManager: {
        addAlert() {},
        showInspector(target) { inspected = target; }
      }
    }
  });
  system.getTerrainHeight = () => 0;

  assert.equal(system.beginHijack(pedestrian, vehicle), true);
  system.updateHijackTransition(0.3);
  assert.equal(system.pedestrians.includes(pedestrian), true);
  assert.ok(pedestrian.mesh.position.x > 0);
  system.updateHijackTransition(0.3);

  assert.equal(system.hijackTransition, null);
  assert.equal(system.pedestrians.includes(pedestrian), false);
  assert.equal(vehicle.driverPedestrian, pedestrian);
  assert.equal(removed, pedestrian.mesh);
  assert.equal(followed, vehicle);
  assert.equal(inspected, vehicle);
});

test('comet earthquake routes into the active CameraRig shake implementation', () => {
  let shake = null;
  const sceneManager = {
    cameraRig: { triggerShake(value) { shake = value; } },
    shakeIntensity: 0,
    shakeTimer: 0
  };

  SceneManager.prototype.earthquakeShake.call(sceneManager, 2.75, 1.1);
  assert.equal(sceneManager.shakeIntensity, 2.75);
  assert.equal(sceneManager.shakeTimer, 1.1);
  assert.equal(shake, 2.75);
});

test('traffic and pedestrian population floors replace missing ambient agents', () => {
  installBrowserStubs();

  const traffic = new TrafficSystem({
    sceneManager: { scene: { add() {} } },
    inspectorHud: null,
    physicsWorld: null
  });
  const movingVehicle = traffic.vehicles.find(vehicle => !vehicle.isParked);
  traffic.vehicles.splice(traffic.vehicles.indexOf(movingVehicle), 1);
  traffic.ensurePopulationFloor();
  assert.equal(traffic.vehicles.filter(vehicle => !vehicle.isParked).length, 48);

  const pedestrians = new PedestrianSystem({
    sceneManager: { scene: { add() {}, remove() {} } },
    inspectorHud: null,
    cityBuilder: { getHillHeight() { return 0; }, isInWater() { return false; } },
    environment: { weatherMode: 'clear' }
  });
  pedestrians.pedestrians.pop();
  pedestrians.ensurePopulationFloor();
  assert.equal(pedestrians.pedestrians.length, 60);
});
