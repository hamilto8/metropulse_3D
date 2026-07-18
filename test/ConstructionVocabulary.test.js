import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILDING_CATALOG,
  getCatalogAccess,
  getCatalogByCategory
} from '../src/world/BuildingCatalog.js';
import {
  isMvpDevelopmentZone,
  MVP_ZONE_LABELS,
  normalizeZoneId
} from '../src/world/ConstructionVocabulary.js';

test('MVP zoning exposes exactly Residential, Commercial, and Operations', () => {
  assert.deepEqual(Object.keys(MVP_ZONE_LABELS), ['RESIDENTIAL', 'COMMERCIAL', 'OPERATIONS']);
  assert.equal(normalizeZoneId('industrial'), 'OPERATIONS');
  assert.equal(normalizeZoneId('ind'), 'OPERATIONS');
  assert.equal(normalizeZoneId('office'), 'COMMERCIAL');
  assert.equal(isMvpDevelopmentZone('power'), false);
  assert.equal(isMvpDevelopmentZone('fire_service'), false);
});

test('first-session catalog is a reduced decision set with each construction role represented', () => {
  const starter = getCatalogByCategory('ALL', { includeAdvanced: false });
  assert.deepEqual(starter.map(spec => spec.id), [
    'CYBERCAFE',
    'METRO_LOFTS',
    'ROAD_STRAIGHT',
    'SOLAR_GRID',
    'CYBER_FAB',
    'FIRE_STATION'
  ]);
  assert.deepEqual(new Set(starter.map(spec => spec.category)), new Set([
    'RESIDENTIAL', 'COMMERCIAL', 'OPERATIONS', 'FACILITIES', 'INFRASTRUCTURE'
  ]));
  assert.ok(starter.length < BUILDING_CATALOG.length / 2);
});

test('advanced disclosure and progression locks are independent, explicit policies', () => {
  const advanced = getCatalogByCategory('ALL', { includeAdvanced: true });
  assert.equal(advanced.length, BUILDING_CATALOG.length);

  const operatorRoad = advanced.find(spec => spec.id === 'ROAD_INTERSECTION');
  const brokerFacility = advanced.find(spec => spec.id === 'WATER_RECLAMATION');
  const magnateLandmark = advanced.find(spec => spec.id === 'AETHER_LANDMARK');
  assert.equal(getCatalogAccess(operatorRoad, {}).unlocked, true);
  assert.equal(getCatalogAccess(brokerFacility, {}).unlocked, false);
  assert.equal(getCatalogAccess(brokerFacility, { BROKER: true }).unlocked, true);
  assert.equal(getCatalogAccess(magnateLandmark, { BROKER: true }).unlocked, false);
  assert.equal(getCatalogAccess(magnateLandmark, { MAGNATE: true }).unlocked, true);
});
