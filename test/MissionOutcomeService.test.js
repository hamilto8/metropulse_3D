import test from 'node:test';
import assert from 'node:assert/strict';

import { DISTRICT_DEFINITIONS } from '../src/data/ContentDefinitions.js';
import { getProductionContentRegistry } from '../src/data/GameDataValidator.js';
import {
  MISSION_OUTCOME_COMMANDS as COMMANDS,
  MissionOutcomeService,
  OutcomeApplicationError,
  OutcomeConflictError,
  createEmptyMissionOutcomeState,
  validateMissionOutcomeState
} from '../src/missions/MissionOutcomeService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';

const contentRegistry = getProductionContentRegistry();

function createHarness() {
  const economy = new EconomySystem({
    initialTreasury: 1_000,
    services: {
      power: { capacity: 100, demand: 100 },
      water: { capacity: 100, demand: 100 },
      fire: { capacity: 100, demand: 100 }
    }
  });
  economy.registerBuilding({ id: 'bridge-operations', status: 'ACTIVE', operational: true });
  const outcomes = new MissionOutcomeService({
    economySystem: economy,
    contentRegistry,
    districtDefinitions: DISTRICT_DEFINITIONS
  });
  return { economy, outcomes };
}

function fullTransaction(overrides = {}) {
  return {
    transactionId: 'mission:bridge-response:run-1:success',
    source: {
      kind: 'MISSION',
      contentId: 'mission_executive',
      outcome: 'SUCCESS',
      runId: 'run-1',
      actorId: 'player',
      reason: 'The emergency lane was restored before rush hour.'
    },
    summary: {
      title: 'Bridge response succeeded',
      description: 'Rapid response restored access and public confidence.'
    },
    commands: [
      { type: COMMANDS.CAPITAL_ADJUSTED, amount: 250, reason: 'Emergency contract payment.' },
      { type: COMMANDS.BUILDING_STATE_SET, buildingId: 'bridge-operations', state: 'DAMAGED', operational: false },
      {
        type: COMMANDS.INFRASTRUCTURE_STATE_SET,
        infrastructureId: 'primary-bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        state: 'DEGRADED', access: 'RESTRICTED', condition: 0.65, safety: 0.72
      },
      {
        type: COMMANDS.INCIDENT_RECORDED,
        incidentId: 'bridge-collision-1', incidentType: 'TRAFFIC_COLLISION',
        districtId: 'PRIMARY_BRIDGE_CORRIDOR', severity: 4,
        happinessModifier: -2, landValueModifier: -5,
        position: { x: 220, z: 0 }, influenceRadius: 80
      },
      { type: COMMANDS.REPAIR_SET, targetId: 'primary-bridge', status: 'SCHEDULED', progress: 0, estimatedCost: 400 },
      {
        type: COMMANDS.SERVICE_OUTAGE_SET,
        outageId: 'bridge-power-outage', service: 'power',
        districtId: 'PRIMARY_BRIDGE_CORRIDOR', active: true,
        severity: 0.5, coverageMultiplier: 0.6
      },
      {
        type: COMMANDS.TRAFFIC_SET,
        scopeId: 'primary-bridge', districtId: 'PRIMARY_BRIDGE_CORRIDOR',
        densityMultiplier: 1.4, access: 'RESTRICTED', enforcement: 0.8, hazardLevel: 0.35
      },
      { type: COMMANDS.FACTION_REPUTATION_ADJUSTED, factionId: 'RESIDENTS', delta: 12 },
      { type: COMMANDS.PROGRESSION_SET, progressionId: 'OPERATOR', unlocked: true },
      { type: COMMANDS.UNLOCK_SET, unlockId: 'bridge-emergency-lane', unlocked: true },
      {
        type: COMMANDS.NEWS_PUBLISHED,
        newsId: 'news-bridge-response', headline: 'Emergency lane restored',
        body: 'Crews reopened one bridge lane before the evening peak.', priority: 2
      },
      { type: COMMANDS.FOLLOW_UP_MISSION_SET, missionId: 'mission_scientist', status: 'AVAILABLE' },
      { type: COMMANDS.AUTHORED_FLAG_SET, flagId: 'bridge.response.success', value: true }
    ],
    ...overrides
  };
}

test('a validated outcome transaction applies every P3.1 consequence family and records explanations', () => {
  const { economy, outcomes } = createHarness();
  const events = [];
  outcomes.subscribe(event => events.push(event));

  const receipt = outcomes.apply(fullTransaction());
  const state = outcomes.snapshot();

  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.effects.length, 13);
  assert.equal(economy.treasury, 1_250);
  assert.deepEqual(state.buildingStates['bridge-operations'], {
    state: 'DAMAGED', operational: false,
    transactionId: receipt.transactionId, commandId: 'command-2'
  });
  assert.equal(state.infrastructure['primary-bridge'].access, 'RESTRICTED');
  assert.equal(state.incidents['bridge-collision-1'].active, true);
  assert.equal(state.repairs['primary-bridge'].status, 'SCHEDULED');
  assert.equal(state.serviceOutages['bridge-power-outage'].coverageMultiplier, 0.6);
  assert.equal(state.traffic['primary-bridge'].hazardLevel, 0.35);
  assert.equal(state.factions.RESIDENTS, 12);
  assert.equal(state.progression.OPERATOR, true);
  assert.equal(state.unlocks['bridge-emergency-lane'], true);
  assert.equal(state.news['news-bridge-response'].priority, 2);
  assert.equal(state.followUpMissions.mission_scientist.status, 'AVAILABLE');
  assert.equal(state.flags['bridge.response.success'].value, true);
  assert.equal(events.length, 1);

  const explanation = outcomes.explain(receipt.transactionId);
  assert.equal(explanation.source.contentId, 'mission_executive');
  assert.equal(explanation.title, 'Bridge response succeeded');
  assert.equal(explanation.effects[0].before, 1_000);
  assert.equal(explanation.effects[0].after, 1_250);
  assert.equal(explanation.effects[0].explanation, 'Emergency contract payment.');
  assert.equal(Object.isFrozen(explanation), true);
  assert.equal(Object.isFrozen(state.infrastructure['primary-bridge']), true);
});

test('reapplying the same transaction is idempotent while reused IDs with different content conflict', () => {
  const { economy, outcomes } = createHarness();
  const transaction = fullTransaction();
  const first = outcomes.apply(transaction);
  const duplicate = outcomes.apply(structuredClone(transaction));

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.transactionId, first.transactionId);
  assert.equal(economy.treasury, 1_250);
  assert.equal(outcomes.snapshot().transactions.length, 1);

  const changed = fullTransaction();
  changed.commands[0].amount = 251;
  assert.throws(() => outcomes.apply(changed), OutcomeConflictError);
  assert.equal(economy.treasury, 1_250);
});

test('economy observer reentrancy cannot replay a transaction before its receipt commits', () => {
  const { economy, outcomes } = createHarness();
  const transaction = fullTransaction({
    transactionId: 'reentrant-outcome',
    commands: [{ type: COMMANDS.CAPITAL_ADJUSTED, amount: 25 }]
  });
  let reentrantError = null;
  economy.subscribe(event => {
    if (event.detail.referenceId !== transaction.transactionId) return;
    try {
      outcomes.apply(transaction);
    } catch (error) {
      reentrantError = error;
    }
  });

  outcomes.apply(transaction);
  assert.equal(reentrantError instanceof OutcomeApplicationError, true);
  assert.match(reentrantError.message, /while outcome reentrant-outcome is committing/);
  assert.equal(economy.treasury, 1_025);
  assert.equal(outcomes.snapshot().transactions.length, 1);
});

test('whole-transaction validation and affordability checks prevent partial consequences', () => {
  const { economy, outcomes } = createHarness();
  const invalid = fullTransaction({
    transactionId: 'invalid-late-command',
    commands: [
      { type: COMMANDS.CAPITAL_ADJUSTED, amount: 500 },
      { type: COMMANDS.SERVICE_OUTAGE_SET, outageId: 'bad', service: 'internet' }
    ]
  });

  assert.throws(() => outcomes.apply(invalid), /service must be power, water, or fire/);
  assert.equal(economy.treasury, 1_000);
  assert.equal(outcomes.snapshot().revision, 0);

  const unaffordable = fullTransaction({
    transactionId: 'unaffordable',
    commands: [
      { type: COMMANDS.CAPITAL_ADJUSTED, amount: -1_001 },
      { type: COMMANDS.AUTHORED_FLAG_SET, flagId: 'should.not.exist', value: true }
    ]
  });
  assert.throws(() => outcomes.apply(unaffordable), OutcomeApplicationError);
  assert.equal(economy.treasury, 1_000);
  assert.equal(outcomes.snapshot().flags['should.not.exist'], undefined);
});

test('commands fail closed on unknown authored IDs and duplicate command IDs', () => {
  const { outcomes } = createHarness();
  assert.throws(() => outcomes.apply(fullTransaction({
    transactionId: 'unknown-faction',
    commands: [{ type: COMMANDS.FACTION_REPUTATION_ADJUSTED, factionId: 'REMOVED', delta: 1 }]
  })), /unknown factions content ID REMOVED/);
  assert.throws(() => outcomes.apply(fullTransaction({
    transactionId: 'unknown-district',
    commands: [{
      type: COMMANDS.TRAFFIC_SET, commandId: 'same', scopeId: 'road', districtId: 'ATLANTIS',
      densityMultiplier: 1
    }]
  })), /unknown district ATLANTIS/);
  assert.throws(() => outcomes.apply(fullTransaction({
    transactionId: 'duplicate-command-id',
    commands: [
      { type: COMMANDS.UNLOCK_SET, commandId: 'same', unlockId: 'one' },
      { type: COMMANDS.UNLOCK_SET, commandId: 'same', unlockId: 'two' }
    ]
  })), /Duplicate outcome commandId/);
});

test('incident resolution and faction bounds produce explicit before-and-after receipts', () => {
  const { outcomes } = createHarness();
  outcomes.apply(fullTransaction());
  const receipt = outcomes.apply({
    transactionId: 'mission:bridge-response:cleanup',
    source: { kind: 'SYSTEM', contentId: 'incident-cleanup', outcome: 'RESOLVED' },
    summary: { title: 'Bridge cleanup', description: 'Cleanup crews cleared the collision.' },
    commands: [
      { type: COMMANDS.INCIDENT_RESOLVED, incidentId: 'bridge-collision-1' },
      { type: COMMANDS.FACTION_REPUTATION_ADJUSTED, factionId: 'RESIDENTS', delta: 500 }
    ]
  });

  assert.equal(outcomes.snapshot().incidents['bridge-collision-1'].active, false);
  assert.equal(outcomes.snapshot().factions.RESIDENTS, 100);
  assert.equal(receipt.effects[0].before.active, true);
  assert.equal(receipt.effects[0].after.active, false);
  assert.equal(receipt.effects[1].before, 12);
  assert.equal(receipt.effects[1].after, 100);
});

test('outcome state round-trips without replaying Capital and rejects corrupt persistence', () => {
  const { economy, outcomes } = createHarness();
  outcomes.apply(fullTransaction());
  const serialized = outcomes.serialize();
  assert.equal(validateMissionOutcomeState(serialized, { contentRegistry }), true);

  const restored = new MissionOutcomeService({ economySystem: economy, contentRegistry });
  restored.restore(serialized);
  assert.deepEqual(restored.serialize(), serialized);
  assert.equal(economy.treasury, 1_250);
  assert.equal(restored.hasApplied('mission:bridge-response:run-1:success'), true);

  const corrupt = structuredClone(serialized);
  corrupt.state.progression.REMOVED_TIER = true;
  assert.throws(() => validateMissionOutcomeState(corrupt, { contentRegistry }), /unknown progression/);

  const empty = createEmptyMissionOutcomeState({ factions: { RESIDENTS: 3 }, progression: { OPERATOR: true } });
  assert.equal(validateMissionOutcomeState(empty, { contentRegistry }), true);
});
