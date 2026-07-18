import assert from 'node:assert/strict';
import test from 'node:test';

import missions from '../src/data/missions.json' with { type: 'json' };
import {
  MVP_ACTIVITY_TEMPLATES,
  MVP_MISSION_IDS,
  MVP_WORLD_FOOTPRINT,
  MVP_ZONE_LABELS
} from '../src/config/MvpScope.js';

test('MVP scope locks mission, activity, world, and Operations vocabulary budgets', () => {
  assert.ok(MVP_MISSION_IDS.length >= 8 && MVP_MISSION_IDS.length <= 12);
  assert.ok(MVP_ACTIVITY_TEMPLATES.length >= 5 && MVP_ACTIVITY_TEMPLATES.length <= 7);
  assert.deepEqual(MVP_WORLD_FOOTPRINT, [
    'WEST_CORE',
    'CENTRAL_PARK',
    'PRIMARY_BRIDGE_CORRIDOR'
  ]);
  assert.equal(MVP_ZONE_LABELS.INDUSTRIAL, 'Operations');
  assert.equal(new Set(MVP_MISSION_IDS).size, MVP_MISSION_IDS.length);
  assert.ok(MVP_MISSION_IDS.every(id => missions.some(mission => mission.id === id)));
});

test('frozen MVP missions use only the frozen activity-template families', () => {
  const scoped = missions.filter(mission => MVP_MISSION_IDS.includes(mission.id));
  const templateTypes = new Set(scoped.map(mission => (
    mission.missionType || mission.objectiveType
  )));
  assert.deepEqual([...templateTypes].sort(), [...MVP_ACTIVITY_TEMPLATES].sort());
});

