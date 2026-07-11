/**
 * Authoritative, renderer-agnostic economy and City Pulse model.
 *
 * All time-based behavior is driven by update(deltaSeconds); the system never
 * reads wall-clock time, the DOM, or global game state. This makes simulations,
 * replays, and tests deterministic for the same ordered inputs.
 */

export const SERVICE_TYPES = Object.freeze({
  POWER: 'power',
  WATER: 'water',
  FIRE: 'fire'
});

export const DISTRICT_IDS = Object.freeze({
  EAST_CYBER_METROPOLIS: 'EAST_CYBER_METROPOLIS',
  EAST_CYBER: 'EAST_CYBER'
});

export const DEFAULT_EAST_DISTRICT_UNLOCK_COST = 1_000_000;

export const ECONOMY_EVENTS = Object.freeze({
  TREASURY_CHANGED: 'TREASURY_CHANGED',
  PASSIVE_INCOME_CHANGED: 'PASSIVE_INCOME_CHANGED',
  PASSIVE_INCOME_EARNED: 'PASSIVE_INCOME_EARNED',
  BUILDING_REGISTERED: 'BUILDING_REGISTERED',
  BUILDING_REMOVED: 'BUILDING_REMOVED',
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  NARRATIVE_ADVANCED: 'NARRATIVE_ADVANCED',
  INCIDENT_RECORDED: 'INCIDENT_RECORDED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  REPUTATION_CHANGED: 'REPUTATION_CHANGED',
  SERVICE_CHANGED: 'SERVICE_CHANGED',
  CITY_PULSE_CHANGED: 'CITY_PULSE_CHANGED',
  DISTRICT_UNLOCKED: 'DISTRICT_UNLOCKED',
  STATE_RESTORED: 'STATE_RESTORED',
  SNAPSHOT: 'SNAPSHOT'
});

const SERVICE_NAMES = Object.freeze(Object.values(SERVICE_TYPES));

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function assertNonNegative(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be greater than or equal to zero`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  assertNonNegative(value, label);
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer`);
  }
  return value;
}

function assertPercentage(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 100) {
    throw new RangeError(`${label} must be between 0 and 100`);
  }
  return value;
}

function assertId(value, label = 'id') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertServiceName(service) {
  if (!SERVICE_NAMES.includes(service)) {
    throw new RangeError(
      `service must be one of ${SERVICE_NAMES.join(', ')}; received ${String(service)}`
    );
  }
  return service;
}

function normalizeDistrictId(id) {
  const normalizedId = assertId(id, 'district id');
  return normalizedId === DISTRICT_IDS.EAST_CYBER
    ? DISTRICT_IDS.EAST_CYBER_METROPOLIS
    : normalizedId;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function normalizeServiceBase(services = {}) {
  assertRecord(services, 'services');
  const normalized = {};

  for (const service of SERVICE_NAMES) {
    const state = services[service] ?? {};
    assertRecord(state, `services.${service}`);
    normalized[service] = {
      capacity: assertNonNegative(
        state.capacity ?? 0,
        `services.${service}.capacity`
      ),
      demand: assertNonNegative(
        state.demand ?? 0,
        `services.${service}.demand`
      )
    };
  }

  return normalized;
}

function normalizePosition(position, x, z, label) {
  const hasFlatCoordinate = x !== undefined || z !== undefined;
  const source = position ?? (hasFlatCoordinate ? { x, z } : null);
  if (source === null) return null;

  assertRecord(source, label);
  return deepFreeze({
    x: assertFiniteNumber(source.x, `${label}.x`),
    z: assertFiniteNumber(source.z, `${label}.z`)
  });
}

function proximityWeight(position, radius, x, z) {
  if (!position || radius <= 0) return null;
  const distance = Math.hypot(position.x - x, position.z - z);
  if (distance >= radius) return 0;
  return 1 - distance / radius;
}

function normalizeBuilding(building) {
  assertRecord(building, 'building');
  const id = assertId(building.id, 'building.id');
  const status = building.status ?? 'ACTIVE';
  if (typeof status !== 'string' || status.trim() === '') {
    throw new TypeError('building.status must be a non-empty string');
  }

  const operational = building.operational ?? true;
  assertBoolean(operational, 'building.operational');

  const position = normalizePosition(
    building.position,
    building.x,
    building.z,
    'building.position'
  );
  const amenityRadius = assertNonNegative(
    building.amenityRadius ?? 0,
    'building.amenityRadius'
  );
  if (amenityRadius > 0 && !position) {
    throw new TypeError('building.position is required when amenityRadius is greater than zero');
  }

  const nestedServices = building.services ?? {};
  const serviceCapacity = building.serviceCapacity ?? {};
  const serviceDemand = building.serviceDemand ?? {};
  assertRecord(nestedServices, 'building.services');
  assertRecord(serviceCapacity, 'building.serviceCapacity');
  assertRecord(serviceDemand, 'building.serviceDemand');

  const services = {};
  for (const service of SERVICE_NAMES) {
    const nestedState = nestedServices[service] ?? {};
    assertRecord(nestedState, `building.services.${service}`);
    services[service] = {
      capacity: assertNonNegative(
        nestedState.capacity ?? serviceCapacity[service] ?? 0,
        `building.services.${service}.capacity`
      ),
      demand: assertNonNegative(
        nestedState.demand ?? serviceDemand[service] ?? 0,
        `building.services.${service}.demand`
      )
    };
  }

  const name = building.name ?? id;
  const kind = building.kind ?? building.type ?? null;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('building.name must be a non-empty string');
  }
  if (kind !== null && (typeof kind !== 'string' || kind.trim() === '')) {
    throw new TypeError('building.kind must be null or a non-empty string');
  }

  return deepFreeze({
    id,
    name: name.trim(),
    kind: kind === null ? null : kind.trim(),
    value: assertNonNegative(building.value ?? 0, 'building.value'),
    employees: assertNonNegativeInteger(
      building.employees ?? 0,
      'building.employees'
    ),
    population: assertNonNegativeInteger(
      building.population ?? building.residents ?? 0,
      'building.population'
    ),
    status: status.trim(),
    operational,
    passiveIncomeRate: assertNonNegative(
      building.passiveIncomeRate ?? 0,
      'building.passiveIncomeRate'
    ),
    happinessModifier: assertFiniteNumber(
      building.happinessModifier ?? 0,
      'building.happinessModifier'
    ),
    landValueModifier: assertFiniteNumber(
      building.landValueModifier ?? 0,
      'building.landValueModifier'
    ),
    position,
    amenityRadius,
    services
  });
}

function normalizeIncident(incident, nextRevision) {
  assertRecord(incident, 'incident');
  const id = assertId(incident.id, 'incident.id');
  const type = incident.type ?? 'GENERAL';
  if (typeof type !== 'string' || type.trim() === '') {
    throw new TypeError('incident.type must be a non-empty string');
  }

  const active = incident.active ?? true;
  assertBoolean(active, 'incident.active');

  const position = normalizePosition(
    incident.position,
    incident.x,
    incident.z,
    'incident.position'
  );
  const influenceRadius = assertNonNegative(
    incident.influenceRadius ?? incident.radius ?? 0,
    'incident.influenceRadius'
  );
  if (influenceRadius > 0 && !position) {
    throw new TypeError('incident.position is required when influenceRadius is greater than zero');
  }

  return deepFreeze({
    id,
    type: type.trim(),
    severity: assertNonNegative(incident.severity ?? 1, 'incident.severity'),
    active,
    reputationDelta: assertFiniteNumber(
      incident.reputationDelta ?? 0,
      'incident.reputationDelta'
    ),
    happinessModifier: assertFiniteNumber(
      incident.happinessModifier ?? 0,
      'incident.happinessModifier'
    ),
    landValueModifier: assertFiniteNumber(
      incident.landValueModifier ?? 0,
      'incident.landValueModifier'
    ),
    position,
    influenceRadius,
    recordedAtRevision: nextRevision,
    resolvedAtRevision: active ? null : nextRevision
  });
}

/**
 * A deterministic treasury, economy, and City Pulse store.
 */
export class EconomySystem {
  #treasury;
  #basePassiveIncomeRate;
  #basePopulation;
  #baseHappiness;
  #baseLandValue;
  #reputation;
  #narrativeProgress;
  #baseServices;
  #buildings = new Map();
  #completedMissions = new Map();
  #incidents = new Map();
  #districts = new Map();
  #listeners = new Set();
  #revision = 0;

  constructor({
    initialTreasury = 0,
    passiveIncomeRate = 0,
    population = 0,
    happiness = 50,
    landValue = 100,
    reputation = 0,
    narrativeProgress = 0,
    services = {},
    eastDistrictUnlockCost = DEFAULT_EAST_DISTRICT_UNLOCK_COST,
    eastDistrictUnlocked = false
  } = {}) {
    this.#treasury = assertNonNegative(initialTreasury, 'initialTreasury');
    this.#basePassiveIncomeRate = assertNonNegative(
      passiveIncomeRate,
      'passiveIncomeRate'
    );
    this.#basePopulation = assertNonNegativeInteger(population, 'population');
    this.#baseHappiness = assertPercentage(happiness, 'happiness');
    this.#baseLandValue = assertNonNegative(landValue, 'landValue');
    this.#reputation = assertFiniteNumber(reputation, 'reputation');
    this.#narrativeProgress = assertNonNegativeInteger(
      narrativeProgress,
      'narrativeProgress'
    );
    this.#baseServices = normalizeServiceBase(services);

    assertBoolean(eastDistrictUnlocked, 'eastDistrictUnlocked');
    this.#districts.set(DISTRICT_IDS.EAST_CYBER_METROPOLIS, deepFreeze({
      id: DISTRICT_IDS.EAST_CYBER_METROPOLIS,
      name: 'East Cyber-Metropolis',
      unlockCost: assertNonNegative(
        eastDistrictUnlockCost,
        'eastDistrictUnlockCost'
      ),
      unlocked: eastDistrictUnlocked
    }));
  }

  get treasury() {
    return this.#treasury;
  }

  get balance() {
    return this.#treasury;
  }

  get reputation() {
    return this.#reputation;
  }

  get narrativeProgress() {
    return this.#narrativeProgress;
  }

  get revision() {
    return this.#revision;
  }

  getServiceState() {
    const totals = {};
    for (const service of SERVICE_NAMES) {
      totals[service] = { ...this.#baseServices[service] };
    }

    for (const building of this.#buildings.values()) {
      if (!building.operational) continue;
      for (const service of SERVICE_NAMES) {
        totals[service].capacity += building.services[service].capacity;
        totals[service].demand += building.services[service].demand;
      }
    }

    const services = {};
    for (const service of SERVICE_NAMES) {
      const { capacity, demand } = totals[service];
      const coverage = demand === 0 ? 1 : Math.min(1, capacity / demand);
      services[service] = {
        capacity,
        demand,
        surplus: capacity - demand,
        coverage,
        adequate: capacity >= demand
      };
    }
    return services;
  }

  /**
   * Returns a deterministic, renderer-independent land-value reading for a
   * world-space parcel. Amenity buildings and active incidents use linear
   * distance falloff inside their configured radii; modifiers without spatial
   * data retain their existing city-wide behavior.
   */
  getLandValueBreakdownAt(x, z) {
    assertFiniteNumber(x, 'x');
    assertFiniteNumber(z, 'z');

    let globalModifier = 0;
    let amenityModifier = 0;
    let mayhemModifier = 0;

    for (const building of this.#buildings.values()) {
      if (!building.operational) continue;
      const weight = proximityWeight(
        building.position,
        building.amenityRadius,
        x,
        z
      );
      if (weight === null) globalModifier += building.landValueModifier;
      else amenityModifier += building.landValueModifier * weight;
    }

    for (const incident of this.#incidents.values()) {
      if (!incident.active) continue;
      const weight = proximityWeight(
        incident.position,
        incident.influenceRadius,
        x,
        z
      );
      if (weight === null) globalModifier += incident.landValueModifier;
      else mayhemModifier += incident.landValueModifier * weight;
    }

    const services = this.getServiceState();
    const serviceHealth = (
      services.power.coverage
      + services.water.coverage
      + services.fire.coverage
    ) / 3;
    const serviceMultiplier = 0.75 + serviceHealth * 0.25;
    const unscaledValue = this.#baseLandValue
      + globalModifier
      + amenityModifier
      + mayhemModifier;

    return deepFreeze({
      x,
      z,
      baseLandValue: this.#baseLandValue,
      globalModifier,
      amenityModifier,
      mayhemModifier,
      serviceMultiplier,
      landValue: Math.max(0, unscaledValue * serviceMultiplier)
    });
  }

  getLandValueAt(x, z) {
    return this.getLandValueBreakdownAt(x, z).landValue;
  }

  get passiveIncomeRate() {
    let grossRate = this.#basePassiveIncomeRate;
    for (const building of this.#buildings.values()) {
      if (building.operational) grossRate += building.passiveIncomeRate;
    }
    const services = this.getServiceState();
    const criticalCoverage = Math.min(
      services.power.coverage,
      services.water.coverage
    );
    return grossRate * (0.4 + criticalCoverage * 0.6);
  }

  canAfford(amount) {
    assertNonNegative(amount, 'amount');
    return this.#treasury >= amount;
  }

  earn(amount, { source = 'manual', referenceId = null } = {}) {
    assertNonNegative(amount, 'amount');
    if (amount === 0) return this.#treasury;

    const nextTreasury = this.#treasury + amount;
    assertFiniteNumber(nextTreasury, 'resulting treasury');

    return this.#commit(
      ECONOMY_EVENTS.TREASURY_CHANGED,
      { amount, source, referenceId, direction: 'credit' },
      () => {
        this.#treasury = nextTreasury;
        return this.#treasury;
      }
    );
  }

  /**
   * Attempts a debit. Insufficient funds are an expected game outcome, so the
   * method returns false without mutating state instead of throwing.
   */
  spend(amount, { source = 'manual', referenceId = null } = {}) {
    assertNonNegative(amount, 'amount');
    if (amount === 0) return true;
    if (!this.canAfford(amount)) return false;

    this.#commit(
      ECONOMY_EVENTS.TREASURY_CHANGED,
      { amount, source, referenceId, direction: 'debit' },
      () => {
        this.#treasury -= amount;
      }
    );
    return true;
  }

  setPassiveIncomeRate(rate) {
    assertNonNegative(rate, 'rate');
    if (rate === this.#basePassiveIncomeRate) return this.snapshot();

    this.#commit(
      ECONOMY_EVENTS.PASSIVE_INCOME_CHANGED,
      { previousRate: this.#basePassiveIncomeRate, rate },
      () => {
        this.#basePassiveIncomeRate = rate;
      }
    );
    return this.snapshot();
  }

  /**
   * Advances passive income by an explicit number of seconds.
   * Returns the amount earned during this step.
   */
  update(deltaSeconds) {
    assertNonNegative(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds === 0) return 0;

    const amount = this.passiveIncomeRate * deltaSeconds;
    assertFiniteNumber(amount, 'passive income amount');
    if (amount === 0) return 0;

    const nextTreasury = this.#treasury + amount;
    assertFiniteNumber(nextTreasury, 'resulting treasury');

    this.#commit(
      ECONOMY_EVENTS.PASSIVE_INCOME_EARNED,
      { amount, deltaSeconds, rate: this.passiveIncomeRate },
      () => {
        this.#treasury = nextTreasury;
      }
    );
    return amount;
  }

  registerBuilding(building) {
    const normalized = normalizeBuilding(building);
    if (this.#buildings.has(normalized.id)) {
      throw new Error(`Building already registered: ${normalized.id}`);
    }

    return this.#commit(
      ECONOMY_EVENTS.BUILDING_REGISTERED,
      { buildingId: normalized.id },
      () => {
        this.#buildings.set(normalized.id, normalized);
        return normalized;
      }
    );
  }

  removeBuilding(id) {
    const normalizedId = assertId(id, 'building id');
    const building = this.#buildings.get(normalizedId);
    if (!building) return null;

    return this.#commit(
      ECONOMY_EVENTS.BUILDING_REMOVED,
      { buildingId: normalizedId },
      () => {
        this.#buildings.delete(normalizedId);
        return building;
      }
    );
  }

  getBuilding(id) {
    const normalizedId = assertId(id, 'building id');
    return this.#buildings.get(normalizedId) ?? null;
  }

  hasCompletedMission(id) {
    return this.#completedMissions.has(assertId(id, 'mission id'));
  }

  /**
   * Completes a mission atomically. Duplicate IDs return false and can never
   * issue a reward or narrative progress twice.
   */
  completeMission({
    id,
    reward = 0,
    narrativeProgressDelta = 1,
    reputationDelta = 0,
    satisfaction = null
  }) {
    const normalizedId = assertId(id, 'mission.id');
    assertNonNegative(reward, 'mission.reward');
    assertNonNegativeInteger(
      narrativeProgressDelta,
      'mission.narrativeProgressDelta'
    );
    assertFiniteNumber(reputationDelta, 'mission.reputationDelta');
    if (satisfaction !== null) {
      assertPercentage(satisfaction, 'mission.satisfaction');
    }

    if (this.#completedMissions.has(normalizedId)) return false;

    const nextTreasury = this.#treasury + reward;
    assertFiniteNumber(nextTreasury, 'resulting treasury');

    this.#commit(
      ECONOMY_EVENTS.MISSION_COMPLETED,
      {
        missionId: normalizedId,
        reward,
        narrativeProgressDelta,
        reputationDelta,
        satisfaction
      },
      () => {
        this.#treasury = nextTreasury;
        this.#narrativeProgress += narrativeProgressDelta;
        this.#reputation += reputationDelta;
        this.#completedMissions.set(normalizedId, deepFreeze({
          id: normalizedId,
          reward,
          narrativeProgressDelta,
          reputationDelta,
          satisfaction,
          completedAtRevision: this.#revision + 1
        }));
      }
    );
    return true;
  }

  /**
   * Adapter for the existing MissionSystem call shape. Mission completion still
   * flows through completeMission, retaining duplicate-reward protection.
   */
  recordMissionCompletion(mission, payout, { satisfaction = null } = {}) {
    assertRecord(mission, 'mission');
    return this.completeMission({
      id: mission.id,
      reward: payout,
      narrativeProgressDelta: mission.narrativeProgressDelta ?? 1,
      reputationDelta: mission.reputationDelta ?? 0,
      satisfaction
    });
  }

  advanceNarrative(amount = 1, { referenceId = null } = {}) {
    assertNonNegativeInteger(amount, 'amount');
    if (amount === 0) return this.#narrativeProgress;

    return this.#commit(
      ECONOMY_EVENTS.NARRATIVE_ADVANCED,
      { amount, referenceId },
      () => {
        this.#narrativeProgress += amount;
        return this.#narrativeProgress;
      }
    );
  }

  adjustReputation(delta, { source = 'manual', referenceId = null } = {}) {
    assertFiniteNumber(delta, 'delta');
    if (delta === 0) return this.#reputation;

    const nextReputation = this.#reputation + delta;
    assertFiniteNumber(nextReputation, 'resulting reputation');

    return this.#commit(
      ECONOMY_EVENTS.REPUTATION_CHANGED,
      { delta, source, referenceId },
      () => {
        this.#reputation = nextReputation;
        return this.#reputation;
      }
    );
  }

  recordIncident(incident) {
    const normalized = normalizeIncident(incident, this.#revision + 1);
    if (this.#incidents.has(normalized.id)) {
      throw new Error(`Incident already recorded: ${normalized.id}`);
    }

    const nextReputation = this.#reputation + normalized.reputationDelta;
    assertFiniteNumber(nextReputation, 'resulting reputation');

    return this.#commit(
      ECONOMY_EVENTS.INCIDENT_RECORDED,
      { incidentId: normalized.id },
      () => {
        this.#incidents.set(normalized.id, normalized);
        this.#reputation = nextReputation;
        return normalized;
      }
    );
  }

  resolveIncident(id) {
    const normalizedId = assertId(id, 'incident id');
    const incident = this.#incidents.get(normalizedId);
    if (!incident || !incident.active) return false;

    this.#commit(
      ECONOMY_EVENTS.INCIDENT_RESOLVED,
      { incidentId: normalizedId },
      () => {
        this.#incidents.set(normalizedId, deepFreeze({
          ...incident,
          active: false,
          resolvedAtRevision: this.#revision + 1
        }));
      }
    );
    return true;
  }

  setService(service, values) {
    assertServiceName(service);
    assertRecord(values, 'values');
    const previous = this.#baseServices[service];
    const capacity = values.capacity === undefined
      ? previous.capacity
      : assertNonNegative(values.capacity, 'values.capacity');
    const demand = values.demand === undefined
      ? previous.demand
      : assertNonNegative(values.demand, 'values.demand');

    if (capacity === previous.capacity && demand === previous.demand) {
      return this.snapshot();
    }

    this.#commit(
      ECONOMY_EVENTS.SERVICE_CHANGED,
      { service, capacity, demand },
      () => {
        this.#baseServices[service] = { capacity, demand };
      }
    );
    return this.snapshot();
  }

  adjustService(service, { capacityDelta = 0, demandDelta = 0 } = {}) {
    assertServiceName(service);
    assertFiniteNumber(capacityDelta, 'capacityDelta');
    assertFiniteNumber(demandDelta, 'demandDelta');
    const current = this.#baseServices[service];
    const capacity = current.capacity + capacityDelta;
    const demand = current.demand + demandDelta;
    assertNonNegative(capacity, 'resulting service capacity');
    assertNonNegative(demand, 'resulting service demand');
    return this.setService(service, { capacity, demand });
  }

  setPopulation(population) {
    assertNonNegativeInteger(population, 'population');
    if (population === this.#basePopulation) return this.snapshot();
    return this.#setCityPulseValue('population', population);
  }

  adjustPopulation(delta) {
    assertFiniteNumber(delta, 'delta');
    if (!Number.isInteger(delta)) {
      throw new RangeError('delta must be an integer');
    }
    return this.setPopulation(this.#basePopulation + delta);
  }

  setHappiness(happiness) {
    assertPercentage(happiness, 'happiness');
    if (happiness === this.#baseHappiness) return this.snapshot();
    return this.#setCityPulseValue('happiness', happiness);
  }

  adjustHappiness(delta) {
    assertFiniteNumber(delta, 'delta');
    return this.setHappiness(clamp(this.#baseHappiness + delta, 0, 100));
  }

  setLandValue(landValue) {
    assertNonNegative(landValue, 'landValue');
    if (landValue === this.#baseLandValue) return this.snapshot();
    return this.#setCityPulseValue('landValue', landValue);
  }

  adjustLandValue(delta) {
    assertFiniteNumber(delta, 'delta');
    const landValue = Math.max(0, this.#baseLandValue + delta);
    return this.setLandValue(landValue);
  }

  canUnlockDistrict(id) {
    const normalizedId = normalizeDistrictId(id);
    const district = this.#districts.get(normalizedId);
    if (!district) {
      throw new RangeError(`Unknown district: ${normalizedId}`);
    }
    return !district.unlocked && this.canAfford(district.unlockCost);
  }

  unlockDistrict(id) {
    const normalizedId = normalizeDistrictId(id);
    const district = this.#districts.get(normalizedId);
    if (!district) {
      throw new RangeError(`Unknown district: ${normalizedId}`);
    }
    if (district.unlocked || !this.canAfford(district.unlockCost)) return false;

    this.#commit(
      ECONOMY_EVENTS.DISTRICT_UNLOCKED,
      { districtId: normalizedId, cost: district.unlockCost },
      () => {
        this.#treasury -= district.unlockCost;
        this.#districts.set(normalizedId, deepFreeze({
          ...district,
          unlocked: true
        }));
      }
    );
    return true;
  }

  unlockEastDistrict() {
    return this.unlockDistrict(DISTRICT_IDS.EAST_CYBER_METROPOLIS);
  }

  isDistrictUnlocked(id) {
    const normalizedId = normalizeDistrictId(id);
    const district = this.#districts.get(normalizedId);
    if (!district) {
      throw new RangeError(`Unknown district: ${normalizedId}`);
    }
    return district.unlocked;
  }

  serialize() {
    return {
      version: 1,
      treasury: this.#treasury,
      basePassiveIncomeRate: this.#basePassiveIncomeRate,
      basePopulation: this.#basePopulation,
      baseHappiness: this.#baseHappiness,
      baseLandValue: this.#baseLandValue,
      reputation: this.#reputation,
      narrativeProgress: this.#narrativeProgress,
      baseServices: structuredClone(this.#baseServices),
      buildings: structuredClone([...this.#buildings.values()]),
      completedMissions: structuredClone([...this.#completedMissions.values()]),
      incidents: structuredClone([...this.#incidents.values()]),
      districts: structuredClone([...this.#districts.values()])
    };
  }

  restore(state) {
    assertRecord(state, 'economy state');
    if (state.version !== 1) throw new RangeError(`Unsupported economy state version: ${String(state.version)}`);

    const treasury = assertNonNegative(state.treasury, 'state.treasury');
    const basePassiveIncomeRate = assertNonNegative(state.basePassiveIncomeRate, 'state.basePassiveIncomeRate');
    const basePopulation = assertNonNegativeInteger(state.basePopulation, 'state.basePopulation');
    const baseHappiness = assertPercentage(state.baseHappiness, 'state.baseHappiness');
    const baseLandValue = assertNonNegative(state.baseLandValue, 'state.baseLandValue');
    const reputation = assertFiniteNumber(state.reputation, 'state.reputation');
    const narrativeProgress = assertNonNegativeInteger(state.narrativeProgress, 'state.narrativeProgress');
    const baseServices = normalizeServiceBase(state.baseServices || {});

    if (!Array.isArray(state.buildings) || !Array.isArray(state.completedMissions) || !Array.isArray(state.incidents)) {
      throw new TypeError('Saved economy collections must be arrays');
    }
    const buildings = new Map(state.buildings.map(building => {
      const normalized = normalizeBuilding(building);
      return [normalized.id, normalized];
    }));
    const incidents = new Map(state.incidents.map(incident => {
      const normalized = normalizeIncident(incident, this.#revision + 1);
      return [normalized.id, normalized];
    }));
    const completedMissions = new Map(state.completedMissions.map(mission => {
      assertRecord(mission, 'completed mission');
      const id = assertId(mission.id, 'completed mission id');
      return [id, deepFreeze({
        id,
        reward: assertNonNegative(mission.reward ?? 0, 'completed mission reward'),
        narrativeProgressDelta: assertNonNegativeInteger(mission.narrativeProgressDelta ?? 0, 'completed mission narrative progress'),
        reputationDelta: assertFiniteNumber(mission.reputationDelta ?? 0, 'completed mission reputation'),
        satisfaction: mission.satisfaction == null ? null : assertPercentage(mission.satisfaction, 'completed mission satisfaction'),
        completedAtRevision: assertNonNegativeInteger(mission.completedAtRevision ?? 0, 'completed mission revision')
      })];
    }));

    const districts = new Map();
    for (const district of state.districts || []) {
      assertRecord(district, 'district');
      const id = normalizeDistrictId(district.id);
      assertBoolean(district.unlocked, 'district.unlocked');
      districts.set(id, deepFreeze({
        id,
        name: typeof district.name === 'string' && district.name.trim() ? district.name.trim() : id,
        unlockCost: assertNonNegative(district.unlockCost, 'district.unlockCost'),
        unlocked: district.unlocked
      }));
    }
    if (!districts.has(DISTRICT_IDS.EAST_CYBER_METROPOLIS)) {
      throw new Error('Saved economy state is missing the East Cyber-Metropolis district');
    }

    this.#commit(ECONOMY_EVENTS.STATE_RESTORED, { version: state.version }, () => {
      this.#treasury = treasury;
      this.#basePassiveIncomeRate = basePassiveIncomeRate;
      this.#basePopulation = basePopulation;
      this.#baseHappiness = baseHappiness;
      this.#baseLandValue = baseLandValue;
      this.#reputation = reputation;
      this.#narrativeProgress = narrativeProgress;
      this.#baseServices = baseServices;
      this.#buildings = buildings;
      this.#completedMissions = completedMissions;
      this.#incidents = incidents;
      this.#districts = districts;
    });
    return this.snapshot();
  }

  snapshot() {
    const services = this.getServiceState();

    let population = this.#basePopulation;
    let happiness = this.#baseHappiness;
    let landValue = this.#baseLandValue;
    let employees = 0;
    let totalBuildingValue = 0;

    for (const building of this.#buildings.values()) {
      totalBuildingValue += building.value;
      if (!building.operational) continue;

      population += building.population;
      employees += building.employees;
      happiness += building.happinessModifier;
      landValue += building.landValueModifier;
    }

    for (const incident of this.#incidents.values()) {
      if (!incident.active) continue;
      happiness += incident.happinessModifier;
      landValue += incident.landValueModifier;
    }

    // Utility shortages have direct management consequences: power/water
    // reduce economic output above, while all three services affect citizen
    // happiness and property value here.
    const utilityCoverage = (services.power.coverage + services.water.coverage) / 2;
    const safetyCoverage = services.fire.coverage;
    const serviceHealth = (services.power.coverage + services.water.coverage + safetyCoverage) / 3;
    happiness -= (1 - utilityCoverage) * 18 + (1 - safetyCoverage) * 10;
    landValue *= 0.75 + serviceHealth * 0.25;

    const districts = {};
    const unlockedDistricts = [];
    for (const [id, district] of this.#districts) {
      districts[id] = { ...district };
      if (district.unlocked) {
        unlockedDistricts.push(id);
        if (id === DISTRICT_IDS.EAST_CYBER_METROPOLIS) {
          unlockedDistricts.push(DISTRICT_IDS.EAST_CYBER);
        }
      }
    }

    const pulse = {
      budget: this.#treasury,
      cash: this.#treasury,
      energy: services.power.coverage * 100,
      energySurplus: services.power.surplus,
      serviceHealth: serviceHealth * 100,
      population,
      happiness: clamp(happiness, 0, 100),
      landValue: Math.max(0, landValue),
      employees,
      totalBuildingValue
    };

    return deepFreeze({
      revision: this.#revision,
      treasury: this.#treasury,
      cash: this.#treasury,
      budget: this.#treasury,
      population: pulse.population,
      energy: pulse.energy,
      happiness: pulse.happiness,
      landValue: pulse.landValue,
      passiveIncomeRate: this.passiveIncomeRate,
      reputation: this.#reputation,
      narrativeProgress: this.#narrativeProgress,
      cityPulse: pulse,
      services,
      buildings: [...this.#buildings.values()].map(building => ({
        ...building,
        services: {
          power: { ...building.services.power },
          water: { ...building.services.water },
          fire: { ...building.services.fire }
        }
      })),
      completedMissions: [...this.#completedMissions.values()].map(mission => ({
        ...mission
      })),
      incidents: [...this.#incidents.values()].map(incident => ({ ...incident })),
      districts,
      unlockedDistricts
    });
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    assertBoolean(emitCurrent, 'emitCurrent');

    this.#listeners.add(listener);
    if (emitCurrent) {
      listener(deepFreeze({
        type: ECONOMY_EVENTS.SNAPSHOT,
        previous: null,
        current: this.snapshot(),
        detail: {}
      }));
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return false;
      subscribed = false;
      return this.#listeners.delete(listener);
    };
  }

  #setCityPulseValue(key, value) {
    this.#commit(
      ECONOMY_EVENTS.CITY_PULSE_CHANGED,
      { key, value },
      () => {
        if (key === 'population') this.#basePopulation = value;
        if (key === 'happiness') this.#baseHappiness = value;
        if (key === 'landValue') this.#baseLandValue = value;
      }
    );
    return this.snapshot();
  }

  #commit(type, detail, mutation) {
    const previous = this.snapshot();
    const result = mutation();
    this.#revision += 1;
    const current = this.snapshot();
    const event = deepFreeze({ type, previous, current, detail: { ...detail } });

    for (const listener of [...this.#listeners]) {
      listener(event);
    }
    return result;
  }
}

export default EconomySystem;
