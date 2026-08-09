import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CityBuilder } from '../../src/world/CityBuilder.js';
import { WORLD_BOUNDS } from '../../src/data/ContentDefinitions.js';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolDirectory, '../..');
const outputPath = path.join(
  repositoryRoot,
  'test/fixtures/godot-port/phase4/world-surface-grid.json'
);
const checkOnly = process.argv.includes('--check');

function createReferenceSurface() {
  const surface = Object.create(CityBuilder.prototype);
  surface.app = null;
  surface.drivableDecks = [];

  surface.registerDrivableDeck(110, 210, -9, 9, 0);
  for (const z of [-100, -50, 50, 100]) {
    surface.registerDrivableDeck(110, 210, z - 7.3, z + 7.3, 0);
  }
  for (const z of [-100, -50, 0, 50, 100]) {
    surface.registerDrivableDeck(380, 420, z - 7, z + 7, 0);
  }
  return surface;
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildFixture() {
  const surface = createReferenceSurface();
  const samples = [];
  for (let x = WORLD_BOUNDS.minX; x <= WORLD_BOUNDS.maxX; x += 10) {
    for (let z = WORLD_BOUNDS.minZ; z <= WORLD_BOUNDS.maxZ; z += 10) {
      const hillHeight = surface.getHillHeight(x, z);
      const terrainHeight = surface.getTerrainHeight(x, z);
      samples.push({
        x,
        z,
        hillHeight,
        terrainHeight,
        waterBelowDeck: surface.isInWater({ x, y: terrainHeight - 1.01, z }),
        waterAtSurface: surface.isInWater({ x, y: terrainHeight, z }),
        withinWorld: x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
          && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ,
        withinDrivable: surface.isWithinDrivableBounds(x, z)
      });
    }
  }

  const boundarySamples = [
    [-190, -390], [810, 390], [-190.01, 0], [810.01, 0], [0, -390.01], [0, 390.01],
    [-498, -398], [818, 398], [-498.01, 0], [818.01, 0], [0, -398.01], [0, 398.01],
    [135, 25], [185, 25], [134.99, 25], [185.01, 25],
    [380, 25], [420, 25], [379.99, 25], [420.01, 25],
    [110, 0], [210, 0], [160, 9], [160, 9.01], [400, 7], [400, 7.01]
  ].map(([x, z]) => ({
    x,
    z,
    hillHeight: surface.getHillHeight(x, z),
    terrainHeight: surface.getTerrainHeight(x, z),
    waterAtZero: surface.isInWater({ x, y: 0, z }),
    waterBelowDeck: surface.isInWater({ x, y: -1.01, z }),
    withinWorld: x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX
      && z >= WORLD_BOUNDS.minZ && z <= WORLD_BOUNDS.maxZ,
    withinDrivable: surface.isWithinDrivableBounds(x, z)
  }));

  return {
    schemaVersion: 1,
    sourceRevision: '44a286a74557adfe4fabd3a6e16b9006079eba32',
    spacingMeters: 10,
    toleranceMeters: 1e-9,
    worldBounds: WORLD_BOUNDS,
    drivableBounds: { minX: -498, maxX: 818, minZ: -398, maxZ: 398 },
    decks: surface.drivableDecks,
    samples,
    boundarySamples
  };
}

const expected = stableStringify(buildFixture());
if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8');
  if (existing !== expected) {
    throw new Error('Phase 4 world-surface fixture drifted; run npm run godot:phase4:surface:capture');
  }
  console.log('Phase 4 world-surface fixture matches the frozen browser implementation.');
} else {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected);
  console.log(`Wrote ${outputPath}`);
}
