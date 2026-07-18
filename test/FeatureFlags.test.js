import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEATURE_IDS,
  FeatureFlags,
  MVP_FEATURE_FLAGS
} from '../src/config/FeatureFlags.js';

test('MVP feature flags keep post-MVP breadth disabled', () => {
  const flags = new FeatureFlags();
  assert.deepEqual(flags.snapshot(), MVP_FEATURE_FLAGS);
  assert.equal(flags.isEnabled(FEATURE_IDS.TEMPORARY_MAYHEM), false);
  assert.equal(flags.isEnabled(FEATURE_IDS.AIRCRAFT), false);
  assert.equal(flags.isEnabled(FEATURE_IDS.ROCKET_LAUNCH), false);
  assert.equal(flags.isEnabled(FEATURE_IDS.EAST_SIDE_DEVELOPMENT), false);
  assert.equal(flags.isEnabled(FEATURE_IDS.PERSISTENT_MAYHEM), false);
});

test('feature overrides are validated and snapshots are immutable', () => {
  const flags = new FeatureFlags({ [FEATURE_IDS.AIRCRAFT]: true });
  const snapshot = flags.snapshot();
  assert.equal(snapshot.aircraft, true);
  assert.throws(() => new FeatureFlags({ unknown: true }), /Unknown feature flag/);
  assert.throws(() => new FeatureFlags({ aircraft: 'yes' }), /must be a boolean/);
  assert.throws(() => { snapshot.aircraft = false; }, TypeError);
});
