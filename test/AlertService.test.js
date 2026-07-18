import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_STATES,
  ALERT_TYPES,
  AlertService,
  validateAlertState
} from '../src/alerts/AlertService.js';
import { AlertActionController } from '../src/alerts/AlertActionController.js';

function structuredAlert(overrides = {}) {
  return {
    dedupeKey: 'traffic:bridge-gridlock',
    type: ALERT_TYPES.TRAFFIC,
    severity: ALERT_SEVERITIES.WARNING,
    title: 'Bridge traffic is stalled',
    cause: 'A disabled vehicle is blocking the eastbound lane.',
    location: {
      label: 'West Core bridge',
      districtId: 'WEST_CORE',
      position: { x: 160, y: 3, z: 0 }
    },
    duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
    recommendation: 'Focus the bridge and dispatch a repair crew.',
    relatedEntityIds: ['bridge-primary', 'vehicle-17'],
    focusAction: { type: ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA },
    ...overrides
  };
}

test('structured alerts retain every P3.4 field as immutable domain data', () => {
  const service = new AlertService({
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => 'alert-bridge'
  });
  const alert = service.publish(structuredAlert());

  assert.equal(alert.id, 'alert-bridge');
  assert.equal(alert.type, ALERT_TYPES.TRAFFIC);
  assert.equal(alert.severity, ALERT_SEVERITIES.WARNING);
  assert.equal(alert.cause, 'A disabled vehicle is blocking the eastbound lane.');
  assert.deepEqual(alert.location.position, { x: 160, y: 3, z: 0 });
  assert.equal(alert.startTime, '2026-07-18T12:00:00.000Z');
  assert.deepEqual(alert.duration, { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED, seconds: null });
  assert.equal(alert.state, ALERT_STATES.ACTIVE);
  assert.match(alert.recommendation, /repair crew/);
  assert.deepEqual(alert.relatedEntityIds, ['bridge-primary', 'vehicle-17']);
  assert.equal(alert.focusAction.type, ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA);
  assert.equal(Object.isFrozen(alert), true);
  assert.equal(Object.isFrozen(alert.location), true);
  assert.throws(() => { alert.location.label = 'Changed'; }, TypeError);
});

test('duplicate observations update one active alert and preserve its original start', () => {
  let time = '2026-07-18T12:00:00.000Z';
  let ids = 0;
  const service = new AlertService({ now: () => new Date(time), idFactory: () => `alert-${++ids}` });
  const first = service.publish(structuredAlert());
  time = '2026-07-18T12:01:00.000Z';
  const second = service.publish(structuredAlert({ severity: ALERT_SEVERITIES.CRITICAL }));

  assert.equal(second.id, first.id);
  assert.equal(second.startTime, first.startTime);
  assert.equal(second.lastObservedAt, time);
  assert.equal(second.occurrences, 2);
  assert.equal(second.severity, ALERT_SEVERITIES.CRITICAL);
  assert.equal(service.snapshot().active.length, 1);
  assert.equal(service.serialize().items.length, 1);
});

test('alerts resolve or supersede explicitly and bounded history cannot grow on duplicates', () => {
  let ids = 0;
  const service = new AlertService({
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => `alert-${++ids}`,
    maxRecords: 10
  });
  const first = service.publish(structuredAlert());
  const replacement = service.publish(structuredAlert({
    dedupeKey: 'traffic:bridge-repair',
    title: 'Bridge repair crew dispatched',
    severity: ALERT_SEVERITIES.INFO,
    supersedes: [first.id]
  }));

  assert.equal(service.find(first.id).state, ALERT_STATES.SUPERSEDED);
  assert.equal(service.find(first.id).supersededBy, replacement.id);
  assert.equal(service.resolve(replacement.id, 'Repair completed').state, ALERT_STATES.RESOLVED);
  assert.equal(service.snapshot().active.length, 0);

  for (let index = 0; index < 30; index += 1) {
    service.publish(structuredAlert({
      dedupeKey: 'traffic:repeating-sensor',
      title: 'Repeated sensor report',
      focusAction: { type: ALERT_FOCUS_ACTIONS.NONE }
    }));
  }
  assert.equal(service.snapshot().active.length, 1);
  assert.equal(service.find('traffic:repeating-sensor').occurrences, 30);
  assert.ok(service.serialize().items.length <= 10);
});

test('timed alerts expire deterministically and structured state survives save/restore', () => {
  let time = '2026-07-18T12:00:00.000Z';
  const service = new AlertService({ now: () => new Date(time), idFactory: () => 'alert-timed' });
  service.publish(structuredAlert({
    duration: { kind: ALERT_DURATION_KINDS.TIMED, seconds: 30 },
    focusAction: { type: ALERT_FOCUS_ACTIONS.STREET_WAYPOINT }
  }));
  time = '2026-07-18T12:00:29.999Z';
  assert.equal(service.expire().length, 0);
  time = '2026-07-18T12:00:30.000Z';
  assert.equal(service.expire().length, 1);

  const serialized = service.serialize();
  assert.equal(validateAlertState(serialized), true);
  const restored = new AlertService({ now: () => new Date(time) });
  restored.restore(serialized);
  assert.deepEqual(restored.serialize(), serialized);
});

test('legacy feeds migrate to complete records and malformed focus actions fail validation', () => {
  const service = new AlertService({
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => 'legacy-alert'
  });
  service.restore({
    version: 1,
    items: [{ time: '08:00', message: 'Police dispatched to city sector', type: 'danger' }]
  });
  const migrated = service.snapshot().active[0];
  assert.equal(migrated.type, ALERT_TYPES.CRIME);
  assert.equal(migrated.severity, ALERT_SEVERITIES.CRITICAL);
  assert.equal(migrated.location.label, 'Citywide');
  assert.ok(migrated.recommendation.length > 0);

  assert.throws(() => service.publish(structuredAlert({
    location: 'Unknown area',
    focusAction: { type: ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA }
  })), /world position/);
  assert.throws(() => validateAlertState({
    version: 2,
    sequence: 1,
    items: [{ ...service.serialize().items[0], version: 99 }]
  }), /record version/);
});

test('alert actions focus management camera or own one street waypoint until resolution', () => {
  let ids = 0;
  const service = new AlertService({
    now: () => new Date('2026-07-18T12:00:00.000Z'),
    idFactory: () => `action-${++ids}`
  });
  let gameState = 'MANAGEMENT';
  const cameraCalls = [];
  const feedback = [];
  const controller = new AlertActionController({
    alertService: service,
    sceneManager: { focusWorldPosition(position) { cameraCalls.push(position); return true; } },
    getGameState: () => gameState,
    onFeedback: (message, ok) => feedback.push({ message, ok })
  });
  const cameraAlert = service.publish(structuredAlert());
  assert.equal(controller.execute(cameraAlert.id).ok, true);
  assert.deepEqual(cameraCalls[0], { x: 160, y: 3, z: 0 });

  gameState = 'STREET_VEHICLE';
  assert.equal(controller.execute(cameraAlert.id).ok, false);
  const waypointAlert = service.publish(structuredAlert({
    dedupeKey: 'crime:street-waypoint',
    type: ALERT_TYPES.CRIME,
    focusAction: { type: ALERT_FOCUS_ACTIONS.STREET_WAYPOINT }
  }));
  assert.equal(controller.execute(waypointAlert.id).ok, true);
  assert.equal(controller.getWaypoint().alertId, waypointAlert.id);
  service.resolve(waypointAlert.id, 'Incident cleared');
  assert.equal(controller.getWaypoint(), null);
  assert.equal(feedback.at(-1).ok, true);
  controller.destroy();
});
