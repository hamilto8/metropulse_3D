import test from 'node:test';
import assert from 'node:assert/strict';

import { UIManager } from '../src/ui/UIManager.js';

test('building inspector exposes parcel land value and spatial influences', () => {
  const manager = Object.create(UIManager.prototype);
  let sampledAt = null;
  manager.app = {
    economySystem: {
      getLandValueBreakdownAt(x, z) {
        sampledAt = { x, z };
        return {
          landValue: 123.4,
          amenityModifier: 8.7,
          mayhemModifier: -3.2
        };
      }
    }
  };
  const building = {
    type: 'BUILDING',
    plot: { x: 40, z: -25 },
    info: {}
  };

  const breakdown = manager.syncLocalLandValue(building);

  assert.deepEqual(sampledAt, { x: 40, z: -25 });
  assert.equal(breakdown.landValue, 123.4);
  assert.equal(building.info['Local Land Value'], '123');
  assert.equal(building.info['Local Influences'], 'Amenities +9 · Mayhem -3');
});

test('local land-value sync ignores non-building inspector entities', () => {
  const manager = Object.create(UIManager.prototype);
  manager.app = {
    economySystem: {
      getLandValueBreakdownAt() {
        throw new Error('should not be called');
      }
    }
  };

  assert.equal(manager.syncLocalLandValue({ type: 'VEHICLE', info: {} }), null);
});
