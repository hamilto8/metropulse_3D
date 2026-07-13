export const TRAFFIC_RULES = Object.freeze({
  compliantShare: 0.8,
  signalGreenDuration: 9,
  signalYellowDuration: 2,
  signalAllRedDuration: 1,
  stopSignWaitDuration: 1.1,
  minimumDetectionDistance: 18,
  maximumDetectionDistance: 34,
  reactionTime: 0.3,
  stoppingClearance: 4
});

export const SIGNAL_STATES = Object.freeze({
  RED: 'RED',
  YELLOW: 'YELLOW',
  GREEN: 'GREEN'
});

export function getSignalCycleDuration(config = TRAFFIC_RULES) {
  return 2 * (
    config.signalGreenDuration
    + config.signalYellowDuration
    + config.signalAllRedDuration
  );
}

export function getSignalState(elapsed, axis, offset = 0, config = TRAFFIC_RULES) {
  const cycle = getSignalCycleDuration(config);
  const safeElapsed = Number.isFinite(elapsed) ? elapsed : 0;
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const time = ((safeElapsed + safeOffset) % cycle + cycle) % cycle;
  const green = config.signalGreenDuration;
  const yellow = config.signalYellowDuration;
  const allRed = config.signalAllRedDuration;
  const nsYellowStart = green;
  const firstAllRedStart = nsYellowStart + yellow;
  const ewGreenStart = firstAllRedStart + allRed;
  const ewYellowStart = ewGreenStart + green;
  const secondAllRedStart = ewYellowStart + yellow;

  if (axis === 'NS') {
    if (time < nsYellowStart) return SIGNAL_STATES.GREEN;
    if (time < firstAllRedStart) return SIGNAL_STATES.YELLOW;
    return SIGNAL_STATES.RED;
  }
  if (time >= ewGreenStart && time < ewYellowStart) return SIGNAL_STATES.GREEN;
  if (time >= ewYellowStart && time < secondAllRedStart) return SIGNAL_STATES.YELLOW;
  return SIGNAL_STATES.RED;
}

export function createDriverRuleProfile(serial) {
  const safeSerial = Number.isFinite(Number(serial)) ? Math.abs(Math.floor(Number(serial))) : 1;
  const compliant = safeSerial % 5 !== 0;
  return Object.freeze({
    compliant,
    style: compliant ? 'RULE_FOLLOWER' : 'RECKLESS'
  });
}

export function createTrafficControlPlan(coordsX, coordsZ) {
  const controls = [];
  const cycle = getSignalCycleDuration();
  for (let xi = 0; xi < coordsX.length; xi += 1) {
    const x = coordsX[xi];
    for (let zi = 0; zi < coordsZ.length; zi += 1) {
      const z = coordsZ[zi];
      const countryside = x >= 420;
      // Rural/suburban side roads are four-way stops. Only the main Z=0
      // arterial receives signals, yielding an 80/20 stop-sign/signal split.
      const type = countryside && z !== 0 ? 'STOP' : 'SIGNAL';
      controls.push(Object.freeze({
        id: `${type}:${x},${z}`,
        type,
        x,
        z,
        district: countryside ? 'COUNTRYSIDE' : 'URBAN',
        phaseOffset: type === 'SIGNAL' ? ((xi + zi) % 2) * (cycle / 2) : 0
      }));
    }
  }
  return controls;
}

export function parseTrafficApproach(node) {
  const match = /^(EB|WB|SB|NB)_IN:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(node?.id || '');
  if (!match) return null;
  const direction = match[1];
  return {
    direction,
    axis: direction === 'EB' || direction === 'WB' ? 'EW' : 'NS',
    x: Number(match[2]),
    z: Number(match[3])
  };
}

export function getTrafficStoppingKinematics(vehicle, config = TRAFFIC_RULES) {
  const speed = Number.isFinite(Number(vehicle?.speed)) ? Math.abs(Number(vehicle.speed)) : 0;
  const acceleration = Number.isFinite(Number(vehicle?.acceleration))
    ? Math.max(0, Number(vehicle.acceleration))
    : 0;
  const deceleration = Math.max(18, acceleration * 2.5);
  const stoppingDistance = speed * speed / (2 * deceleration);
  const detectionDistance = Math.max(
    config.minimumDetectionDistance,
    Math.min(
      config.maximumDetectionDistance,
      stoppingDistance + speed * config.reactionTime + config.stoppingClearance
    )
  );
  return { speed, deceleration, stoppingDistance, detectionDistance };
}
