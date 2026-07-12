export const DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR = Object.freeze({
  impatienceProbability: 0.2,
  impatienceDelay: 3.5,
  reactionTime: 0.18,
  clearance: 4.5,
  minDetectionDistance: 7,
  maxDetectionDistance: 36,
  brakeMultiplier: 3.5,
  minBrakeDeceleration: 28,
  emergencyStopDistance: 3.1,
  largeVehicleEmergencyStopDistance: 4.2
});

function normalizedProbability(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizedDelay(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, numeric);
}

function finiteNonNegative(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

export function getPedestrianYieldKinematics(vehicle, config = {}) {
  const speed = finiteNonNegative(Math.abs(Number(vehicle?.speed)), 0);
  const acceleration = finiteNonNegative(
    vehicle?.acceleration,
    0
  );
  const brakeMultiplier = finiteNonNegative(
    config.brakeMultiplier,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.brakeMultiplier
  );
  const minimumBrake = finiteNonNegative(
    config.minBrakeDeceleration,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.minBrakeDeceleration
  );
  const brakeDeceleration = Math.max(minimumBrake, acceleration * brakeMultiplier);
  const reactionTime = finiteNonNegative(
    config.reactionTime,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.reactionTime
  );
  const clearance = finiteNonNegative(
    config.clearance,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.clearance
  );
  const minimumDistance = finiteNonNegative(
    config.minDetectionDistance,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.minDetectionDistance
  );
  const maximumDistance = Math.max(
    minimumDistance,
    finiteNonNegative(
      config.maxDetectionDistance,
      DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.maxDetectionDistance
    )
  );
  const stoppingDistance = brakeDeceleration > 0 ? (speed * speed) / (2 * brakeDeceleration) : maximumDistance;
  const detectionDistance = Math.max(
    minimumDistance,
    Math.min(maximumDistance, stoppingDistance + speed * reactionTime + clearance)
  );
  return { speed, brakeDeceleration, stoppingDistance, detectionDistance };
}

export function approachTrafficTargetSpeed(vehicle, delta, pedestrianBlocked = false) {
  const current = Number.isFinite(vehicle?.speed) ? vehicle.speed : 0;
  const target = Number.isFinite(vehicle?.targetSpeed) ? vehicle.targetSpeed : 0;
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
  const acceleration = finiteNonNegative(vehicle?.acceleration, 0);
  if (current < target) return Math.min(target, current + acceleration * safeDelta);
  if (current <= target) return current;
  const deceleration = pedestrianBlocked
    ? getPedestrianYieldKinematics(vehicle).brakeDeceleration
    : acceleration * 1.8;
  return Math.max(target, current - deceleration * safeDelta);
}

export function getPedestrianEmergencyStopDistance(vehicle, config = {}) {
  const largeVehicle = ['BUS', 'TRUCK', 'DUMP_TRUCK'].includes(vehicle?.vType);
  const key = largeVehicle ? 'largeVehicleEmergencyStopDistance' : 'emergencyStopDistance';
  return finiteNonNegative(config[key], DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR[key]);
}

export function createPedestrianTrafficState(pedestrian, random = Math.random, config = {}) {
  let randomValue = 0.5;
  try {
    randomValue = Number(random?.());
  } catch {
    randomValue = 0.5;
  }
  const roll = Number.isFinite(randomValue) ? Math.max(0, Math.min(1, randomValue)) : 0.5;
  const impatienceProbability = normalizedProbability(
    config.impatienceProbability,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.impatienceProbability
  );
  return {
    pedestrian,
    impatient: roll < impatienceProbability,
    elapsed: 0,
    honked: false,
    released: false
  };
}

/** Advances one driver/pedestrian encounter and returns the required traffic action. */
export function updatePedestrianTrafficState(state, delta, config = {}) {
  if (!state) return { shouldYield: false, shouldHonk: false };
  const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const impatienceDelay = normalizedDelay(
    config.impatienceDelay,
    DEFAULT_PEDESTRIAN_TRAFFIC_BEHAVIOR.impatienceDelay
  );
  state.elapsed += safeDelta;

  // Patient drivers remain stopped for the entire encounter. The owning
  // traffic system clears this state only after the corridor is unobstructed.
  if (!state.impatient) return { shouldYield: true, shouldHonk: false };
  if (state.elapsed < impatienceDelay) return { shouldYield: true, shouldHonk: false };

  const shouldHonk = !state.honked;
  state.honked = true;
  state.released = true;
  return { shouldYield: false, shouldHonk };
}
