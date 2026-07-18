import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDING_CATALOG } from '../src/world/BuildingCatalog.js';
import missions from '../src/data/missions.json' with { type: 'json' };
import { CATALOG_STAGES } from '../src/world/ConstructionVocabulary.js';
import { ECONOMY_BALANCE, FISCAL_STATES } from '../src/systems/EconomyBalance.js';
import { runBalancedSession } from '../src/systems/EconomyScenarioSimulator.js';

test('starter income assets and authored mission rewards stay inside declared balance bands', () => {
  const profitableStarters = BUILDING_CATALOG.filter(spec => (
    spec.catalogStage === CATALOG_STAGES.STARTER && spec.incomePerMinute > 0
  ));
  assert.ok(profitableStarters.length >= 3);
  for (const spec of profitableStarters) {
    const payback = spec.cost / spec.incomePerMinute;
    assert.ok(payback >= ECONOMY_BALANCE.construction.starterPaybackMinutes.min, `${spec.id} pays back too quickly`);
    assert.ok(payback <= ECONOMY_BALANCE.construction.starterPaybackMinutes.max, `${spec.id} pays back too slowly`);
  }

  const baseRewards = missions.map(mission => mission.baseReward * ECONOMY_BALANCE.missions.rewardScale);
  assert.ok(Math.min(...baseRewards) >= ECONOMY_BALANCE.missions.targetRewardRange.min);
  assert.ok(Math.max(...baseRewards) <= ECONOMY_BALANCE.missions.targetRewardRange.max);
  const severeResponse = 5 * (
    ECONOMY_BALANCE.incidents.cleanupCostPerSeverity
    + ECONOMY_BALANCE.incidents.repairCostPerSeverity
  );
  assert.ok(severeResponse < Math.min(...baseRewards), 'one severe response must not erase a full baseline contract reward');
});

for (const durationMinutes of [15, 30, 60, 120]) {
  test(`${durationMinutes}-minute economy scenario is deterministic, solvent, and meets its session target`, () => {
    const first = runBalancedSession(durationMinutes);
    const second = runBalancedSession(durationMinutes);
    const target = ECONOMY_BALANCE.sessionTargets[durationMinutes];

    assert.deepEqual(first, second);
    assert.equal(first.snapshot.fiscalStatus, FISCAL_STATES.STABLE);
    assert.ok(first.snapshot.treasury >= target.minimumTreasury, `${target.label} treasury target missed`);
    assert.ok(first.assetCount >= target.minimumAssets, `${target.label} asset target missed`);
    assert.equal(Object.isFrozen(first), true);
  });
}
