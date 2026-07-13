export const PLAYER_VEHICLE_RECOVERY = Object.freeze({
  minimumIntent: 0.55,
  maximumStuckSpeed: 0.45,
  delaySeconds: 2.25,
  decayRate: 2
});

function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

/**
 * Produces one canonical drive command from keyboard and analog state.
 * Invalid controller values are treated as neutral, and simultaneous throttle
 * and brake resolve predictably instead of leaving both wheel commands active.
 */
export function resolvePlayerVehicleControls(keys = {}, inputState = null) {
  let throttle = Math.max(
    keys.w || keys.arrowup ? 1 : 0,
    clampUnit(inputState?.throttle)
  );
  let reverse = Math.max(
    keys.s || keys.arrowdown ? 1 : 0,
    clampUnit(inputState?.brake)
  );

  if (throttle > 0.05 && reverse > 0.05) {
    if (Math.abs(throttle - reverse) <= 0.05) {
      throttle = 0;
      reverse = 0;
    } else if (throttle > reverse) {
      reverse = 0;
    } else {
      throttle = 0;
    }
  }

  const keyboardSteer = (keys.a || keys.arrowleft ? 1 : 0)
    - (keys.d || keys.arrowright ? 1 : 0);
  const analogSteer = Number(inputState?.steer);
  const steer = Number.isFinite(analogSteer) && Math.abs(analogSteer) > 0.05
    ? Math.max(-1, Math.min(1, analogSteer))
    : keyboardSteer;

  return Object.freeze({
    throttle,
    reverse,
    steer,
    handbrake: Boolean(keys[' '] || inputState?.handbrake)
  });
}

/**
 * Converts drive intent into cannon-es wheel commands. RaycastVehicle's
 * engine-force sign is opposite its configured +Z forward axis: negative
 * wheel force drives forward and positive wheel force drives in reverse.
 */
export function resolvePlayerVehicleDriveForces(
  { throttle = 0, reverse = 0, handbrake = false } = {},
  forwardSpeed = 0,
  profile = {}
) {
  const safeSpeed = Number.isFinite(forwardSpeed) ? forwardSpeed : 0;
  const forwardInput = clampUnit(throttle);
  const reverseInput = clampUnit(reverse);
  const forwardEngineForce = Math.max(0, Number(profile.forwardEngineForce) || 0);
  const reverseEngineForce = Math.max(0, Number(profile.reverseEngineForce) || 0);
  const maxBrakeForce = Math.max(0, Number(profile.maxBrakeForce) || 0);
  const maxForwardSpeed = Math.max(0, Number(profile.maxForwardSpeed) || 0);
  const maxReverseSpeed = Math.max(0, Number(profile.maxReverseSpeed) || 0);
  const directionChangeSpeed = 1.5;

  if (handbrake) {
    return { engineForce: 0, brakeForce: maxBrakeForce * 2.5 };
  }
  if (forwardInput > 0.05) {
    if (safeSpeed < -directionChangeSpeed) {
      return { engineForce: 0, brakeForce: maxBrakeForce * forwardInput };
    }
    return {
      engineForce: safeSpeed < maxForwardSpeed ? -forwardEngineForce * forwardInput : 0,
      brakeForce: 0
    };
  }
  if (reverseInput > 0.05) {
    if (safeSpeed > directionChangeSpeed) {
      return { engineForce: 0, brakeForce: maxBrakeForce * reverseInput };
    }
    return {
      engineForce: safeSpeed > -maxReverseSpeed ? reverseEngineForce * reverseInput : 0,
      brakeForce: 0
    };
  }
  return { engineForce: 0, brakeForce: 15 };
}

/** Returns the next stuck duration and whether a safe-pose recovery is due. */
export function updateVehicleMobilityTimer(
  elapsed,
  { throttle = 0, reverse = 0, handbrake = false, horizontalSpeed = 0 } = {},
  delta,
  config = PLAYER_VEHICLE_RECOVERY
) {
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.25)) : 0;
  const speed = Number.isFinite(horizontalSpeed) ? Math.max(0, horizontalSpeed) : 0;
  const previousElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const hasDriveIntent = Math.max(throttle, reverse) >= config.minimumIntent && !handbrake;
  const isStuck = hasDriveIntent && speed <= config.maximumStuckSpeed;
  const nextElapsed = isStuck
    ? previousElapsed + safeDelta
    : Math.max(0, previousElapsed - safeDelta * config.decayRate);

  return {
    elapsed: nextElapsed,
    shouldRecover: nextElapsed >= config.delaySeconds
  };
}
