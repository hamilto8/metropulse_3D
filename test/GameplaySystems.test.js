import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { PlayerVehicle } from '../src/entities/PlayerVehicle.js';
import { Pedestrian } from '../src/entities/Pedestrian.js';
import { Vehicle } from '../src/entities/Vehicle.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import { updatePedestrianKnockdown } from '../src/systems/PedestrianImpact.js';
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

test('physics vehicles recover to their last supported pose after falling below terrain', () => {
  const physics = new PhysicsWorld();
  physics.terrainSystem = { getTerrainHeight() { return 0; } };
  const mesh = new THREE.Group();
  const vehicle = new PlayerVehicle(mesh, physics, new THREE.Vector3(12, 0, -8));
  const safeX = vehicle.chassisBody.position.x;
  const safeZ = vehicle.chassisBody.position.z;

  vehicle.chassisBody.position.set(40, -20, 40);
  vehicle.syncMesh();

  assert.equal(vehicle.chassisBody.position.x, safeX);
  assert.equal(vehicle.chassisBody.position.z, safeZ);
  assert.ok(vehicle.chassisBody.position.y > 0);
  assert.equal(vehicle.chassisBody.velocity.length(), 0);
  vehicle.destroy();
});

test('a high-centered physics vehicle auto-recovers under sustained drive input', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  try {
    const physics = new PhysicsWorld();
    const mesh = new THREE.Group();
    const vehicle = new PlayerVehicle(mesh, physics, new THREE.Vector3(0, 1, 0));
    let recoveries = 0;
    vehicle.recoverToSafePose = () => {
      recoveries += 1;
      return true;
    };

    for (let frame = 0; frame < 300 && recoveries === 0; frame += 1) {
      // Deliberately do not step physics: this models a chassis pinned on an
      // obstacle with throttle applied and no wheel-generated motion.
      vehicle.applyInput({ w: true }, 1 / 120);
    }

    assert.equal(recoveries, 1);
    assert.equal(vehicle.stuckElapsed, 0);
    assert.ok(vehicle.recoveryCooldown > 0);
    vehicle.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
});

test('physics drive transitions from forward motion through braking into reverse', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  try {
    const physics = new PhysicsWorld();
    const mesh = new THREE.Group();
    const vehicle = new PlayerVehicle(mesh, physics, new THREE.Vector3(0, 0, 0));

    for (let frame = 0; frame < 240; frame += 1) {
      vehicle.applyInput({ w: true }, 1 / 120);
      physics.step(1 / 120);
      vehicle.syncMesh();
    }
    const forwardPosition = vehicle.chassisBody.position.z;
    assert.ok(forwardPosition > 8, `forward drive stalled at ${forwardPosition}`);

    for (let frame = 0; frame < 480; frame += 1) {
      vehicle.applyInput({ s: true }, 1 / 120);
      physics.step(1 / 120);
      vehicle.syncMesh();
    }
    assert.ok(
      vehicle.chassisBody.position.z < forwardPosition - 8,
      `reverse drive failed to escape: ${vehicle.chassisBody.position.z} from ${forwardPosition}`
    );
    vehicle.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
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

test('vehicle explosions ignite nearby cars and cull wrecks after their lifetime', () => {
  installBrowserStubs();
  const source = new Vehicle('SEDAN', 0x3366cc, 'Source Sedan');
  const nearby = new Vehicle('TAXI', 0xffcc00, 'Nearby Taxi');
  const distant = new Vehicle('BUS', 0xffffff, 'Distant Bus');
  source.mesh.position.set(0, 0, 0);
  nearby.mesh.position.set(7, 0, 0);
  distant.mesh.position.set(30, 0, 0);
  let explosions = 0;
  let replacements = 0;
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.app = {
    explosionManager: { createExplosion() { explosions += 1; } },
    audioSystem: { playExplosion() {} },
    sceneManager: { scene: { remove() {} } },
    physicsWorld: null
  };
  traffic.vehicles = [source, nearby, distant];
  traffic.chainReactionRadius = 10;
  traffic.chainReactionDelay = 4;
  traffic.destroyedVehicleLifetime = 30;
  traffic.spawnVehicles = count => { replacements += count; };

  assert.equal(traffic.igniteVehicle(source, { delay: 0.1 }), true);
  assert.equal(source.onFire, true);
  assert.equal(traffic.explodeVehicle(source), true);
  assert.equal(explosions, 1);
  assert.equal(source.isDestroyed, true);
  assert.equal(nearby.onFire, true);
  assert.equal(nearby.fireTimer, 4);
  assert.equal(distant.onFire, false);

  source.destroyedTimer = 0;
  traffic.update(0);
  assert.equal(traffic.vehicles.includes(source), false);
  assert.equal(replacements, 1);
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

test('vehicle impacts throw pedestrians backward and keep them down briefly', () => {
  installBrowserStubs();
  const system = Object.create(PedestrianSystem.prototype);
  system.app = { cityBuilder: { getTerrainHeight() { return 0; } }, audioSystem: { playBump() {} } };
  const pedestrian = {
    mesh: new THREE.Group(),
    knockedDown: false,
    speed: 2,
    targetSpeed: 2,
    info: { Activity: 'Walking', Mood: 'Energized' },
    legL: { rotation: { x: 0 } },
    legR: { rotation: { x: 0 } },
    armL: { rotation: { x: 0 } },
    armR: { rotation: { x: 0 } }
  };
  assert.equal(system.knockDownPedestrian(pedestrian, new THREE.Vector3(0, 0, 1), 20), true);
  assert.equal(pedestrian.knockedDown, true);
  assert.ok(pedestrian.knockdownState.velocity.z > 3);
  assert.ok(pedestrian.knockdownState.velocity.y > 2);
  assert.equal(pedestrian.knockdownTimer, 4);
  assert.equal(pedestrian.info.Mood, 'Dazed on Ground');

  for (let i = 0; i < 250; i += 1) {
    updatePedestrianKnockdown(pedestrian, 1 / 60, () => 0);
  }
  assert.equal(pedestrian.knockedDown, false);
  assert.equal(pedestrian.knockdownState, null);
  assert.equal(pedestrian.mesh.position.y, 0);
  assert.equal(pedestrian.mesh.rotation.x, 0);
  assert.equal(pedestrian.mesh.rotation.z, 0);
});

test('pedestrian knockdown sanitizes invalid impact speed and terrain values', () => {
  const system = Object.create(PedestrianSystem.prototype);
  system.app = { audioSystem: { playBump() {} } };
  const pedestrian = {
    mesh: new THREE.Group(),
    knockedDown: false,
    speed: 1,
    targetSpeed: 1,
    info: { Activity: 'Walking', Mood: 'Calm' }
  };
  assert.equal(system.knockDownPedestrian(pedestrian, null, Number.NaN), true);
  updatePedestrianKnockdown(pedestrian, Number.NaN, () => Number.NaN);
  assert.equal(Number.isFinite(pedestrian.mesh.position.x), true);
  assert.equal(Number.isFinite(pedestrian.mesh.position.y), true);
  assert.equal(Number.isFinite(pedestrian.mesh.position.z), true);
});

test('vehicle exit delegates terrain lookup and releases the vehicle exactly once', () => {
  installBrowserStubs();

  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Exit Test Sedan');
  vehicle.userControlled = true;
  vehicle.mesh.position.set(12, 0, 8);
  traffic.controlledVehicle = vehicle;
  traffic.controlSession = { source: 'pedestrian', pedestrian: null };
  traffic.nodes = new Map();

  let releaseCount = 0;
  let pedestrianControlCount = 0;
  let followedEntity = null;
  let inspectorHidden = 0;
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
      toggleUserControl: () => {
        pedestrianControlCount += 1;
        return true;
      }
    },
    sceneManager: {
      scene: new THREE.Group(),
      startFollowTarget(target) { followedEntity = target; }
    },
    inspectorHud: { registerObject() {} },
    uiManager: { hideInspector() { inspectorHidden += 1; } }
  };

  assert.doesNotThrow(() => traffic.exitControlledVehicle());
  assert.equal(releaseCount, 1);
  assert.equal(pedestrianControlCount, 1);
  assert.equal(traffic.app.pedestrianSystem.pedestrians.length, 1);
  assert.equal(traffic.app.pedestrianSystem.pedestrians[0].mesh.position.y, 0.4);
  assert.equal(followedEntity, traffic.app.pedestrianSystem.pedestrians[0]);
  assert.equal(inspectorHidden, 1);
  assert.equal(vehicle.driverPedestrian, null);
});

test('pedestrian vehicle exit does not duplicate an already registered pedestrian', () => {
  installBrowserStubs();

  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Repeat Exit Sedan');
  const pedestrian = new Pedestrian('CASUAL', 0x2563eb, 'Returning Driver');
  vehicle.userControlled = true;
  vehicle.driverPedestrian = pedestrian;
  traffic.controlledVehicle = vehicle;
  traffic.controlSession = { source: 'pedestrian', pedestrian };
  traffic.nodes = new Map();
  traffic.getTerrainHeight = () => 0.2;
  traffic.releaseControl = target => {
    target.userControlled = false;
    traffic.controlledVehicle = null;
  };

  const pedestrians = [pedestrian];
  let followedEntity = null;
  traffic.app = {
    pedestrianSystem: {
      pedestrians,
      nodes: new Map(),
      toggleUserControl(target) {
        target.userControlled = true;
        this.controlledPedestrian = target;
        return true;
      }
    },
    sceneManager: {
      scene: new THREE.Group(),
      startFollowTarget(target) { followedEntity = target; }
    }
  };

  assert.equal(traffic.exitControlledVehicle(), true);
  assert.equal(pedestrians.length, 1);
  assert.equal(followedEntity, pedestrian);
});

test('camera-origin vehicle exit returns to management without creating a pedestrian', () => {
  const traffic = Object.create(TrafficSystem.prototype);
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Camera Test Sedan');
  vehicle.userControlled = true;
  traffic.controlledVehicle = vehicle;
  traffic.controlSession = { source: 'camera', pedestrian: null };
  let released = 0;
  let pedestrians = 0;
  traffic.releaseControl = () => { released += 1; traffic.controlledVehicle = null; };
  traffic.app = {
    pedestrianSystem: { toggleUserControl: () => { pedestrians += 1; } },
    sceneManager: { stopFollowTarget() {} },
    uiManager: { hideInspector() {} }
  };
  assert.equal(traffic.exitControlledVehicle(), true);
  assert.equal(released, 1);
  assert.equal(pedestrians, 0);
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
  const archetypeCounts = pedestrians.pedestrians.reduce((counts, pedestrian) => {
    counts[pedestrian.archetype] = (counts[pedestrian.archetype] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(archetypeCounts, {
    CASUAL: 18,
    BUSINESS: 12,
    JOGGER: 9,
    TOURIST: 9,
    CAFE_READER: 6,
    CRIMINAL: 6
  });
});
