import test from 'node:test';
import assert from 'node:assert/strict';

import { CityEditorSystem } from '../src/world/CityEditorSystem.js';

test('builder economy records preserve amenity position and influence radius', () => {
  const editor = Object.create(CityEditorSystem.prototype);
  editor.nextUserBuildingId = 1;
  const building = {
    plot: { x: 120, y: 0, z: -80 },
    name: 'Neighborhood Plaza'
  };
  const spec = {
    id: 'PLAZA',
    name: 'Neighborhood Plaza',
    category: 'CIVIC',
    cost: 150_000,
    happiness: 12,
    amenityRadius: 95
  };

  const record = editor.createEconomyBuildingRecord(building, spec);

  assert.deepEqual(record.position, { x: 120, z: -80 });
  assert.equal(record.amenityRadius, 95);
  assert.equal(record.landValueModifier, 10.2);
  assert.equal(record.happinessModifier, 12);
});

test('move tool updates world, physics, traffic, and economy coordinates atomically', () => {
  const calls = [];
  const building = {
    economyId: 'road-1',
    name: 'User Road',
    spec: { id: 'ROAD', generatorType: 'ROAD_SEGMENT', footprint: { width: 10, depth: 40 } },
    plot: { x: 0, y: 0, z: 0, width: 10, depth: 40 },
    group: { position: { set(x, y, z) { calls.push(['group', x, y, z]); } } }
  };
  const editor = Object.create(CityEditorSystem.prototype);
  editor.selectedStructure = building;
  editor.currentHit = { x: 40, y: 2, z: 50, valid: true };
  editor.checkPlacementValidity = () => true;
  editor.getEconomyController = () => ({
    removeBuilding(id) { calls.push(['remove', id]); },
    registerBuilding(record) { calls.push(['register', record.position]); return record; }
  });
  editor.createEconomyBuildingRecord = CityEditorSystem.prototype.createEconomyBuildingRecord;
  editor.app = {
    buildingFactory: { buildings: [building] },
    trafficSystem: {
      unregisterRoadSegment() { calls.push(['road-off']); },
      registerRoadSegment() { calls.push(['road-on']); }
    },
    uiManager: { addAlert() {} },
    persistenceSystem: { scheduleSave() { calls.push(['save']); } }
  };

  assert.equal(editor.moveSelectedStructureToCurrentHit(), true);
  assert.deepEqual({ x: building.plot.x, y: building.plot.y, z: building.plot.z }, { x: 40, y: 2, z: 50 });
  assert.deepEqual(calls.map(call => call[0]), ['road-off', 'remove', 'group', 'register', 'road-on', 'save']);
});
