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
  editor.getPlacementValidation = () => ({ valid: true, primaryBlocker: null });
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
    saveService: { scheduleSave() { calls.push(['save']); } }
  };

  assert.equal(editor.moveSelectedStructureToCurrentHit(), true);
  assert.deepEqual({ x: building.plot.x, y: building.plot.y, z: building.plot.z }, { x: 40, y: 2, z: 50 });
  assert.deepEqual(calls.map(call => call[0]), ['road-off', 'remove', 'group', 'register', 'road-on', 'save']);
});

test('move rollback restores transforms, economy, and road graph after a participant rejects', () => {
  const calls = [];
  const economyRecords = new Map([['road-1', {
    id: 'road-1',
    name: 'User Road',
    position: { x: 0, z: 0 },
    services: {
      power: { capacity: 0, demand: 0 },
      water: { capacity: 0, demand: 0 },
      fire: { capacity: 0, demand: 0 }
    }
  }]]);
  const building = {
    economyId: 'road-1',
    name: 'User Road',
    spec: { id: 'ROAD', generatorType: 'ROAD_SEGMENT', footprint: { width: 10, depth: 40 } },
    plot: { x: 0, y: 0, z: 0, width: 10, depth: 40 },
    group: {
      rotation: { y: 0 },
      position: {
        x: 0, y: 0, z: 0,
        set(x, y, z) { this.x = x; this.y = y; this.z = z; calls.push(['group', x, y, z]); }
      }
    }
  };
  const economy = {
    getBuilding(id) { return economyRecords.get(id) || null; },
    removeBuilding(id) { const value = economyRecords.get(id); economyRecords.delete(id); calls.push(['remove', id]); return value; },
    registerBuilding(record) { economyRecords.set(record.id, record); calls.push(['register', record.position]); return record; }
  };
  const editor = Object.create(CityEditorSystem.prototype);
  editor.selectedStructure = building;
  editor.currentHit = { x: 40, y: 2, z: 50, valid: true };
  editor.getPlacementValidation = () => ({ valid: true, primaryBlocker: null });
  editor.getEconomyController = () => economy;
  editor.createEconomyBuildingRecord = CityEditorSystem.prototype.createEconomyBuildingRecord;
  editor.app = {
    trafficSystem: {
      unregisterRoadSegment() { calls.push(['road-off']); return true; },
      registerRoadSegment() {
        calls.push(['road-on']);
        if (building.plot.x === 40) return false;
        return true;
      }
    },
    uiManager: { showToast() {} }
  };

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(editor.moveSelectedStructureToCurrentHit(), false);
  } finally {
    console.error = originalConsoleError;
  }
  assert.deepEqual(building.plot, { x: 0, y: 0, z: 0, width: 10, depth: 40 });
  assert.deepEqual(
    { x: building.group.position.x, y: building.group.position.y, z: building.group.position.z },
    { x: 0, y: 0, z: 0 }
  );
  assert.deepEqual(economyRecords.get('road-1').position, { x: 0, z: 0 });
  assert.equal(calls.filter(call => call[0] === 'road-on').length, 2);
});

test('restored user-building identifiers reseed the placement allocator', () => {
  const editor = Object.create(CityEditorSystem.prototype);
  editor.nextUserBuildingId = 1;

  assert.equal(editor.reserveUserBuildingId('USER_BUILDING_7'), 8);
  assert.equal(editor.reserveUserBuildingId('existing-12'), 8);
  assert.equal(editor.reserveUserBuildingId('USER_BUILDING_3'), 8);
});
