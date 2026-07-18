import test from 'node:test';
import assert from 'node:assert/strict';

import { GAME_STATES } from '../src/core/GameManager.js';
import { ServiceWorkInteractionProvider } from '../src/systems/ServiceWorkInteractionProvider.js';

function responseHarness() {
  const order = {
    id: 'work:relay:cleanup', workType: 'CLEANUP', label: 'Clear relay debris',
    incidentId: 'relay', position: { x: 10, z: 20 }, interactionRadius: 7,
    status: 'SCHEDULED', progress: 0, prerequisiteMet: true
  };
  const performed = [];
  return {
    order,
    performed,
    service: {
      getWorkOrders: () => [order],
      performStreetWork: id => { performed.push(id); return { id }; }
    }
  };
}

test('scheduled local work becomes a high-priority accessible on-foot interaction', () => {
  const harness = responseHarness();
  const provider = new ServiceWorkInteractionProvider({
    incidentResponseService: harness.service,
    getPlayerPosition: () => ({ x: 12, z: 20 })
  });
  const [candidate] = provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_ON_FOOT });
  assert.equal(candidate.kind, 'SERVICE_CLEANUP');
  assert.equal(candidate.priority, 950);
  assert.equal(candidate.eligibility.allowed, true);
  assert.match(candidate.accessibilityLabel, /0 percent complete/);
  candidate.action();
  assert.deepEqual(harness.performed, ['work:relay:cleanup']);
});

test('vehicle, distance, prerequisite, and mission ownership guards explain blocked work', () => {
  const harness = responseHarness();
  let player = { x: 12, z: 20 };
  let missionCritical = false;
  const provider = new ServiceWorkInteractionProvider({
    incidentResponseService: harness.service,
    getPlayerPosition: () => player,
    isMissionCritical: () => missionCritical
  });
  let [candidate] = provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_VEHICLE });
  assert.equal(candidate.eligibility.allowed, false);
  assert.match(candidate.failureReason, /Exit the vehicle/);

  harness.order.prerequisiteMet = false;
  [candidate] = provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_ON_FOOT });
  assert.match(candidate.failureReason, /cleanup objective/);
  harness.order.prerequisiteMet = true;
  player = { x: 30, z: 20 };
  [candidate] = provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_ON_FOOT });
  assert.match(candidate.failureReason, /within 7 metres/);
  player = { x: 50, z: 20 };
  assert.deepEqual(provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_ON_FOOT }), []);
  player = { x: 12, z: 20 };
  missionCritical = true;
  assert.deepEqual(provider.getInteractionCandidates({ gameState: GAME_STATES.STREET_ON_FOOT }), []);
});
