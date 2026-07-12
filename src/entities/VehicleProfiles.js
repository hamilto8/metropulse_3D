const DEFAULT_PROFILE = Object.freeze({
  mass: 1200,
  width: 2,
  height: 1.4,
  length: 4.2,
  wheelRadius: 0.4,
  suspensionRestLength: 0.45,
  suspensionStiffness: 48,
  maxSuspensionForce: 100000
});

const PROFILE_OVERRIDES = Object.freeze({
  SPORTS: { mass: 950, width: 2.1, height: 1.05, length: 4.4, wheelRadius: 0.45, suspensionRestLength: 0.38, suspensionStiffness: 68 },
  SPORTS_CAR: { mass: 950, width: 2.1, height: 1.05, length: 4.4, wheelRadius: 0.45, suspensionRestLength: 0.38, suspensionStiffness: 68 },
  BUS: { mass: 4800, width: 2.6, height: 3.2, length: 10.5, wheelRadius: 0.6, suspensionRestLength: 0.6, suspensionStiffness: 120, maxSuspensionForce: 350000 },
  TRUCK: { mass: 3500, width: 2.4, height: 3, length: 7.5, wheelRadius: 0.55, suspensionRestLength: 0.55, suspensionStiffness: 95, maxSuspensionForce: 250000 },
  AMBULANCE: { mass: 2400, width: 2.3, height: 2.4, length: 6.2, wheelRadius: 0.5, suspensionRestLength: 0.5, suspensionStiffness: 75, maxSuspensionForce: 180000 },
  ICECREAM: { mass: 1900, width: 2.2, height: 2.3, length: 5.8, wheelRadius: 0.48, suspensionRestLength: 0.48, suspensionStiffness: 65, maxSuspensionForce: 150000 },
  DUMP_TRUCK: { mass: 4200, width: 2.5, height: 2.9, length: 7.8, wheelRadius: 0.6, suspensionRestLength: 0.58, suspensionStiffness: 110, maxSuspensionForce: 300000 },
  MOTORBIKE: { mass: 250, width: 0.7, height: 1, length: 2.2, wheelRadius: 0.35, suspensionRestLength: 0.35, suspensionStiffness: 55, maxSuspensionForce: 80000 }
});

const PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(PROFILE_OVERRIDES).map(([type, override]) => [
    type,
    Object.freeze({ ...DEFAULT_PROFILE, ...override })
  ])
));

export function getVehicleProfile(type) {
  return PROFILES[type] || DEFAULT_PROFILE;
}
