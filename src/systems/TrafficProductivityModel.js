import { clamp, clone, deepFreeze } from '../missions/ContractUtils.js';
import { ECONOMY_BALANCE } from './EconomyBalance.js';

export const TRAFFIC_PRODUCTIVITY_VERSION = 1;

export const BRIDGE_POLICIES = Object.freeze({
  BALANCED: 'BALANCED',
  FREIGHT_PRIORITY: 'FREIGHT_PRIORITY'
});

export const TRAFFIC_ACCESS = Object.freeze({
  OPEN: 'OPEN',
  RESTRICTED: 'RESTRICTED',
  CLOSED: 'CLOSED'
});

const POLICY_PROFILES = Object.freeze({
  [BRIDGE_POLICIES.BALANCED]: Object.freeze({
    label: 'Balanced access',
    bridgeCapacityMultiplier: 1,
    freightReliabilityBonus: 0,
    commuterSatisfactionPenalty: 0,
    operatingCostRate: 0,
    tradeoff: 'Equal bridge access; no operating cost or freight advantage.'
  }),
  [BRIDGE_POLICIES.FREIGHT_PRIORITY]: Object.freeze({
    label: 'Freight priority',
    bridgeCapacityMultiplier: 1.28,
    freightReliabilityBonus: 0.1,
    commuterSatisfactionPenalty: 2,
    operatingCostRate: ECONOMY_BALANCE.policies.freightPriorityCostPerSecond,
    tradeoff: 'Faster, more reliable deliveries for $120/min and −2 satisfaction while active.'
  })
});

const FREIGHT_OBJECTIVES = new Set(['COURIER', 'DELIVERY']);
const PRIMARY_BRIDGE_ID = 'primary-bridge';
const PRIMARY_BRIDGE_DISTRICT = 'PRIMARY_BRIDGE_CORRIDOR';
const BRIDGE_MIN_X = 100;
const BRIDGE_MAX_X = 210;

function assertOwner(owner, method, label) {
  if (!owner?.[method]) throw new TypeError(`${label} must expose ${method}()`);
  return owner;
}

function stablePolicy(value) {
  const policy = String(value || '').toUpperCase();
  if (!Object.hasOwn(POLICY_PROFILES, policy)) {
    throw new RangeError(`Unsupported bridge policy: ${String(value)}`);
  }
  return policy;
}

function accessRank(access) {
  if (access === TRAFFIC_ACCESS.CLOSED) return 2;
  if (access === TRAFFIC_ACCESS.RESTRICTED) return 1;
  return 0;
}

function worstAccess(current, candidate) {
  const normalized = Object.values(TRAFFIC_ACCESS).includes(candidate)
    ? candidate
    : TRAFFIC_ACCESS.OPEN;
  return accessRank(normalized) > accessRank(current) ? normalized : current;
}

function isBridgeScope(id, record = {}) {
  return String(id).toLowerCase().includes('bridge')
    || record.districtId === PRIMARY_BRIDGE_DISTRICT;
}

function hasMaterialDifference(left, right) {
  if (!left || !right) return true;
  const omitVolatile = value => {
    const copy = clone(value);
    delete copy.revision;
    return copy;
  };
  return JSON.stringify(omitVolatile(left)) !== JSON.stringify(omitVolatile(right));
}

function missionCrossesPrimaryBridge(mission) {
  const pickupX = mission?.pickup?.x;
  const dropoffX = mission?.dropoff?.x;
  if (!Number.isFinite(pickupX) || !Number.isFinite(dropoffX)) return false;
  return (pickupX < BRIDGE_MIN_X && dropoffX > BRIDGE_MAX_X)
    || (dropoffX < BRIDGE_MIN_X && pickupX > BRIDGE_MAX_X);
}

/**
 * Authoritative, renderer-independent aggregate road-mobility model.
 *
 * The model consumes city demand, authored outcomes, road edits, and one
 * explicit management policy. Its immutable snapshot is the sole source for
 * economy productivity, mission traffic modifiers, alerts, and ambient-agent
 * presentation targets. Visible vehicles never feed back into these values.
 */
export class TrafficProductivityModel {
  #economySystem;
  #outcomeService;
  #roadProvider;
  #listeners = new Set();
  #policy = BRIDGE_POLICIES.BALANCED;
  #revision = 0;
  #snapshot = null;
  #presentationVehicleCap;

  constructor({
    economySystem,
    outcomeService = null,
    roadProvider = null,
    presentationVehicleCap = 48
  } = {}) {
    this.#economySystem = assertOwner(economySystem, 'snapshot', 'economySystem');
    if (outcomeService !== null) assertOwner(outcomeService, 'snapshot', 'outcomeService');
    if (roadProvider !== null && typeof roadProvider !== 'function' && !roadProvider?.getRoadNetworkSnapshot) {
      throw new TypeError('roadProvider must be a function, expose getRoadNetworkSnapshot(), or be null');
    }
    this.#outcomeService = outcomeService;
    this.#roadProvider = roadProvider;
    this.#presentationVehicleCap = Math.max(0, Math.trunc(presentationVehicleCap));
    this.update(0, { force: true });
  }

  get bridgePolicy() {
    return this.#policy;
  }

  getPolicyOptions() {
    return deepFreeze(Object.entries(POLICY_PROFILES).map(([id, profile]) => ({
      id,
      ...profile,
      active: id === this.#policy
    })));
  }

  setBridgePolicy(policy) {
    const normalized = stablePolicy(policy);
    if (normalized === this.#policy) return this.snapshot();
    this.#policy = normalized;
    return this.update(0, { force: true, reason: 'BRIDGE_POLICY_CHANGED' });
  }

  toggleBridgePriority(forceEnabled = null) {
    const enabled = forceEnabled == null
      ? this.#policy !== BRIDGE_POLICIES.FREIGHT_PRIORITY
      : Boolean(forceEnabled);
    this.setBridgePolicy(enabled ? BRIDGE_POLICIES.FREIGHT_PRIORITY : BRIDGE_POLICIES.BALANCED);
    return enabled;
  }

  update(_deltaSeconds = 0, { force = false, reason = 'INPUTS_CHANGED' } = {}) {
    const previous = this.#snapshot;
    const next = this.#calculate();
    if (!force && !hasMaterialDifference(previous, next)) return previous;

    this.#revision += 1;
    this.#snapshot = deepFreeze({ ...next, revision: this.#revision });
    this.#economySystem.setMobilityFeedback?.({
      revision: this.#revision,
      productivityMultiplier: this.#snapshot.productivity.multiplier,
      jobAccessMultiplier: this.#snapshot.jobs.accessMultiplier,
      satisfactionModifier: this.#snapshot.satisfaction.modifier,
      deliveryReliability: this.#snapshot.deliveries.reliability,
      congestion: this.#snapshot.network.congestion,
      bridgeCongestion: this.#snapshot.bridge.congestion,
      managementCostRate: this.#snapshot.policy.operatingCostRate,
      explanation: this.#snapshot.explanation
    });

    const event = deepFreeze({
      type: reason,
      previous,
      current: this.#snapshot
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('TrafficProductivityModel listener failed.', error);
      }
    }
    return this.#snapshot;
  }

  snapshot() {
    return this.#snapshot;
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(deepFreeze({ type: 'SNAPSHOT', previous: null, current: this.#snapshot }));
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return this.#listeners.delete(listener);
    };
  }

  getMissionImpact(mission) {
    const snapshot = this.#snapshot;
    const objective = String(mission?.missionType || mission?.objectiveType || 'DELIVERY').toUpperCase();
    const freight = FREIGHT_OBJECTIVES.has(objective);
    const crossesBridge = missionCrossesPrimaryBridge(mission);
    const blocked = crossesBridge && snapshot.bridge.access === TRAFFIC_ACCESS.CLOSED;
    const disruption = crossesBridge
      ? Math.max(snapshot.network.congestion, snapshot.bridge.congestion)
      : snapshot.network.congestion;
    const difficulty = disruption >= 0.72
      ? 'SEVERE'
      : disruption >= 0.48 ? 'ELEVATED' : disruption >= 0.28 ? 'BUSY' : 'NORMAL';
    const rewardMultiplier = 1 + (freight ? (1 - snapshot.deliveries.reliability) * 0.35 : disruption * 0.1);
    const timeLimitMultiplier = 1 + disruption * (crossesBridge ? 0.2 : 0.1);
    const demandStatus = freight && snapshot.deliveries.reliability < 0.78
      ? 'SURGE'
      : 'NORMAL';
    return deepFreeze({
      available: !blocked,
      reason: blocked ? 'The primary bridge is closed; this route has no safe authored alternative.' : null,
      objective,
      crossesBridge,
      difficulty,
      congestion: disruption,
      demandStatus,
      rewardMultiplier,
      timeLimitMultiplier,
      summary: blocked
        ? 'Unavailable: primary bridge closed.'
        : `${difficulty.toLowerCase()} traffic · ${Math.round(timeLimitMultiplier * 100)}% time allowance · ${Math.round(rewardMultiplier * 100)}% reward`
    });
  }

  getStreetDirective({ x = 0, z = 0 } = {}) {
    const onBridge = x >= BRIDGE_MIN_X && x <= BRIDGE_MAX_X && Math.abs(z) <= 18;
    return deepFreeze({
      onBridge,
      access: onBridge ? this.#snapshot.bridge.access : TRAFFIC_ACCESS.OPEN,
      speedMultiplier: onBridge
        ? this.#snapshot.presentation.bridgeSpeedMultiplier
        : this.#snapshot.presentation.speedMultiplier,
      priorityActive: onBridge && this.#policy === BRIDGE_POLICIES.FREIGHT_PRIORITY,
      outageActive: onBridge && this.#snapshot.bridge.outageActive,
      label: onBridge ? this.#snapshot.bridge.streetStatus : 'City traffic flow'
    });
  }

  serialize() {
    return { version: TRAFFIC_PRODUCTIVITY_VERSION, bridgePolicy: this.#policy };
  }

  restore(state) {
    validateTrafficProductivityState(state);
    this.#policy = state.bridgePolicy;
    return this.update(0, { force: true, reason: 'STATE_RESTORED' });
  }

  #roadSnapshot() {
    const supplied = typeof this.#roadProvider === 'function'
      ? this.#roadProvider()
      : this.#roadProvider?.getRoadNetworkSnapshot?.();
    const segments = Array.isArray(supplied?.segments) ? supplied.segments : [];
    return {
      baseNodeCount: Math.max(0, Number(supplied?.baseNodeCount ?? supplied?.nodeCount ?? 0)),
      segments: segments.map(segment => ({
        id: String(segment.id),
        connected: Boolean(segment.connected),
        position: segment.position && Number.isFinite(segment.position.x) && Number.isFinite(segment.position.z)
          ? { x: segment.position.x, z: segment.position.z }
          : null
      }))
    };
  }

  #outcomeSnapshot() {
    return this.#outcomeService?.snapshot?.() || {
      revision: 0,
      traffic: {},
      serviceOutages: {},
      infrastructure: {}
    };
  }

  #calculate() {
    const economy = this.#economySystem.snapshot();
    const outcomes = this.#outcomeSnapshot();
    const roads = this.#roadSnapshot();
    const profile = POLICY_PROFILES[this.#policy];
    const trafficPolicies = Object.entries(outcomes.traffic || {});
    const activeOutages = Object.entries(outcomes.serviceOutages || {})
      .filter(([, outage]) => outage.active);
    const bridgePolicies = trafficPolicies.filter(([id, policy]) => isBridgeScope(id, policy));
    const cityPolicies = trafficPolicies.filter(([id, policy]) => id === 'CITY' || !isBridgeScope(id, policy));
    let networkAccess = TRAFFIC_ACCESS.OPEN;
    let bridgeAccess = TRAFFIC_ACCESS.OPEN;
    let networkHazard = 0;
    let bridgeHazard = 0;
    let densityMultiplier = 1;
    let bridgeDensityMultiplier = 1;

    for (const [, policy] of cityPolicies) {
      networkAccess = worstAccess(networkAccess, policy.access);
      networkHazard = Math.max(networkHazard, Number(policy.hazardLevel || 0));
      densityMultiplier *= Math.max(0.1, Number(policy.densityMultiplier || 1));
    }
    for (const [, policy] of bridgePolicies) {
      bridgeAccess = worstAccess(bridgeAccess, policy.access);
      bridgeHazard = Math.max(bridgeHazard, Number(policy.hazardLevel || 0));
      bridgeDensityMultiplier *= Math.max(0.1, Number(policy.densityMultiplier || 1));
    }
    const bridgeInfrastructure = outcomes.infrastructure?.[PRIMARY_BRIDGE_ID];
    bridgeAccess = worstAccess(bridgeAccess, bridgeInfrastructure?.access);
    const bridgeOutages = activeOutages.filter(([id, outage]) => isBridgeScope(id, outage));
    const outageSeverity = clamp(activeOutages.reduce((sum, [, outage]) => sum + Number(outage.severity || 0), 0) / 8, 0, 1);
    const bridgeOutageSeverity = clamp(bridgeOutages.reduce((sum, [, outage]) => sum + Number(outage.severity || 0), 0) / 5, 0, 1);

    const demographics = economy.demographics || {};
    const demand = economy.demand || {};
    const workforce = Math.max(0, Number(demographics.workforce || 0));
    const jobCapacity = Math.max(0, Number(demographics.jobCapacity || 0));
    const commuterDemand = 42 + Math.min(55, workforce / 55) + Math.min(35, jobCapacity / 90);
    const freightDemand = 24 + Number(demand.operations || 0) * 0.22 + Number(demand.commercial || 0) * 0.14;
    const connectedRoads = roads.segments.filter(segment => segment.connected).length;
    const disconnectedRoads = roads.segments.length - connectedRoads;
    const roadCapacity = 150 + connectedRoads * 12;
    const totalDemand = (commuterDemand + freightDemand) * densityMultiplier;
    const accessPenalty = networkAccess === TRAFFIC_ACCESS.CLOSED ? 0.52 : networkAccess === TRAFFIC_ACCESS.RESTRICTED ? 0.16 : 0;
    const congestion = clamp(
      0.08
      + Math.max(0, totalDemand / roadCapacity - 0.48) * 0.72
      + networkHazard * 0.18
      + outageSeverity * 0.12
      + accessPenalty
      + disconnectedRoads * 0.015,
      0,
      1
    );
    const bridgeDemand = (commuterDemand * 0.36 + freightDemand * 0.62) * bridgeDensityMultiplier;
    const bridgeCapacity = 58 * profile.bridgeCapacityMultiplier;
    const bridgeAccessPenalty = bridgeAccess === TRAFFIC_ACCESS.CLOSED ? 0.72 : bridgeAccess === TRAFFIC_ACCESS.RESTRICTED ? 0.2 : 0;
    const bridgeCongestion = clamp(
      0.1
      + Math.max(0, bridgeDemand / bridgeCapacity - 0.42) * 0.72
      + bridgeHazard * 0.24
      + bridgeOutageSeverity * 0.2
      + bridgeAccessPenalty,
      0,
      1
    );
    const deliveryReliability = clamp(
      1
      - congestion * 0.3
      - bridgeCongestion * 0.26
      - outageSeverity * 0.12
      - (bridgeAccess === TRAFFIC_ACCESS.CLOSED ? 0.32 : 0)
      + profile.freightReliabilityBonus,
      0.2,
      1
    );
    const jobAccessMultiplier = clamp(1 - congestion * 0.18 - bridgeCongestion * 0.08, 0.65, 1);
    const accessibleJobs = Math.round(Math.min(workforce, jobCapacity || workforce) * jobAccessMultiplier);
    const productivityMultiplier = clamp(
      1 - congestion * 0.22 - bridgeCongestion * 0.1 - outageSeverity * 0.08,
      0.55,
      1
    );
    const satisfactionModifier = -(
      congestion * 9
      + bridgeCongestion * 4
      + outageSeverity * 3
      + profile.commuterSatisfactionPenalty
    );
    const presentationDensity = clamp(0.58 + congestion * 0.42, 0.5, 1);
    const targetVehicles = Math.round(this.#presentationVehicleCap * presentationDensity);
    const streetStatus = bridgeAccess === TRAFFIC_ACCESS.CLOSED
      ? 'Bridge closed — barricades active'
      : bridgeOutages.length > 0
        ? 'Bridge service outage — reduced flow'
        : this.#policy === BRIDGE_POLICIES.FREIGHT_PRIORITY
          ? 'Freight priority lane active'
          : bridgeCongestion >= 0.55 ? 'Heavy bridge traffic' : 'Bridge open';
    const topRoadHotspot = roads.segments.find(segment => !segment.connected && segment.position);
    const hotspots = [
      ...(bridgeCongestion >= 0.35 || bridgeOutages.length > 0
        ? [{ id: PRIMARY_BRIDGE_ID, label: 'Primary bridge corridor', x: 155, z: 0, intensity: Math.max(bridgeCongestion, bridgeOutageSeverity), cause: streetStatus }]
        : []),
      ...(topRoadHotspot
        ? [{ id: topRoadHotspot.id, label: 'Disconnected road segment', ...topRoadHotspot.position, intensity: 0.4, cause: 'Road change has no network connection.' }]
        : [])
    ];
    const delayedDeliveries = Math.round((1 - deliveryReliability) * 100);

    return {
      version: TRAFFIC_PRODUCTIVITY_VERSION,
      network: {
        congestion,
        rating: congestion >= 0.75 ? 'GRIDLOCKED' : congestion >= 0.5 ? 'HEAVY' : congestion >= 0.28 ? 'BUSY' : 'FLOWING',
        access: networkAccess,
        demand: Math.round(totalDemand),
        capacity: roadCapacity,
        connectedRoadSegments: connectedRoads,
        disconnectedRoadSegments: disconnectedRoads,
        hotspots
      },
      bridge: {
        id: PRIMARY_BRIDGE_ID,
        congestion: bridgeCongestion,
        rating: bridgeCongestion >= 0.75 ? 'GRIDLOCKED' : bridgeCongestion >= 0.5 ? 'HEAVY' : bridgeCongestion >= 0.28 ? 'BUSY' : 'FLOWING',
        access: bridgeAccess,
        demand: Math.round(bridgeDemand),
        capacity: Math.round(bridgeCapacity),
        outageActive: bridgeOutages.length > 0,
        outageIds: bridgeOutages.map(([id]) => id),
        streetStatus
      },
      jobs: {
        accessMultiplier: jobAccessMultiplier,
        accessibleJobs,
        jobsDelayedByCommute: Math.max(0, Math.round(Math.min(workforce, jobCapacity || workforce) - accessibleJobs))
      },
      deliveries: {
        reliability: deliveryReliability,
        onTimePercent: Math.round(deliveryReliability * 100),
        delayedPercent: delayedDeliveries,
        demand: delayedDeliveries >= 22 ? 'SURGE' : delayedDeliveries >= 10 ? 'ELEVATED' : 'NORMAL'
      },
      productivity: {
        multiplier: productivityMultiplier,
        percent: Math.round(productivityMultiplier * 100)
      },
      satisfaction: {
        modifier: satisfactionModifier,
        roundedModifier: Math.round(satisfactionModifier)
      },
      policy: {
        id: this.#policy,
        ...profile
      },
      presentation: {
        targetMovingVehicles: targetVehicles,
        densityMultiplier: presentationDensity,
        speedMultiplier: clamp(1 - congestion * 0.48, 0.35, 1),
        bridgeSpeedMultiplier: bridgeAccess === TRAFFIC_ACCESS.CLOSED
          ? 0
          : clamp((1 - bridgeCongestion * 0.5) * (this.#policy === BRIDGE_POLICIES.FREIGHT_PRIORITY ? 1.1 : 1), 0.3, 1.05)
      },
      explanation: [
        `${Math.round(congestion * 100)}% network congestion reduces productivity to ${Math.round(productivityMultiplier * 100)}%.`,
        `${Math.round(bridgeCongestion * 100)}% bridge congestion leaves ${Math.round(deliveryReliability * 100)}% of deliveries on time.`,
        `${accessibleJobs.toLocaleString()} jobs remain reachable; traffic changes satisfaction by ${Math.round(satisfactionModifier)}.`,
        profile.tradeoff
      ],
      inputs: {
        workforce,
        jobCapacity,
        activeOutageCount: activeOutages.length
      }
    };
  }
}

export function validateTrafficProductivityState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('traffic productivity state must be an object');
  }
  if (state.version !== TRAFFIC_PRODUCTIVITY_VERSION) {
    throw new RangeError(`Unsupported traffic productivity state version: ${String(state.version)}`);
  }
  stablePolicy(state.bridgePolicy);
  return true;
}

export default TrafficProductivityModel;
