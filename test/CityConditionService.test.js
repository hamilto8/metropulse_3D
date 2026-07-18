import test from 'node:test';
import assert from 'node:assert/strict';

import { DISTRICT_DEFINITIONS } from '../src/data/ContentDefinitions.js';
import { getProductionContentRegistry } from '../src/data/GameDataValidator.js';
import {
  CITY_CONDITION_TYPES as CONDITIONS,
  CONDITION_OPERATORS,
  CityConditionService
} from '../src/missions/CityConditionService.js';
import {
  MISSION_OUTCOME_COMMANDS as COMMANDS,
  MissionOutcomeService
} from '../src/missions/MissionOutcomeService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';

function createHarness() {
  const economy = new EconomySystem({
    initialTreasury: 10_000,
    landValue: 100,
    services: {
      power: { capacity: 100, demand: 100 },
      water: { capacity: 100, demand: 100 },
      fire: { capacity: 100, demand: 100 }
    }
  });
  const outcomes = new MissionOutcomeService({
    economySystem: economy,
    contentRegistry: getProductionContentRegistry(),
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  const conditions = new CityConditionService({
    economySystem: economy,
    outcomeService: outcomes,
    trafficProvider: () => ({
      revision: 7,
      index: 0.4,
      activeVehicles: 20,
      stoppedVehicles: 8,
      crashedVehicles: 1,
      bridge: { index: 0.6, vehicles: 10, stoppedVehicles: 6 },
      hotspots: []
    }),
    bridgeProvider: id => ({ id, state: 'OPEN', access: 'OPEN', condition: 0.95, safety: 0.98 }),
    weatherProvider: () => ({ mode: 'rain' })
  });
  return { economy, outcomes, conditions };
}

function applyConditions(outcomes) {
  return outcomes.apply({
    transactionId: 'management:bridge-diversion',
    source: {
      kind: 'MANAGEMENT', contentId: 'bridge-diversion', outcome: 'APPROVED',
      reason: 'Council approved a restricted bridge diversion.'
    },
    summary: {
      title: 'Bridge diversion approved',
      description: 'The bridge is restricted while crews respond to a collision.'
    },
    commands: [
      {
        type: COMMANDS.INFRASTRUCTURE_STATE_SET,
        infrastructureId: 'primary-bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        state: 'DEGRADED', access: 'RESTRICTED', condition: 0.65, safety: 0.7
      },
      { type: COMMANDS.REPAIR_SET, targetId: 'primary-bridge', status: 'IN_PROGRESS', progress: 0.35, estimatedCost: 2_500 },
      {
        type: COMMANDS.SERVICE_OUTAGE_SET,
        outageId: 'bridge-power', service: 'power', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        active: true, severity: 0.5, coverageMultiplier: 0.5
      },
      {
        type: COMMANDS.TRAFFIC_SET,
        scopeId: 'primary-bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        densityMultiplier: 1.5, access: 'RESTRICTED', enforcement: 0.8, hazardLevel: 0.4
      },
      {
        type: COMMANDS.INCIDENT_RECORDED,
        incidentId: 'bridge-collision', incidentType: 'COLLISION',
        districtId: 'PRIMARY_BRIDGE_CORRIDOR', severity: 5,
        landValueModifier: -8, position: { x: 220, z: 0 }, influenceRadius: 100
      },
      { type: COMMANDS.UNLOCK_SET, unlockId: 'EAST_CYBER_METROPOLIS', unlocked: true },
      { type: COMMANDS.AUTHORED_FLAG_SET, flagId: 'bridge.diversion.active', value: true }
    ]
  });
}

test('traffic and bridge queries merge live simulation data with authored consequences', () => {
  const { outcomes, conditions } = createHarness();
  const receipt = applyConditions(outcomes);

  const traffic = conditions.getTraffic({ scopeId: 'primary-bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR' });
  assert.equal(traffic.value.baseCongestion, 0.6);
  assert.ok(Math.abs(traffic.value.congestion - 0.96) < 1e-9);
  assert.equal(traffic.value.access, 'RESTRICTED');
  assert.equal(traffic.value.enforcement, 0.8);
  assert.equal(traffic.facts.activeVehicles, 20);
  assert.equal(traffic.sources[0].transactionId, receipt.transactionId);

  const bridge = conditions.query({ type: CONDITIONS.BRIDGE, bridgeId: 'primary-bridge' });
  assert.deepEqual(bridge.value, {
    state: 'DEGRADED', access: 'RESTRICTED', condition: 0.65, safety: 0.7,
    repairStatus: 'IN_PROGRESS', repairProgress: 0.35, congestion: traffic.value.congestion
  });
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(Object.isFrozen(bridge.facts), true);
});

test('service coverage, safety, and repair queries are deterministic and district-aware', () => {
  const { outcomes, conditions } = createHarness();
  applyConditions(outcomes);

  const affected = conditions.getServiceCoverage('power', { districtId: 'PRIMARY_BRIDGE_CORRIDOR' });
  const unaffected = conditions.getServiceCoverage('power', { districtId: 'WEST_CORE' });
  assert.equal(affected.value.coverage, 0.5);
  assert.equal(affected.value.outageActive, true);
  assert.equal(unaffected.value.coverage, 1);
  assert.equal(unaffected.value.outageActive, false);

  const safety = conditions.getSafety({ districtId: 'PRIMARY_BRIDGE_CORRIDOR' });
  assert.equal(safety.value.score, 70);
  assert.equal(safety.value.rating, 'STRAINED');
  assert.equal(safety.value.activeIncidentCount, 1);

  assert.deepEqual(conditions.getRepair('primary-bridge').value, {
    status: 'IN_PROGRESS', progress: 0.35, estimatedCost: 2_500
  });
  assert.deepEqual(conditions.getRepair('unknown-target').value, {
    status: 'NOT_STARTED', progress: 0, estimatedCost: 0
  });
});

test('land value, weather, district state, and authored flags expose plain immutable values', () => {
  const { outcomes, conditions } = createHarness();
  applyConditions(outcomes);

  const land = conditions.getLandValue({ x: 220, z: 0 });
  assert.equal(land.value.districtId, 'PRIMARY_BRIDGE_CORRIDOR');
  assert.equal(land.value.landValue, 92);
  assert.equal(land.facts.authoredModifier, -8);

  const weather = conditions.getWeather();
  assert.equal(weather.value.mode, 'rain');
  assert.equal(weather.value.visibility, 0.72);
  assert.equal(weather.value.roadGrip, 0.7);

  const bridgeDistrict = conditions.getDistrict('PRIMARY_BRIDGE_CORRIDOR');
  assert.equal(bridgeDistrict.value.unlocked, true);
  assert.equal(bridgeDistrict.value.state, 'DISRUPTED');
  assert.equal(conditions.getDistrict('EAST_CYBER_METROPOLIS').value.unlocked, true);

  const flag = conditions.getAuthoredFlag('bridge.diversion.active');
  assert.equal(flag.value, true);
  assert.equal(flag.facts.set, true);
  assert.equal(conditions.getAuthoredFlag('unset.flag').value, null);
});

test('authored requirement evaluation supports paths, operators, ALL/ANY, and explainable failures', () => {
  const { outcomes, conditions } = createHarness();
  applyConditions(outcomes);

  const access = conditions.evaluate({
    query: { type: CONDITIONS.BRIDGE, bridgeId: 'primary-bridge' },
    path: 'access', operator: CONDITION_OPERATORS.EQUALS, expected: 'RESTRICTED'
  });
  assert.equal(access.passed, true);
  assert.equal(access.actual, 'RESTRICTED');

  const all = conditions.evaluateAll([
    {
      query: { type: CONDITIONS.WEATHER }, path: 'mode',
      operator: CONDITION_OPERATORS.IN, expected: ['rain', 'storm']
    },
    {
      query: { type: CONDITIONS.AUTHORED_FLAG, flagId: 'bridge.diversion.active' },
      operator: CONDITION_OPERATORS.TRUTHY
    }
  ]);
  assert.equal(all.passed, true);
  assert.equal(all.results.length, 2);

  const any = conditions.evaluateAll([
    { query: { type: CONDITIONS.REPAIR, targetId: 'primary-bridge' }, path: 'progress', operator: CONDITION_OPERATORS.GREATER_THAN, expected: 0.9 },
    { query: { type: CONDITIONS.SAFETY, districtId: 'PRIMARY_BRIDGE_CORRIDOR' }, path: 'score', operator: CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL, expected: 70 }
  ], { mode: 'ANY' });
  assert.equal(any.passed, true);
});

test('condition resolvers are extensible without allowing built-in ownership to be replaced', () => {
  const { conditions } = createHarness();
  assert.throws(() => conditions.registerResolver(CONDITIONS.WEATHER, () => ({})), /already registered/);
  const unregister = conditions.registerResolver('TRANSIT_CAPACITY', (request, context) => ({
    type: 'TRANSIT_CAPACITY',
    subjectId: request.lineId,
    value: context.economy.cityPulse.population / 100,
    facts: {}, sources: [], revision: context.economy.revision
  }));
  assert.equal(conditions.query({ type: 'TRANSIT_CAPACITY', lineId: 'west-loop' }).value, 0);
  unregister();
  assert.throws(() => conditions.query({ type: 'TRANSIT_CAPACITY', lineId: 'west-loop' }), /Unsupported/);
});

test('invalid condition requests fail closed with actionable contract errors', () => {
  const { conditions } = createHarness();
  assert.throws(() => conditions.query({ type: 'REMOVED_CONDITION' }), /Unsupported city condition type/);
  assert.throws(() => conditions.getServiceCoverage('internet'), /power, water, or fire/);
  assert.throws(() => conditions.getDistrict('ATLANTIS'), /Unknown district/);
  assert.throws(() => conditions.getLandValue({ x: 1 }), /both x and z/);
  assert.throws(() => conditions.evaluateAll([], { mode: 'SOME' }), /ALL or ANY/);
});
