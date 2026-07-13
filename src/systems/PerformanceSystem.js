import * as THREE from 'three';

export const DETAIL_TIERS = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
});

export const RENDER_QUALITY_TIERS = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
});

const NEXT_LOWER_RENDER_TIER = Object.freeze({
  [RENDER_QUALITY_TIERS.HIGH]: RENDER_QUALITY_TIERS.MEDIUM,
  [RENDER_QUALITY_TIERS.MEDIUM]: RENDER_QUALITY_TIERS.LOW
});

const NEXT_HIGHER_RENDER_TIER = Object.freeze({
  [RENDER_QUALITY_TIERS.LOW]: RENDER_QUALITY_TIERS.MEDIUM,
  [RENDER_QUALITY_TIERS.MEDIUM]: RENDER_QUALITY_TIERS.HIGH
});

/**
 * Uses one-second FPS samples to adapt expensive renderer features. The long
 * upgrade window and separate thresholds prevent quality oscillation while a
 * short startup grace period avoids reacting to shader compilation.
 */
export class AdaptiveQualityController {
  constructor({
    initialTier = RENDER_QUALITY_TIERS.HIGH,
    locked = false,
    warmupSamples = 4,
    downgradeSamples = 3,
    upgradeSamples = 15,
    onChange = null
  } = {}) {
    this.tier = initialTier;
    this.locked = locked;
    this.warmupSamples = warmupSamples;
    this.downgradeSamples = downgradeSamples;
    this.upgradeSamples = upgradeSamples;
    this.onChange = onChange;
    this.samples = 0;
    this.slowSamples = 0;
    this.fastSamples = 0;
  }

  observe(fps) {
    if (this.locked || !Number.isFinite(fps) || fps <= 0) return this.tier;
    this.samples += 1;
    if (this.samples <= this.warmupSamples) return this.tier;

    const downgradeThreshold = this.tier === RENDER_QUALITY_TIERS.HIGH ? 45 : 38;
    const upgradeThreshold = this.tier === RENDER_QUALITY_TIERS.LOW ? 52 : 72;

    if (fps < downgradeThreshold && NEXT_LOWER_RENDER_TIER[this.tier]) {
      this.slowSamples += 1;
      this.fastSamples = 0;
      if (this.slowSamples >= this.downgradeSamples) {
        this.setTier(NEXT_LOWER_RENDER_TIER[this.tier]);
      }
    } else if (fps >= upgradeThreshold && NEXT_HIGHER_RENDER_TIER[this.tier]) {
      this.fastSamples += 1;
      this.slowSamples = 0;
      if (this.fastSamples >= this.upgradeSamples) {
        this.setTier(NEXT_HIGHER_RENDER_TIER[this.tier]);
      }
    } else {
      this.slowSamples = 0;
      this.fastSamples = 0;
    }

    return this.tier;
  }

  setTier(tier) {
    if (!Object.values(RENDER_QUALITY_TIERS).includes(tier) || tier === this.tier) {
      return this.tier;
    }
    const previous = this.tier;
    this.tier = tier;
    this.slowSamples = 0;
    this.fastSamples = 0;
    this.onChange?.(tier, previous);
    return this.tier;
  }
}

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
    const sceneManager = this.app?.sceneManager;
    this.renderQuality = new AdaptiveQualityController({
      initialTier: sceneManager?.renderQuality || RENDER_QUALITY_TIERS.HIGH,
      locked: Boolean(sceneManager?.renderQualityOverride),
      onChange: tier => sceneManager?.setRenderQuality?.(tier)
    });
  }

  recordFrameRate(fps) {
    return this.renderQuality.observe(fps);
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
