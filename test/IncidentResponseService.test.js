import test from 'node:test';
import assert from 'node:assert/strict';

import { AlertService } from '../src/alerts/AlertService.js';
import { DISTRICT_DEFINITIONS } from '../src/data/ContentDefinitions.js';
import { getProductionContentRegistry } from '../src/data/GameDataValidator.js';
import {
  MissionOutcomeService,
  validateMissionOutcomeState
} from '../src/missions/MissionOutcomeService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';
import { IncidentResponseService } from '../src/systems/IncidentResponseService.js';

const definition = Object.freeze({
  id: 'bridge-relay-test',
  type: 'ENERGY_RELAY_DAMAGE',
  title: 'Bridge relay damaged',
  cause: 'A transformer strike scattered debris across the service bay.',
  targetId: 'bridge-relay',
  infrastructureId: 'bridge-relay',
  districtId: 'PRIMARY_BRIDGE_CORRIDOR',
  service: 'power',
  severity: 5,
  cleanupCost: 1_500,
  repairCost: 4_500,
  coverageMultiplier: 0.4,
  position: { x: 205, z: 18 },
  influenceRadius: 90
});

function harness(treasury = 10_000) {
  const economy = new EconomySystem({ initialTreasury: treasury });
  const outcomes = new MissionOutcomeService({
    economySystem: economy,
    contentRegistry: getProductionContentRegistry(),
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  const alerts = new AlertService({ now: () => new Date('2026-07-18T12:00:00.000Z') });
  const response = new IncidentResponseService({ outcomeService: outcomes, economySystem: economy, alertService: alerts });
  return { economy, outcomes, alerts, response };
}

test('reporting a service incident atomically creates local damage, outage, cleanup, repair, and alert records', () => {
  const { outcomes, alerts, response } = harness();
  const result = response.reportIncident(definition);
  const state = outcomes.snapshot();

  assert.equal(result.incident.active, true);
  assert.equal(state.infrastructure['bridge-relay'].state, 'DAMAGED');
  assert.equal(state.serviceOutages['outage:bridge-relay-test'].position.x, 205);
  assert.equal(state.serviceOutages['outage:bridge-relay-test'].influenceRadius, 90);
  assert.equal(state.repairs['work:bridge-relay-test:cleanup'].workType, 'CLEANUP');
  assert.equal(state.repairs['work:bridge-relay-test:repair'].prerequisiteTargetId, 'work:bridge-relay-test:cleanup');
  assert.equal(response.getIncidentSummaries()[0].responseCost, 6_000);
  assert.equal(alerts.snapshot().active[0].focusAction.type, 'MANAGEMENT_CAMERA');
  assert.equal(Object.isFrozen(result), true);

  const duplicate = response.reportIncident(definition);
  assert.equal(duplicate.duplicate, true);
  assert.equal(outcomes.snapshot().transactions.length, 1);
});

test('management funding is atomic and street work enforces cleanup before repair', () => {
  const { economy, outcomes, alerts, response } = harness();
  response.reportIncident(definition);
  const funded = response.scheduleResponse(definition.id);
  assert.equal(economy.treasury, 4_000);
  assert.equal(funded.workOrders.every(order => order.status === 'SCHEDULED'), true);
  assert.equal(alerts.snapshot().active[0].focusAction.type, 'STREET_WAYPOINT');
  const duplicate = response.scheduleResponse(definition.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(economy.treasury, 4_000);

  assert.throws(
    () => response.performStreetWork('work:bridge-relay-test:repair'),
    /completed first/
  );
  response.performStreetWork('work:bridge-relay-test:cleanup');
  assert.equal(response.getWorkOrder('work:bridge-relay-test:cleanup').progress, 0.5);
  response.performStreetWork('work:bridge-relay-test:cleanup');
  assert.equal(response.getWorkOrder('work:bridge-relay-test:cleanup').status, 'COMPLETE');
  response.performStreetWork('work:bridge-relay-test:repair');
  const completed = response.performStreetWork('work:bridge-relay-test:repair');

  assert.equal(completed.incident.active, false);
  assert.equal(outcomes.snapshot().serviceOutages['outage:bridge-relay-test'].active, false);
  assert.equal(outcomes.snapshot().infrastructure['bridge-relay'].state, 'ACTIVE');
  assert.equal(outcomes.snapshot().infrastructure['bridge-relay'].condition, 1);
  assert.equal(alerts.snapshot().active.some(alert => alert.severity === 'SUCCESS'), true);
  assert.equal(
    alerts.snapshot().items.find(alert => alert.dedupeKey === 'service-incident:bridge-relay-test').state,
    'RESOLVED'
  );
});

test('an unaffordable response leaves Capital and every work order untouched', () => {
  const { economy, outcomes, response } = harness(5_999);
  response.reportIncident(definition);
  assert.throws(() => response.scheduleResponse(definition.id), /requires \$6,000 Capital/);
  assert.equal(economy.treasury, 5_999);
  assert.equal(response.getWorkOrders().every(order => order.status === 'NOT_STARTED'), true);
  assert.equal(outcomes.snapshot().transactions.length, 1);
});

test('extended incident contracts validate, round-trip, and resume field work after restore', () => {
  const source = harness();
  source.response.reportIncident(definition);
  source.response.scheduleResponse(definition.id);
  source.response.performStreetWork('work:bridge-relay-test:cleanup');
  const serialized = source.outcomes.serialize();
  assert.equal(validateMissionOutcomeState(serialized, { contentRegistry: getProductionContentRegistry() }), true);

  const restoredEconomy = new EconomySystem({ initialTreasury: source.economy.treasury });
  const restoredOutcomes = new MissionOutcomeService({
    economySystem: restoredEconomy,
    contentRegistry: getProductionContentRegistry(),
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  const restoreEvents = [];
  restoredOutcomes.subscribe(event => restoreEvents.push(event));
  restoredOutcomes.restore(serialized);
  const restored = new IncidentResponseService({ outcomeService: restoredOutcomes, economySystem: restoredEconomy });
  assert.equal(restoreEvents[0].type, 'RESTORED');
  assert.equal(restored.getWorkOrder('work:bridge-relay-test:cleanup').progress, 0.5);
  restored.performStreetWork('work:bridge-relay-test:cleanup');
  assert.equal(restored.getWorkOrder('work:bridge-relay-test:cleanup').status, 'COMPLETE');
  assert.equal(restoredEconomy.treasury, 4_000);
});
