import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PRESET_COORDINATES } from '../../src/camera/CameraPresets.js';
import { DISTRICT_DEFINITIONS } from '../../src/data/ContentDefinitions.js';
import { MVP_MISSION_IDS, MVP_WORLD_FOOTPRINT } from '../../src/config/MvpScope.js';
import {
  getSuspensionCableHeight,
  SUSPENSION_BRIDGE_LAYOUT
} from '../../src/world/SuspensionBridge.js';
import { STREET_LAMP_ROADS } from '../../src/world/StreetFurnitureLayout.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, '../..');
const outputPath = path.join(repositoryRoot, 'test/fixtures/godot-port/phase4/world-landmarks.json');
const cityBuilderPath = path.join(repositoryRoot, 'src/world/CityBuilder.js');
const missionsPath = path.join(repositoryRoot, 'src/data/missions.json');
const phaseZeroPath = path.join(repositoryRoot, 'test/fixtures/godot-port/phase0/world-landmarks.json');
const sourceRevision = '44a286a74557adfe4fabd3a6e16b9006079eba32';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function sourceArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\[[^;]+\\]);`));
  assert.ok(match, `CityBuilder source is missing ${name}`);
  return JSON.parse(match[1]);
}

function sourceNumber(source, name) {
  const match = source.match(new RegExp(`const ${name} = (-?\\d+(?:\\.\\d+)?);`));
  assert.ok(match, `CityBuilder source is missing ${name}`);
  return Number(match[1]);
}

function sourceParkCenter(source) {
  const match = source.match(/const parkCenter = \{ x: (-?\d+(?:\.\d+)?), z: (-?\d+(?:\.\d+)?) \};/);
  assert.ok(match, 'CityBuilder source is missing parkCenter');
  return { x: Number(match[1]), z: Number(match[2]) };
}

async function buildFixture() {
  const [cityBuilder, missions, phaseZero] = await Promise.all([
    readFile(cityBuilderPath, 'utf8'),
    readFile(missionsPath, 'utf8').then(JSON.parse),
    readFile(phaseZeroPath, 'utf8').then(JSON.parse)
  ]);
  const blockX = sourceArray(cityBuilder, 'blockCentersX');
  const blockZ = sourceArray(cityBuilder, 'blockCentersZ');
  const park = sourceParkCenter(cityBuilder);
  const parkSize = sourceNumber(cityBuilder, 'parkSize');
  const mvpMissions = missions.filter(mission => MVP_MISSION_IDS.includes(mission.id));
  assert.equal(mvpMissions.length, MVP_MISSION_IDS.length, 'Every MVP mission must publish a landmark');

  const plots = blockX.flatMap(x => blockZ
    .filter(z => x !== park.x || z !== park.z)
    .map(z => ({ id: `plot-surface-${x}-${z}`, x, z })));
  const barriers = [-8.7, 8.7].map(z => ({
    position: [SUSPENSION_BRIDGE_LAYOUT.centerX, 1.1, z],
    size: [SUSPENSION_BRIDGE_LAYOUT.deckEndX - SUSPENSION_BRIDGE_LAYOUT.deckStartX, 2.2, 0.6]
  }));
  const cameraPresets = {
    management: PRESET_COORDINATES.birdseye,
    ...Object.fromEntries(Object.entries(PRESET_COORDINATES)
      .filter(([id]) => id !== 'airfield' && id !== 'rocket'))
  };

  return {
    schemaVersion: 1,
    sourceRevision,
    positionToleranceMeters: 0.01,
    plotCenters: plots,
    roads: {
      x: STREET_LAMP_ROADS.x,
      z: STREET_LAMP_ROADS.z,
      width: 14
    },
    bridge: {
      deck: {
        position: [SUSPENSION_BRIDGE_LAYOUT.centerX, -0.45, 0],
        size: [SUSPENSION_BRIDGE_LAYOUT.deckEndX - SUSPENSION_BRIDGE_LAYOUT.deckStartX, 1, SUSPENSION_BRIDGE_LAYOUT.deckWidth]
      },
      barriers,
      cableSamples: phaseZero.data.bridge.cableSamples.map(({ x }) => ({
        x,
        height: getSuspensionCableHeight(x)
      }))
    },
    park: {
      center: [park.x, 0.45, park.z],
      size: [parkSize, 0.5, parkSize]
    },
    missionPickups: mvpMissions.map(mission => ({
      id: mission.id,
      districtId: mission.pickup.districtId,
      x: mission.pickup.x,
      z: mission.pickup.z
    })),
    cameraPresets,
    terrainSamples: phaseZero.data.terrainSamples,
    districtBounds: DISTRICT_DEFINITIONS
      .filter(district => MVP_WORLD_FOOTPRINT.includes(district.id))
      .map(({ id, bounds }) => ({ id, ...bounds }))
  };
}

const expected = stableStringify(await buildFixture());
if (process.argv.includes('--check')) {
  const actual = await readFile(outputPath, 'utf8');
  if (actual !== expected) {
    throw new Error('Phase 4 landmark fixture drifted; run npm run godot:phase4:landmarks:capture');
  }
  console.log(JSON.stringify({ ok: true, fixture: path.relative(repositoryRoot, outputPath) }, null, 2));
} else {
  await writeFile(outputPath, expected);
  console.log(JSON.stringify({ ok: true, fixture: path.relative(repositoryRoot, outputPath) }, null, 2));
}
