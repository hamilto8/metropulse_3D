export const AIRCRAFT_MODES = Object.freeze({
  PARKED: 'PARKED',
  TAXI: 'TAXI',
  TAKEOFF: 'TAKEOFF',
  AIRBORNE: 'AIRBORNE',
  LANDING: 'LANDING',
  CRASHED: 'CRASHED'
});

export const DEFAULT_AIRCRAFT_CONFIG = Object.freeze({
  gearHeight: 1.15,
  maxSpeed: 64,
  takeoffSpeed: 24,
  stallSpeed: 18,
  landingMaxSpeed: 35,
  maxAltitude: 280,
  maxPitch: Math.PI * 0.16,
  maxRoll: Math.PI * 0.27,
  throttleRate: 0.52,
  groundTurnRate: 0.62,
  bankTurnRate: 0.78,
  safeVerticalSpeed: -8,
  safeLandingRoll: Math.PI * 0.16
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const approach = (current, target, rate, delta) => (
  current + (target - current) * Math.min(1, Math.max(0, rate * delta))
);

function normalizeHeading(value) {
  const turn = Math.PI * 2;
  return ((finite(value) % turn) + turn) % turn;
}

export function createAircraftFlightState(overrides = {}) {
  const position = overrides.position || {};
  const grounded = overrides.grounded ?? true;
  return {
    position: {
      x: finite(position.x),
      y: finite(position.y, DEFAULT_AIRCRAFT_CONFIG.gearHeight),
      z: finite(position.z)
    },
    heading: normalizeHeading(overrides.heading),
    pitch: finite(overrides.pitch),
    roll: finite(overrides.roll),
    speed: Math.max(0, finite(overrides.speed)),
    verticalSpeed: finite(overrides.verticalSpeed),
    throttle: clamp(finite(overrides.throttle), 0, 1),
    grounded: Boolean(grounded),
    landingSurface: typeof overrides.landingSurface === 'string' ? overrides.landingSurface : null,
    mode: overrides.mode || (grounded ? AIRCRAFT_MODES.PARKED : AIRCRAFT_MODES.AIRBORNE),
    stallWarning: Boolean(overrides.stallWarning),
    crashed: Boolean(overrides.crashed)
  };
}

export function sanitizeAircraftControls(controls = {}) {
  return {
    roll: clamp(finite(controls.roll), -1, 1),
    pitch: clamp(finite(controls.pitch), -1, 1),
    throttleUp: clamp(finite(controls.throttleUp), 0, 1),
    throttleDown: clamp(finite(controls.throttleDown), 0, 1),
    brake: clamp(finite(controls.brake), 0, 1)
  };
}

/**
 * Deterministic, renderer-agnostic arcade flight step. Values use metres and
 * seconds; speed is metres/second. The model intentionally assists rotation
 * at takeoff speed while retaining stalls, banked turns, and landing limits.
 */
export function stepAircraftFlight(
  currentState,
  rawControls,
  rawDelta,
  environment = {},
  config = DEFAULT_AIRCRAFT_CONFIG
) {
  const state = createAircraftFlightState(currentState);
  const controls = sanitizeAircraftControls(rawControls);
  const delta = clamp(finite(rawDelta), 0, 0.1);
  const groundHeight = finite(environment.groundHeight);
  const gearY = groundHeight + config.gearHeight;

  if (state.crashed || state.mode === AIRCRAFT_MODES.CRASHED) {
    return { ...state, crashed: true, mode: AIRCRAFT_MODES.CRASHED, speed: 0, verticalSpeed: 0 };
  }

  state.throttle = clamp(
    state.throttle + (controls.throttleUp - controls.throttleDown) * config.throttleRate * delta,
    0,
    1
  );

  const brakeDeceleration = controls.brake * (state.grounded ? 28 : 8);
  const baseDrag = state.grounded ? 2.2 + state.speed * 0.055 : 1.15 + state.speed * 0.038;
  const thrust = state.throttle * (state.grounded ? 19.5 : 16.5);
  const climbPenalty = state.grounded ? 0 : Math.max(0, state.verticalSpeed) * 0.2;
  state.speed = clamp(
    state.speed + (thrust - baseDrag - brakeDeceleration - climbPenalty) * delta,
    0,
    config.maxSpeed
  );

  if (state.grounded) {
    const taxiAuthority = clamp(state.speed / 14, 0, 1);
    state.heading = normalizeHeading(
      state.heading + controls.roll * config.groundTurnRate * taxiAuthority * delta
    );
    state.roll = approach(state.roll, controls.roll * 0.08, 7, delta);

    const takeoffReady = state.speed >= config.takeoffSpeed && state.throttle >= 0.72;
    const takeoffBias = takeoffReady ? 0.14 : 0;
    const targetPitch = clamp(
      controls.pitch * config.maxPitch + takeoffBias,
      -config.maxPitch,
      config.maxPitch
    );
    state.pitch = approach(state.pitch, targetPitch, takeoffReady ? 2.8 : 5, delta);

    if (takeoffReady && state.pitch > 0.055) {
      state.mode = AIRCRAFT_MODES.TAKEOFF;
      state.verticalSpeed = Math.max(1.2, Math.sin(state.pitch) * state.speed * 0.75);
      state.position.y = Math.max(gearY, state.position.y + state.verticalSpeed * delta);
      if (state.position.y >= gearY + 1.8) {
        state.grounded = false;
        state.mode = AIRCRAFT_MODES.AIRBORNE;
      }
    } else {
      state.mode = state.speed > 0.6 ? AIRCRAFT_MODES.TAXI : AIRCRAFT_MODES.PARKED;
      state.position.y = gearY;
      state.verticalSpeed = 0;
    }
  } else {
    const targetRoll = controls.roll * config.maxRoll;
    const takeoffAssist = state.mode === AIRCRAFT_MODES.TAKEOFF ? 0.12 : 0;
    const targetPitch = clamp(
      controls.pitch * config.maxPitch + takeoffAssist,
      -config.maxPitch,
      config.maxPitch
    );
    state.roll = approach(state.roll, targetRoll, 2.9, delta);
    state.pitch = approach(state.pitch, targetPitch, 2.35, delta);

    const speedAuthority = clamp(state.speed / Math.max(1, config.takeoffSpeed), 0.35, 1.35);
    state.heading = normalizeHeading(
      state.heading + Math.sin(state.roll) * config.bankTurnRate * speedAuthority * delta
    );

    const stallDeficit = Math.max(0, config.stallSpeed - state.speed);
    const targetVerticalSpeed = Math.sin(state.pitch) * state.speed * 0.78
      - stallDeficit * 0.72
      - Math.abs(Math.sin(state.roll)) * 1.1;
    state.verticalSpeed = approach(state.verticalSpeed, targetVerticalSpeed, 2.2, delta);
    state.position.y += state.verticalSpeed * delta;
    state.stallWarning = state.speed < config.stallSpeed + 2;
    state.mode = state.verticalSpeed < -1.2 && state.position.y < gearY + 25
      ? AIRCRAFT_MODES.LANDING
      : AIRCRAFT_MODES.AIRBORNE;

    if (state.position.y > groundHeight + config.maxAltitude) {
      state.position.y = groundHeight + config.maxAltitude;
      state.verticalSpeed = Math.min(0, state.verticalSpeed);
      state.pitch = Math.min(0, state.pitch);
    }

    if (state.position.y <= gearY) {
      const safeLanding = !environment.inWater
        && environment.canLand !== false
        && state.speed <= config.landingMaxSpeed
        && state.verticalSpeed >= config.safeVerticalSpeed
        && Math.abs(state.roll) <= config.safeLandingRoll;
      if (!safeLanding) {
        return {
          ...state,
          position: { ...state.position, y: gearY },
          crashed: true,
          mode: AIRCRAFT_MODES.CRASHED,
          speed: 0,
          verticalSpeed: 0
        };
      }
      state.position.y = gearY;
      state.verticalSpeed = 0;
      state.grounded = true;
      state.landingSurface = typeof environment.landingSurface === 'string'
        ? environment.landingSurface
        : state.landingSurface;
      state.pitch = approach(state.pitch, 0, 7, delta);
      state.roll = approach(state.roll, 0, 7, delta);
      state.mode = state.speed > 0.6 ? AIRCRAFT_MODES.TAXI : AIRCRAFT_MODES.PARKED;
      state.stallWarning = false;
    }
  }

  const horizontalSpeed = state.speed * Math.max(0.25, Math.cos(state.pitch));
  state.position.x += Math.sin(state.heading) * horizontalSpeed * delta;
  state.position.z += Math.cos(state.heading) * horizontalSpeed * delta;
  return state;
}
