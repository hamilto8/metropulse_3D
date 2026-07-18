/**
 * Stable feature identifiers for release-scope decisions.
 *
 * Flags describe player-facing capabilities, not implementation modules. Keep
 * identifiers stable because diagnostics, browser scenarios, and save-policy
 * adapters use them as a shared vocabulary.
 */
export const FEATURE_IDS = Object.freeze({
  AIRCRAFT: 'aircraft',
  ROCKET_LAUNCH: 'rocketLaunch',
  EAST_SIDE_DEVELOPMENT: 'eastSideDevelopment',
  TEMPORARY_MAYHEM: 'temporaryMayhem',
  MAYHEM_VARIANTS: 'mayhemVariants',
  PERSISTENT_MAYHEM: 'persistentMayhem',
  COUNTRYSIDE_EXPANSION: 'countrysideExpansion'
});

/** The Phase 0 scope lock. Changes require a recorded design amendment. */
export const MVP_FEATURE_FLAGS = Object.freeze({
  [FEATURE_IDS.AIRCRAFT]: false,
  [FEATURE_IDS.ROCKET_LAUNCH]: false,
  [FEATURE_IDS.EAST_SIDE_DEVELOPMENT]: false,
  // MVP-scoped, but held closed until rollback/cleanup acceptance passes.
  [FEATURE_IDS.TEMPORARY_MAYHEM]: false,
  [FEATURE_IDS.MAYHEM_VARIANTS]: false,
  [FEATURE_IDS.PERSISTENT_MAYHEM]: false,
  [FEATURE_IDS.COUNTRYSIDE_EXPANSION]: false
});

const KNOWN_FEATURES = Object.freeze(Object.values(FEATURE_IDS));

function assertKnownFeature(featureId) {
  if (!KNOWN_FEATURES.includes(featureId)) {
    throw new RangeError(`Unknown feature flag: ${String(featureId)}`);
  }
}

export class FeatureFlags {
  #values;

  constructor(overrides = {}) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      throw new TypeError('Feature flag overrides must be an object');
    }

    const values = { ...MVP_FEATURE_FLAGS };
    for (const [featureId, enabled] of Object.entries(overrides)) {
      assertKnownFeature(featureId);
      if (typeof enabled !== 'boolean') {
        throw new TypeError(`Feature flag ${featureId} must be a boolean`);
      }
      values[featureId] = enabled;
    }
    this.#values = Object.freeze(values);
  }

  isEnabled(featureId) {
    assertKnownFeature(featureId);
    return this.#values[featureId];
  }

  snapshot() {
    return Object.freeze({ ...this.#values });
  }
}

/**
 * Applies declarative feature visibility after the DOM has loaded. Elements
 * use `data-feature="<stable id>"`; no feature-specific UI branching is needed.
 */
export function applyFeatureVisibility(root, featureFlags) {
  if (!root?.querySelectorAll || !(featureFlags instanceof FeatureFlags)) return 0;

  const elements = root.querySelectorAll('[data-feature]');
  for (const element of elements) {
    const featureId = element.dataset.feature;
    const enabled = featureFlags.isEnabled(featureId);
    element.hidden = !enabled;
    element.setAttribute('aria-hidden', String(!enabled));
    if ('disabled' in element) element.disabled = !enabled;
  }
  return elements.length;
}
