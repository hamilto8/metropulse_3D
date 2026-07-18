import test from 'node:test';
import assert from 'node:assert/strict';

import { MISSION_OUTCOME_COMMANDS as COMMANDS } from '../src/missions/MissionOutcomeService.js';
import {
  MISSION_RESULT_KINDS,
  RESULT_SECTION_IDS,
  buildMissionResultHistory,
  buildMissionResultViewModel,
  classifyMissionResult
} from '../src/ui/MissionResultViewModel.js';

function explanation(overrides = {}) {
  return {
    transactionId: 'mission:bridge:run-1:attempt-1:SUCCESS',
    source: {
      kind: 'MISSION',
      contentId: 'mission_executive',
      outcome: 'SUCCESS',
      runId: 'mission_executive:run-1',
      reason: null
    },
    title: 'Bridge response complete',
    description: 'The response restored access and public confidence.',
    effects: [
      {
        type: COMMANDS.CAPITAL_ADJUSTED,
        subjectId: 'capital',
        before: 1_000,
        after: 1_250,
        explanation: 'Emergency contract payment.'
      },
      {
        type: COMMANDS.TRAFFIC_SET,
        subjectId: 'primary-bridge',
        before: { access: 'RESTRICTED' },
        after: { access: 'OPEN' },
        explanation: 'The emergency lane reopened.'
      },
      {
        type: COMMANDS.FACTION_REPUTATION_ADJUSTED,
        subjectId: 'RESIDENTS',
        before: 4,
        after: 12,
        explanation: 'Residents noticed the quick response.'
      },
      {
        type: COMMANDS.UNLOCK_SET,
        subjectId: 'bridge-emergency-lane',
        before: null,
        after: true,
        explanation: 'The emergency lane is now available.'
      }
    ],
    ...overrides
  };
}

function lifecycle(overrides = {}) {
  return {
    phase: 'RESULT',
    selectedMissionId: 'mission_executive',
    run: {
      transactionId: 'mission:bridge:run-1:attempt-1:SUCCESS',
      attempt: 1,
      weather: {
        disposition: 'ADAPTED',
        reason: 'Rain reduced road grip, so the timer was extended.'
      },
      resolution: {
        outcome: 'SUCCESS',
        satisfaction: 88,
        damage: 0.12,
        heat: 2,
        summary: 'The bridge response succeeded.'
      }
    },
    ...overrides
  };
}

test('result view model explains cause and separates reward, city, faction, and progression changes', () => {
  const view = buildMissionResultViewModel({
    lifecycleSnapshot: lifecycle(),
    explanation: explanation(),
    mission: { id: 'mission_executive', title: 'Boardroom Emergency' },
    sequence: 7
  });

  assert.equal(view.kind, MISSION_RESULT_KINDS.SUCCESS);
  assert.equal(view.sequence, 7);
  assert.equal(view.outcomeLabel, 'Success');
  assert.match(view.why.join(' '), /Rain reduced road grip/);
  assert.equal(view.sections.map(section => section.id).join(','), 'REWARD,CITY,FACTION,PROGRESSION');

  const sections = Object.fromEntries(view.sections.map(section => [section.id, section]));
  assert.equal(sections[RESULT_SECTION_IDS.REWARD].items.length, 4);
  assert.equal(sections[RESULT_SECTION_IDS.REWARD].items[0].value, '$1,000 → $1,250 (+$250)');
  assert.equal(sections[RESULT_SECTION_IDS.CITY].items[0].value, 'Restricted access → Open access');
  assert.equal(sections[RESULT_SECTION_IDS.FACTION].items[0].value, '4 → 12 (+8)');
  assert.equal(sections[RESULT_SECTION_IDS.PROGRESSION].items[0].value, 'Unlocked');
  assert.equal(view.nextAction.canRetry, false);
  assert.match(view.announcement, /7 recorded changes/);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.sections[0].items), true);
});

test('result classification supports success, partial success, failure, abandonment, arrest, and vehicle loss', () => {
  const cases = [
    [{ outcome: 'SUCCESS' }, {}, MISSION_RESULT_KINDS.SUCCESS],
    [{ outcome: 'PARTIAL' }, {}, MISSION_RESULT_KINDS.PARTIAL_SUCCESS],
    [{ outcome: 'FAILURE', reason: 'timeout' }, {}, MISSION_RESULT_KINDS.FAILURE],
    [{ outcome: 'FAILURE', reason: 'cancelled' }, {}, MISSION_RESULT_KINDS.ABANDONED],
    [{ outcome: 'FAILURE', reason: 'arrested' }, {}, MISSION_RESULT_KINDS.ARRESTED],
    [{ outcome: 'FAILURE', reason: 'vehicle_lost' }, {}, MISSION_RESULT_KINDS.VEHICLE_LOSS]
  ];
  for (const [resolution, source, expected] of cases) {
    assert.equal(classifyMissionResult({ resolution, source }), expected);
  }
  assert.equal(classifyMissionResult({ source: { outcome: 'ARREST' } }), MISSION_RESULT_KINDS.ARRESTED);
});

test('failed result exposes bounded retry guidance without inventing retry ownership in the UI', () => {
  const snapshot = lifecycle();
  snapshot.run.resolution = { outcome: 'FAILURE', reason: 'vehicle_lost' };
  const source = explanation();
  source.source.outcome = 'FAILURE';
  source.source.reason = 'vehicle_lost';

  const view = buildMissionResultViewModel({
    lifecycleSnapshot: snapshot,
    explanation: source,
    retryDecision: {
      allowed: true,
      reason: 'Restart from mission approach.',
      attemptsRemaining: 2,
      checkpoint: null
    }
  });

  assert.equal(view.kind, MISSION_RESULT_KINDS.VEHICLE_LOSS);
  assert.equal(view.nextAction.canRetry, true);
  assert.equal(view.nextAction.retryLabel, 'Retry mission');
  assert.match(view.nextAction.description, /2 attempts remain/);
  assert.match(view.why[0], /required mission vehicle/);
});

test('persistent history is newest-first and retains receipt-time explanations', () => {
  const first = {
    version: 1,
    sequence: 1,
    transactionId: 'first',
    source: { kind: 'MISSION', contentId: 'mission_executive', outcome: 'FAILURE', runId: 'run-1', reason: 'timeout' },
    summary: { title: 'First result', description: 'The timer expired.' },
    effects: []
  };
  const second = {
    version: 1,
    sequence: 2,
    transactionId: 'second',
    source: { kind: 'MISSION', contentId: 'mission_executive', outcome: 'PARTIAL', runId: 'run-2', reason: 'One objective remained.' },
    summary: { title: 'Second result', description: 'Access improved, but repairs remain.' },
    effects: [{
      type: COMMANDS.REPAIR_SET,
      subjectId: 'primary-bridge',
      before: { status: 'NOT_STARTED' },
      after: { status: 'SCHEDULED' },
      explanation: 'Repair crews were scheduled when the result committed.'
    }]
  };

  const history = buildMissionResultHistory({
    receipts: [first, second],
    missions: [{ id: 'mission_executive', title: 'Boardroom Emergency' }]
  });

  assert.deepEqual(history.map(entry => entry.transactionId), ['second', 'first']);
  assert.equal(history[0].kind, MISSION_RESULT_KINDS.PARTIAL_SUCCESS);
  assert.equal(history[0].sections.find(section => section.id === RESULT_SECTION_IDS.CITY).items[0].explanation,
    'Repair crews were scheduled when the result committed.');
  assert.equal(history[1].why[0], 'The mission timer expired before the final objective was completed.');
});
