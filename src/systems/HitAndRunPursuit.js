export const DEFAULT_HIT_AND_RUN_PURSUIT = Object.freeze({
  nearbyPoliceRadius: 65,
  maxResponders: 2,
  pursuitDuration: 22,
  fugitiveSpeedMultiplier: 1.55,
  maxFugitiveSpeed: 38,
  policeMaxSpeed: 42,
  policeCatchUpSpeed: 8,
  policeFollowingDistance: 5
});

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function selectNearbyPolice(vehicles, origin, config = {}) {
  if (!Array.isArray(vehicles) || !origin) return [];
  const radius = finitePositive(
    config.nearbyPoliceRadius,
    DEFAULT_HIT_AND_RUN_PURSUIT.nearbyPoliceRadius
  );
  const maxResponders = Math.max(0, Math.floor(finitePositive(
    config.maxResponders,
    DEFAULT_HIT_AND_RUN_PURSUIT.maxResponders
  )));
  const radiusSquared = radius * radius;

  return vehicles
    .filter(vehicle => (
      vehicle?.isPolice
      && vehicle.mesh?.position
      && !vehicle.userControlled
      && !vehicle.crashed
      && !vehicle.isDestroyed
      && !vehicle.isParked
      && !vehicle.emergencyTarget
      && !vehicle.pursuitTarget
      && vehicle.mesh.position.distanceToSquared(origin) <= radiusSquared
    ))
    .sort((a, b) => (
      a.mesh.position.distanceToSquared(origin) - b.mesh.position.distanceToSquared(origin)
    ))
    .slice(0, maxResponders);
}

export function createHitAndRunState(offender, responders = [], config = {}) {
  const normalMaxSpeed = finitePositive(offender?.normalMaxSpeed, finitePositive(offender?.maxSpeed, 20));
  const multiplier = finitePositive(
    config.fugitiveSpeedMultiplier,
    DEFAULT_HIT_AND_RUN_PURSUIT.fugitiveSpeedMultiplier
  );
  const maximum = finitePositive(
    config.maxFugitiveSpeed,
    DEFAULT_HIT_AND_RUN_PURSUIT.maxFugitiveSpeed
  );
  return {
    elapsed: 0,
    duration: finitePositive(config.pursuitDuration, DEFAULT_HIT_AND_RUN_PURSUIT.pursuitDuration),
    normalMaxSpeed,
    escapeSpeed: Math.min(maximum, normalMaxSpeed * multiplier),
    responders: responders.filter(Boolean)
  };
}

export function advanceHitAndRunState(state, delta) {
  if (!state) return false;
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.25)) : 0;
  state.elapsed += safeDelta;
  return state.elapsed < state.duration;
}

export function getPursuitSpeed(pursuer, offender, distance, config = {}) {
  const maximum = finitePositive(config.policeMaxSpeed, DEFAULT_HIT_AND_RUN_PURSUIT.policeMaxSpeed);
  const catchUp = finitePositive(config.policeCatchUpSpeed, DEFAULT_HIT_AND_RUN_PURSUIT.policeCatchUpSpeed);
  const followingDistance = finitePositive(
    config.policeFollowingDistance,
    DEFAULT_HIT_AND_RUN_PURSUIT.policeFollowingDistance
  );
  const offenderSpeed = Math.max(0, Number.isFinite(offender?.speed) ? offender.speed : 0);
  if (Number.isFinite(distance) && distance <= followingDistance) {
    return Math.min(maximum, offenderSpeed);
  }
  const minimumResponseSpeed = finitePositive(pursuer?.normalMaxSpeed, 20);
  return Math.min(maximum, Math.max(minimumResponseSpeed, offenderSpeed + catchUp));
}
