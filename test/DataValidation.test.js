import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT_TYPES,
  DataValidationError,
  PRODUCTION_GAME_DATA,
  validateGameData
} from '../src/data/GameDataValidator.js';

function gameDataFixture() {
  return structuredClone(PRODUCTION_GAME_DATA);
}

test('production content validates into a read-only stable-ID registry', () => {
  const registry = validateGameData();

  assert.equal(registry.has(CONTENT_TYPES.MISSION, 'mission_executive'), true);
  assert.equal(registry.has(CONTENT_TYPES.BUILDING, 'NEOTECH_HQ'), true);
  assert.equal(registry.has(CONTENT_TYPES.ZONE, 'OPERATIONS'), true);
  assert.equal(registry.has(CONTENT_TYPES.ZONE, 'INDUSTRIAL'), false);
  assert.equal(registry.has(CONTENT_TYPES.DISTRICT, 'WEST_CORE'), true);
  assert.equal(registry.has(CONTENT_TYPES.FACTION, 'RESIDENTS'), true);
  assert.equal(registry.has(CONTENT_TYPES.PROGRESSION, 'MAGNATE'), true);
  assert.equal(registry.has(CONTENT_TYPES.WEATHER, 'thunderstorm'), true);
  assert.equal(registry.hasDialogueNode('mission_executive', 'start'), true);
  assert.deepEqual(registry.counts, {
    missions: 15,
    buildings: 19,
    zones: 7,
    districts: 4,
    factions: 4,
    progression: 3,
    weather: 4,
    dialogue: 47
  });
  assert.equal(Object.isFrozen(registry.counts), true);
});

test('duplicate stable IDs fail closed with the source record and field', () => {
  const data = gameDataFixture();
  data.buildings.push(structuredClone(data.buildings[0]));

  assert.throws(
    () => validateGameData(data),
    error => error instanceof DataValidationError
      && error.code === 'DUPLICATE_ID'
      && error.source === 'buildings'
      && error.recordId === 'NEOTECH_HQ'
      && error.field === 'id'
  );
});

test('missing cross-record and dialogue references identify the exact authoring path', () => {
  const districtData = gameDataFixture();
  districtData.missions[0].pickup.districtId = 'REMOVED_DISTRICT';
  assert.throws(
    () => validateGameData(districtData),
    error => error.code === 'MISSING_REFERENCE'
      && error.path === 'missions[mission_executive].pickup.districtId'
      && /REMOVED_DISTRICT/.test(error.message)
  );

  const dialogueData = gameDataFixture();
  dialogueData.missions[0].dialogueTree.start.choices[0].next = 'removed_node';
  assert.throws(
    () => validateGameData(dialogueData),
    error => error.code === 'MISSING_REFERENCE'
      && error.field === 'dialogueTree.start.choices[0].next'
  );
});

test('invalid enums and impossible authored coordinates are rejected', () => {
  const enumData = gameDataFixture();
  enumData.missions[0].missionType = 'TELEPORT';
  assert.throws(
    () => validateGameData(enumData),
    error => error.code === 'INVALID_ENUM'
      && error.path === 'missions[mission_executive].missionType'
  );

  const coordinateData = gameDataFixture();
  coordinateData.missions[0].pickup.x = 100_000;
  assert.throws(
    () => validateGameData(coordinateData),
    error => error.path === 'missions[mission_executive].pickup.x'
      && /-190\.\.810/.test(error.message)
  );
});

test('progression prerequisites must exist and remain acyclic', () => {
  const missingData = gameDataFixture();
  missingData.progression[1].prerequisiteIds = ['REMOVED_TIER'];
  assert.throws(
    () => validateGameData(missingData),
    error => error.code === 'MISSING_REFERENCE'
      && error.path === 'progression[BROKER].prerequisiteIds[0]'
  );

  const circularData = gameDataFixture();
  circularData.progression[0].prerequisiteIds = ['MAGNATE'];
  assert.throws(
    () => validateGameData(circularData),
    error => error.code === 'CIRCULAR_REFERENCE'
      && error.source === 'progression'
      && /OPERATOR -> MAGNATE -> BROKER -> OPERATOR/.test(error.message)
  );
});

test('mission prerequisites remain referentially valid and acyclic', () => {
  const missingData = gameDataFixture();
  missingData.missions[0].prerequisites = ['mission_removed'];
  assert.throws(
    () => validateGameData(missingData),
    error => error.code === 'MISSING_REFERENCE'
      && error.path === 'missions[mission_executive].prerequisites[0].missionId'
  );

  const circularData = gameDataFixture();
  circularData.missions[0].prerequisites = ['mission_scientist'];
  circularData.missions[2].prerequisites = ['mission_executive'];
  assert.throws(
    () => validateGameData(circularData),
    error => error.code === 'CIRCULAR_PREREQUISITE'
      && error.source === 'missions'
  );
});

test('every mission declares a known weather policy and valid retry bounds', () => {
  const missingPolicy = gameDataFixture();
  delete missingPolicy.missions[0].weatherPolicy;
  assert.throws(
    () => validateGameData(missingPolicy),
    error => error.path === 'missions[mission_executive].weatherPolicy'
  );

  const unknownPolicy = gameDataFixture();
  unknownPolicy.missions[0].weatherPolicy = 'WARP_STORM';
  assert.throws(
    () => validateGameData(unknownPolicy),
    error => error.code === 'INVALID_ENUM'
      && error.path === 'missions[mission_executive].weatherPolicy'
  );

  const retry = gameDataFixture();
  retry.missions[0].retryPolicy = { strategy: 'RESTART', maxAttempts: 0 };
  assert.throws(
    () => validateGameData(retry),
    error => error.path === 'missions[mission_executive].retryPolicy.maxAttempts'
  );
});
