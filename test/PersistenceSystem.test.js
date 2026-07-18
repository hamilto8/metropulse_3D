import test from 'node:test';
import assert from 'node:assert/strict';

import { SaveService, SAVE_STATUS } from '../src/save/SaveService.js';
import {
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  SaveValidationError,
  convertLegacyV1Save,
  createSaveDocument,
  validateSaveDocument
} from '../src/save/SaveSchema.js';
import {
  captureGameState,
  restoreStaticGameState,
  restoreWorld,
  validateGameState
} from '../src/save/SaveGameState.js';
import { DISTRICT_DEFINITIONS } from '../src/data/ContentDefinitions.js';
import { getProductionContentRegistry } from '../src/data/GameDataValidator.js';
import {
  MISSION_OUTCOME_COMMANDS,
  MissionOutcomeService
} from '../src/missions/MissionOutcomeService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';

class MemoryRepository {
  constructor(current = null) {
    this.current = current;
    this.recovery = null;
    this.failWrites = false;
    this.commits = [];
  }

  async commitCurrent(value) {
    if (this.failWrites) throw new Error('interrupted transaction');
    if (this.current != null) this.recovery = structuredClone(this.current);
    this.current = structuredClone(value);
    this.commits.push(structuredClone(value));
    return value;
  }

  async clearCurrent({ preserveAsRecovery = true } = {}) {
    if (preserveAsRecovery && this.current) this.recovery = structuredClone(this.current);
    this.current = null;
  }
}

function createAppHarness() {
  const calls = [];
  const app = {
    settings: { textScale: 1 },
    trafficHeatmapEnabled: false,
    gameManager: {
      snapshot: () => ({ state: 'MANAGEMENT', resumeState: null, mayhemEnabled: false }),
      subscribe: () => () => {},
      setMayhem(value) { calls.push(['mayhem', value]); }
    },
    economySystem: {
      serialize: () => ({ version: 1 }),
      subscribe: () => () => {},
      restore(value) { calls.push(['economy', value]); }
    },
    cityEditorSystem: {
      serializeWorldEdits: () => ({ version: 1, buildings: [], zones: [] }),
      restoreZoneParcels(values) { calls.push(['zones', values]); }
    },
    timeManager: {
      timeVal: 8,
      isPlaying: true,
      speed: 10,
      setTime(value) { calls.push(['time', value]); },
      setPlaying(value) { calls.push(['playing', value]); },
      setSpeed(value) { calls.push(['speed', value]); }
    },
    environment: {
      weatherMode: 'clear',
      setWeather(value) { calls.push(['weather', value]); },
      setDynamicWeather(value) { calls.push(['dynamic-weather', value]); }
    },
    missionSystem: {
      narrativeState: { completedMissionIds: new Set(), dialogueChoices: [], chronologyStep: 0 },
      missionRunCounts: new Map(),
      activeMission: null
    },
    pedestrianSystem: { isWanted: false, escapeTimer: 0, activeCrimeIncidentId: null },
    inputManager: {},
    trafficHeatmapSystem: { setVisible(value) { calls.push(['heatmap', value]); } },
    uiManager: {}
  };
  return { app, calls };
}

function validData() {
  const { app } = createAppHarness();
  const service = new SaveService(app, {
    repository: new MemoryRepository(),
    windowRef: null,
    documentRef: null,
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => 'fixture-save'
  });
  const data = service.createSnapshot().data;
  service.destroy();
  return data;
}

test('save envelope versions storage schema independently from feature versions', () => {
  const document = createSaveDocument(validData(), {
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => 'save-1'
  });
  assert.equal(document.format, SAVE_FORMAT);
  assert.equal(document.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(document.featureVersion, 1);
  assert.equal(document.data.economy.version, 1);
  assert.equal(document.metadata.saveId, 'save-1');
});

test('schema migrations run forward and future saves fail with a player-facing error', () => {
  const current = createSaveDocument(validData(), { idFactory: () => 'save-current' });
  const old = { ...current, schemaVersion: 0 };
  const migrated = validateSaveDocument(old, { validateDomains: validateGameState });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.metadata.migratedFromSchema, 0);

  assert.throws(
    () => validateSaveDocument({ ...current, schemaVersion: 99 }),
    error => error instanceof SaveValidationError
      && error.code === 'FUTURE_SAVE_VERSION'
      && /newer MetroPulse/.test(error.userMessage)
  );
});

test('LocalStorage v1 converts once into the complete P2.2 domain envelope', () => {
  const migrated = convertLegacyV1Save({
    version: 1,
    savedAt: '2026-07-17T09:30:00.000Z',
    economy: { version: 1 },
    world: { version: 1, buildings: [], zones: [] },
    mission: { completedMissionIds: ['mission_executive'], dialogueChoices: [], chronologyStep: 1, runCounts: [] },
    settings: { time: 15, weather: 'rain', mayhem: true }
  });
  assert.equal(migrated.metadata.migratedFrom, 'localStorage-v1');
  assert.equal(migrated.data.timeWeather.weather, 'rain');
  assert.equal(migrated.data.game.mayhemEnabled, true);
  assert.deepEqual(Object.keys(migrated.data), [
    'game', 'economy', 'world', 'player', 'timeWeather', 'missions',
    'factions', 'progression', 'heat', 'settings', 'bindings', 'alerts'
  ]);
});

test('transactional save rotates the prior known-good document into recovery', async () => {
  const previous = createSaveDocument(validData(), { idFactory: () => 'previous' });
  const repository = new MemoryRepository(previous);
  const { app } = createAppHarness();
  const service = new SaveService(app, {
    repository,
    windowRef: null,
    documentRef: null,
    now: () => new Date('2026-07-18T13:00:00.000Z'),
    idFactory: () => 'current'
  });

  assert.equal(await service.saveNow({ reason: 'manual' }), true);
  assert.equal(repository.current.metadata.saveId, 'current');
  assert.equal(repository.recovery.metadata.saveId, 'previous');
  assert.equal(service.getStatus().status, SAVE_STATUS.SAVED);
  service.destroy();
});

test('an interrupted write reports failure without destroying either valid slot', async () => {
  const previous = createSaveDocument(validData(), { idFactory: () => 'previous' });
  const recovery = createSaveDocument(validData(), { idFactory: () => 'recovery' });
  const repository = new MemoryRepository(previous);
  repository.recovery = recovery;
  repository.failWrites = true;
  const before = structuredClone({ current: repository.current, recovery: repository.recovery });
  const { app } = createAppHarness();
  const service = new SaveService(app, { repository, windowRef: null, documentRef: null });

  assert.equal(await service.saveNow(), false);
  assert.deepEqual({ current: repository.current, recovery: repository.recovery }, before);
  assert.equal(service.getStatus().status, SAVE_STATUS.ERROR);
  assert.match(service.getStatus().error, /interrupted transaction/);
  service.destroy();
});

test('autosave reasons coalesce and checkpoints are recorded in metadata', async () => {
  const repository = new MemoryRepository();
  const { app } = createAppHarness();
  const service = new SaveService(app, { repository, debounceMs: 60_000, windowRef: null, documentRef: null });
  service.scheduleSave('economy-change');
  service.scheduleSave('world-edit');
  assert.equal(await service.saveCheckpoint('mission_executive:dropoff'), true);
  assert.deepEqual(repository.current.metadata.reasons.sort(), ['checkpoint', 'economy-change', 'world-edit']);
  assert.equal(repository.current.metadata.checkpoint, 'mission_executive:dropoff');
  service.destroy();
});

test('the whole document is validated before any live domain is mutated', () => {
  const { app, calls } = createAppHarness();
  const service = new SaveService(app, { repository: new MemoryRepository(), windowRef: null, documentRef: null });
  const document = createSaveDocument(validData());
  document.data.world.buildings.push({
    economyId: 'ghost',
    specId: 'REMOVED_SPEC',
    plot: { x: 0, z: 0 },
    rotationY: 0
  });

  assert.equal(service.restore(document), false);
  assert.deepEqual(calls, []);
  assert.equal(service.getStatus().status, SAVE_STATUS.ERROR);
  service.destroy();
});

test('condition/consequence receipts and derived faction views survive save validation and restore', () => {
  const contentRegistry = getProductionContentRegistry();
  const source = createAppHarness().app;
  source.economySystem = new EconomySystem({ initialTreasury: 500 });
  source.missionOutcomeService = new MissionOutcomeService({
    economySystem: source.economySystem,
    contentRegistry,
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  source.missionOutcomeService.apply({
    transactionId: 'mission:save-contract:success',
    source: { kind: 'MISSION', contentId: 'mission_executive', outcome: 'SUCCESS' },
    summary: { title: 'Saved outcome', description: 'A durable consequence fixture.' },
    commands: [
      { type: MISSION_OUTCOME_COMMANDS.CAPITAL_ADJUSTED, amount: 50 },
      { type: MISSION_OUTCOME_COMMANDS.FACTION_REPUTATION_ADJUSTED, factionId: 'RESIDENTS', delta: 4 },
      { type: MISSION_OUTCOME_COMMANDS.PROGRESSION_SET, progressionId: 'OPERATOR', unlocked: true },
      { type: MISSION_OUTCOME_COMMANDS.AUTHORED_FLAG_SET, flagId: 'save.contract.applied', value: true }
    ]
  });

  const data = captureGameState(source);
  assert.equal(validateGameState(data, { contentRegistry }), true);
  assert.equal(data.economy.treasury, 550);
  assert.deepEqual(data.factions.values, { RESIDENTS: 4 });
  assert.deepEqual(data.progression.values, { OPERATOR: true });

  const target = createAppHarness().app;
  target.economySystem = new EconomySystem();
  target.missionOutcomeService = new MissionOutcomeService({
    economySystem: target.economySystem,
    contentRegistry,
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  restoreStaticGameState(target, data);
  assert.equal(target.economySystem.treasury, 550);
  assert.equal(target.missionOutcomeService.hasApplied('mission:save-contract:success'), true);
  assert.equal(target.missionOutcomeService.snapshot().flags['save.contract.applied'].value, true);

  const mismatched = structuredClone(data);
  mismatched.factions.values.RESIDENTS = 5;
  assert.throws(
    () => validateGameState(mismatched, { contentRegistry }),
    /authoritative mission outcome faction view/
  );
});

test('save validation rejects incompatible content references before load', () => {
  const cases = [
    {
      path: 'save.data.timeWeather.weather',
      mutate: data => { data.timeWeather.weather = 'toxic_snow'; }
    },
    {
      path: 'save.data.missions.completedMissionIds[0]',
      mutate: data => { data.missions.completedMissionIds = ['mission_removed']; }
    },
    {
      path: 'save.data.missions.dialogueChoices[0].nodeId',
      mutate: data => {
        data.missions.dialogueChoices = [{
          missionId: 'mission_executive',
          nodeId: 'removed_node',
          choice: 'Accept',
          next: 'accept_standard'
        }];
      }
    },
    {
      path: 'save.data.world.zones[0].zoneType',
      mutate: data => {
        data.world.zones = [{
          key: '0,0', x: 0, z: 0, zoneType: 'REMOVED_ZONE',
          happinessModifier: 0, landValueModifier: 0
        }];
      }
    },
    {
      path: 'save.data.factions.values.REMOVED_FACTION',
      mutate: data => { data.factions.values = { REMOVED_FACTION: 10 }; }
    },
    {
      path: 'save.data.progression.values.REMOVED_TIER',
      mutate: data => { data.progression.values = { REMOVED_TIER: true }; }
    }
  ];

  for (const fixture of cases) {
    const data = validData();
    fixture.mutate(data);
    assert.throws(
      () => validateGameState(data),
      error => error instanceof SaveValidationError
        && error.path === fixture.path
        && /unknown|removed/i.test(error.message),
      fixture.path
    );
  }
});

function createWorldHarness({ valid = true } = {}) {
  const calls = [];
  const app = {
    economySystem: { removeBuilding(id) { calls.push(['economy-remove', id]); } },
    cityBuilder: {
      getHillHeight() { return 2; },
      removeCountrysideSceneryOverlapping(rect) { calls.push(['clear-scenery', rect]); return [{}]; }
    },
    cityEditorSystem: {
      getPlacementRect(x, z) { return { minX: x - 22, maxX: x + 22, minZ: z - 22, maxZ: z + 22 }; },
      isPlacementValid() { return valid; },
      restoreZoneParcels() {}
    },
    buildingFactory: {
      placeUserBuilding(plot, spec, rotationY) {
        calls.push(['place', plot, spec.id, rotationY]);
        return { plot: { ...plot }, group: { rotation: { y: rotationY } } };
      }
    }
  };
  return { app, calls };
}

const savedWorld = {
  version: 1,
  buildings: [{ economyId: 'saved-tower-1', specId: 'NEOTECH_HQ', plot: { x: 500, z: 25 }, rotationY: 0 }],
  zones: []
};

test('world adapter restores valid stable IDs and skips regenerated overlaps safely', () => {
  const valid = createWorldHarness();
  assert.deepEqual(restoreWorld(valid.app, savedWorld), {
    restoredBuildings: 1,
    skippedBuildings: 0,
    clearedScenery: 1
  });
  assert.deepEqual(valid.calls.map(call => call[0]), ['place', 'clear-scenery']);

  const blocked = createWorldHarness({ valid: false });
  assert.deepEqual(restoreWorld(blocked.app, savedWorld), {
    restoredBuildings: 0,
    skippedBuildings: 1,
    clearedScenery: 0
  });
  assert.deepEqual(blocked.calls, [['economy-remove', 'saved-tower-1']]);
});

test('static restore intentionally restarts dynamic weather after persisted time and weather', () => {
  const { app, calls } = createAppHarness();
  app.buildingFactory = { placeUserBuilding() {} };
  app.cityBuilder = {};
  const data = validData();
  data.timeWeather = { version: 1, time: 9, playing: true, speed: 15, weather: 'rain' };
  restoreStaticGameState(app, data);
  assert.deepEqual(calls.slice(1, 6), [
    ['zones', []],
    ['time', 9],
    ['playing', true],
    ['speed', 15],
    ['weather', 'rain']
  ]);
  assert.ok(calls.some(call => call[0] === 'dynamic-weather' && call[1] === true));
});
