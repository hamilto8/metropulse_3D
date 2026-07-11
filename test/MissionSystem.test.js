import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { MissionSystem, validateMissionData } from '../src/systems/MissionSystem.js';

// MissionSystem owns presentation objects as well as its deterministic state
// machine. These minimal browser shims keep the tests focused on state and
// integration semantics without introducing a DOM implementation dependency.
globalThis.window = {
  addEventListener() {}
};

globalThis.document = {
  getElementById() {
    return null;
  },
  querySelector() {
    return null;
  }
};

function missionFixture(overrides = {}) {
  return {
    id: 'mission-test-taxi',
    title: 'Test Fare',
    missionType: 'TAXI',
    vehicleType: 'TAXI',
    passengerName: 'Test Rider',
    passengerRole: 'QA specialist',
    pickup: { x: 10, z: 20, district: 'Test District' },
    dropoff: { x: 110, z: 120, district: 'Destination' },
    timeLimit: 60,
    baseReward: 10,
    rewardScale: 100,
    narrativeProgressDelta: 1,
    dialogueTree: {
      start: {
        text: 'Can you take me there?',
        choices: [{ label: 'Accept', next: 'accepted' }]
      },
      accepted: { text: 'Go!' }
    },
    ...overrides
  };
}

function vehicleFixture({ x = 10, z = 20, type = 'TAXI', controlled = true } = {}) {
  return {
    vType: type,
    userControlled: controlled,
    speed: 0,
    mesh: {
      position: new THREE.Vector3(x, 0, z),
      rotation: { y: 0 }
    }
  };
}

function appFixture(overrides = {}) {
  const app = {
    sceneManager: { scene: new THREE.Scene() },
    trafficSystem: {
      controlledVehicle: null,
      vehicles: [],
      getCongestionMetrics: () => ({ index: 0 })
    },
    gameManager: {
      setMode() {},
      setMayhem() {}
    },
    uiManager: {
      showToast() {},
      setMayhem() {}
    }
  };

  return Object.assign(app, overrides);
}

function createSystem(app = appFixture()) {
  return new MissionSystem(app, {
    currentMission: null,
    showMissionDialogue() {}
  });
}

test('mission-data validation accepts supported objectives and rejects structural defects', () => {
  const taxi = missionFixture();
  const survival = missionFixture({
    id: 'mission-survival',
    missionType: 'SURVIVAL',
    dropoff: undefined
  });

  assert.equal(validateMissionData([taxi, survival]), true);
  assert.throws(() => validateMissionData([]), /non-empty array/);
  assert.throws(
    () => validateMissionData([taxi, { ...taxi }]),
    /missing or duplicated/
  );
  assert.throws(
    () => validateMissionData([missionFixture({ pickup: { x: 1 } })]),
    /invalid pickup/
  );
  assert.throws(
    () => validateMissionData([missionFixture({ missionType: 'ESCORT' })]),
    /unsupported objective ESCORT/
  );
  assert.throws(
    () => validateMissionData([missionFixture({ timeLimit: 0 })]),
    /invalid timeLimit/
  );
  assert.throws(
    () => validateMissionData([missionFixture({ missionType: 'RACE' })]),
    /checkpoints/
  );
  assert.throws(
    () => validateMissionData([missionFixture({ missionType: 'SABOTAGE' })]),
    /sabotage action/
  );

  const brokenDialogue = missionFixture();
  brokenDialogue.dialogueTree.start.choices[0].next = 'missing-node';
  assert.throws(
    () => validateMissionData([brokenDialogue]),
    /broken dialogue choice/
  );
});

test('mission eligibility requires direct control, the requested vehicle type, and pickup proximity', () => {
  const app = appFixture();
  const system = createSystem(app);
  const mission = missionFixture();

  assert.deepEqual(
    system.canUseMission(mission),
    { allowed: false, vehicle: null, reason: 'Take direct control of a vehicle first.' }
  );

  app.trafficSystem.controlledVehicle = vehicleFixture({ controlled: false });
  assert.match(system.canUseMission(mission).reason, /direct control/);

  app.trafficSystem.controlledVehicle = vehicleFixture({ type: 'SPORTS' });
  assert.match(system.canUseMission(mission).reason, /Requires a TAXI vehicle/);

  app.trafficSystem.controlledVehicle = vehicleFixture({ x: 100, z: 100 });
  assert.match(system.canUseMission(mission).reason, /pickup ring/);

  const taxi = vehicleFixture();
  app.trafficSystem.controlledVehicle = taxi;
  assert.deepEqual(system.canUseMission(mission), {
    allowed: true,
    vehicle: taxi,
    reason: ''
  });
});

test('starting a mission binds it to the accepting vehicle and applies choice timing and reward', () => {
  const app = appFixture();
  const taxi = vehicleFixture();
  app.trafficSystem.controlledVehicle = taxi;
  const transitions = [];
  app.gameManager.setMode = (...args) => transitions.push(['mode', ...args]);

  const system = createSystem(app);
  const mission = missionFixture();

  assert.equal(system.startMission(mission, {
    timeLimitOverride: 45,
    rushBonus: 5
  }), true);
  assert.equal(system.state, 'IN_PROGRESS');
  assert.equal(system.activeVehicle, taxi);
  assert.equal(system.timeRemaining, 45);
  assert.equal(system.initialTimeLimit, 45);
  assert.equal(system.basePayout, 1_500);
  assert.equal(system.payout, 1_500);
  assert.equal(system.destinationBeacon instanceof THREE.Group, true);
  assert.equal(transitions[0][1], 'ACTION');

  let failureReason = null;
  system.failMission = reason => {
    failureReason = reason;
  };
  app.trafficSystem.controlledVehicle = vehicleFixture();
  system.update(0.1);
  assert.equal(failureReason, 'vehicle_lost');
});

test('delivery timers advance deterministically and fail at zero while survival completes at zero', () => {
  const deliveryApp = appFixture();
  const deliveryVehicle = vehicleFixture();
  deliveryApp.trafficSystem.controlledVehicle = deliveryVehicle;
  const deliverySystem = createSystem(deliveryApp);
  const delivery = missionFixture({ timeLimit: 1 });
  assert.equal(deliverySystem.startMission(delivery), true);

  let deliveryFailure = null;
  deliverySystem.failMission = reason => {
    deliveryFailure = reason ?? 'timeout';
  };
  deliverySystem.update(0.25);
  assert.equal(deliverySystem.timeRemaining, 0.75);
  assert.equal(deliveryFailure, null);
  deliverySystem.update(0.75);
  assert.equal(deliveryFailure, 'timeout');

  const survivalApp = appFixture();
  const survivalVehicle = vehicleFixture({ type: 'SPORTS' });
  survivalApp.trafficSystem.controlledVehicle = survivalVehicle;
  const survivalSystem = createSystem(survivalApp);
  const survival = missionFixture({
    id: 'mission-test-survival',
    missionType: 'SURVIVAL',
    vehicleType: 'SPORTS',
    dropoff: undefined,
    timeLimit: 1
  });
  assert.equal(survivalSystem.startMission(survival), true);

  let completions = 0;
  survivalSystem.completeMission = () => {
    completions += 1;
  };
  survivalSystem.update(1);
  assert.equal(completions, 1);
});

test('race missions advance authored checkpoints and fail when a rival finishes first', () => {
  const app = appFixture();
  const racer = vehicleFixture({ type: 'SPORTS' });
  app.trafficSystem.controlledVehicle = racer;
  const system = createSystem(app);
  const race = missionFixture({
    id: 'mission-test-race',
    missionType: 'RACE',
    vehicleType: 'SPORTS',
    timeLimit: 100,
    checkpoints: [
      { x: 20, z: 20, district: 'One' },
      { x: 30, z: 20, district: 'Two' }
    ],
    dropoff: { x: 40, z: 20, district: 'Finish' },
    rivals: [{ name: 'Test Rival', finishTime: 30 }]
  });
  assert.equal(system.startMission(race), true);
  assert.equal(system.routePoints.length, 3);

  racer.mesh.position.set(20, 0, 20);
  system.update(0.1);
  assert.equal(system.routeIndex, 1);
  assert.deepEqual(system.getNavigationTarget(), race.checkpoints[1]);

  let failure = null;
  system.failMission = reason => { failure = reason; };
  system.raceElapsed = 29.9;
  system.update(0.1);
  assert.equal(failure, 'race_lost');
});

test('sabotage missions require a stopped on-target interaction and hold period', () => {
  const app = appFixture();
  const cruiser = vehicleFixture({ type: 'POLICE', x: 110, z: 120 });
  app.trafficSystem.controlledVehicle = cruiser;
  const system = createSystem(app);
  const sabotage = missionFixture({
    id: 'mission-test-sabotage',
    missionType: 'SABOTAGE',
    vehicleType: 'POLICE',
    sabotageAction: 'Disable target network',
    sabotageDuration: 2
  });
  cruiser.mesh.position.set(10, 0, 20);
  assert.equal(system.startMission(sabotage), true);
  cruiser.mesh.position.set(110, 0, 120);
  cruiser.speed = 0;
  assert.equal(system.handleActionKey(), true);
  assert.equal(system.sabotageActive, true);

  let completions = 0;
  system.completeMission = () => { completions += 1; };
  system.update(1);
  assert.equal(completions, 0);
  system.update(1);
  assert.equal(completions, 1);
});

test('completion sends adjusted taxi payout to the shared economy and isolates repeat-run narrative progress', () => {
  const completions = [];
  const app = appFixture({
    economySystem: {
      recordMissionCompletion(mission, reward, metadata) {
        completions.push({ mission, reward, metadata });
        return true;
      }
    }
  });
  const system = createSystem(app);
  system.showPayoutToast = () => {};

  const mission = missionFixture();
  const completeRun = () => {
    system.activeMission = mission;
    system.activeVehicle = vehicleFixture();
    system.state = 'IN_PROGRESS';
    system.initialTimeLimit = 100;
    system.timeRemaining = 50;
    system.basePayout = 1_000;
    system.payout = 1_000;
    system.congestionSamples = 2;
    system.congestionTotal = 1;
    system.completeMission();
  };

  completeRun();
  completeRun();

  assert.equal(completions.length, 2);
  assert.equal(completions[0].mission.id, mission.id);
  assert.equal(completions[0].reward, 1_060);
  assert.equal(completions[0].metadata.satisfaction, 62);
  assert.equal(completions[1].mission.id, `${mission.id}:run-2`);
  assert.equal(completions[1].mission.narrativeProgressDelta, 0);
  assert.equal(system.narrativeState.completedMissionIds.has(mission.id), true);
  assert.equal(system.narrativeState.chronologyStep, 1);
});

test('fallback congestion estimate is bounded and weights crashes above stopped traffic', () => {
  const app = appFixture();
  const system = createSystem(app);

  app.trafficSystem.vehicles = [
    { speed: 0, isParked: false },
    { speed: 5, isParked: false },
    { speed: 10, isParked: false, crashed: true },
    { speed: 0, isParked: true }
  ];
  assert.equal(system.estimateCongestion(), 0.75);

  app.trafficSystem.vehicles = [{ speed: 0, crashed: true }];
  assert.equal(system.estimateCongestion(), 1);
  app.trafficSystem.vehicles = [];
  assert.equal(system.estimateCongestion(), 0);
});
