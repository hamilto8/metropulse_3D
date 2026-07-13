// Slightly taller than the pedestrian's maximum jump arc so the continuous
// safety envelope cannot be bypassed between sparse decorative rail members.
const DEFAULT_BARRIER_HEIGHT = 2.2;
const DEFAULT_BARRIER_THICKNESS = 0.6;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Creates the two continuous collision envelopes behind a bridge's visible
 * open guardrails. Keeping this geometry data-driven ensures vehicle and
 * pedestrian containment always agrees with the rendered bridge layout.
 */
export function createBridgeBarrierColliders({
  centerX = 0,
  centerZ = 0,
  length,
  width,
  deckHeight = 0,
  barrierHeight = DEFAULT_BARRIER_HEIGHT,
  barrierThickness = DEFAULT_BARRIER_THICKNESS,
  rotationY = 0,
  bridgeId = 'bridge'
} = {}) {
  const safeLength = finiteOr(length, 0);
  const safeWidth = finiteOr(width, 0);
  if (safeLength <= 0 || safeWidth <= 0) return [];

  const safeHeight = Math.max(0.8, finiteOr(barrierHeight, DEFAULT_BARRIER_HEIGHT));
  const safeThickness = Math.min(
    safeWidth * 0.25,
    Math.max(0.2, finiteOr(barrierThickness, DEFAULT_BARRIER_THICKNESS))
  );
  const safeRotation = finiteOr(rotationY, 0);
  const lateralOffset = safeWidth * 0.5 - safeThickness * 0.5;
  const sine = Math.sin(safeRotation);
  const cosine = Math.cos(safeRotation);

  return [-1, 1].map(side => ({
    position: {
      x: finiteOr(centerX, 0) + sine * lateralOffset * side,
      y: finiteOr(deckHeight, 0) + safeHeight * 0.5,
      z: finiteOr(centerZ, 0) + cosine * lateralOffset * side
    },
    size: { x: safeLength, y: safeHeight, z: safeThickness },
    rotationY: safeRotation,
    kind: 'bridge-barrier',
    bridgeId: String(bridgeId),
    side: side < 0 ? 'north' : 'south'
  }));
}
