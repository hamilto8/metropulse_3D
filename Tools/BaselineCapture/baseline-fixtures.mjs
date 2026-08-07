import * as THREE from 'three';

import {
  CONTROL_KINDS,
  GAME_STATE_POLICIES,
  GAME_STATE_TRANSITIONS,
  GAME_STATES,
  GameManager,
  getTransitionEffects
} from '../../src/core/GameManager.js';
import { CLOCK_POLICIES, GAME_STATE_VALUES } from '../../src/core/GameState.js';
import {
  SIMULATION_CLOCKS,
  SIMULATION_STAGES,
  SIMULATION_STAGE_ORDER,
  SimulationScheduler
} from '../../src/core/SimulationScheduler.js';
import { createSeededRandom } from '../../src/app/RuntimeConfig.js';
import {
  CONTENT_TYPES,
  PRODUCTION_GAME_DATA,
  validateGameData
} from '../../src/data/GameDataValidator.js';
import { WORLD_BOUNDS } from '../../src/data/ContentDefinitions.js';
import { EconomySystem } from '../../src/systems/EconomySystem.js';
import { runBalancedSession } from '../../src/systems/EconomyScenarioSimulator.js';
import {
  MissionLifecycleController,
  evaluateMissionWeather
} from '../../src/missions/MissionLifecycleController.js';
import { AlertService } from '../../src/alerts/AlertService.js';
import { SettingsStore } from '../../src/settings/SettingsStore.js';
import { createDefaultSettingsDocument } from '../../src/settings/SettingsSchema.js';
import { CONTROL_CONTEXTS } from '../../src/systems/ControlBindings.js';
import {
  createSaveDocument,
  inspectSaveDocument,
  migrateSaveDocument,
  validateSaveDocument
} from '../../src/save/SaveSchema.js';
import { captureGameState, validateGameState } from '../../src/save/SaveGameState.js';
import { TrafficSystem } from '../../src/systems/TrafficSystem.js';
import {
  TRAFFIC_NAVIGATION,
  enforceLaneCorridor,
  getNavigationSpeedLimit,
  hasReachedNavigationTarget,
  projectToNavigationSegment
} from '../../src/systems/TrafficNavigation.js';
import { Vehicle } from '../../src/entities/Vehicle.js';
import {
  createPedestrianDescriptor,
  PEDESTRIAN_ARCHETYPE_SEQUENCE
} from '../../src/entities/PedestrianArchetypes.js';
import { getVehicleProfile, getPlayerVehiclePhysicsLayout } from '../../src/entities/VehicleProfiles.js';
import { VEHICLE_CONTENT_IDS } from '../../src/data/ContentDefinitions.js';
import { PRESET_COORDINATES } from '../../src/camera/CameraPresets.js';
import {
  SUSPENSION_BRIDGE_LAYOUT,
  getSuspensionCableHeight
} from '../../src/world/SuspensionBridge.js';
import { CityBuilder } from '../../src/world/CityBuilder.js';

export const REFERENCE_REVISION = '44a286a74557adfe4fabd3a6e16b9006079eba32';
export const REFERENCE_CAPTURE_DATE = '2026-08-07';
export const REFERENCE_SEED = 'godot-port-phase-0';
export const FIXTURE_SCHEMA_VERSION = 1;

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)])
    );
  }
  return value;
}

export function stableStringify(value) {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function fixture(kind, data, comparison = { mode: 'exact' }) {
  return {
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    kind,
    reference: {
      application: 'MetroPulse 3D browser reference',
      revision: REFERENCE_REVISION,
      capturedOn: REFERENCE_CAPTURE_DATE,
      seed: REFERENCE_SEED,
      featureFlags: {
        aircraft: false,
        countrysideExpansion: false,
        eastSideDevelopment: false,
        mayhemVariants: false,
        persistentMayhem: false,
        rocketLaunch: false,
        temporaryMayhem: false
      }
    },
    comparison,
    data
  };
}

function context(overrides = {}) {
  return {
    missionActive: false,
    missionCritical: false,
    missionState: 'IDLE',
    handoffPending: false,
    controlledEntityCount: 0,
    controlledEntityKind: CONTROL_KINDS.NONE,
    heatActive: false,
    ...overrides
  };
}

function ownershipContext(from, to) {
  const relevant = to === GAME_STATES.PAUSED ? from : to;
  if (relevant === GAME_STATES.STREET_ON_FOOT) {
    return context({ controlledEntityCount: 1, controlledEntityKind: CONTROL_KINDS.PEDESTRIAN });
  }
  if (relevant === GAME_STATES.STREET_VEHICLE) {
    return context({ controlledEntityCount: 1, controlledEntityKind: CONTROL_KINDS.VEHICLE });
  }
  return context();
}

function captureGameStateFixture() {
  const transitions = [];
  for (const from of GAME_STATE_VALUES) {
    for (const to of GAME_STATE_VALUES) {
      const declaredLegal = from === to || GAME_STATE_TRANSITIONS[from].includes(to);
      let evaluation;
      if (from === GAME_STATES.TRANSITION) {
        evaluation = { allowed: false, code: 'TRANSITION_IN_PROGRESS' };
      } else {
        const manager = new GameManager({
          initialState: from,
          contextProvider: () => ownershipContext(from, to)
        });
        const result = manager.evaluateTransition(to);
        evaluation = {
          allowed: result.allowed,
          code: result.code,
          reason: result.reason
        };
      }
      transitions.push({
        from,
        to,
        declaredLegal,
        evaluation,
        effects: declaredLegal && from !== to && to !== GAME_STATES.TRANSITION
          ? getTransitionEffects(from, to)
          : null
      });
    }
  }
  return fixture('game-state', {
    states: GAME_STATE_VALUES,
    policies: GAME_STATE_POLICIES,
    requestedTransitions: GAME_STATE_TRANSITIONS,
    transitionMatrix: transitions
  });
}

function captureSchedulerFixture() {
  const taskOrder = [];
  const scheduler = new SimulationScheduler({
    fixedPhysicsStep: 0.1,
    cityStep: 1,
    maxFrameDelta: 1,
    maxPhysicsStepsPerFrame: 10,
    maxCityTicksPerFrame: 10,
    getCityTimeScale: () => 5,
    initialClockPolicy: CLOCK_POLICIES.CITY
  });
  for (const [index, stage] of SIMULATION_STAGE_ORDER.entries()) {
    scheduler.registerTask({
      id: `baseline:${stage}`,
      stage,
      order: index * 10,
      update: (delta, frame) => taskOrder.push({ frame: frame.frame, stage, delta })
    });
  }
  const frames = [0.06, 0.07, 0.87, 0.25].map(delta => ({
    delta,
    snapshot: scheduler.advanceFrame(delta)
  }));

  const policies = {};
  for (const policy of Object.values(CLOCK_POLICIES)) {
    const subject = new SimulationScheduler({
      fixedPhysicsStep: 0.1,
      cityStep: 1,
      maxFrameDelta: 1,
      getCityTimeScale: () => 15,
      initialClockPolicy: policy
    });
    policies[policy] = subject.advanceFrame(0.25);
  }
  return fixture('simulation-scheduler', {
    clocks: SIMULATION_CLOCKS,
    stages: SIMULATION_STAGES,
    stageOrder: SIMULATION_STAGE_ORDER,
    frames,
    taskOrder,
    policySnapshots: policies
  }, { mode: 'absolute', epsilon: 1e-9 });
}

function captureEconomyFixture() {
  const initial = new EconomySystem({
    initialTreasury: 650_000,
    passiveIncomeRate: 8,
    population: 1_200,
    happiness: 70,
    landValue: 100
  }).snapshot();
  const scenarios = Object.fromEntries(
    [15, 30, 60, 120].map(minutes => [minutes, runBalancedSession(minutes)])
  );

  const spending = new EconomySystem({ initialTreasury: 30_000, passiveIncomeRate: 0 });
  const spendingDecisions = {
    affordableEssential: spending.evaluateSpending(6_000, { source: 'incident-response' }),
    insufficientCapital: spending.evaluateSpending(40_000, { source: 'building-placement' }),
    reserveAtRisk: new EconomySystem({ initialTreasury: 30_000, passiveIncomeRate: 0 })
      .evaluateSpending(10_000, { source: 'building-placement', recurringCostRate: 2 })
  };

  const shortage = new EconomySystem({
    initialTreasury: 100_000,
    passiveIncomeRate: 100,
    happiness: 80,
    landValue: 200,
    services: {
      power: { capacity: 50, demand: 100 },
      water: { capacity: 25, demand: 100 },
      fire: { capacity: 0, demand: 100 }
    }
  });
  shortage.registerBuilding({
    id: 'baseline-amenity',
    position: { x: 0, z: 0 },
    amenityRadius: 100,
    landValueModifier: 20
  });
  shortage.recordIncident({
    id: 'baseline-incident',
    position: { x: 0, z: 0 },
    influenceRadius: 50,
    landValueModifier: -30
  });
  const landValueQueries = [
    [0, 0], [25, 0], [75, 0], [100, 0]
  ].map(([x, z]) => shortage.getLandValueBreakdownAt(x, z));

  return fixture('economy', {
    initial,
    scenarios,
    spendingDecisions,
    serviceShortage: shortage.snapshot(),
    landValueQueries
  }, { mode: 'absolute', epsilon: 1e-9 });
}

function validationFailure(mutator) {
  const input = structuredClone(PRODUCTION_GAME_DATA);
  mutator(input);
  try {
    validateGameData(input);
    return { accepted: true };
  } catch (error) {
    return {
      accepted: false,
      name: error.name,
      code: error.code,
      source: error.source,
      recordId: error.recordId,
      field: error.field,
      path: error.path,
      message: error.message
    };
  }
}

function captureContentFixture() {
  const registry = validateGameData();
  const records = {};
  for (const type of Object.values(CONTENT_TYPES)) {
    records[type] = registry.ids(type).map(id => registry.get(type, id));
  }
  return fixture('content-registry', {
    counts: registry.counts,
    records,
    scope: PRODUCTION_GAME_DATA.scope,
    vehicleIds: PRODUCTION_GAME_DATA.vehicleIds,
    worldBounds: WORLD_BOUNDS,
    validationFailures: {
      duplicateBuilding: validationFailure(data => data.buildings.push(structuredClone(data.buildings[0]))),
      missingDistrict: validationFailure(data => { data.missions[0].pickup.districtId = 'REMOVED_DISTRICT'; }),
      invalidMissionType: validationFailure(data => { data.missions[0].missionType = 'TELEPORT'; }),
      impossibleCoordinate: validationFailure(data => { data.missions[0].pickup.x = 100_000; }),
      circularProgression: validationFailure(data => { data.progression[0].prerequisiteIds = ['MAGNATE']; })
    }
  });
}

function syntheticMission(overrides = {}) {
  return {
    id: 'mission-alpha',
    title: 'Alpha Run',
    missionType: 'DELIVERY',
    prerequisites: [],
    weatherPolicy: 'STANDARD_ROAD',
    ...overrides
  };
}

function beginMission(controller, missionId = 'mission-alpha') {
  const phases = [];
  const unsubscribe = controller.subscribe(event => {
    if (event.type === 'PHASE_CHANGED') phases.push(event.current.phase);
  });
  controller.prepare(missionId);
  controller.beginBriefing();
  controller.accept({ baseTimeLimit: 60, baseReward: 500 });
  controller.beginExecution();
  return { phases, unsubscribe };
}

function captureMissionFixture() {
  const availabilityController = new MissionLifecycleController({
    missions: [syntheticMission(), syntheticMission({
      id: 'mission-beta',
      title: 'Beta Run',
      prerequisites: ['mission-alpha']
    })],
    weatherProvider: () => 'clear'
  });
  const availability = {
    alpha: availabilityController.evaluateAvailability('mission-alpha'),
    betaLocked: availabilityController.evaluateAvailability('mission-beta'),
    missing: availabilityController.evaluateAvailability('missing-mission'),
    weather: Object.fromEntries(
      ['clear', 'mist', 'rain', 'thunderstorm'].map(weather => [
        weather,
        evaluateMissionWeather(syntheticMission(), weather)
      ])
    )
  };

  const successController = new MissionLifecycleController({ missions: [syntheticMission()] });
  const successTrace = beginMission(successController);
  successController.resolveSuccess({ payout: 650, summary: 'Delivered.' });
  successController.beginCleanup();
  const transaction = successController.createOutcomeTransaction();
  const receipt = {
    transactionId: transaction.transactionId,
    duplicate: false,
    effects: [],
    summary: transaction.summary
  };
  successController.commitCleanup(receipt);
  const committedResult = successController.snapshot();
  successController.beginRecovery();
  successController.finishRecovery();
  successTrace.unsubscribe();

  const raceController = new MissionLifecycleController({
    missions: [syntheticMission({ missionType: 'RACE' })]
  });
  beginMission(raceController).unsubscribe();
  raceController.recordCheckpoint('race:checkpoint-2', { routeIndex: 2, timeRemaining: 31 });
  raceController.resumeFromCheckpoint();
  raceController.resolveFailure('race_lost', { summary: 'Finished behind the rival.' });
  raceController.beginCleanup();
  const raceTransaction = raceController.createOutcomeTransaction();
  raceController.commitCleanup({
    transactionId: raceTransaction.transactionId,
    duplicate: false,
    effects: [],
    summary: raceTransaction.summary
  });

  const production = new MissionLifecycleController({
    missions: PRODUCTION_GAME_DATA.missions,
    conditionService: { evaluate: () => ({ passed: false }) },
    weatherProvider: () => 'clear'
  });
  const productionAvailability = PRODUCTION_GAME_DATA.missions.map(mission => ({
    missionId: mission.id,
    missionType: mission.missionType,
    clear: production.evaluateAvailability(mission.id, { weatherMode: 'clear' }),
    rain: production.evaluateAvailability(mission.id, { weatherMode: 'rain' })
  }));

  return fixture('missions', {
    availability,
    productionAvailability,
    success: {
      phases: successTrace.phases,
      transaction,
      receipt,
      committedResult,
      recovered: successController.snapshot()
    },
    retry: {
      failedResult: raceController.snapshot(),
      decision: raceController.getRetryDecision()
    }
  });
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function captureSettingsAlertsFixture() {
  const storage = new MemoryStorage();
  const settings = new SettingsStore({ storage });
  settings.load();
  const defaults = settings.snapshot();
  settings.set('textScale', 1.25);
  settings.set('cameraSensitivity.vehicle', 1.4);
  settings.setBinding(CONTROL_CONTEXTS.VEHICLE, 'INTERACT', 'KeyG');
  let reservedBindingError;
  try {
    settings.setBinding(CONTROL_CONTEXTS.VEHICLE, 'INTERACT', 'F5');
  } catch (error) {
    reservedBindingError = { name: error.name, message: error.message };
  }

  let nowIndex = 0;
  const times = [
    '2026-08-07T12:00:00.000Z',
    '2026-08-07T12:00:01.000Z',
    '2026-08-07T12:00:02.000Z'
  ];
  const alerts = new AlertService({
    now: () => new Date(times[Math.min(nowIndex++, times.length - 1)]),
    idFactory: () => `baseline-alert-${nowIndex}`
  });
  const alertInput = {
    dedupeKey: 'baseline:bridge',
    type: 'INFRASTRUCTURE',
    severity: 'WARNING',
    title: 'Bridge lane obstructed',
    cause: 'A disabled vehicle blocks one lane.',
    location: { label: 'Primary bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR', position: { x: 160, y: 0, z: 0 } },
    duration: { kind: 'UNTIL_RESOLVED' },
    recommendation: 'Clear the vehicle or enable bridge priority.',
    relatedEntityIds: ['baseline-disabled-vehicle'],
    focusAction: { type: 'MANAGEMENT_CAMERA' }
  };
  const first = alerts.publish(alertInput);
  const duplicate = alerts.publish({ ...alertInput, cause: 'Two reports confirm the same obstruction.' });
  const active = alerts.snapshot();
  const resolved = alerts.resolve(first.id, 'The disabled vehicle was cleared.');

  return fixture('settings-bindings-alerts', {
    defaults,
    defaultDocument: createDefaultSettingsDocument(),
    customized: settings.snapshot(),
    vehicleInteractLabel: settings.getActionLabel(CONTROL_CONTEXTS.VEHICLE, 'INTERACT'),
    reservedBindingError,
    alerts: { first, duplicate, active, resolved, serialized: alerts.serialize() }
  });
}

function createTrafficGraph() {
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.nodes = new Map();
  traffic.roadCoordsX = [-100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750];
  traffic.roadCoordsZ = [-100, -50, 0, 50, 100];
  traffic.laneOffset = 3.5;
  traffic.initWaypoints();
  return traffic;
}

function captureWorldFixture() {
  const traffic = createTrafficGraph();
  const nodes = [...traffic.nodes.values()]
    .map(node => ({ id: node.id, position: node.pos.toArray(), next: node.nextNodes.map(next => next.id).sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = nodes.flatMap(node => node.next.map(to => ({ from: node.id, to })))
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`));

  const terrain = Object.create(CityBuilder.prototype);
  terrain.app = null;
  terrain.drivableDecks = [];
  terrain.surfaceColliders = [];
  terrain.sceneryColliders = [];
  const terrainPoints = [
    [-190, -390], [0, 0], [160, 0], [420, -100], [500, 75],
    [650, 0], [700, -200], [810, 390]
  ].map(([x, z]) => ({ x, z, height: terrain.getHillHeight(x, z) }));

  const cableSamples = [110, 124, 138, 150, 160, 170, 182, 196, 210]
    .map(x => ({ x, height: getSuspensionCableHeight(x) }));
  const selectedVehicleProfiles = Object.fromEntries(
    ['SEDAN', 'SPORTS', 'SPORTS_CAR', 'BUS', 'TRUCK', 'MOTORBIKE'].map(type => [type, {
      profile: getVehicleProfile(type),
      physicsLayout: getPlayerVehiclePhysicsLayout(type)
    }])
  );

  return fixture('world-landmarks', {
    roadGraph: { nodeCount: nodes.length, edgeCount: edges.length, nodes, edges },
    bridge: { layout: SUSPENSION_BRIDGE_LAYOUT, cableSamples },
    terrainSamples: terrainPoints,
    cameraPresets: PRESET_COORDINATES,
    vehicleProfiles: selectedVehicleProfiles,
    navigationConstants: TRAFFIC_NAVIGATION
  }, { mode: 'absolute', epsilon: 1e-6, positionToleranceMeters: 0.01 });
}

function captureAgentsFixture() {
  const pedestrianRandom = createSeededRandom(`${REFERENCE_SEED}:pedestrians`);
  const pedestrians = Array.from({ length: 12 }, (_, serial) => ({
    serial,
    descriptor: createPedestrianDescriptor(serial, pedestrianRandom)
  }));

  const vehicleRandom = createSeededRandom(`${REFERENCE_SEED}:vehicles`);
  const previousRandom = Math.random;
  Math.random = vehicleRandom;
  let traffic;
  try {
    traffic = new TrafficSystem({
      sceneManager: { scene: new THREE.Scene() },
      inspectorHud: null,
      physicsWorld: null
    }, { targetMovingVehicleCount: 8 });
  } finally {
    Math.random = previousRandom;
  }
  const vehicles = traffic.vehicles
    .filter(vehicle => !vehicle.isParked)
    .map((vehicle, serial) => ({
      serial,
      type: vehicle.vType,
      name: vehicle.name,
      color: vehicle.mesh?.userData?.color ?? null,
      position: vehicle.mesh.position.toArray(),
      rotationY: vehicle.mesh.rotation.y,
      speed: vehicle.speed,
      currentNode: vehicle.currentNode?.id ?? null,
      targetNode: vehicle.targetNode?.id ?? null,
      driverRuleProfile: vehicle.driverRuleProfile
    }));

  const subject = new Vehicle('SEDAN', 0x3366cc, 'Navigation Baseline');
  subject.currentNode = { id: 'start', pos: new THREE.Vector3(0, 0, 0), nextNodes: [] };
  subject.targetNode = { id: 'target', pos: new THREE.Vector3(0, 0, 20), nextNodes: [] };
  const navigationSteps = [
    [7, 10], [4, 14], [1, 19], [0.5, 24]
  ].map(([x, z]) => {
    subject.mesh.position.set(x, 0, z);
    const before = projectToNavigationSegment(subject.mesh.position, subject.currentNode, subject.targetNode);
    const corrected = enforceLaneCorridor(subject);
    return {
      input: { x, z },
      before,
      corrected,
      output: subject.mesh.position.toArray(),
      reached: hasReachedNavigationTarget(subject),
      speedLimit: getNavigationSpeedLimit(subject)
    };
  });

  return fixture('seeded-agents-navigation', {
    pedestrianArchetypeSequence: PEDESTRIAN_ARCHETYPE_SEQUENCE,
    pedestrians,
    vehicleContentIds: VEHICLE_CONTENT_IDS,
    vehicles,
    navigationSteps
  }, { mode: 'absolute', epsilon: 1e-6, positionToleranceMeters: 0.01 });
}

function createControlledVehicle(type = 'SEDAN') {
  const mesh = new THREE.Group();
  mesh.position.set(12, 0.5, -8);
  mesh.rotation.set(0, Math.PI / 4, 0);
  return {
    persistenceId: 'baseline-controlled-vehicle',
    vType: type,
    speed: 12.5,
    mesh
  };
}

function createSaveApp({ state = GAME_STATES.MANAGEMENT, controlledVehicle = null, lifecycle = null } = {}) {
  const settingsStore = new SettingsStore({ storage: null });
  settingsStore.load();
  const alertService = new AlertService({
    now: () => new Date('2026-08-07T12:00:00.000Z'),
    idFactory: () => 'baseline-save-alert'
  });
  const missionSystem = {
    narrativeState: { completedMissionIds: new Set(), dialogueChoices: [], chronologyStep: 0 },
    missionRunCounts: new Map(),
    activeMission: lifecycle?.currentMission ?? null,
    activeVehicle: lifecycle?.phase === 'RESULT' ? controlledVehicle : null,
    lifecycle: lifecycle ?? null,
    timeRemaining: 42,
    initialTimeLimit: 60,
    basePayout: 500,
    payout: 500,
    routeIndex: 0,
    raceElapsed: 0,
    sabotageProgress: 0,
    sabotageActive: false
  };
  return {
    settingsStore,
    alertService,
    settings: settingsStore.getSettings(),
    trafficHeatmapEnabled: false,
    gameManager: {
      snapshot: () => ({ state, resumeState: null, mayhemEnabled: false })
    },
    economySystem: new EconomySystem({ initialTreasury: 650_000, passiveIncomeRate: 8 }),
    cityEditorSystem: {
      serializeWorldEdits: () => ({ version: 1, buildings: [], zones: [] })
    },
    timeManager: { timeVal: 9.25, isPlaying: true, speed: 1 },
    environment: { weatherMode: 'clear' },
    missionSystem,
    pedestrianSystem: { isWanted: false, escapeTimer: 0, activeCrimeIncidentId: null },
    trafficSystem: controlledVehicle
      ? { controlledVehicle, vehicles: [controlledVehicle] }
      : { controlledVehicle: null, vehicles: [] }
  };
}

function saveDocument(app, saveId, reason) {
  const data = captureGameState(app);
  validateGameState(data);
  return createSaveDocument(data, {
    now: () => new Date('2026-08-07T12:00:00.000Z'),
    idFactory: () => saveId,
    reason,
    reasons: [reason]
  });
}

function captureSaveFixtures() {
  const valid = saveDocument(createSaveApp(), 'phase0-valid', 'phase0-reference');
  const recovery = structuredClone(valid);
  recovery.metadata.saveId = 'phase0-recovery';
  recovery.metadata.reason = 'recovery-reference';
  recovery.metadata.reasons = ['recovery-reference'];

  const controlledVehicle = createControlledVehicle();
  const controlled = saveDocument(
    createSaveApp({ state: GAME_STATES.STREET_VEHICLE, controlledVehicle }),
    'phase0-controlled-entity',
    'controlled-entity-reference'
  );

  const mission = syntheticMission({ id: 'mission_executive', title: 'Executive Pickup', missionType: 'TAXI' });
  const activeLifecycle = new MissionLifecycleController({ missions: [mission] });
  beginMission(activeLifecycle, mission.id).unsubscribe();
  const midMission = saveDocument(
    createSaveApp({ state: GAME_STATES.STREET_VEHICLE, controlledVehicle, lifecycle: activeLifecycle }),
    'phase0-mid-mission',
    'mission-checkpoint'
  );

  const resultLifecycle = new MissionLifecycleController({ missions: [mission] });
  beginMission(resultLifecycle, mission.id).unsubscribe();
  resultLifecycle.resolveSuccess({ payout: 500, summary: 'Passenger delivered.' });
  resultLifecycle.beginCleanup();
  const transaction = resultLifecycle.createOutcomeTransaction();
  resultLifecycle.commitCleanup({
    transactionId: transaction.transactionId,
    duplicate: false,
    effects: [],
    summary: transaction.summary
  });
  const result = saveDocument(
    createSaveApp({ state: GAME_STATES.RESULT, controlledVehicle, lifecycle: resultLifecycle }),
    'phase0-result',
    'mission-result'
  );

  const schema0 = structuredClone(valid);
  schema0.schemaVersion = 0;
  schema0.featureVersion = 1;
  const schema1 = structuredClone(valid);
  schema1.schemaVersion = 1;
  schema1.featureVersion = 1;
  const future = structuredClone(valid);
  future.schemaVersion = 99;
  const corrupt = structuredClone(valid);
  delete corrupt.data.economy;

  const documents = { valid, recovery, controlled, midMission, result, schema0, schema1, future, corrupt };
  const inspection = Object.fromEntries(
    Object.entries(documents).map(([name, document]) => [
      name,
      inspectSaveDocument(document, name === 'recovery' ? 'recovery' : 'current', {
        validateDomains: validateGameState
      })
    ])
  );
  const migrations = {
    schema0ToCurrent: migrateSaveDocument(schema0),
    schema1ToCurrent: migrateSaveDocument(schema1)
  };
  validateSaveDocument(valid, { validateDomains: validateGameState });
  validateSaveDocument(controlled, { validateDomains: validateGameState });
  validateSaveDocument(midMission, { validateDomains: validateGameState });
  validateSaveDocument(result, { validateDomains: validateGameState });

  return { documents, inspection, migrations };
}

export function buildFixtureValues() {
  const saves = captureSaveFixtures();
  return new Map([
    ['game-state.json', captureGameStateFixture()],
    ['simulation-scheduler.json', captureSchedulerFixture()],
    ['economy.json', captureEconomyFixture()],
    ['content-registry.json', captureContentFixture()],
    ['missions.json', captureMissionFixture()],
    ['settings-bindings-alerts.json', captureSettingsAlertsFixture()],
    ['world-landmarks.json', captureWorldFixture()],
    ['seeded-agents-navigation.json', captureAgentsFixture()],
    ['save-valid.json', fixture('save-valid', saves.documents.valid)],
    ['save-recovery.json', fixture('save-recovery', saves.documents.recovery)],
    ['save-controlled-entity.json', fixture('save-controlled-entity', saves.documents.controlled)],
    ['save-mid-mission.json', fixture('save-mid-mission', saves.documents.midMission)],
    ['save-result.json', fixture('save-result', saves.documents.result)],
    ['save-schema-0.json', fixture('save-schema-0', saves.documents.schema0)],
    ['save-schema-1.json', fixture('save-schema-1', saves.documents.schema1)],
    ['save-future.json', fixture('save-future', saves.documents.future)],
    ['save-corrupt.json', fixture('save-corrupt', saves.documents.corrupt)],
    ['save-inspection-migrations.json', fixture('save-inspection-migrations', {
      inspection: saves.inspection,
      migrations: saves.migrations
    })]
  ]);
}

export function buildFixtureFiles() {
  return new Map(
    [...buildFixtureValues()].map(([name, value]) => [name, stableStringify(value)])
  );
}
