import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InteractionService,
  INTERACTION_PRIORITIES,
  INTERACTION_RESOLUTION,
  normalizeInteractionCandidate,
  selectPrimaryInteraction
} from '../src/systems/InteractionService.js';

function candidate({
  id,
  kind = 'TEST',
  priority = 100,
  distance = 1,
  eligibility = true,
  failureReason = null,
  action = () => true
}) {
  return {
    id,
    kind,
    priority,
    prompt: `use ${id}`,
    action,
    eligibility,
    failureReason,
    distance,
    accessibilityLabel: `Use ${id}`
  };
}

test('interaction contract requires every player-facing and resolution field', () => {
  const valid = normalizeInteractionCandidate(candidate({ id: 'door:a' }), 'doors');
  assert.equal(valid.eligibility.allowed, true);
  assert.equal(valid.providerId, 'doors');
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid.eligibility));

  for (const key of [
    'id', 'kind', 'priority', 'prompt', 'action', 'eligibility',
    'distance', 'accessibilityLabel'
  ]) {
    const invalid = candidate({ id: 'invalid' });
    delete invalid[key];
    assert.throws(() => normalizeInteractionCandidate(invalid), /interaction|priority|distance|getCandidates/i);
  }
  assert.throws(
    () => normalizeInteractionCandidate(candidate({ id: 'locked', eligibility: false })),
    /failure reason/
  );
});

test('priority resolution is deterministic across missions, vehicles, NPCs, and doors', () => {
  const calls = [];
  const interactions = [
    candidate({
      id: 'npc:alex',
      kind: 'NPC',
      priority: INTERACTION_PRIORITIES.NPC_CONVERSATION,
      distance: 0.5,
      action: () => calls.push('npc')
    }),
    candidate({
      id: 'vehicle:coupe',
      kind: 'VEHICLE',
      priority: INTERACTION_PRIORITIES.VEHICLE_HIJACK,
      distance: 0.2,
      action: () => calls.push('vehicle')
    }),
    candidate({
      id: 'door:warehouse',
      kind: 'DOOR',
      priority: INTERACTION_PRIORITIES.VEHICLE_HIJACK,
      distance: 0.2,
      action: () => calls.push('door')
    }),
    candidate({
      id: 'mission:pickup',
      kind: 'MISSION_PICKUP',
      priority: INTERACTION_PRIORITIES.MISSION_PICKUP,
      distance: 4,
      action: () => calls.push('mission')
    })
  ].map(value => normalizeInteractionCandidate(value, value.kind.toLowerCase()));

  assert.equal(selectPrimaryInteraction(interactions).id, 'mission:pickup');
  assert.equal(selectPrimaryInteraction([...interactions].reverse()).id, 'mission:pickup');

  const withoutMission = interactions.filter(value => value.kind !== 'MISSION_PICKUP');
  assert.equal(selectPrimaryInteraction(withoutMission).id, 'door:warehouse');
  assert.equal(selectPrimaryInteraction([...withoutMission].reverse()).id, 'door:warehouse');
  assert.deepEqual(calls, []);
});

test('equal-priority candidates prefer eligibility, then distance, then stable ID', () => {
  const normalized = [
    candidate({ id: 'door:locked', priority: 500, distance: 0.1, eligibility: false, failureReason: 'Locked.' }),
    candidate({ id: 'door:z', priority: 500, distance: 2 }),
    candidate({ id: 'door:a', priority: 500, distance: 2 })
  ].map(value => normalizeInteractionCandidate(value, 'doors'));
  assert.equal(selectPrimaryInteraction(normalized).id, 'door:a');

  const highPriorityFailure = normalizeInteractionCandidate(candidate({
    id: 'mission:blocked',
    priority: 900,
    distance: 10,
    eligibility: false,
    failureReason: 'Wrong vehicle.'
  }), 'missions');
  assert.equal(selectPrimaryInteraction([...normalized, highPriorityFailure]).id, 'door:a');
  assert.equal(
    selectPrimaryInteraction([normalized[0], highPriorityFailure]).id,
    'mission:blocked'
  );
});

test('one primary snapshot is published even when providers overlap', () => {
  const service = new InteractionService({ contextProvider: () => ({ state: 'STREET' }) });
  const observed = [];
  service.subscribe(snapshot => observed.push(snapshot));
  service.registerProvider({
    id: 'vehicles',
    getCandidates: context => [
      candidate({ id: `vehicle:${context.state}:b`, priority: 700, distance: 2 }),
      candidate({ id: `vehicle:${context.state}:a`, priority: 700, distance: 2 })
    ]
  });
  service.registerProvider({
    id: 'npcs',
    getCandidates: () => candidate({ id: 'npc:one', priority: 600, distance: 1 })
  });

  const snapshot = service.refresh();
  assert.equal(snapshot.primary.id, 'vehicle:STREET:a');
  assert.equal(snapshot.candidates.length, 3);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].primary, snapshot.primary);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.candidates));
});

test('resolution executes the highest-priority eligible winner and reports failures when none are eligible', () => {
  const calls = [];
  const failures = [];
  const eligibleService = new InteractionService({
    onFailure: (reason, interaction) => failures.push([reason, interaction.id])
  });
  eligibleService.registerProvider({
    id: 'world',
    getCandidates: () => [
      candidate({ id: 'npc', priority: 600, action: () => calls.push('npc') }),
      candidate({ id: 'mission', priority: 900, eligibility: false, failureReason: 'Stop first.', action: () => calls.push('mission') })
    ]
  });

  assert.equal(eligibleService.resolvePrimary().status, INTERACTION_RESOLUTION.COMPLETED);
  assert.deepEqual(calls, ['npc']);
  assert.deepEqual(failures, []);

  const blockedService = new InteractionService({
    onFailure: (reason, interaction) => failures.push([reason, interaction.id])
  });
  blockedService.registerProvider({
    id: 'world',
    getCandidates: () => [
      candidate({ id: 'exit', priority: 500, eligibility: false, failureReason: 'Mission active.' }),
      candidate({ id: 'mission', priority: 900, eligibility: false, failureReason: 'Stop first.', action: () => calls.push('mission') })
    ]
  });
  const blocked = blockedService.resolvePrimary();
  assert.equal(blocked.handled, true);
  assert.equal(blocked.status, INTERACTION_RESOLUTION.INELIGIBLE);
  assert.deepEqual(failures, [['Stop first.', 'mission']]);
  assert.deepEqual(calls, ['npc']);

  const executable = new InteractionService();
  executable.registerProvider({
    id: 'world',
    getCandidates: () => candidate({ id: 'door', action: () => calls.push('door') })
  });
  assert.equal(executable.resolvePrimary().status, INTERACTION_RESOLUTION.COMPLETED);
  assert.deepEqual(calls, ['npc', 'door']);
});

test('provider and action failures are isolated and stale providers unregister idempotently', () => {
  const errors = [];
  const service = new InteractionService({ onError: (error, source) => errors.push([error.message, source]) });
  const unregister = service.registerProvider({
    id: 'broken-provider',
    getCandidates: () => { throw new Error('provider failed'); }
  });
  service.registerProvider({
    id: 'broken-action',
    getCandidates: () => candidate({ id: 'action', action: () => { throw new Error('action failed'); } })
  });

  assert.equal(service.resolvePrimary().status, INTERACTION_RESOLUTION.ACTION_FAILED);
  assert.deepEqual(errors, [
    ['provider failed', 'broken-provider'],
    ['action failed', 'broken-action'],
    ['provider failed', 'broken-provider']
  ]);
  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
});
