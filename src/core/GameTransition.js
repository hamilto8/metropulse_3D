import { CONTROL_KINDS, GAME_STATES } from './GameState.js';

export const TRANSITION_REJECTION_CODES = Object.freeze({
  INVALID_STATE: 'INVALID_STATE',
  SAME_STATE: 'SAME_STATE',
  ILLEGAL_EDGE: 'ILLEGAL_EDGE',
  TRANSITION_IN_PROGRESS: 'TRANSITION_IN_PROGRESS',
  HANDOFF_UNRESOLVED: 'HANDOFF_UNRESOLVED',
  MISSION_CRITICAL: 'MISSION_CRITICAL',
  CONTROLLED_ENTITY_ACTIVE: 'CONTROLLED_ENTITY_ACTIVE',
  CONTROLLED_ENTITY_REQUIRED: 'CONTROLLED_ENTITY_REQUIRED',
  MULTIPLE_CONTROLLED_ENTITIES: 'MULTIPLE_CONTROLLED_ENTITIES',
  INVALID_RESUME_TARGET: 'INVALID_RESUME_TARGET',
  CUSTOM_GUARD_REJECTED: 'CUSTOM_GUARD_REJECTED',
  GUARD_ERROR: 'GUARD_ERROR'
});

const EMPTY_CONTEXT = Object.freeze({
  missionActive: false,
  missionCritical: false,
  missionState: 'IDLE',
  handoffPending: false,
  controlledEntityCount: 0,
  controlledEntityKind: CONTROL_KINDS.NONE,
  heatActive: false
});

export function assertTransitionOptions(options, label = 'options') {
  if (options === undefined) return {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${label} must be an object`);
  }
  return options;
}

function normalizeControlledKind(kind, count) {
  if (count > 1) return CONTROL_KINDS.MULTIPLE;
  return Object.values(CONTROL_KINDS).includes(kind)
    ? kind
    : count === 0
      ? CONTROL_KINDS.NONE
      : CONTROL_KINDS.MULTIPLE;
}

export function normalizeTransitionContext(value) {
  const context = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : EMPTY_CONTEXT;
  const count = Number.isInteger(context.controlledEntityCount)
    ? Math.max(0, context.controlledEntityCount)
    : context.controlledEntityKind && context.controlledEntityKind !== CONTROL_KINDS.NONE
      ? 1
      : 0;

  return Object.freeze({
    missionActive: Boolean(context.missionActive),
    missionCritical: Boolean(context.missionCritical),
    missionState: typeof context.missionState === 'string' ? context.missionState : 'IDLE',
    handoffPending: Boolean(context.handoffPending),
    controlledEntityCount: count,
    controlledEntityKind: normalizeControlledKind(context.controlledEntityKind, count),
    heatActive: Boolean(context.heatActive)
  });
}

function describeTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const type = typeof target.type === 'string' ? target.type : null;
  const id = target.id ?? target.economyId ?? target.name ?? null;
  if (!type && id === null) return null;
  return Object.freeze({
    type,
    id: typeof id === 'string' || typeof id === 'number' ? id : null
  });
}

export function normalizeTransitionMetadata(options) {
  const reason = typeof options.reason === 'string' ? options.reason : null;
  const source = typeof options.source === 'string' ? options.source : null;
  const correlationId = typeof options.correlationId === 'string' ? options.correlationId : null;
  return Object.freeze({
    reason,
    source,
    correlationId,
    target: describeTarget(options.target)
  });
}

export function createTransitionRejection(code, reason, details = {}) {
  return Object.freeze({
    allowed: false,
    code,
    reason,
    details: Object.freeze({ ...details })
  });
}

export const ALLOWED_TRANSITION = Object.freeze({
  allowed: true,
  code: null,
  reason: null,
  details: Object.freeze({})
});

export function isVehicleControl(kind) {
  return kind === CONTROL_KINDS.VEHICLE || kind === CONTROL_KINDS.AIRCRAFT;
}

/** Validates the ownership invariants that must hold at destination commit. */
export function validateDestinationContract(destination, context) {
  if (context.controlledEntityCount > 1) {
    return createTransitionRejection(
      TRANSITION_REJECTION_CODES.MULTIPLE_CONTROLLED_ENTITIES,
      'More than one entity currently has player control.',
      { count: context.controlledEntityCount }
    );
  }

  if (
    destination === GAME_STATES.BOOT
    || destination === GAME_STATES.LOAD
    || destination === GAME_STATES.MANAGEMENT
    || destination === GAME_STATES.BUILDER
    || destination === GAME_STATES.RESULT
  ) {
    if (context.controlledEntityCount !== 0) {
      return createTransitionRejection(
        TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_ACTIVE,
        `${destination} requires player entity control to be released.`,
        { controlledEntityKind: context.controlledEntityKind }
      );
    }
  }

  if (
    (destination === GAME_STATES.BOOT || destination === GAME_STATES.LOAD)
    && (context.missionActive || context.missionCritical)
  ) {
    return createTransitionRejection(
      TRANSITION_REJECTION_CODES.MISSION_CRITICAL,
      `${destination} cannot own an active mission.`,
      { missionState: context.missionState }
    );
  }

  if (
    (destination === GAME_STATES.MANAGEMENT || destination === GAME_STATES.BUILDER)
    && context.missionCritical
  ) {
    return createTransitionRejection(
      TRANSITION_REJECTION_CODES.MISSION_CRITICAL,
      `${destination} is unavailable until the mission reaches a resolved state.`,
      { missionState: context.missionState }
    );
  }

  if (
    destination === GAME_STATES.STREET_ON_FOOT
    && (context.controlledEntityCount !== 1 || context.controlledEntityKind !== CONTROL_KINDS.PEDESTRIAN)
  ) {
    return createTransitionRejection(
      TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_REQUIRED,
      'STREET_ON_FOOT requires exactly one controlled pedestrian.',
      { controlledEntityKind: context.controlledEntityKind }
    );
  }

  if (
    destination === GAME_STATES.STREET_VEHICLE
    && (context.controlledEntityCount !== 1 || !isVehicleControl(context.controlledEntityKind))
  ) {
    return createTransitionRejection(
      TRANSITION_REJECTION_CODES.CONTROLLED_ENTITY_REQUIRED,
      'STREET_VEHICLE requires exactly one controlled vehicle or aircraft.',
      { controlledEntityKind: context.controlledEntityKind }
    );
  }

  return ALLOWED_TRANSITION;
}

export class GameTransitionError extends Error {
  constructor(result, { from = null, to = null, transitionId = null } = {}) {
    super(result?.reason || 'Game-state transition rejected');
    this.name = 'GameTransitionError';
    this.code = result?.code || TRANSITION_REJECTION_CODES.CUSTOM_GUARD_REJECTED;
    this.from = from;
    this.to = to;
    this.transitionId = transitionId;
    this.details = result?.details || Object.freeze({});
  }
}
