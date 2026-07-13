export const STREET_LAMP_MIN_SPACING = 12;

export const STREET_LAMP_ROADS = Object.freeze({
  x: Object.freeze([-100, -50, 0, 50, 100, 210, 260, 310]),
  z: Object.freeze([-100, -50, 0, 50, 100])
});

function isFinitePlacement(placement) {
  return Number.isFinite(placement?.x) && Number.isFinite(placement?.z);
}

function placementCell(value, cellSize) {
  return Math.floor(value / cellSize);
}

/**
 * Keeps the first authored placement in each minimum-spacing radius. A small
 * spatial index makes the rule reusable if the street network grows.
 */
export function removeNearbyPlacements(placements, minSpacing = STREET_LAMP_MIN_SPACING) {
  if (!Array.isArray(placements) || !Number.isFinite(minSpacing) || minSpacing <= 0) {
    return [];
  }

  const accepted = [];
  const cells = new Map();
  const minDistanceSquared = minSpacing * minSpacing;

  for (const placement of placements) {
    if (!isFinitePlacement(placement)) continue;

    const cellX = placementCell(placement.x, minSpacing);
    const cellZ = placementCell(placement.z, minSpacing);
    let hasNearbyPlacement = false;

    for (let xOffset = -1; xOffset <= 1 && !hasNearbyPlacement; xOffset += 1) {
      for (let zOffset = -1; zOffset <= 1 && !hasNearbyPlacement; zOffset += 1) {
        const neighbours = cells.get(`${cellX + xOffset}:${cellZ + zOffset}`) || [];
        hasNearbyPlacement = neighbours.some(neighbour => {
          const deltaX = placement.x - neighbour.x;
          const deltaZ = placement.z - neighbour.z;
          return (deltaX * deltaX) + (deltaZ * deltaZ) < minDistanceSquared;
        });
      }
    }

    if (hasNearbyPlacement) continue;
    accepted.push(placement);
    const cellKey = `${cellX}:${cellZ}`;
    const cellPlacements = cells.get(cellKey) || [];
    cellPlacements.push(placement);
    cells.set(cellKey, cellPlacements);
  }

  return accepted;
}

function isClearOfIntersection(position) {
  return Math.abs(position % 50) > 10;
}

/**
 * Three.js street lamps extend along local +Z, so yaw is measured from +Z
 * toward the shortest vector back to the road centerline.
 */
export function getStreetFacingRotation({ x, z }, { roadAxis, roadCenter }) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(roadCenter)) return 0;
  if (roadAxis === 'z') return Math.atan2(roadCenter - x, 0);
  if (roadAxis === 'x') return Math.atan2(0, roadCenter - z);
  return 0;
}

function createRoadFacingPlacement(x, z, roadAxis, roadCenter) {
  return {
    x,
    z,
    roadAxis,
    roadCenter,
    rot: getStreetFacingRotation({ x, z }, { roadAxis, roadCenter })
  };
}

export function createStreetLampLayout({
  roadCoordsX = STREET_LAMP_ROADS.x,
  roadCoordsZ = STREET_LAMP_ROADS.z,
  minSpacing = STREET_LAMP_MIN_SPACING
} = {}) {
  const candidates = [];

  for (const roadX of roadCoordsX) {
    for (let z = -85; z <= 85; z += 30) {
      if (!isClearOfIntersection(z)) continue;
      candidates.push(
        createRoadFacingPlacement(roadX + 8, z, 'z', roadX),
        createRoadFacingPlacement(roadX - 8, z, 'z', roadX)
      );
    }
  }

  for (const roadZ of roadCoordsZ) {
    for (let x = -135; x <= 335; x += 30) {
      if (x > 115 && x < 205) continue;
      if (!isClearOfIntersection(x)) continue;
      candidates.push(
        createRoadFacingPlacement(x, roadZ + 8, 'x', roadZ),
        createRoadFacingPlacement(x, roadZ - 8, 'x', roadZ)
      );
    }
  }

  return removeNearbyPlacements(candidates, minSpacing);
}
