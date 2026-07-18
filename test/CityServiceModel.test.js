import test from 'node:test';
import assert from 'node:assert/strict';

import { DISTRICT_DEFINITIONS } from '../src/data/ContentDefinitions.js';
import { getProductionContentRegistry } from '../src/data/GameDataValidator.js';
import { CityConditionService } from '../src/missions/CityConditionService.js';
import {
  MISSION_OUTCOME_COMMANDS as COMMANDS,
  MissionOutcomeService
} from '../src/missions/MissionOutcomeService.js';
import { CityServiceModel } from '../src/systems/CityServiceModel.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';

function harness() {
  const economy = new EconomySystem({
    initialTreasury: 20_000,
    services: {
      power: { capacity: 100, demand: 100 },
      water: { capacity: 100, demand: 100 },
      fire: { capacity: 100, demand: 100 }
    }
  });
  economy.registerBuilding({
    id: 'west-energy-array', name: 'West energy array', position: { x: -20, z: 0 },
    services: {
      power: { capacity: 50, demand: 0, reach: 120 },
      water: { capacity: 0, demand: 0 },
      fire: { capacity: 0, demand: 0 }
    }
  });
  const outcomes = new MissionOutcomeService({
    economySystem: economy,
    contentRegistry: getProductionContentRegistry(),
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  const model = new CityServiceModel({ economySystem: economy, outcomeService: outcomes });
  return { economy, outcomes, model };
}

test('aggregate metrics stay simple while district access and facility reach make local coverage matter', () => {
  const { model } = harness();
  const aggregate = model.getCoverage('power');
  const nearFacility = model.getCoverage('power', { position: { x: -20, z: 0 } });
  const bridge = model.getCoverage('power', { position: { x: 210, z: 0 } });

  assert.equal(aggregate.coverage, 1);
  assert.equal(aggregate.facts.aggregate.capacity, 150);
  assert.equal(nearFacility.coverage, 1);
  assert.equal(nearFacility.facts.networkAccess, 1);
  assert.equal(bridge.districtId, 'PRIMARY_BRIDGE_CORRIDOR');
  assert.equal(bridge.coverage, 0.76);
  assert.equal(bridge.health, 'STRAINED');
  assert.match(bridge.explanation, /76% local access/);
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(Object.isFrozen(bridge.facts.facilities), true);
});

test('spatial outages penalize the response site without flattening the whole district', () => {
  const { outcomes, model } = harness();
  outcomes.apply({
    transactionId: 'system:bridge-outage',
    source: { kind: 'SYSTEM', contentId: 'bridge-outage', outcome: 'REPORTED' },
    summary: { title: 'Bridge outage', description: 'A local relay failed.' },
    commands: [{
      type: COMMANDS.SERVICE_OUTAGE_SET,
      outageId: 'bridge-outage', service: 'power', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
      targetId: 'relay', cause: 'Relay failure', position: { x: 210, z: 0 }, influenceRadius: 80,
      active: true, severity: 0.8, coverageMultiplier: 0.25
    }]
  });

  const site = model.getCoverage('power', { position: { x: 210, z: 0 } });
  const districtEdge = model.getCoverage('power', { position: { x: 300, z: 100 } });
  const aggregate = model.snapshot();
  assert.equal(site.coverage, 0.19);
  assert.equal(site.outageActive, true);
  assert.equal(site.health, 'CRITICAL');
  assert.equal(districtEdge.outageActive, false);
  assert.equal(districtEdge.coverage, 0.76);
  assert.ok(aggregate.energy.coverage < 1 && aggregate.energy.coverage > 0.8);
  assert.equal(aggregate.activeIncidentCount, 0);
});

test('mission-facing service queries consume the same local model and publish its explanation', () => {
  const { economy, outcomes, model } = harness();
  const conditions = new CityConditionService({
    economySystem: economy,
    outcomeService: outcomes,
    serviceModel: model
  });
  const result = conditions.getServiceCoverage('fire', {
    districtId: 'PRIMARY_BRIDGE_CORRIDOR',
    position: { x: 220, z: 0 }
  });
  assert.equal(result.value.coverage, 0.58);
  assert.equal(result.value.health, 'CRITICAL');
  assert.match(result.value.explanation, /Safety response/);
  assert.equal(result.facts.networkAccess, 0.58);
});

test('service model subscriptions coalesce authoritative economy and outcome changes without mutable state', () => {
  const { economy, outcomes, model } = harness();
  const readings = [];
  const unsubscribe = model.subscribe(event => readings.push(event.current), { emitCurrent: true });
  economy.setService('power', { demand: 200 });
  outcomes.apply({
    transactionId: 'system:flag-only',
    source: { kind: 'SYSTEM', contentId: 'flag-only', outcome: 'SET' },
    summary: { title: 'Flag set', description: 'A revision-only outcome.' },
    commands: [{ type: COMMANDS.AUTHORED_FLAG_SET, flagId: 'service.test', value: true }]
  });
  unsubscribe();
  economy.setService('power', { demand: 210 });
  assert.equal(readings.length, 3);
  assert.ok(readings[1].energy.coverage < readings[0].energy.coverage);
  assert.equal(Object.isFrozen(readings[2]), true);
  model.destroy();
});
