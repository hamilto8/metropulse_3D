const DEFAULT_DRIVE_PROFILE = Object.freeze({
  forwardEngineForce: 5850,
  reverseEngineForce: 5175,
  maxBrakeForce: 160,
  maxSteering: 0.55,
  maxForwardSpeed: 42,
  maxReverseSpeed: 18
});

const DEFAULT_PLAYER_DYNAMICS = Object.freeze({
  drivenAxle: 'all',
  downforceFactor: 400,
  lateralGripFactor: 10,
  angularDamping: 0.25,
  angularFactor: Object.freeze({ x: 1, y: 1, z: 1 }),
  rollInfluence: 0.05,
  wheelTrackFactor: 0.45,
  visualLeanFactor: 0
});

function createDriveProfile(overrides = {}) {
  return Object.freeze({ ...DEFAULT_DRIVE_PROFILE, ...overrides });
}

function createPlayerDynamics(overrides = {}) {
  return Object.freeze({
    ...DEFAULT_PLAYER_DYNAMICS,
    ...overrides,
    angularFactor: Object.freeze({
      ...DEFAULT_PLAYER_DYNAMICS.angularFactor,
      ...overrides.angularFactor
    })
  });
}

const SPORTS_DRIVE_PROFILE = createDriveProfile({
  forwardEngineForce: 9360,
  reverseEngineForce: 8280,
  maxForwardSpeed: 56
});
const BUS_DRIVE_PROFILE = createDriveProfile({
  forwardEngineForce: 23400,
  reverseEngineForce: 20700,
  maxBrakeForce: 600,
  maxSteering: 0.35,
  maxForwardSpeed: 22
});
const TRUCK_DRIVE_PROFILE = createDriveProfile({
  forwardEngineForce: 15600,
  reverseEngineForce: 13800,
  maxBrakeForce: 400,
  maxSteering: 0.45,
  maxForwardSpeed: 28
});
const AMBULANCE_DRIVE_PROFILE = createDriveProfile({
  forwardEngineForce: 11050,
  reverseEngineForce: 9775,
  maxForwardSpeed: 46
});
const MOTORBIKE_DRIVE_PROFILE = createDriveProfile({
  // RaycastVehicle applies this value per driven wheel. A bike is far lighter
  // than a car and only its rear virtual axle is powered, so inheriting the
  // four-wheel car force makes the suspension hop and repeatedly lose grip.
  forwardEngineForce: 1900,
  reverseEngineForce: 1500,
  maxBrakeForce: 90,
  maxSteering: 0.48,
  maxForwardSpeed: 36,
  maxReverseSpeed: 10
});

const DEFAULT_PROFILE = Object.freeze({
  mass: 1200,
  width: 2,
  height: 1.4,
  length: 4.2,
  wheelCount: 4,
  wheelRadius: 0.4,
  suspensionRestLength: 0.45,
  suspensionStiffness: 48,
  maxSuspensionForce: 100000,
  drive: DEFAULT_DRIVE_PROFILE,
  playerDynamics: DEFAULT_PLAYER_DYNAMICS
});

const PROFILE_OVERRIDES = Object.freeze({
  SPORTS: {
    mass: 950, width: 2.1, height: 1.05, length: 4.4, wheelRadius: 0.45,
    suspensionRestLength: 0.38, suspensionStiffness: 68,
    drive: SPORTS_DRIVE_PROFILE,
    playerDynamics: { downforceFactor: 600, lateralGripFactor: 12 }
  },
  SPORTS_CAR: {
    mass: 950, width: 2.1, height: 1.05, length: 4.4, wheelRadius: 0.45,
    suspensionRestLength: 0.38, suspensionStiffness: 68,
    drive: SPORTS_DRIVE_PROFILE,
    playerDynamics: { downforceFactor: 600, lateralGripFactor: 12 }
  },
  BUS: {
    mass: 4800, width: 2.6, height: 3.2, length: 10.5, wheelCount: 6, wheelRadius: 0.6,
    suspensionRestLength: 0.6, suspensionStiffness: 120, maxSuspensionForce: 350000,
    drive: BUS_DRIVE_PROFILE,
    playerDynamics: { downforceFactor: 100 }
  },
  TRUCK: {
    mass: 3500, width: 2.4, height: 3, length: 7.5, wheelRadius: 0.55,
    suspensionRestLength: 0.55, suspensionStiffness: 95, maxSuspensionForce: 250000,
    drive: TRUCK_DRIVE_PROFILE,
    playerDynamics: { downforceFactor: 200 }
  },
  AMBULANCE: {
    mass: 2400, width: 2.3, height: 2.4, length: 6.2, wheelRadius: 0.5,
    suspensionRestLength: 0.5, suspensionStiffness: 75, maxSuspensionForce: 180000,
    drive: AMBULANCE_DRIVE_PROFILE
  },
  ICECREAM: { mass: 1900, width: 2.2, height: 2.3, length: 5.8, wheelRadius: 0.48, suspensionRestLength: 0.48, suspensionStiffness: 65, maxSuspensionForce: 150000 },
  DUMP_TRUCK: {
    mass: 4200, width: 2.5, height: 2.9, length: 7.8, wheelRadius: 0.6,
    suspensionRestLength: 0.58, suspensionStiffness: 110, maxSuspensionForce: 300000,
    drive: BUS_DRIVE_PROFILE
  },
  MOTORBIKE: {
    mass: 250,
    width: 0.7,
    height: 1,
    length: 2.2,
    wheelRadius: 0.35,
    suspensionRestLength: 0.35,
    suspensionStiffness: 55,
    maxSuspensionForce: 80000,
    drive: MOTORBIKE_DRIVE_PROFILE,
    playerDynamics: {
      drivenAxle: 'rear',
      downforceFactor: 60,
      lateralGripFactor: 8,
      angularDamping: 0.65,
      // The rendered motorcycle still leans into a turn, while the narrow
      // invisible support chassis resists solver-induced pitch and roll.
      angularFactor: { x: 0.3, y: 1, z: 0 },
      rollInfluence: 0.015,
      wheelTrackFactor: 0.72,
      visualLeanFactor: 0.24
    }
  }
});

const PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(PROFILE_OVERRIDES).map(([type, override]) => [
    type,
    Object.freeze({
      ...DEFAULT_PROFILE,
      ...override,
      drive: createDriveProfile(override.drive),
      playerDynamics: createPlayerDynamics(override.playerDynamics)
    })
  ])
));

export function getVehicleProfile(type) {
  return PROFILES[type] || DEFAULT_PROFILE;
}

export const PLAYER_VEHICLE_LAYOUT = Object.freeze({
  wheelConnectionY: -0.05,
  fallbackGravity: 25
});

/**
 * Derives the rigid chassis/visual alignment from the same suspension data
 * used by cannon-es. Keeping this calculation profile-driven prevents tall,
 * heavy vehicles from receiving a nearly ground-level invisible collider.
 */
export function getPlayerVehiclePhysicsLayout(type, gravityY = -PLAYER_VEHICLE_LAYOUT.fallbackGravity) {
  const profile = getVehicleProfile(type);
  const wheelCount = Math.max(1, Number(profile.wheelCount) || 4);
  const gravity = Number.isFinite(gravityY)
    ? Math.abs(gravityY)
    : PLAYER_VEHICLE_LAYOUT.fallbackGravity;
  const staticCompression = Math.min(
    profile.suspensionRestLength * 0.8,
    gravity / (profile.suspensionStiffness * wheelCount)
  );
  const settledRideHeight = Math.max(
    profile.wheelRadius,
    profile.wheelRadius
      + profile.suspensionRestLength
      - PLAYER_VEHICLE_LAYOUT.wheelConnectionY
      - staticCompression
  );

  return Object.freeze({
    wheelCount,
    wheelConnectionY: PLAYER_VEHICLE_LAYOUT.wheelConnectionY,
    settledRideHeight,
    // The visible lower body begins one wheel radius above the mesh origin.
    // Align the physical box to that same plane so contacts are never hidden.
    chassisShapeOffsetY: profile.height * 0.5 + profile.wheelRadius - settledRideHeight,
    chassisGroundClearance: profile.wheelRadius
  });
}
