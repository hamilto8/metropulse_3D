import { FEATURE_IDS, FeatureFlags } from '../config/FeatureFlags.js';
import { normalizeWeatherMode } from '../systems/Weather.js';

export const DEFAULT_TEST_SEED = 'metropulse-phase-0';

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function parseFeatureOverrides(params, allowOverrides) {
  if (!allowOverrides) return {};
  const enabled = new Set((params.get('features') || '').split(',').filter(Boolean));
  const disabled = new Set((params.get('disableFeatures') || '').split(',').filter(Boolean));
  const overrides = {};

  for (const featureId of Object.values(FEATURE_IDS)) {
    if (enabled.has(featureId)) overrides[featureId] = true;
    if (disabled.has(featureId)) overrides[featureId] = false;
  }
  return overrides;
}

function parseUnavailableCapabilities(params) {
  const allowed = new Set(['webgl2', 'localStorage', 'indexedDB']);
  return Object.freeze(
    (params.get('unavailableCapabilities') || '')
      .split(',')
      .filter(capability => allowed.has(capability))
  );
}

/**
 * Converts a URL into immutable runtime policy. Test and feature overrides are
 * accepted only in explicitly enabled development/test builds.
 */
export function createRuntimeConfig({
  search = '',
  allowTestMode = false,
  allowFeatureOverrides = allowTestMode
} = {}) {
  const params = new URLSearchParams(search);
  const testRequested = params.get('testMode') === '1';
  const testEnabled = Boolean(allowTestMode && testRequested);
  const featureFlags = new FeatureFlags(
    parseFeatureOverrides(params, Boolean(allowFeatureOverrides))
  );

  const test = testEnabled
    ? Object.freeze({
      seed: params.get('seed') || DEFAULT_TEST_SEED,
      trafficCount: clampInteger(params.get('traffic'), 12, 0, 48),
      pedestrianCount: clampInteger(params.get('pedestrians'), 16, 0, 60),
      time: clampNumber(params.get('time'), 9.25, 0, 24),
      weather: normalizeWeatherMode(params.get('weather') || 'clear'),
      missionId: params.get('mission') || 'mission_executive',
      cleanProfile: params.get('profile') === 'clean',
      unavailableCapabilities: parseUnavailableCapabilities(params)
    })
    : null;

  return Object.freeze({
    diagnosticsEnabled: testEnabled || (allowTestMode && params.get('diagnostics') === '1'),
    featureFlags,
    test
  });
}

/** xmur3 + mulberry32 provide a compact, repeatable PRNG for test scenarios. */
export function createSeededRandom(seed = DEFAULT_TEST_SEED) {
  let hash = 1779033703 ^ String(seed).length;
  for (let index = 0; index < String(seed).length; index += 1) {
    hash = Math.imul(hash ^ String(seed).charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
  let value = state();

  return () => {
    value += 0x6D2B79F5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

/** Installs deterministic randomness before any world or agent is created. */
export function installDeterministicRandom(testConfig, target = Math) {
  if (!testConfig) return () => {};
  const previous = target.random;
  target.random = createSeededRandom(testConfig.seed);
  return () => {
    target.random = previous;
  };
}
