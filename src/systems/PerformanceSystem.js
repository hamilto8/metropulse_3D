import * as THREE from 'three';

export const DETAIL_TIERS = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
});

/** A small, allocation-conscious XZ spatial index for local agent queries. */
export class SpatialHashGrid {
  constructor(cellSize = 24) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('cellSize must be positive.');
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  key(x, z) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  rebuild(entities = []) {
    this.cells.clear();
    for (const entity of entities) {
      const position = entity?.mesh?.position || entity?.position;
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) continue;
      const key = this.key(position.x, position.z);
      const cell = this.cells.get(key);
      if (cell) cell.push(entity);
      else this.cells.set(key, [entity]);
    }
  }

  query(position, radius) {
    if (!position || !Number.isFinite(radius) || radius < 0) return [];
    const minX = Math.floor((position.x - radius) / this.cellSize);
    const maxX = Math.floor((position.x + radius) / this.cellSize);
    const minZ = Math.floor((position.z - radius) / this.cellSize);
    const maxZ = Math.floor((position.z + radius) / this.cellSize);
    const radiusSq = radius * radius;
    const matches = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (const entity of this.cells.get(`${x},${z}`) || []) {
          const candidate = entity?.mesh?.position || entity?.position;
          const dx = candidate.x - position.x;
          const dz = candidate.z - position.z;
          if (dx * dx + dz * dz <= radiusSq) matches.push(entity);
        }
      }
    }
    return matches;
  }
}

/**
 * Owns performance policy: spatial indices, authored detail tiers, and bounded
 * animation cadence. Simulation movement stays continuous while expensive
 * collision/detail work scales with local relevance.
 */
export class PerformanceSystem {
  constructor(app, { highDetailDistance = 130, mediumDetailDistance = 340 } = {}) {
    this.app = app;
    this.highDetailDistance = highDetailDistance;
    this.mediumDetailDistance = mediumDetailDistance;
    this.vehicleGrid = new SpatialHashGrid(24);
    this.pedestrianGrid = new SpatialHashGrid(18);
    this.frame = 0;
    this.focus = new THREE.Vector3();
  }

  beginFrame() {
    this.frame += 1;
    this.vehicleGrid.rebuild(this.app?.trafficSystem?.vehicles || []);
    this.pedestrianGrid.rebuild(this.app?.pedestrianSystem?.pedestrians || []);

    const target = this.app?.trafficSystem?.controlledVehicle?.mesh?.position
      || this.app?.pedestrianSystem?.controlledPedestrian?.mesh?.position
      || this.app?.sceneManager?.controls?.target
      || this.app?.sceneManager?.camera?.position;
    if (target) this.focus.copy(target);

    for (const vehicle of this.app?.trafficSystem?.vehicles || []) {
      vehicle.setDetailLevel?.(this.tierFor(vehicle.mesh.position));
    }
    for (const pedestrian of this.app?.pedestrianSystem?.pedestrians || []) {
      pedestrian.setDetailLevel?.(this.tierFor(pedestrian.mesh.position));
    }
  }

  tierFor(position) {
    const distanceSq = this.focus.distanceToSquared(position);
    if (distanceSq <= this.highDetailDistance ** 2) return DETAIL_TIERS.HIGH;
    if (distanceSq <= this.mediumDetailDistance ** 2) return DETAIL_TIERS.MEDIUM;
    return DETAIL_TIERS.LOW;
  }

  shouldAnimate(entity, index = 0) {
    if (entity?.userControlled) return true;
    const tier = entity?.detailLevel || this.tierFor(entity.mesh.position);
    if (tier === DETAIL_TIERS.HIGH) return true;
    const cadence = tier === DETAIL_TIERS.MEDIUM ? 2 : 4;
    return (this.frame + index) % cadence === 0;
  }

  nearbyVehicles(position, radius) {
    return this.vehicleGrid.query(position, radius);
  }

  nearbyPedestrians(position, radius) {
    return this.pedestrianGrid.query(position, radius);
  }
}
