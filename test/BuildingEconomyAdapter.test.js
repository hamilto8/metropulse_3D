import test from 'node:test';
import assert from 'node:assert/strict';

import { createBuildingEconomyRecord } from '../src/systems/BuildingEconomyAdapter.js';
import { getBuildingSpec } from '../src/world/BuildingCatalog.js';

test('canonical building adapter preserves public-service upkeep and derives city capacity', () => {
  const spec = getBuildingSpec('MED_CENTER');
  const record = createBuildingEconomyRecord({
    economyId: 'clinic-1',
    isUserPlaced: true,
    plot: { x: 20, z: 30 }
  }, { spec });

  assert.equal(record.grossIncomeRate, 0);
  assert.equal(record.operatingCostRate, 1_700 / 60);
  assert.equal(record.jobCapacity, 310);
  assert.ok(record.services.fire.demand > 0);
  assert.deepEqual(record.position, { x: 20, z: 30 });
});

test('unknown building catalog identifiers fail closed', () => {
  assert.equal(getBuildingSpec('REMOVED_OR_CORRUPT_SPEC'), null);
});
