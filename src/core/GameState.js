/**
 * Renderer-independent game-session state definitions.
 *
 * This module describes policy; GameManager owns the mutable state and the
 * TransitionCoordinator executes the declared effects through the runtime
 * adapter while this module remains renderer-independent.
 */

export const GAME_STATES = Object.freeze({
  BOOT: 'BOOT',
  LOAD: 'LOAD',
  MANAGEMENT: 'MANAGEMENT',
  BUILDER: 'BUILDER',
  TRANSITION: 'TRANSITION',
  STREET_ON_FOOT: 'STREET_ON_FOOT',
  STREET_VEHICLE: 'STREET_VEHICLE',
  RESULT: 'RESULT',
  PAUSED: 'PAUSED',
  MENU: 'MENU'
});

// Retained as an import compatibility alias. Modes and states are now the same
// authoritative concept; callers must use the explicit street states.
export const GAME_MODES = GAME_STATES;

export const GAME_STATE_VALUES = Object.freeze(Object.values(GAME_STATES));

export const CONTROL_KINDS = Object.freeze({
  NONE: 'NONE',
  PEDESTRIAN: 'PEDESTRIAN',
  VEHICLE: 'VEHICLE',
  AIRCRAFT: 'AIRCRAFT',
  MULTIPLE: 'MULTIPLE'
});

export const MISSION_POLICIES = Object.freeze({
  REQUIRE_NONE: 'REQUIRE_NONE',
  REQUIRE_RESOLVED: 'REQUIRE_RESOLVED',
  PRESERVE: 'PRESERVE',
  PRESERVE_UNTIL_RESULT_COMMIT: 'PRESERVE_UNTIL_RESULT_COMMIT',
  SUSPEND: 'SUSPEND'
});

export const HEAT_POLICIES = Object.freeze({
  PRESERVE_FROZEN: 'PRESERVE_FROZEN',
  PRESERVE_RUNNING: 'PRESERVE_RUNNING'
});

export const CONTROL_POLICIES = Object.freeze({
  REQUIRE_NONE: 'REQUIRE_NONE',
  HANDOFF: 'HANDOFF',
  REQUIRE_PEDESTRIAN: 'REQUIRE_PEDESTRIAN',
  REQUIRE_VEHICLE: 'REQUIRE_VEHICLE',
  PRESERVE: 'PRESERVE',
  SUSPEND: 'SUSPEND'
});

export const CAMERA_POLICIES = Object.freeze({
  NONE: 'NONE',
  LOADING: 'LOADING',
  MANAGEMENT: 'MANAGEMENT',
  BUILDER: 'BUILDER',
  HANDOFF: 'HANDOFF',
  STREET_ON_FOOT: 'STREET_ON_FOOT',
  STREET_VEHICLE: 'STREET_VEHICLE',
  RESULT: 'RESULT',
  PRESERVE: 'PRESERVE',
  MENU: 'MENU'
});

export const CLOCK_POLICIES = Object.freeze({
  STOPPED: 'STOPPED',
  CITY: 'CITY',
  BUILDER: 'BUILDER',
  HANDOFF: 'HANDOFF',
  STREET: 'STREET',
  RESULT: 'RESULT',
  PAUSED: 'PAUSED',
  MENU: 'MENU'
});

function policy(mission, heat, control, camera, clock) {
  return Object.freeze({ mission, heat, control, camera, clock });
}

/**
 * Destination contracts for mission, Heat, entity control, camera ownership,
 * and the simulation clock. No transition is allowed to invent its own policy.
 */
export const GAME_STATE_POLICIES = Object.freeze({
  [GAME_STATES.BOOT]: policy(
    MISSION_POLICIES.REQUIRE_NONE,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.REQUIRE_NONE,
    CAMERA_POLICIES.NONE,
    CLOCK_POLICIES.STOPPED
  ),
  [GAME_STATES.LOAD]: policy(
    MISSION_POLICIES.REQUIRE_NONE,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.REQUIRE_NONE,
    CAMERA_POLICIES.LOADING,
    CLOCK_POLICIES.STOPPED
  ),
  [GAME_STATES.MANAGEMENT]: policy(
    MISSION_POLICIES.REQUIRE_RESOLVED,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.REQUIRE_NONE,
    CAMERA_POLICIES.MANAGEMENT,
    CLOCK_POLICIES.CITY
  ),
  [GAME_STATES.BUILDER]: policy(
    MISSION_POLICIES.REQUIRE_RESOLVED,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.REQUIRE_NONE,
    CAMERA_POLICIES.BUILDER,
    CLOCK_POLICIES.BUILDER
  ),
  [GAME_STATES.TRANSITION]: policy(
    MISSION_POLICIES.PRESERVE,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.HANDOFF,
    CAMERA_POLICIES.HANDOFF,
    CLOCK_POLICIES.HANDOFF
  ),
  [GAME_STATES.STREET_ON_FOOT]: policy(
    MISSION_POLICIES.PRESERVE,
    HEAT_POLICIES.PRESERVE_RUNNING,
    CONTROL_POLICIES.REQUIRE_PEDESTRIAN,
    CAMERA_POLICIES.STREET_ON_FOOT,
    CLOCK_POLICIES.STREET
  ),
  [GAME_STATES.STREET_VEHICLE]: policy(
    MISSION_POLICIES.PRESERVE,
    HEAT_POLICIES.PRESERVE_RUNNING,
    CONTROL_POLICIES.REQUIRE_VEHICLE,
    CAMERA_POLICIES.STREET_VEHICLE,
    CLOCK_POLICIES.STREET
  ),
  [GAME_STATES.RESULT]: policy(
    MISSION_POLICIES.PRESERVE_UNTIL_RESULT_COMMIT,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.REQUIRE_NONE,
    CAMERA_POLICIES.RESULT,
    CLOCK_POLICIES.RESULT
  ),
  [GAME_STATES.PAUSED]: policy(
    MISSION_POLICIES.SUSPEND,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.SUSPEND,
    CAMERA_POLICIES.PRESERVE,
    CLOCK_POLICIES.PAUSED
  ),
  [GAME_STATES.MENU]: policy(
    MISSION_POLICIES.SUSPEND,
    HEAT_POLICIES.PRESERVE_FROZEN,
    CONTROL_POLICIES.SUSPEND,
    CAMERA_POLICIES.MENU,
    CLOCK_POLICIES.MENU
  )
});

function destinations(...states) {
  return Object.freeze(states);
}

/**
 * Legal requested destinations. The machine passes through TRANSITION for
 * every non-idempotent request, so TRANSITION is not a public destination.
 */
export const GAME_STATE_TRANSITIONS = Object.freeze({
  [GAME_STATES.BOOT]: destinations(GAME_STATES.LOAD, GAME_STATES.MENU),
  [GAME_STATES.LOAD]: destinations(GAME_STATES.MANAGEMENT, GAME_STATES.MENU),
  [GAME_STATES.MANAGEMENT]: destinations(
    GAME_STATES.BUILDER,
    GAME_STATES.STREET_ON_FOOT,
    GAME_STATES.STREET_VEHICLE,
    GAME_STATES.PAUSED,
    GAME_STATES.MENU
  ),
  [GAME_STATES.BUILDER]: destinations(
    GAME_STATES.MANAGEMENT,
    GAME_STATES.PAUSED,
    GAME_STATES.MENU
  ),
  [GAME_STATES.TRANSITION]: destinations(),
  [GAME_STATES.STREET_ON_FOOT]: destinations(
    GAME_STATES.STREET_VEHICLE,
    GAME_STATES.MANAGEMENT,
    GAME_STATES.RESULT,
    GAME_STATES.PAUSED,
    GAME_STATES.MENU
  ),
  [GAME_STATES.STREET_VEHICLE]: destinations(
    GAME_STATES.STREET_ON_FOOT,
    GAME_STATES.MANAGEMENT,
    GAME_STATES.RESULT,
    GAME_STATES.PAUSED,
    GAME_STATES.MENU
  ),
  [GAME_STATES.RESULT]: destinations(
    GAME_STATES.MANAGEMENT,
    GAME_STATES.STREET_ON_FOOT,
    GAME_STATES.STREET_VEHICLE,
    GAME_STATES.PAUSED,
    GAME_STATES.MENU
  ),
  [GAME_STATES.PAUSED]: destinations(GAME_STATES.MENU),
  [GAME_STATES.MENU]: destinations(GAME_STATES.LOAD, GAME_STATES.MANAGEMENT)
});

export function isGameState(state) {
  return GAME_STATE_VALUES.includes(state);
}

export function isStreetState(state) {
  return state === GAME_STATES.STREET_ON_FOOT
    || state === GAME_STATES.STREET_VEHICLE;
}

export function getStatePolicy(state) {
  return GAME_STATE_POLICIES[state] || null;
}

export function getTransitionEffects(from, to) {
  const source = getStatePolicy(from);
  const destination = getStatePolicy(to);
  if (!source || !destination) return null;
  return Object.freeze({
    mission: Object.freeze({ from: source.mission, to: destination.mission }),
    heat: Object.freeze({ from: source.heat, to: destination.heat }),
    controlledEntity: Object.freeze({ from: source.control, to: destination.control }),
    camera: Object.freeze({ from: source.camera, to: destination.camera }),
    simulationClock: Object.freeze({ from: source.clock, to: destination.clock })
  });
}
