const freezeList = values => Object.freeze([...values]);

export const COUNTRYSIDE_GRID = Object.freeze({
  bounds: Object.freeze({ minX: 420, maxX: 800, minZ: -350, maxZ: 350 }),
  buildableBounds: Object.freeze({ minX: 440, maxX: 780, minZ: -330, maxZ: 330 }),
  roadWidth: 14,
  horizontalRoadCenters: freezeList([-100, -50, 0, 50, 100]),
  verticalRoadCenters: freezeList([450, 550, 650, 750]),
  verticalRoadMinZ: -100,
  verticalRoadMaxZ: 100,
  residentialColumnCenters: freezeList([500, 600, 700]),
  residentialRowCenters: freezeList([-125, -75, -25, 25, 75, 125]),
  rocketAccessRoad: Object.freeze({ centerX: 700, minZ: -280, maxZ: -100, width: 14 }),
  missionControlSpur: Object.freeze({ minX: 700, maxX: 735, centerZ: -245, width: 12 })
});

export const SUBURBAN_HOME_RULES = Object.freeze({
  // Includes the roof overhang, not just the narrower wall collider.
  footprint: Object.freeze({ width: 11.6, depth: 8.8 }),
  roadSetback: 3,
  occupancyProbability: 0.8
});

function rectangle(id, kind, minX, maxX, minZ, maxZ) {
  return Object.freeze({ id, kind, minX, maxX, minZ, maxZ });
}

function buildReservations() {
  const reservations = [];
  const halfRoad = COUNTRYSIDE_GRID.roadWidth * 0.5;
  for (const z of COUNTRYSIDE_GRID.horizontalRoadCenters) {
    reservations.push(rectangle(
      `road-horizontal-${z}`,
      'ROAD',
      COUNTRYSIDE_GRID.bounds.minX,
      COUNTRYSIDE_GRID.bounds.maxX,
      z - halfRoad,
      z + halfRoad
    ));
  }
  for (const x of COUNTRYSIDE_GRID.verticalRoadCenters) {
    reservations.push(rectangle(
      `road-vertical-${x}`,
      'ROAD',
      x - halfRoad,
      x + halfRoad,
      COUNTRYSIDE_GRID.verticalRoadMinZ,
      COUNTRYSIDE_GRID.verticalRoadMaxZ
    ));
  }

  const access = COUNTRYSIDE_GRID.rocketAccessRoad;
  reservations.push(rectangle(
    'road-rocket-access',
    'ROAD',
    access.centerX - access.width * 0.5,
    access.centerX + access.width * 0.5,
    access.minZ,
    access.maxZ
  ));
  const spur = COUNTRYSIDE_GRID.missionControlSpur;
  reservations.push(rectangle(
    'road-mission-control-spur',
    'ROAD',
    spur.minX,
    spur.maxX,
    spur.centerZ - spur.width * 0.5,
    spur.centerZ + spur.width * 0.5
  ));

  // Non-road civic sites also reserve their operational/safety footprints.
  reservations.push(
    rectangle('site-rocket-pad', 'CIVIC', 676, 724, -304, -256),
    rectangle('site-mission-control', 'CIVIC', 720, 750, -258, -232),
    rectangle('site-space-billboard', 'CIVIC', 600, 644, -180, -140)
  );
  return Object.freeze(reservations);
}

export const COUNTRYSIDE_RESERVATIONS = buildReservations();

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getFootprintEnvelope(position, footprint, {
  rotationY = 0,
  setback = 0,
  id = null,
  kind = 'OCCUPIED'
} = {}) {
  const x = finiteNumber(position?.x);
  const z = finiteNumber(position?.z);
  const width = finiteNumber(footprint?.width);
  const depth = finiteNumber(footprint?.depth);
  if (x == null || z == null || width == null || depth == null || width <= 0 || depth <= 0) {
    return null;
  }

  const safeRotation = finiteNumber(rotationY) ?? 0;
  const safeSetback = Math.max(0, finiteNumber(setback) ?? 0);
  const cosine = Math.abs(Math.cos(safeRotation));
  const sine = Math.abs(Math.sin(safeRotation));
  const halfX = (width * cosine + depth * sine) * 0.5 + safeSetback;
  const halfZ = (width * sine + depth * cosine) * 0.5 + safeSetback;
  return { id, kind, minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ };
}

export function footprintsOverlap(a, b) {
  if (!a || !b) return false;
  return a.minX < b.maxX
    && a.maxX > b.minX
    && a.minZ < b.maxZ
    && a.maxZ > b.minZ;
}

export function canPlaceCountrysideStructure(position, footprint, {
  rotationY = 0,
  setback = 0,
  reservations = COUNTRYSIDE_RESERVATIONS,
  occupied = []
} = {}) {
  const envelope = getFootprintEnvelope(position, footprint, { rotationY, setback });
  if (!envelope) return false;
  const bounds = COUNTRYSIDE_GRID.buildableBounds;
  if (
    envelope.minX < bounds.minX
    || envelope.maxX > bounds.maxX
    || envelope.minZ < bounds.minZ
    || envelope.maxZ > bounds.maxZ
  ) return false;

  return ![...(reservations || []), ...(occupied || [])].some(reservation => (
    footprintsOverlap(envelope, reservation)
  ));
}

function nearestFrontageRotation(z) {
  let nearestRoad = COUNTRYSIDE_GRID.horizontalRoadCenters[0];
  let nearestDistance = Math.abs(z - nearestRoad);
  for (const roadZ of COUNTRYSIDE_GRID.horizontalRoadCenters.slice(1)) {
    const distance = Math.abs(z - roadZ);
    if (distance < nearestDistance) {
      nearestRoad = roadZ;
      nearestDistance = distance;
    }
  }
  return nearestRoad >= z ? 0 : Math.PI;
}

export function createSuburbanParcels() {
  const parcels = [];
  for (const x of COUNTRYSIDE_GRID.residentialColumnCenters) {
    for (const z of COUNTRYSIDE_GRID.residentialRowCenters) {
      const rotationY = nearestFrontageRotation(z);
      if (!canPlaceCountrysideStructure(
        { x, z },
        SUBURBAN_HOME_RULES.footprint,
        { rotationY, setback: SUBURBAN_HOME_RULES.roadSetback }
      )) continue;
      parcels.push(Object.freeze({
        id: `suburban-${x}-${z}`,
        zone: 'SUBURBAN_RESIDENTIAL',
        x,
        z,
        rotationY
      }));
    }
  }
  return Object.freeze(parcels);
}
