import { DISTRICT_DEFINITIONS } from '../data/ContentDefinitions.js';
import { SERVICE_TYPES } from './EconomySystem.js';

export const MVP_SERVICE_TYPES = Object.freeze({
  ENERGY: SERVICE_TYPES.POWER,
  SAFETY: SERVICE_TYPES.FIRE
});

export const SERVICE_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  STRAINED: 'STRAINED',
  CRITICAL: 'CRITICAL'
});

const SERVICE_NAMES = new Set(Object.values(SERVICE_TYPES));
const DEFAULT_DISTRICT_ACCESS = Object.freeze({
  WEST_CORE: Object.freeze({ power: 0.9, water: 1, fire: 0.72 }),
  CENTRAL_PARK: Object.freeze({ power: 0.86, water: 1, fire: 0.84 }),
  PRIMARY_BRIDGE_CORRIDOR: Object.freeze({ power: 0.76, water: 1, fire: 0.58 }),
  EAST_CYBER_METROPOLIS: Object.freeze({ power: 0.42, water: 0.7, fire: 0.36 })
});

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function assertService(service) {
  if (typeof service !== 'string' || !SERVICE_NAMES.has(service.toLowerCase())) {
    throw new RangeError('service must be power, water, or fire');
  }
  return service.toLowerCase();
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function area(definition) {
  return (definition.bounds.maxX - definition.bounds.minX)
    * (definition.bounds.maxZ - definition.bounds.minZ);
}

function contains(definition, position) {
  return position.x >= definition.bounds.minX && position.x <= definition.bounds.maxX
    && position.z >= definition.bounds.minZ && position.z <= definition.bounds.maxZ;
}

function healthFor(coverage) {
  if (coverage >= 0.9) return SERVICE_HEALTH.HEALTHY;
  if (coverage >= 0.65) return SERVICE_HEALTH.STRAINED;
  return SERVICE_HEALTH.CRITICAL;
}

function positionWeight(origin, radius, position) {
  if (!origin || !(radius > 0) || !position) return null;
  return clamp(1 - Math.hypot(origin.x - position.x, origin.z - position.z) / radius);
}

function explain(service, coverage, { networkAccess, outageMultiplier, outageCount }) {
  const label = service === SERVICE_TYPES.POWER ? 'Energy' : service === SERVICE_TYPES.FIRE ? 'Safety response' : 'Water';
  const contributors = [`${Math.round(networkAccess * 100)}% local access`];
  if (outageCount > 0) contributors.push(`${outageCount} active outage${outageCount === 1 ? '' : 's'}`);
  if (outageMultiplier < 1) contributors.push(`${Math.round((1 - outageMultiplier) * 100)}% outage loss`);
  return `${label} is ${healthFor(coverage).toLowerCase()} at ${Math.round(coverage * 100)}% (${contributors.join(', ')}).`;
}

/**
 * Read-only composite for the intentionally lightweight MVP service model.
 * EconomySystem remains the capacity/demand owner and MissionOutcomeService
 * remains the outage/incident owner. This class only answers aggregate and
 * location-aware questions from those two truths.
 */
export class CityServiceModel {
  #economy;
  #outcomes;
  #districts;
  #districtsById;
  #listeners = new Set();
  #unsubscribers = [];
  #revision = 0;

  constructor({
    economySystem,
    outcomeService,
    districtDefinitions = DISTRICT_DEFINITIONS
  } = {}) {
    if (!economySystem?.snapshot || !economySystem?.subscribe) {
      throw new TypeError('CityServiceModel requires an observable EconomySystem');
    }
    if (!outcomeService?.snapshot || !outcomeService?.subscribe) {
      throw new TypeError('CityServiceModel requires an observable MissionOutcomeService');
    }
    this.#economy = economySystem;
    this.#outcomes = outcomeService;
    this.#districts = [...districtDefinitions].sort((left, right) => area(left) - area(right));
    this.#districtsById = new Map(this.#districts.map(definition => [definition.id, definition]));
    const publish = () => this.#publish();
    this.#unsubscribers.push(economySystem.subscribe(publish), outcomeService.subscribe(publish));
  }

  getCoverage(service, selector = {}) {
    const normalizedService = assertService(service);
    assertRecord(selector, 'service selector');
    const position = selector.position == null
      ? (Number.isFinite(selector.x) && Number.isFinite(selector.z)
        ? { x: selector.x, z: selector.z }
        : null)
      : selector.position;
    if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.z))) {
      throw new TypeError('service selector.position requires finite x and z');
    }
    const district = this.#resolveDistrict(selector.districtId, position);
    const economy = this.#economy.snapshot();
    const aggregate = economy.services[normalizedService];
    const facilities = economy.buildings
      .filter(building => building.operational && building.services?.[normalizedService]?.capacity > 0)
      .map(building => {
        const state = building.services[normalizedService];
        return {
          id: building.id,
          name: building.name,
          position: building.position,
          capacity: state.capacity,
          reach: state.reach || 0,
          weight: positionWeight(building.position, state.reach || 0, position)
        };
      });

    const networkAccess = position || district
      ? this.#networkAccess(normalizedService, district, position, facilities)
      : 1;
    const outages = Object.entries(this.#outcomes.snapshot().serviceOutages || {})
      .filter(([, outage]) => outage.active && outage.service === normalizedService)
      .map(([id, outage]) => ({ id, ...clone(outage) }));
    const applicableOutages = outages.filter(outage => this.#outageApplies(outage, district, position));
    const outageMultiplier = applicableOutages.reduce(
      (current, outage) => current * this.#outageMultiplier(outage, district, position),
      1
    );
    const coverage = clamp(aggregate.coverage * networkAccess * outageMultiplier);
    const facts = {
      aggregate: clone(aggregate),
      districtId: district?.id ?? null,
      networkAccess,
      outageMultiplier,
      facilities,
      outages: applicableOutages
    };
    return freeze({
      service: normalizedService,
      districtId: district?.id ?? null,
      position: position ? clone(position) : null,
      coverage,
      coveragePercent: coverage * 100,
      adequate: aggregate.adequate && coverage >= 0.9,
      health: healthFor(coverage),
      outageActive: applicableOutages.length > 0,
      explanation: explain(normalizedService, coverage, {
        networkAccess,
        outageMultiplier,
        outageCount: applicableOutages.length
      }),
      facts
    });
  }

  snapshot() {
    const economy = this.#economy.snapshot();
    const outcomes = this.#outcomes.snapshot();
    const power = this.getCoverage(SERVICE_TYPES.POWER);
    const fire = this.getCoverage(SERVICE_TYPES.FIRE);
    const water = this.getCoverage(SERVICE_TYPES.WATER);
    const activeIncidents = Object.entries(outcomes.incidents || {})
      .filter(([, incident]) => incident.active)
      .map(([id, incident]) => ({ id, ...clone(incident) }));
    const workOrders = Object.entries(outcomes.repairs || {})
      .map(([id, repair]) => ({ id, ...clone(repair) }));
    const openWorkOrders = workOrders.filter(order => order.status !== 'COMPLETE' && order.status !== 'CANCELLED');
    return freeze({
      revision: Math.max(this.#revision, economy.revision || 0, outcomes.revision || 0),
      services: { power, fire, water },
      energy: power,
      safety: fire,
      activeIncidents,
      activeIncidentCount: activeIncidents.length,
      workOrders,
      openWorkOrders,
      openWorkOrderCount: openWorkOrders.length
    });
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('service model listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(freeze({ type: 'SNAPSHOT', current: this.snapshot() }));
    return () => this.#listeners.delete(listener);
  }

  destroy() {
    this.#unsubscribers.splice(0).forEach(unsubscribe => unsubscribe?.());
    this.#listeners.clear();
  }

  #resolveDistrict(districtId, position) {
    if (districtId != null) {
      const district = this.#districtsById.get(districtId);
      if (!district) throw new RangeError(`Unknown district: ${districtId}`);
      return district;
    }
    return position ? this.#districts.find(definition => contains(definition, position)) ?? null : null;
  }

  #networkAccess(service, district, position, facilities) {
    const base = district ? (DEFAULT_DISTRICT_ACCESS[district.id]?.[service] ?? 0.35) : 0.25;
    if (!position) return base;
    const facilityAccess = facilities.reduce((best, facility) => Math.max(best, facility.weight ?? 0), 0);
    return clamp(Math.max(base, facilityAccess));
  }

  #outageApplies(outage, district, position) {
    if (outage.districtId && district && outage.districtId !== district.id) return false;
    if (outage.districtId && !district && position) return false;
    const weight = positionWeight(outage.position, outage.influenceRadius || 0, position);
    return weight === null || weight > 0 || (!position && (!outage.districtId || outage.districtId === district?.id));
  }

  #outageMultiplier(outage, district, position) {
    const loss = 1 - clamp(outage.coverageMultiplier);
    const spatialWeight = positionWeight(outage.position, outage.influenceRadius || 0, position);
    if (spatialWeight !== null) return 1 - loss * spatialWeight;
    if (position || district) return clamp(outage.coverageMultiplier);
    const aggregateWeight = clamp((outage.severity || 0) * (outage.districtId ? 0.25 : 0.5));
    return 1 - loss * aggregateWeight;
  }

  #publish() {
    this.#revision += 1;
    const event = freeze({ type: 'CHANGED', current: this.snapshot() });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('CityServiceModel listener failed.', error);
      }
    }
  }
}

export default CityServiceModel;
