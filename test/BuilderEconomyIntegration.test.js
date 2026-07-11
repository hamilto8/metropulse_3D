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
