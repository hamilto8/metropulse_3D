import { AIRFIELD_LAYOUT } from '../world/Airfield.js';
import { COUNTRYSIDE_GRID } from '../world/CountrysidePlan.js';

export const LANDING_SURFACE_TYPES = Object.freeze({
  RUNWAY: 'RUNWAY',
  ROAD: 'ROAD',
  COUNTRYSIDE: 'COUNTRYSIDE',
  UNSUITABLE: 'UNSUITABLE'
});

export const LANDING_SURFACE_LABELS = Object.freeze({
  [LANDING_SURFACE_TYPES.RUNWAY]: 'AIRFIELD RUNWAY',
  [LANDING_SURFACE_TYPES.ROAD]: 'ROAD',
  [LANDING_SURFACE_TYPES.COUNTRYSIDE]: 'COUNTRYSIDE',
  [LANDING_SURFACE_TYPES.UNSUITABLE]: 'UNSUITABLE TERRAIN'
});

const CITY_ROAD_X = Object.freeze([-100, -50, 0, 50, 100, 210, 260, 310]);
const CITY_ROAD_Z = Object.freeze([-100, -50, 0, 50, 100]);
const CITY_HORIZONTAL_SEGMENTS = Object.freeze([
  Object.freeze({ min: -150, max: 115 }),
  Object.freeze({ min: 205, max: 380 })
]);
const ROAD_HALF_WIDTH = COUNTRYSIDE_GRID.roadWidth * 0.5;
const MAX_LANDING_GRADE = 0.22;

// These points cover the landing gear, nose/tail and wing tips. Sampling the
// complete footprint prevents a valid centre point from hiding a riverbank or
// sharp terrain change under another part of the aircraft.
const AIRCRAFT_FOOTPRINT = Object.freeze([
  Object.freeze({ x: 0, z: 0 }),
  Object.freeze({ x: -1.65, z: 0.45 }),
  Object.freeze({ x: 1.65, z: 0.45 }),
  Object.freeze({ x: 0, z: -3.05 }),
  Object.freeze({ x: 0, z: 3.7 }),
  Object.freeze({ x: -4.75, z: 0.35 }),
  Object.freeze({ x: 4.75, z: 0.35 })
]);

const inRange = (value, minimum, maximum) => value >= minimum && value <= maximum;
const near = (value, center, radius = ROAD_HALF_WIDTH) => Math.abs(value - center) <= radius;

function isFinitePoint(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.z);
}

function isOnRunway(x, z, layout = AIRFIELD_LAYOUT) {
  return near(x, layout.centerX, layout.runwayWidth * 0.5)
    && near(z, layout.centerZ, layout.runwayLength * 0.5);
}

function isOnAuthoredRoad(x, z) {
  const onCityHorizontal = CITY_ROAD_Z.some(roadZ => near(z, roadZ))
    && CITY_HORIZONTAL_SEGMENTS.some(segment => inRange(x, segment.min, segment.max));
  const onCityVertical = CITY_ROAD_X.some(roadX => near(x, roadX))
    && inRange(z, -100, 100);
  const onCountryHorizontal = COUNTRYSIDE_GRID.horizontalRoadCenters.some(roadZ => near(z, roadZ))
    && inRange(x, COUNTRYSIDE_GRID.bounds.minX, COUNTRYSIDE_GRID.bounds.maxX);
  const onCountryVertical = COUNTRYSIDE_GRID.verticalRoadCenters.some(roadX => near(x, roadX))
    && inRange(z, COUNTRYSIDE_GRID.verticalRoadMinZ, COUNTRYSIDE_GRID.verticalRoadMaxZ);

  const access = COUNTRYSIDE_GRID.rocketAccessRoad;
  const onRocketAccess = near(x, access.centerX, access.width * 0.5)
    && inRange(z, access.minZ, access.maxZ);
  const spur = COUNTRYSIDE_GRID.missionControlSpur;
  const onMissionSpur = inRange(x, spur.minX, spur.maxX)
    && near(z, spur.centerZ, spur.width * 0.5);

  return onCityHorizontal || onCityVertical || onCountryHorizontal
    || onCountryVertical || onRocketAccess || onMissionSpur;
}

function isOnPlacedRoad(x, z, cityBuilder) {
  const records = cityBuilder?.app?.trafficSystem?.placedRoadSegments;
  if (!records?.values) return false;
  for (const record of records.values()) {
    const building = record?.building;
    const spec = record?.spec || building?.spec;
    if (!building?.plot || building.isDestroyed || !spec?.roadType || spec.roadType === 'BRIDGE') continue;
    const rotation = building.group?.rotation?.y || 0;
    const dx = x - building.plot.x;
    const dz = z - building.plot.z;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const localX = dx * cosine - dz * sine;
    const localZ = dx * sine + dz * cosine;
    const halfWidth = Number(building.plot.width || spec.footprint?.width || 30) * 0.5;
    const halfDepth = Number(building.plot.depth || spec.footprint?.depth || 30) * 0.5;
    if (Math.abs(localX) <= halfWidth && Math.abs(localZ) <= halfDepth) return true;
  }
  return false;
}

function isOnBridge(x, z, cityBuilder) {
  return cityBuilder?.getUserBridgeDeckHeight?.(x, z) != null
    || cityBuilder?.getBuiltInBridgeDeckHeight?.(x, z) != null;
}

export function classifyLandingSurface(position, cityBuilder, layout = AIRFIELD_LAYOUT) {
  if (!isFinitePoint(position)) return LANDING_SURFACE_TYPES.UNSUITABLE;
  const { x, z } = position;
  if (isOnRunway(x, z, layout)) return LANDING_SURFACE_TYPES.RUNWAY;
  // Bridges are intentionally excluded: their barriers and short decks do not
  // provide the wing or rollout clearance of a proper road landing.
  if (isOnBridge(x, z, cityBuilder)) return LANDING_SURFACE_TYPES.UNSUITABLE;
  if (isOnAuthoredRoad(x, z) || isOnPlacedRoad(x, z, cityBuilder)) {
    return LANDING_SURFACE_TYPES.ROAD;
  }
  if (
    inRange(x, COUNTRYSIDE_GRID.bounds.minX, COUNTRYSIDE_GRID.bounds.maxX)
    && inRange(z, COUNTRYSIDE_GRID.bounds.minZ, COUNTRYSIDE_GRID.bounds.maxZ)
  ) {
    return LANDING_SURFACE_TYPES.COUNTRYSIDE;
  }
  return LANDING_SURFACE_TYPES.UNSUITABLE;
}

export function getLandingFootprintSamples(position, heading = 0) {
  if (!isFinitePoint(position)) return [];
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  const cosine = Math.cos(safeHeading);
  const sine = Math.sin(safeHeading);
  return AIRCRAFT_FOOTPRINT.map(local => Object.freeze({
    x: position.x + local.x * cosine + local.z * sine,
    z: position.z - local.x * sine + local.z * cosine
  }));
}

export function assessLandingSurface({
  position,
  heading = 0,
  cityBuilder,
  layout = AIRFIELD_LAYOUT,
  maxGrade = MAX_LANDING_GRADE
} = {}) {
  const type = classifyLandingSurface(position, cityBuilder, layout);
  const label = LANDING_SURFACE_LABELS[type];
  const samples = getLandingFootprintSamples(position, heading);
  if (!samples.length) {
    return Object.freeze({ allowed: false, type, label, reason: 'invalid-position', groundHeight: 0, maxGrade: Infinity });
  }

  const heights = samples.map(sample => {
    const height = cityBuilder?.getTerrainHeight?.(sample.x, sample.z);
    return Number.isFinite(height) ? height : 0;
  });
  const centerHeight = heights[0];
  const wet = samples.some((sample, index) => Boolean(cityBuilder?.isInWater?.({
    x: sample.x,
    y: heights[index] + 1.15,
    z: sample.z
  })));
  const maxDetectedGrade = samples.reduce((maximum, sample, index) => {
    if (index === 0) return maximum;
    const distance = Math.hypot(sample.x - samples[0].x, sample.z - samples[0].z);
    return Math.max(maximum, distance > 0 ? Math.abs(heights[index] - centerHeight) / distance : 0);
  }, 0);

  let reason = null;
  if (wet) reason = 'water';
  else if (type === LANDING_SURFACE_TYPES.UNSUITABLE) reason = 'unsupported-surface';
  else if (maxDetectedGrade > maxGrade) reason = 'terrain-too-steep';

  return Object.freeze({
    allowed: reason === null,
    type,
    label,
    reason,
    groundHeight: wet ? Math.max(0, centerHeight) : centerHeight,
    maxGrade: maxDetectedGrade
  });
}

export { MAX_LANDING_GRADE };
