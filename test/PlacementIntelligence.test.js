import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlacementPreview,
  evaluatePlacement,
  PLACEMENT_BLOCKERS
} from '../src/world/PlacementIntelligence.js';
import {
  runWorldEditTransaction,
  WorldEditTransaction
} from '../src/world/WorldEditTransaction.js';

const ordinarySpec = Object.freeze({
  id: 'METRO_LOFTS',
  name: 'Metro Cyber Lofts',
  category: 'RESIDENTIAL',
  generatorType: 'RESIDENTIAL',
  cost: 350_000,
  incomePerMinute: 1_900,
  residents: 180,
  powerDemand: 8,
  waterDemand: 10,
  happiness: 1
});

function healthyEconomy(overrides = {}) {
  return {
    treasury: 650_000,
    demand: { residential: 72, commercial: 40, operations: 30, services: 10 },
    services: {
      power: { capacity: 120, demand: 90 },
      water: { capacity: 100, demand: 82 },
      fire: { capacity: 70, demand: 60 }
    },
    ...overrides
  };
}

test('placement decisions return prioritized immutable blockers with a concrete remedy', () => {
  const result = evaluatePlacement({
    spec: ordinarySpec,
    position: { x: 10, y: 0, z: 10 },
    access: { unlocked: false, requiredTier: 'BROKER', reason: 'Unlocks at Broker tier' },
    district: { allowed: false, id: 'EAST', reason: 'East is locked.' },
    inBounds: false,
    protectedLandmark: 'Central Park',
    water: true,
    slopeDegrees: 15,
    maxSlopeDegrees: 8,
    playerOccupied: true,
    roadOverlap: true,
    collision: { kind: 'BUILDING', id: 'existing-1', name: 'NeoTech HQ' },
    zone: { zoneType: 'COMMERCIAL', label: 'Commercial' },
    zoneCompatible: false,
    hasRoadAccess: false,
    economySnapshot: healthyEconomy(),
    availableCredits: 10
  });

  assert.equal(result.valid, false);
  assert.equal(result.primaryBlocker.code, PLACEMENT_BLOCKERS.CONTENT_LOCKED);
  assert.match(result.primaryBlocker.remedy, /Broker/i);
  assert.ok(result.blockers.some(blocker => blocker.code === PLACEMENT_BLOCKERS.ROAD_ACCESS));
  assert.ok(result.blockers.some(blocker => blocker.code === PLACEMENT_BLOCKERS.INSUFFICIENT_FUNDS));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
  assert.throws(() => result.blockers.push({}), TypeError);
});

test('ordinary development requires road access and projected critical services', () => {
  const noRoad = evaluatePlacement({
    spec: ordinarySpec,
    position: { x: 0, y: 0, z: 0 },
    hasRoadAccess: false,
    economySnapshot: healthyEconomy(),
    availableCredits: 650_000
  });
  assert.deepEqual(noRoad.blockers.map(blocker => blocker.code), [PLACEMENT_BLOCKERS.ROAD_ACCESS]);

  const noWater = evaluatePlacement({
    spec: ordinarySpec,
    position: { x: 0, y: 0, z: 0 },
    hasRoadAccess: true,
    economySnapshot: healthyEconomy({
      services: {
        power: { capacity: 120, demand: 90 },
        water: { capacity: 90, demand: 85 },
        fire: { capacity: 70, demand: 60 }
      }
    }),
    availableCredits: 650_000
  });
  assert.equal(noWater.primaryBlocker.code, PLACEMENT_BLOCKERS.SERVICE_SHORTAGE);
  assert.equal(noWater.primaryBlocker.detail.service, 'water');
  assert.equal(noWater.primaryBlocker.detail.shortage, 5);
});

test('truthful placement forecast covers finance, capacity, demand, services, community, and risk', () => {
  const preview = createPlacementPreview(ordinarySpec, healthyEconomy(), { availableCredits: 650_000 });

  assert.equal(preview.cost, 350_000);
  assert.equal(preview.operatingCost, 0);
  assert.equal(preview.netCashflow, 1_900);
  assert.equal(preview.payback.category, 'MEDIUM');
  assert.equal(preview.capacity.residents, 180);
  assert.equal(preview.demandEffect.type, 'residential');
  assert.equal(preview.serviceEffect.power.projectedSurplus, 22);
  assert.equal(preview.serviceEffect.water.projectedSurplus, 8);
  assert.equal(preview.happiness, 1);
  assert.equal(preview.landValue, 0.6);
  assert.equal(preview.risks[0].level, 'LOW');
});

test('world-edit transactions compensate every applied step in reverse order', () => {
  const calls = [];
  assert.throws(() => runWorldEditTransaction('placement', transaction => {
    transaction.step('economy', () => calls.push('economy-on'), () => calls.push('economy-off'));
    transaction.step('physics', () => calls.push('physics-on'), () => calls.push('physics-off'));
    transaction.step('traffic', () => {
      calls.push('traffic-on');
      return false;
    }, () => calls.push('traffic-off'));
  }), /traffic rejected/);
  assert.deepEqual(calls, [
    'economy-on', 'physics-on', 'traffic-on',
    'physics-off', 'economy-off'
  ]);

  let balance = 100;
  assert.throws(() => runWorldEditTransaction('purchase', transaction => {
    transaction.step('debit', () => false, () => { balance += 50; });
  }), /debit rejected/);
  assert.equal(balance, 100, 'a rejected non-mutating step must not run compensation');

  const thrownCalls = [];
  assert.throws(() => runWorldEditTransaction('partial', transaction => {
    transaction.step('first', () => thrownCalls.push('first-on'), () => thrownCalls.push('first-off'));
    transaction.step('partial', () => {
      thrownCalls.push('partial-on');
      throw new Error('partial failure');
    }, () => thrownCalls.push('partial-off'));
  }), /partial failure/);
  assert.deepEqual(thrownCalls, ['first-on', 'partial-on', 'partial-off', 'first-off']);

  const committed = new WorldEditTransaction('commit');
  committed.step('one', () => true, () => calls.push('should-not-run'));
  assert.equal(committed.commit(), true);
  assert.deepEqual(committed.rollback(), []);
});
