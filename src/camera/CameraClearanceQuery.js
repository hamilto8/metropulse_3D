import * as THREE from 'three';

export const CAMERA_CLEARANCE_DEFAULTS = Object.freeze({
  radius: 0.8,
  terrainClearance: 0.7,
  searchStep: 2.5,
  maxSearchRadius: 30,
  samplesPerRing: 16
});

function finiteVector(value) {
  return Number.isFinite(value?.x)
    && Number.isFinite(value?.y)
    && Number.isFinite(value?.z);
}

function readSize(size) {
  return {
    x: Number(size?.x ?? size?.width ?? 0),
    y: Number(size?.y ?? size?.height ?? 0),
    z: Number(size?.z ?? size?.depth ?? 0)
  };
}

function normalizeObstacle(obstacle) {
  if (!finiteVector(obstacle?.position)) return null;
  const size = readSize(obstacle.size);
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) return null;
  return { position: obstacle.position, size, kind: obstacle.kind || 'obstacle' };
}

function sphereIntersectsBox(position, radius, obstacle) {
  const halfX = obstacle.size.x * 0.5;
  const halfY = obstacle.size.y * 0.5;
  const halfZ = obstacle.size.z * 0.5;
  const dx = Math.max(Math.abs(position.x - obstacle.position.x) - halfX, 0);
  const dy = Math.max(Math.abs(position.y - obstacle.position.y) - halfY, 0);
  const dz = Math.max(Math.abs(position.z - obstacle.position.z) - halfZ, 0);
  return dx * dx + dy * dy + dz * dz < radius * radius;
}

/**
 * Finds a deterministic collision-free camera origin. It uses lightweight
 * runtime obstacle snapshots rather than renderer raycasts, so the same query
 * can cover authored buildings, trees/scenery, vehicles, terrain, and water.
 */
export class CameraClearanceQuery {
  constructor({
    getTerrainHeight = () => 0,
    isWater = () => false,
    getObstacles = () => [],
    ...defaults
  } = {}) {
    if (typeof getTerrainHeight !== 'function') throw new TypeError('getTerrainHeight must be a function');
    if (typeof isWater !== 'function') throw new TypeError('isWater must be a function');
    if (typeof getObstacles !== 'function') throw new TypeError('getObstacles must be a function');
    this.getTerrainHeight = getTerrainHeight;
    this.isWater = isWater;
    this.getObstacles = getObstacles;
    this.defaults = Object.freeze({ ...CAMERA_CLEARANCE_DEFAULTS, ...defaults });
  }

  inspect(position, options = {}) {
    if (!finiteVector(position)) {
      return Object.freeze({ clear: false, reason: 'INVALID_POSITION', obstacle: null });
    }
    const radius = Math.max(0, Number(options.radius ?? this.defaults.radius) || 0);
    const terrainClearance = Math.max(
      radius,
      Number(options.terrainClearance ?? this.defaults.terrainClearance) || 0
    );
    const terrainHeight = Number(this.getTerrainHeight(position.x, position.z));
    const surfaceHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
    if (position.y < surfaceHeight + terrainClearance) {
      return Object.freeze({
        clear: false,
        reason: 'TERRAIN',
        obstacle: null,
        minimumY: surfaceHeight + terrainClearance
      });
    }
    if (this.isWater(position)) {
      return Object.freeze({ clear: false, reason: 'WATER', obstacle: null });
    }

    const ignored = new Set(options.ignore || []);
    for (const candidate of this.getObstacles() || []) {
      if (ignored.has(candidate) || ignored.has(candidate?.entity)) continue;
      const obstacle = normalizeObstacle(candidate);
      if (obstacle && sphereIntersectsBox(position, radius, obstacle)) {
        return Object.freeze({ clear: false, reason: 'OBSTACLE', obstacle: candidate });
      }
    }
    return Object.freeze({ clear: true, reason: null, obstacle: null });
  }

  resolve(desiredPosition, options = {}) {
    if (!finiteVector(desiredPosition)) throw new TypeError('desiredPosition must contain finite x, y, and z');
    const resolved = desiredPosition.clone?.() || new THREE.Vector3(
      desiredPosition.x,
      desiredPosition.y,
      desiredPosition.z
    );
    this.#liftAboveTerrain(resolved, options);
    if (this.inspect(resolved, options).clear) return resolved;

    const step = Math.max(0.25, Number(options.searchStep ?? this.defaults.searchStep) || 0.25);
    const maxRadius = Math.max(step, Number(options.maxSearchRadius ?? this.defaults.maxSearchRadius) || step);
    const samples = Math.max(8, Math.round(Number(options.samplesPerRing ?? this.defaults.samplesPerRing) || 8));
    const preferredDirection = options.preferredDirection;
    const startAngle = finiteVector(preferredDirection)
      ? Math.atan2(preferredDirection.z, preferredDirection.x)
      : 0;

    for (let distance = step; distance <= maxRadius; distance += step) {
      for (let index = 0; index < samples; index += 1) {
        const angle = startAngle + (index / samples) * Math.PI * 2;
        resolved.set(
          desiredPosition.x + Math.cos(angle) * distance,
          desiredPosition.y,
          desiredPosition.z + Math.sin(angle) * distance
        );
        this.#liftAboveTerrain(resolved, options);
        if (this.inspect(resolved, options).clear) return resolved;
      }
    }

    throw new Error(`No safe camera position exists within ${maxRadius} world units.`);
  }

  #liftAboveTerrain(position, options) {
    const radius = Math.max(0, Number(options.radius ?? this.defaults.radius) || 0);
    const clearance = Math.max(
      radius,
      Number(options.terrainClearance ?? this.defaults.terrainClearance) || 0
    );
    const terrainHeight = Number(this.getTerrainHeight(position.x, position.z));
    position.y = Math.max(position.y, (Number.isFinite(terrainHeight) ? terrainHeight : 0) + clearance);
  }
}

export default CameraClearanceQuery;
