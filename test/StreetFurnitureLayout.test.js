import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStreetLampLayout,
  getStreetFacingRotation,
  removeNearbyPlacements,
  STREET_LAMP_MIN_SPACING
} from '../src/world/StreetFurnitureLayout.js';

test('street-lamp layout removes duplicate corner placements', () => {
  const layout = createStreetLampLayout();

  assert.ok(layout.length > 0);
  for (let firstIndex = 0; firstIndex < layout.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < layout.length; secondIndex += 1) {
      const first = layout[firstIndex];
      const second = layout[secondIndex];
      const distance = Math.hypot(first.x - second.x, first.z - second.z);
      assert.ok(
        distance >= STREET_LAMP_MIN_SPACING,
        `lamps at (${first.x}, ${first.z}) and (${second.x}, ${second.z}) are ${distance.toFixed(2)} units apart`
      );
    }
  }
});

test('every street lamp faces its associated road centerline', () => {
  const layout = createStreetLampLayout();

  for (const lamp of layout) {
    const forward = { x: Math.sin(lamp.rot), z: Math.cos(lamp.rot) };
    const towardRoad = lamp.roadAxis === 'z'
      ? { x: lamp.roadCenter - lamp.x, z: 0 }
      : { x: 0, z: lamp.roadCenter - lamp.z };
    const dot = forward.x * towardRoad.x + forward.z * towardRoad.z;
    assert.ok(dot > 0, `lamp at (${lamp.x}, ${lamp.z}) faces away from its road`);
  }

  assert.equal(getStreetFacingRotation({ x: 0, z: 8 }, { roadAxis: 'x', roadCenter: 0 }), Math.PI);
  assert.equal(getStreetFacingRotation({ x: 0, z: -8 }, { roadAxis: 'x', roadCenter: 0 }), 0);
});

test('nearby-placement filtering is stable and rejects malformed candidates', () => {
  const first = { x: 0, z: 0, rot: 0 };
  const near = { x: 4, z: 3, rot: Math.PI };
  const far = { x: 16, z: 0, rot: Math.PI / 2 };

  assert.deepEqual(
    removeNearbyPlacements([first, near, far, { x: Number.NaN, z: 10 }], 12),
    [first, far]
  );
  assert.deepEqual(removeNearbyPlacements([first], 0), []);
});
