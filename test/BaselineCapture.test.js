import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FIXTURE_DIRECTORY,
  checkFixtures
} from '../Tools/BaselineCapture/capture.mjs';
import { buildFixtureFiles } from '../Tools/BaselineCapture/baseline-fixtures.mjs';

test('Godot Phase 0 parity fixtures are deterministic within one process', () => {
  const first = buildFixtureFiles();
  const second = buildFixtureFiles();
  assert.deepEqual([...first], [...second]);
  assert.ok(first.size >= 18);
});

test('checked-in Godot Phase 0 fixtures match the reference capture tool', async () => {
  const result = await checkFixtures(DEFAULT_FIXTURE_DIRECTORY);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.ok, true);
});
