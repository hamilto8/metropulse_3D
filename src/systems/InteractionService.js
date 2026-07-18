/**
 * Renderer-independent primary interaction arbitration.
 *
 * Domain systems publish immutable candidate descriptions. This service is
 * the sole owner of ranking and action resolution; it deliberately knows
 * nothing about DOM, Three.js, input devices, or any specific interactable.
 */

export const INTERACTION_PRIORITIES = Object.freeze({
  MISSION_OBJECTIVE: 1000,
  MISSION_PICKUP: 900,
  AIRCRAFT_BOARD: 800,
  VEHICLE_HIJACK: 700,
  NPC_CONVERSATION: 600,
  CONTROLLED_ENTITY_EXIT: 500,
  SELECTED_ENTITY: 100
});

export const INTERACTION_RESOLUTION = Object.freeze({
  NONE: 'NONE',
  COMPLETED: 'COMPLETED',
  INELIGIBLE: 'INELIGIBLE',
  ACTION_REJECTED: 'ACTION_REJECTED',
  ACTION_FAILED: 'ACTION_FAILED'
});

function asNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeEligibility(value, failureReason) {
  if (typeof value === 'boolean') {
    return Object.freeze({ allowed: value, reason: value ? null : failureReason });
  }
  if (!value || typeof value !== 'object' || typeof value.allowed !== 'boolean') {
    throw new TypeError('interaction eligibility must be a boolean or { allowed, reason }');
  }
  const reason = value.allowed ? null : (value.reason ?? failureReason);
  return Object.freeze({
    allowed: value.allowed,
    reason: reason == null ? null : asNonEmptyString(reason, 'interaction failure reason')
  });
}

export function normalizeInteractionCandidate(candidate, providerId = 'anonymous') {
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(`interaction provider ${providerId} returned a non-object candidate`);
  }

  const id = asNonEmptyString(candidate.id, 'interaction id');
  const kind = asNonEmptyString(candidate.kind, 'interaction kind');
  const prompt = asNonEmptyString(candidate.prompt, 'interaction prompt');
  const accessibilityLabel = asNonEmptyString(
    candidate.accessibilityLabel,
    'interaction accessibility label'
  );
  if (!Number.isFinite(candidate.priority)) {
    throw new TypeError(`interaction ${id} priority must be finite`);
  }
  const distance = candidate.distance === Infinity ? Infinity : Number(candidate.distance);
  if (!(distance >= 0) || Number.isNaN(distance)) {
    throw new TypeError(`interaction ${id} distance must be non-negative or Infinity`);
  }
  if (typeof candidate.action !== 'function') {
    throw new TypeError(`interaction ${id} action must be a function`);
  }

  const failureReason = candidate.failureReason == null
    ? null
    : asNonEmptyString(candidate.failureReason, 'interaction failure reason');
  const eligibility = normalizeEligibility(candidate.eligibility, failureReason);
  if (!eligibility.allowed && !eligibility.reason) {
    throw new TypeError(`ineligible interaction ${id} must publish a failure reason`);
  }

  return Object.freeze({
    id,
    kind,
    priority: candidate.priority,
    prompt,
    action: candidate.action,
    eligibility,
    failureReason: eligibility.reason,
    distance,
    accessibilityLabel,
    metadata: candidate.metadata == null
      ? null
      : Object.freeze({ ...candidate.metadata }),
    providerId
  });
}

/**
 * Stable total ordering: eligibility, design priority, proximity, then ID.
 * If no eligible action exists, the highest-priority ineligible candidate is
 * retained so its published failure reason can explain the blocked intent.
 * The final ID tie-break makes results independent of provider/entity order.
 */
export function compareInteractions(left, right) {
  if (left.eligibility.allowed !== right.eligibility.allowed) {
    return left.eligibility.allowed ? -1 : 1;
  }
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.distance !== right.distance) return left.distance - right.distance;
  const idOrder = left.id === right.id ? 0 : (left.id < right.id ? -1 : 1);
  if (idOrder !== 0) return idOrder;
  return left.providerId === right.providerId ? 0 : (left.providerId < right.providerId ? -1 : 1);
}

export function selectPrimaryInteraction(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort(compareInteractions)[0] || null;
}

function createSnapshot(revision, candidates, primary) {
  return Object.freeze({
    revision,
    primary,
    candidates: Object.freeze([...candidates])
  });
}

export class InteractionService {
  #providers = new Map();
  #listeners = new Set();
  #revision = 0;
  #snapshot = createSnapshot(0, [], null);
  #contextProvider;
  #onFailure;
  #onError;
  #resolving = false;

  constructor({
    contextProvider = () => Object.freeze({}),
    onFailure = null,
    onError = null
  } = {}) {
    if (typeof contextProvider !== 'function') throw new TypeError('contextProvider must be a function');
    if (onFailure !== null && typeof onFailure !== 'function') throw new TypeError('onFailure must be a function or null');
    if (onError !== null && typeof onError !== 'function') throw new TypeError('onError must be a function or null');
    this.#contextProvider = contextProvider;
    this.#onFailure = onFailure;
    this.#onError = onError;
  }

  get snapshot() {
    return this.#snapshot;
  }

  get primary() {
    return this.#snapshot.primary;
  }

  registerProvider({ id, getCandidates }) {
    const providerId = asNonEmptyString(id, 'interaction provider id');
    if (typeof getCandidates !== 'function') throw new TypeError('getCandidates must be a function');
    if (this.#providers.has(providerId)) {
      throw new Error(`interaction provider already registered: ${providerId}`);
    }
    this.#providers.set(providerId, getCandidates);
    let registered = true;
    return () => {
      if (!registered) return false;
      registered = false;
      return this.#providers.delete(providerId);
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return false;
      subscribed = false;
      return this.#listeners.delete(listener);
    };
  }

  refresh() {
    let context;
    try {
      context = Object.freeze({ ...(this.#contextProvider() || {}) });
    } catch (error) {
      this.#reportError(error, 'context');
      context = Object.freeze({});
    }

    const candidates = [];
    for (const [providerId, getCandidates] of this.#providers) {
      try {
        const published = getCandidates(context);
        if (published == null) continue;
        const providerCandidates = Array.isArray(published) ? published : [published];
        for (const candidate of providerCandidates) {
          if (candidate == null) continue;
          candidates.push(normalizeInteractionCandidate(candidate, providerId));
        }
      } catch (error) {
        this.#reportError(error, providerId);
      }
    }

    candidates.sort(compareInteractions);
    const primary = candidates[0] || null;
    this.#revision += 1;
    this.#snapshot = createSnapshot(this.#revision, candidates, primary);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch (error) {
        this.#reportError(error, 'listener');
      }
    }
    return this.#snapshot;
  }

  resolvePrimary() {
    if (this.#resolving) {
      return Object.freeze({ handled: false, status: INTERACTION_RESOLUTION.NONE, candidate: null });
    }

    const candidate = this.refresh().primary;
    if (!candidate) {
      return Object.freeze({ handled: false, status: INTERACTION_RESOLUTION.NONE, candidate: null });
    }
    if (!candidate.eligibility.allowed) {
      this.#onFailure?.(candidate.failureReason, candidate);
      return Object.freeze({
        handled: true,
        status: INTERACTION_RESOLUTION.INELIGIBLE,
        candidate,
        reason: candidate.failureReason
      });
    }

    this.#resolving = true;
    try {
      const result = candidate.action(Object.freeze({ candidate, context: this.#contextProvider() || {} }));
      return Object.freeze({
        handled: true,
        status: result === false
          ? INTERACTION_RESOLUTION.ACTION_REJECTED
          : INTERACTION_RESOLUTION.COMPLETED,
        candidate,
        result
      });
    } catch (error) {
      this.#reportError(error, candidate.providerId);
      return Object.freeze({
        handled: true,
        status: INTERACTION_RESOLUTION.ACTION_FAILED,
        candidate,
        error
      });
    } finally {
      this.#resolving = false;
      this.refresh();
    }
  }

  clear() {
    this.#revision += 1;
    this.#snapshot = createSnapshot(this.#revision, [], null);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch (error) {
        this.#reportError(error, 'listener');
      }
    }
    return this.#snapshot;
  }

  #reportError(error, source) {
    if (this.#onError) this.#onError(error, source);
  }
}

export default InteractionService;
