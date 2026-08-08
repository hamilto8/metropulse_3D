import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILDING_CATALOG,
  BUILDING_CATEGORIES
} from '../../src/world/BuildingCatalog.js';
import {
  CATALOG_STAGES,
  PROGRESSION_TIERS
} from '../../src/world/ConstructionVocabulary.js';
import {
  DEFAULT_WEATHER_MODE,
  WEATHER_DEFINITIONS,
  WEATHER_SEQUENCE
} from '../../src/systems/Weather.js';
import {
  MISSION_WEATHER_POLICIES
} from '../../src/missions/MissionPolicyDefinitions.js';
import { VEHICLE_CONTENT_IDS } from '../../src/data/ContentDefinitions.js';
import {
  getPlayerVehiclePhysicsLayout,
  getVehicleProfile
} from '../../src/entities/VehicleProfiles.js';
import {
  PEDESTRIAN_ARCHETYPES,
  PEDESTRIAN_ARCHETYPE_SEQUENCE
} from '../../src/entities/PedestrianArchetypes.js';
import { PRESET_COORDINATES } from '../../src/camera/CameraPresets.js';
import {
  getSuspensionCableHeight,
  SUSPENSION_BRIDGE_LAYOUT
} from '../../src/world/SuspensionBridge.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, '../..');
const contentFixturePath = path.join(
  repositoryRoot,
  'test/fixtures/godot-port/phase0/content-registry.json'
);
const worldFixturePath = path.join(
  repositoryRoot,
  'test/fixtures/godot-port/phase0/world-landmarks.json'
);
const agentsFixturePath = path.join(
  repositoryRoot,
  'test/fixtures/godot-port/phase0/seeded-agents-navigation.json'
);
const outputDirectory = path.join(
  repositoryRoot,
  'godot/MetroPulse.Domain/Content/Data'
);
const sourceRevision = '44a286a74557adfe4fabd3a6e16b9006079eba32';

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

function stableStringify(value) {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function ids(records) {
  return records.map(record => record.id);
}

async function buildOutputs() {
  const [contentFixture, worldFixture, agentsFixture] = await Promise.all([
    readFile(contentFixturePath, 'utf8').then(JSON.parse),
    readFile(worldFixturePath, 'utf8').then(JSON.parse),
    readFile(agentsFixturePath, 'utf8').then(JSON.parse)
  ]);
  const referenceBuildings = contentFixture.data.records.buildings;
  const referenceWeather = contentFixture.data.records.weather;
  const sourceWeather = Object.values(WEATHER_DEFINITIONS);

  assert.equal(BUILDING_CATALOG.length, referenceBuildings.length, 'Building record count changed');
  assert.deepEqual(ids(BUILDING_CATALOG), ids(referenceBuildings), 'Building stable IDs changed');
  assert.deepEqual(
    normalize(BUILDING_CATALOG),
    normalize(referenceBuildings),
    'Building scalars differ from the frozen Phase 0 fixture'
  );

  assert.equal(sourceWeather.length, referenceWeather.length, 'Weather record count changed');
  assert.deepEqual(ids(sourceWeather), ids(referenceWeather), 'Weather stable IDs changed');
  assert.deepEqual(
    normalize(sourceWeather),
    normalize(referenceWeather),
    'Weather scalars differ from the frozen Phase 0 fixture'
  );

  const vehicleRecords = Object.fromEntries(VEHICLE_CONTENT_IDS.map(id => [id, {
    profile: getVehicleProfile(id),
    physicsLayout: getPlayerVehiclePhysicsLayout(id)
  }]));
  assert.deepEqual(
    VEHICLE_CONTENT_IDS,
    agentsFixture.data.vehicleContentIds,
    'Vehicle stable IDs differ from the frozen Phase 0 fixture'
  );
  for (const [id, reference] of Object.entries(worldFixture.data.vehicleProfiles)) {
    assert.deepEqual(
      normalize(vehicleRecords[id]),
      normalize(reference),
      `Vehicle profile ${id} differs from the frozen Phase 0 fixture`
    );
  }

  assert.deepEqual(
    PEDESTRIAN_ARCHETYPE_SEQUENCE,
    agentsFixture.data.pedestrianArchetypeSequence,
    'Pedestrian archetype sequence differs from the frozen Phase 0 fixture'
  );
  const referenceArchetypes = new Map();
  for (const pedestrian of agentsFixture.data.pedestrians) {
    const { archetype, profile } = pedestrian.descriptor;
    const existing = referenceArchetypes.get(archetype);
    if (existing) {
      assert.deepEqual(normalize(profile), normalize(existing), `Pedestrian archetype ${archetype} is inconsistent`);
    } else {
      referenceArchetypes.set(archetype, profile);
    }
  }
  assert.equal(
    Object.keys(PEDESTRIAN_ARCHETYPES).length,
    referenceArchetypes.size,
    'Pedestrian archetype count differs from the frozen Phase 0 fixture'
  );
  for (const [id, profile] of Object.entries(PEDESTRIAN_ARCHETYPES)) {
    assert.deepEqual(
      normalize(profile),
      normalize(referenceArchetypes.get(id)),
      `Pedestrian archetype ${id} differs from the frozen Phase 0 fixture`
    );
  }

  assert.deepEqual(
    normalize(PRESET_COORDINATES),
    normalize(worldFixture.data.cameraPresets),
    'Camera preset scalars differ from the frozen Phase 0 fixture'
  );
  const bridgeCableSamples = worldFixture.data.bridge.cableSamples.map(({ x }) => ({
    x,
    height: getSuspensionCableHeight(x)
  }));
  assert.deepEqual(
    normalize(SUSPENSION_BRIDGE_LAYOUT),
    normalize(worldFixture.data.bridge.layout),
    'Suspension bridge layout differs from the frozen Phase 0 fixture'
  );
  assert.deepEqual(
    normalize(bridgeCableSamples),
    normalize(worldFixture.data.bridge.cableSamples),
    'Suspension bridge cable samples differ from the frozen Phase 0 fixture'
  );

  return new Map([
    ['buildings.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      categories: BUILDING_CATEGORIES,
      catalogStages: CATALOG_STAGES,
      progressionTiers: PROGRESSION_TIERS,
      records: BUILDING_CATALOG
    })],
    ['weather.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      defaultMode: DEFAULT_WEATHER_MODE,
      sequence: WEATHER_SEQUENCE,
      records: sourceWeather
    })],
    ['mission-weather-policies.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      records: MISSION_WEATHER_POLICIES
    })],
    ['vehicle-profiles.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      contentIds: VEHICLE_CONTENT_IDS,
      records: vehicleRecords
    })],
    ['pedestrian-archetypes.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      sequence: PEDESTRIAN_ARCHETYPE_SEQUENCE,
      records: PEDESTRIAN_ARCHETYPES
    })],
    ['camera-presets.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      records: PRESET_COORDINATES
    })],
    ['suspension-bridge.json', stableStringify({
      schemaVersion: 1,
      sourceRevision,
      layout: SUSPENSION_BRIDGE_LAYOUT,
      cableSamples: bridgeCableSamples
    })]
  ]);
}

async function writeOutputs(outputs) {
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, content] of outputs) {
    await writeFile(path.join(outputDirectory, name), content, 'utf8');
  }
  return { ok: true, mode: 'write', files: [...outputs.keys()] };
}

async function checkOutputs(outputs) {
  const mismatches = [];
  for (const [name, expected] of outputs) {
    let actual = null;
    try {
      actual = await readFile(path.join(outputDirectory, name), 'utf8');
    } catch {
      // Missing output is reported through the same deterministic mismatch list.
    }
    if (actual !== expected) mismatches.push(name);
  }
  return { ok: mismatches.length === 0, mode: 'check', mismatches };
}

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
if (write === check) {
  throw new Error('Choose exactly one extraction mode: --write or --check');
}

const outputs = await buildOutputs();
const result = write ? await writeOutputs(outputs) : await checkOutputs(outputs);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
