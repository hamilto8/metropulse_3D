import { DISTRICT_DEFINITIONS } from '../data/ContentDefinitions.js';
import { SERVICE_TYPES } from '../systems/EconomySystem.js';
import {
  assertFiniteNumber,
  assertId,
  assertRecord,
  clamp,
  clone,
  deepFreeze
} from './ContractUtils.js';

export const CITY_CONDITION_TYPES = Object.freeze({
  TRAFFIC: 'TRAFFIC',
  BRIDGE: 'BRIDGE',
  SERVICE_COVERAGE: 'SERVICE_COVERAGE',
  SAFETY: 'SAFETY',
  REPAIR: 'REPAIR',
  LAND_VALUE: 'LAND_VALUE',
  WEATHER: 'WEATHER',
  DISTRICT: 'DISTRICT',
  AUTHORED_FLAG: 'AUTHORED_FLAG'
});

export const CONDITION_OPERATORS = Object.freeze({
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  GREATER_THAN: 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  LESS_THAN: 'LESS_THAN',
  LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  IN: 'IN',
  CONTAINS: 'CONTAINS',
  TRUTHY: 'TRUTHY',
  FALSY: 'FALSY'
});

const CONDITION_TYPE_NAMES = new Set(Object.values(CITY_CONDITION_TYPES));
const SERVICE_NAMES = new Set(Object.values(SERVICE_TYPES));

const WEATHER_PROFILES = Object.freeze({
  clear: Object.freeze({ severity: 0, visibility: 1, roadGrip: 1 }),
  mist: Object.freeze({ severity: 0.25, visibility: 0.65, roadGrip: 0.9 }),
  rain: Object.freeze({ severity: 0.55, visibility: 0.72, roadGrip: 0.7 }),
  storm: Object.freeze({ severity: 1, visibility: 0.42, roadGrip: 0.5 })
});

function resolveProvider(provider, methodName, ...args) {
  if (typeof provider === 'function') return provider(...args);
  return provider?.[methodName]?.(...args) ?? null;
}

function condition(type, subjectId, value, facts, sources, revision) {
  return deepFreeze({ type, subjectId, value, facts, sources, revision });
}

function ownValue(object, key, fallback = null) {
  return object && Object.hasOwn(object, key) ? object[key] : fallback;
}

function getPath(value, path) {
  if (!path) return value;
  return String(path).split('.').reduce((current, segment) => (
    current == null ? undefined : current[segment]
  ), value);
}

function compare(actual, operator, expected) {
  switch (operator) {
    case CONDITION_OPERATORS.EQUALS: return Object.is(actual, expected);
    case CONDITION_OPERATORS.NOT_EQUALS: return !Object.is(actual, expected);
    case CONDITION_OPERATORS.GREATER_THAN: return actual > expected;
    case CONDITION_OPERATORS.GREATER_THAN_OR_EQUAL: return actual >= expected;
    case CONDITION_OPERATORS.LESS_THAN: return actual < expected;
    case CONDITION_OPERATORS.LESS_THAN_OR_EQUAL: return actual <= expected;
    case CONDITION_OPERATORS.IN: return Array.isArray(expected) && expected.includes(actual);
    case CONDITION_OPERATORS.CONTAINS:
      return Array.isArray(actual) ? actual.includes(expected) : typeof actual === 'string' && actual.includes(expected);
    case CONDITION_OPERATORS.TRUTHY: return Boolean(actual);
    case CONDITION_OPERATORS.FALSY: return !actual;
    default: throw new RangeError(`Unsupported condition operator: ${operator}`);
  }
}

function districtForPosition(definitions, x, z) {
  return definitions.find(definition => (
    x >= definition.bounds.minX && x <= definition.bounds.maxX
    && z >= definition.bounds.minZ && z <= definition.bounds.maxZ
  )) ?? null;
}

/**
 * Renderer-independent query facade used by authored mission rules.
 *
 * Providers are deliberately narrow: a simulation owner may be passed
 * directly when it exposes the expected read method, or composition can pass a
 * callback that translates its runtime state into plain data.
 */
export class CityConditionService {
  #economySystem;
  #outcomeService;
  #serviceModel;
  #trafficProvider;
  #bridgeProvider;
  #weatherProvider;
  #districtDefinitions;
  #districtsById;
  #customResolvers = new Map();

  constructor({
    economySystem,
    outcomeService = null,
    serviceModel = null,
    trafficProvider = null,
    bridgeProvider = null,
    weatherProvider = null,
    districtDefinitions = DISTRICT_DEFINITIONS
  } = {}) {
    if (!economySystem?.snapshot || !economySystem?.getLandValueBreakdownAt) {
      throw new TypeError('CityConditionService requires an economySystem query owner');
    }
    this.#economySystem = economySystem;
    this.#outcomeService = outcomeService;
    if (serviceModel !== null && !serviceModel?.getCoverage) {
      throw new TypeError('serviceModel must expose getCoverage or be null');
    }
    this.#serviceModel = serviceModel;
    this.#trafficProvider = trafficProvider;
    this.#bridgeProvider = bridgeProvider;
    this.#weatherProvider = weatherProvider;
    this.#districtDefinitions = [...districtDefinitions];
    this.#districtsById = new Map(this.#districtDefinitions.map(definition => [definition.id, definition]));
  }

  query(request) {
    assertRecord(request, 'condition request');
    const type = assertId(request.type, 'condition request.type').toUpperCase();
    const custom = this.#customResolvers.get(type);
    if (custom) return deepFreeze(custom(clone(request), this.#context()));
    if (!CONDITION_TYPE_NAMES.has(type)) throw new RangeError(`Unsupported city condition type: ${type}`);

    switch (type) {
      case CITY_CONDITION_TYPES.TRAFFIC: return this.getTraffic(request);
      case CITY_CONDITION_TYPES.BRIDGE: return this.getBridge(request.bridgeId);
      case CITY_CONDITION_TYPES.SERVICE_COVERAGE: return this.getServiceCoverage(request.service, request);
      case CITY_CONDITION_TYPES.SAFETY: return this.getSafety(request);
      case CITY_CONDITION_TYPES.REPAIR: return this.getRepair(request.targetId);
      case CITY_CONDITION_TYPES.LAND_VALUE: return this.getLandValue(request);
      case CITY_CONDITION_TYPES.WEATHER: return this.getWeather();
      case CITY_CONDITION_TYPES.DISTRICT: return this.getDistrict(request.districtId);
      case CITY_CONDITION_TYPES.AUTHORED_FLAG: return this.getAuthoredFlag(request.flagId);
      default: throw new RangeError(`Unsupported city condition type: ${type}`);
    }
  }

  registerResolver(type, resolver) {
    const normalizedType = assertId(type, 'condition type').toUpperCase();
    if (CONDITION_TYPE_NAMES.has(normalizedType) || this.#customResolvers.has(normalizedType)) {
      throw new Error(`Condition resolver already registered: ${normalizedType}`);
    }
    if (typeof resolver !== 'function') throw new TypeError('condition resolver must be a function');
    this.#customResolvers.set(normalizedType, resolver);
    return () => this.#customResolvers.delete(normalizedType);
  }

  evaluate(requirement) {
    assertRecord(requirement, 'condition requirement');
    const result = this.query(requirement.query ?? requirement);
    const operator = assertId(requirement.operator ?? CONDITION_OPERATORS.TRUTHY, 'condition requirement.operator').toUpperCase();
    const actual = getPath(result.value, requirement.path);
    return deepFreeze({
      passed: compare(actual, operator, requirement.expected),
      operator,
      expected: clone(requirement.expected),
      actual: clone(actual),
      condition: result
    });
  }

  evaluateAll(requirements, { mode = 'ALL' } = {}) {
    if (!Array.isArray(requirements)) throw new TypeError('condition requirements must be an array');
    const normalizedMode = assertId(mode, 'condition evaluation mode').toUpperCase();
    if (!['ALL', 'ANY'].includes(normalizedMode)) throw new RangeError('condition evaluation mode must be ALL or ANY');
    const results = requirements.map(requirement => this.evaluate(requirement));
    return deepFreeze({
      passed: normalizedMode === 'ALL' ? results.every(result => result.passed) : results.some(result => result.passed),
      mode: normalizedMode,
      results
    });
  }

  getTraffic({ scopeId = 'CITY', districtId = null } = {}) {
    const metrics = clone(resolveProvider(this.#trafficProvider, 'getCongestionMetrics') || {
      index: 0,
      activeVehicles: 0,
      stoppedVehicles: 0,
      crashedVehicles: 0,
      bridge: { index: 0, vehicles: 0, stoppedVehicles: 0 },
      hotspots: []
    });
    const outcome = this.#outcomes();
    const policies = Object.entries(outcome.traffic || {})
      .filter(([id, policy]) => id === scopeId || id === 'CITY' || (districtId && policy.districtId === districtId))
      .map(([id, policy]) => ({ id, ...policy }));
    const densityMultiplier = policies.reduce((value, policy) => value * policy.densityMultiplier, 1);
    const access = policies.some(policy => policy.access === 'CLOSED')
      ? 'CLOSED'
      : policies.some(policy => policy.access === 'RESTRICTED') ? 'RESTRICTED' : 'OPEN';
    const enforcement = policies.reduce((value, policy) => Math.max(value, policy.enforcement), 0);
    const hazardLevel = policies.reduce((value, policy) => Math.max(value, policy.hazardLevel), 0);
    const baseIndex = scopeId.toLowerCase().includes('bridge') ? metrics.bridge?.index ?? metrics.index : metrics.index;
    // TrafficProductivityModel already consumes authored traffic outcomes.
    // Legacy/live providers still receive the compatibility composition here.
    const effectiveIndex = metrics.includesAuthoredPolicies
      ? clamp(baseIndex, 0, 1)
      : clamp(baseIndex * densityMultiplier + hazardLevel * 0.15, 0, 1);
    return condition(CITY_CONDITION_TYPES.TRAFFIC, scopeId, {
      congestion: effectiveIndex,
      baseCongestion: baseIndex,
      densityMultiplier,
      access,
      enforcement,
      hazardLevel
    }, { ...metrics, policies }, this.#sources(policies), this.#revision(metrics.revision));
  }

  getBridge(bridgeId) {
    const id = assertId(bridgeId, 'bridgeId');
    const base = clone(resolveProvider(this.#bridgeProvider, 'getBridgeState', id) || {
      state: 'OPEN', access: 'OPEN', condition: 1, safety: 1
    });
    const outcomes = this.#outcomes();
    const authored = outcomes.infrastructure?.[id] ?? null;
    const repair = outcomes.repairs?.[id] ?? null;
    const traffic = this.getTraffic({ scopeId: id });
    const value = {
      state: authored?.state ?? base.state ?? 'OPEN',
      access: authored?.access ?? base.access ?? 'OPEN',
      condition: authored?.condition ?? base.condition ?? 1,
      safety: authored?.safety ?? base.safety ?? 1,
      repairStatus: repair?.status ?? 'NOT_STARTED',
      repairProgress: repair?.progress ?? 0,
      congestion: traffic.value.congestion
    };
    return condition(CITY_CONDITION_TYPES.BRIDGE, id, value, {
      base, authored, repair, traffic: traffic.value
    }, this.#sources([authored, repair]), this.#revision());
  }

  getServiceCoverage(service, request = {}) {
    const { districtId = null } = request;
    const normalizedService = assertId(service, 'service').toLowerCase();
    if (!SERVICE_NAMES.has(normalizedService)) throw new RangeError('service must be power, water, or fire');
    if (districtId) this.#knownDistrict(districtId);
    if (this.#serviceModel) {
      const local = this.#serviceModel.getCoverage(normalizedService, {
        districtId,
        position: request.position,
        x: request.x,
        z: request.z
      });
      return condition(CITY_CONDITION_TYPES.SERVICE_COVERAGE, districtId ? `${districtId}:${normalizedService}` : normalizedService, {
        service: normalizedService,
        districtId: local.districtId,
        position: local.position,
        coverage: local.coverage,
        coveragePercent: local.coveragePercent,
        adequate: local.adequate,
        health: local.health,
        outageActive: local.outageActive,
        explanation: local.explanation
      }, local.facts, this.#sources(local.facts.outages), this.#revision());
    }
    const economy = this.#economySystem.snapshot();
    const base = economy.services[normalizedService];
    const outages = Object.entries(this.#outcomes().serviceOutages || {})
      .filter(([, outage]) => outage.active && outage.service === normalizedService && (!outage.districtId || outage.districtId === districtId))
      .map(([id, outage]) => ({ id, ...outage }));
    const coverageMultiplier = outages.reduce((value, outage) => value * outage.coverageMultiplier, 1);
    const coverage = clamp(base.coverage * coverageMultiplier, 0, 1);
    return condition(CITY_CONDITION_TYPES.SERVICE_COVERAGE, districtId ? `${districtId}:${normalizedService}` : normalizedService, {
      service: normalizedService,
      districtId,
      coverage,
      coveragePercent: coverage * 100,
      adequate: coverage >= 1 && base.adequate,
      outageActive: outages.length > 0
    }, { base, coverageMultiplier, outages }, this.#sources(outages), this.#revision(economy.revision));
  }

  getSafety({ districtId = null } = {}) {
    if (districtId) this.#knownDistrict(districtId);
    const fire = this.getServiceCoverage(SERVICE_TYPES.FIRE, { districtId });
    const incidents = Object.entries(this.#outcomes().incidents || {})
      .filter(([, incident]) => incident.active && (!incident.districtId || incident.districtId === districtId))
      .map(([id, incident]) => ({ id, ...incident }));
    const trafficPolicies = Object.values(this.#outcomes().traffic || {})
      .filter(policy => !policy.districtId || policy.districtId === districtId);
    const incidentPenalty = incidents.reduce((total, incident) => total + incident.severity * 4, 0);
    const trafficPenalty = trafficPolicies.reduce((value, policy) => Math.max(value, policy.hazardLevel * 25), 0);
    const score = clamp(fire.value.coveragePercent - incidentPenalty - trafficPenalty, 0, 100);
    return condition(CITY_CONDITION_TYPES.SAFETY, districtId || 'CITY', {
      score,
      rating: score >= 80 ? 'SAFE' : score >= 55 ? 'STRAINED' : 'DANGEROUS',
      activeIncidentCount: incidents.length
    }, { fireCoverage: fire.value.coverage, incidentPenalty, trafficPenalty, incidents }, this.#sources(incidents), this.#revision());
  }

  getRepair(targetId) {
    const id = assertId(targetId, 'targetId');
    const repair = this.#outcomes().repairs?.[id] ?? null;
    const value = repair
      ? { status: repair.status, progress: repair.progress, estimatedCost: repair.estimatedCost }
      : { status: 'NOT_STARTED', progress: 0, estimatedCost: 0 };
    return condition(CITY_CONDITION_TYPES.REPAIR, id, value, { repair }, this.#sources([repair]), this.#revision());
  }

  getLandValue({ x = null, z = null, districtId = null } = {}) {
    if ((x == null) !== (z == null)) throw new TypeError('land-value queries require both x and z');
    let resolvedDistrict = districtId;
    let breakdown;
    if (x != null) {
      assertFiniteNumber(x, 'x');
      assertFiniteNumber(z, 'z');
      const definition = districtForPosition(this.#districtDefinitions, x, z);
      resolvedDistrict = resolvedDistrict ?? definition?.id ?? null;
      breakdown = this.#economySystem.getLandValueBreakdownAt(x, z);
    } else {
      if (resolvedDistrict) this.#knownDistrict(resolvedDistrict);
      const economy = this.#economySystem.snapshot();
      breakdown = { landValue: economy.cityPulse.landValue, baseLandValue: economy.cityPulse.landValue };
    }
    const incidents = Object.values(this.#outcomes().incidents || {})
      .filter(incident => incident.active && (!incident.districtId || incident.districtId === resolvedDistrict));
    const authoredModifier = incidents.reduce((total, incident) => total + incident.landValueModifier, 0);
    const landValue = Math.max(0, breakdown.landValue + authoredModifier);
    return condition(CITY_CONDITION_TYPES.LAND_VALUE, resolvedDistrict || (x == null ? 'CITY' : `${x},${z}`), {
      landValue,
      districtId: resolvedDistrict,
      x,
      z
    }, { economy: breakdown, authoredModifier }, this.#sources(incidents), this.#revision());
  }

  getWeather() {
    const supplied = clone(resolveProvider(this.#weatherProvider, 'getWeatherState'));
    const mode = typeof supplied === 'string'
      ? supplied.toLowerCase()
      : String(supplied?.mode ?? supplied?.weatherMode ?? 'clear').toLowerCase();
    const profile = WEATHER_PROFILES[mode] ?? WEATHER_PROFILES.clear;
    const value = { mode, ...profile, ...(typeof supplied === 'object' && supplied ? supplied : {}) };
    return condition(CITY_CONDITION_TYPES.WEATHER, 'CURRENT', value, { profile }, [], this.#revision(supplied?.revision));
  }

  getDistrict(districtId) {
    const id = this.#knownDistrict(districtId);
    const definition = this.#districtsById.get(id);
    const economy = this.#economySystem.snapshot();
    const economyDistrict = economy.districts?.[id] ?? null;
    const unlockedOverride = ownValue(this.#outcomes().unlocks, id, null);
    const unlocked = unlockedOverride ?? economyDistrict?.unlocked ?? definition.releaseScope === 'MVP';
    const incidents = Object.values(this.#outcomes().incidents || {})
      .filter(incident => incident.active && incident.districtId === id);
    return condition(CITY_CONDITION_TYPES.DISTRICT, id, {
      id,
      label: definition.label,
      releaseScope: definition.releaseScope,
      unlocked,
      state: incidents.length > 0 ? 'DISRUPTED' : 'STABLE',
      activeIncidentCount: incidents.length
    }, { definition: clone(definition), economy: economyDistrict, incidents }, this.#sources(incidents), this.#revision(economy.revision));
  }

  getAuthoredFlag(flagId) {
    const id = assertId(flagId, 'flagId');
    const flag = this.#outcomes().flags?.[id] ?? null;
    return condition(CITY_CONDITION_TYPES.AUTHORED_FLAG, id, flag?.value ?? null, {
      set: flag !== null,
      flag
    }, this.#sources([flag]), this.#revision());
  }

  #outcomes() {
    return this.#outcomeService?.snapshot?.() ?? {
      revision: 0,
      infrastructure: {}, incidents: {}, repairs: {}, serviceOutages: {},
      traffic: {}, unlocks: {}, flags: {}
    };
  }

  #sources(records) {
    const values = Array.isArray(records) ? records : [];
    const ids = values.map(record => record?.transactionId).filter(Boolean);
    return [...new Set(ids)].map(transactionId => ({
      transactionId,
      summary: this.#outcomeService?.getReceipt?.(transactionId)?.summary ?? null
    }));
  }

  #revision(...revisions) {
    return Math.max(0, this.#outcomeService?.snapshot?.().revision ?? 0, ...revisions.filter(Number.isFinite));
  }

  #knownDistrict(districtId) {
    const id = assertId(districtId, 'districtId');
    if (!this.#districtsById.has(id)) throw new RangeError(`Unknown district: ${id}`);
    return id;
  }

  #context() {
    return deepFreeze({
      economy: this.#economySystem.snapshot(),
      outcomes: this.#outcomes(),
      districts: clone(this.#districtDefinitions)
    });
  }
}
