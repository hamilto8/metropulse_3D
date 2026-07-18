import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSION_AVAILABILITY,
  MISSION_PHASES,
  MISSION_RETRY_STRATEGIES,
  MissionLifecycleController,
  evaluateMissionWeather,
  validateMissionLifecycleState
} from '../src/missions/MissionLifecycleController.js';
import { MissionOutcomeService } from '../src/missions/MissionOutcomeService.js';
import { EconomySystem } from '../src/systems/EconomySystem.js';

function mission(overrides = {}) {
  return {
    id: 'mission-alpha',
    title: 'Alpha Run',
    missionType: 'DELIVERY',
    prerequisites: [],
    weatherPolicy: 'STANDARD_ROAD',
    ...overrides
  };
}

function controller(missions, overrides = {}) {
  return new MissionLifecycleController({
    missions,
    weatherProvider: () => 'clear',
    ...overrides
  });
}

function begin(instance, missionId = 'mission-alpha') {
  instance.prepare(missionId);
  instance.beginBriefing();
  instance.accept({ baseTimeLimit: 60, baseReward: 500 });
  instance.beginExecution();
}

function commitResult(instance, outcome, reason = 'timeout') {
  if (outcome === 'SUCCESS') instance.resolveSuccess({ payout: 500, summary: 'Delivered.' });
  else instance.resolveFailure(reason, { summary: 'Not delivered.' });
  instance.beginCleanup();
  const transaction = instance.createOutcomeTransaction();
  instance.commitCleanup({ transactionId: transaction.transactionId, effects: [], summary: transaction.summary });
  return transaction;
}

test('availability composes mission, follow-up, and city-condition prerequisites', () => {
  let conditionPassed = false;
  const outcomes = { followUpMissions: { 'mission-alpha': { status: 'AVAILABLE' } } };
  const instance = controller([
    mission(),
    mission({
      id: 'mission-beta',
      title: 'Beta Run',
      prerequisites: [
        'mission-alpha',
        { type: 'FOLLOW_UP_STATUS', missionId: 'mission-alpha', status: 'AVAILABLE' },
        { type: 'CITY_CONDITION', requirement: { query: { type: 'AUTHORED_FLAG', flagId: 'bridge.ready' } }, reason: 'Repair the bridge first.' }
      ]
    })
  ], {
    conditionService: { evaluate: () => ({ passed: conditionPassed }) },
    outcomeService: { snapshot: () => outcomes }
  });

  let availability = instance.evaluateAvailability('mission-beta');
  assert.equal(availability.status, MISSION_AVAILABILITY.LOCKED);
  assert.deepEqual(availability.reasons, ['Complete Alpha Run first.', 'Repair the bridge first.']);

  begin(instance);
  commitResult(instance, 'SUCCESS');
  instance.beginRecovery();
  instance.finishRecovery();
  conditionPassed = true;
  availability = instance.evaluateAvailability('mission-beta');
  assert.equal(availability.available, true);
  assert.equal(Object.isFrozen(availability), true);
});

test('the complete success path retains mission ownership through committed result and recovery', () => {
  const phases = [];
  const instance = controller([mission()]);
  instance.subscribe(event => {
    if (event.type === 'PHASE_CHANGED') phases.push(event.current.phase);
  });

  instance.prepare('mission-alpha');
  instance.beginBriefing();
  instance.accept({ baseTimeLimit: 60, baseReward: 500 });
  instance.beginExecution();
  instance.resolveSuccess({ payout: 650 });
  instance.beginCleanup();
  assert.equal(instance.canSave().allowed, false);
  const transaction = instance.createOutcomeTransaction();
  assert.equal(transaction.commands[0].amount, 650);
  instance.commitCleanup({ transactionId: transaction.transactionId, effects: [] });

  assert.equal(instance.phase, MISSION_PHASES.RESULT);
  assert.equal(instance.currentMission.id, 'mission-alpha');
  assert.equal(instance.progressSnapshot().completedMissionIds.includes('mission-alpha'), true);
  assert.equal(instance.canSave().allowed, true);
  instance.beginRecovery();
  instance.finishRecovery();
  assert.equal(instance.phase, MISSION_PHASES.IDLE);
  assert.equal(instance.currentMission, null);
  assert.deepEqual(phases, [
    'PREPARATION', 'BRIEFING', 'APPROACH', 'ACTIVE', 'COMPLETION',
    'CLEANUP', 'RESULT', 'RECOVERY', 'IDLE'
  ]);
});

test('outcome cleanup uses one idempotent transaction identity per run attempt', () => {
  const economy = new EconomySystem({ initialTreasury: 1_000 });
  const outcomeService = new MissionOutcomeService({ economySystem: economy });
  const instance = controller([mission()], { outcomeService });
  begin(instance);
  instance.resolveSuccess({ payout: 500 });
  instance.beginCleanup();
  const transaction = instance.createOutcomeTransaction();
  const first = outcomeService.apply(transaction);
  const duplicate = outcomeService.apply(transaction);
  instance.commitCleanup(first);

  assert.equal(transaction.transactionId, 'mission:mission-alpha:run-1:attempt-1:SUCCESS');
  assert.equal(economy.treasury, 1_500);
  assert.equal(duplicate.duplicate, true);
  assert.equal(instance.snapshot().run.receipt.transactionId, first.transactionId);
});

test('race and sabotage retries recover the latest checkpoint while delivery restarts', () => {
  const race = controller([mission({ missionType: 'RACE' })]);
  begin(race);
  race.recordCheckpoint('race:checkpoint-2', { routeIndex: 2, timeRemaining: 31 });
  race.resumeFromCheckpoint();
  commitResult(race, 'FAILURE', 'race_lost');
  const raceRetry = race.getRetryDecision();
  assert.equal(raceRetry.strategy, MISSION_RETRY_STRATEGIES.LAST_CHECKPOINT);
  assert.deepEqual(raceRetry.checkpoint.payload, { routeIndex: 2, timeRemaining: 31 });

  race.beginRecovery({ retry: true });
  race.finishRecovery({ retry: true });
  assert.equal(race.phase, MISSION_PHASES.APPROACH);
  assert.equal(race.snapshot().run.attempt, 2);

  const delivery = controller([mission()]);
  begin(delivery);
  delivery.recordCheckpoint('delivery:approach', { timeRemaining: 25 });
  delivery.resumeFromCheckpoint();
  commitResult(delivery, 'FAILURE');
  const deliveryRetry = delivery.getRetryDecision();
  assert.equal(deliveryRetry.strategy, MISSION_RETRY_STRATEGIES.RESTART);
  assert.equal(deliveryRetry.checkpoint, null);
});

test('retry attempts are bounded and each failed attempt receives a distinct transaction', () => {
  const instance = controller([mission({ retryPolicy: { strategy: 'RESTART', maxAttempts: 2 } })]);
  begin(instance);
  const first = commitResult(instance, 'FAILURE');
  instance.beginRecovery({ retry: true });
  instance.finishRecovery({ retry: true });
  instance.beginExecution();
  const second = commitResult(instance, 'FAILURE');

  assert.notEqual(first.transactionId, second.transactionId);
  assert.equal(second.transactionId.includes('attempt-2'), true);
  const decision = instance.getRetryDecision();
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /limit reached/i);
  assert.throws(() => instance.beginRecovery({ retry: true }), /limit reached/i);
});

test('weather policy explicitly allows, adapts, delays, and blocks mission starts', () => {
  const standard = mission();
  const clear = evaluateMissionWeather(standard, 'clear');
  const rain = evaluateMissionWeather(standard, 'rain');
  const storm = evaluateMissionWeather(standard, 'thunderstorm');
  const race = evaluateMissionWeather(mission({ weatherPolicy: 'DRY_COMPETITION' }), 'thunderstorm');

  assert.equal(clear.disposition, 'ALLOWED');
  assert.equal(rain.disposition, 'ADAPTED');
  assert.equal(rain.timeLimitMultiplier, 1.2);
  assert.equal(storm.disposition, 'DELAYED');
  assert.equal(race.disposition, 'BLOCKED');

  const delayed = controller([standard], { weatherProvider: () => 'thunderstorm' });
  assert.equal(delayed.evaluateAvailability('mission-alpha').status, MISSION_AVAILABILITY.DELAYED);
  assert.throws(() => delayed.prepare('mission-alpha'), error => (
    error.code === 'MISSION_DELAYED' && /thunderstorm passes/i.test(error.message)
  ));
});

test('checkpoint and result lifecycle state round-trip without exposing mutable internals', () => {
  const source = controller([mission({ missionType: 'SABOTAGE' })]);
  begin(source);
  source.recordCheckpoint('target-arrival', { targetId: 'bridge-relay', timeRemaining: 41 });
  const serialized = source.serialize();
  assert.equal(validateMissionLifecycleState(serialized), true);

  const target = controller([mission({ missionType: 'SABOTAGE' })]);
  const restored = target.restore(serialized);
  assert.equal(restored.phase, MISSION_PHASES.CHECKPOINT);
  assert.deepEqual(restored.run.checkpoint.payload, { targetId: 'bridge-relay', timeRemaining: 41 });
  serialized.run.checkpoint.payload.timeRemaining = 0;
  assert.equal(target.snapshot().run.checkpoint.payload.timeRemaining, 41);
});

test('cleanup failures remain mission-critical and cannot clear or save partial results', () => {
  const instance = controller([mission()]);
  begin(instance);
  instance.resolveSuccess({ payout: 500 });
  instance.beginCleanup();
  instance.recordCleanupFailure(new Error('outcome storage unavailable'));

  assert.equal(instance.phase, MISSION_PHASES.CLEANUP);
  assert.equal(instance.isMissionCritical, true);
  assert.equal(instance.canSave().allowed, false);
  assert.match(instance.snapshot().run.cleanupError, /storage unavailable/);
  assert.throws(() => instance.beginRecovery(), /expected RESULT/);
});
