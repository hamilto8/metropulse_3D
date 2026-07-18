import { createBuildingEconomyRecord } from '../systems/BuildingEconomyAdapter.js';

export const PLACEMENT_BLOCKERS = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  CONTENT_LOCKED: 'CONTENT_LOCKED',
  DISTRICT_LOCKED: 'DISTRICT_LOCKED',
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  PROTECTED_LANDMARK: 'PROTECTED_LANDMARK',
  WATER: 'WATER',
  SLOPE: 'SLOPE',
  PLAYER_OCCUPIED: 'PLAYER_OCCUPIED',
  ROAD_OVERLAP: 'ROAD_OVERLAP',
  COLLISION: 'COLLISION',
  ZONE_RESTRICTION: 'ZONE_RESTRICTION',
  ROAD_ACCESS: 'ROAD_ACCESS',
  SERVICE_SHORTAGE: 'SERVICE_SHORTAGE',
  FISCAL_RESTRICTION: 'FISCAL_RESTRICTION',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS'
});

const BLOCKER_PRIORITY = Object.freeze({
  [PLACEMENT_BLOCKERS.INVALID_INPUT]: 0,
  [PLACEMENT_BLOCKERS.CONTENT_LOCKED]: 10,
  [PLACEMENT_BLOCKERS.DISTRICT_LOCKED]: 20,
  [PLACEMENT_BLOCKERS.OUT_OF_BOUNDS]: 30,
  [PLACEMENT_BLOCKERS.PROTECTED_LANDMARK]: 40,
  [PLACEMENT_BLOCKERS.WATER]: 50,
  [PLACEMENT_BLOCKERS.SLOPE]: 60,
  [PLACEMENT_BLOCKERS.PLAYER_OCCUPIED]: 70,
  [PLACEMENT_BLOCKERS.ROAD_OVERLAP]: 80,
  [PLACEMENT_BLOCKERS.COLLISION]: 90,
  [PLACEMENT_BLOCKERS.ZONE_RESTRICTION]: 100,
  [PLACEMENT_BLOCKERS.ROAD_ACCESS]: 110,
  [PLACEMENT_BLOCKERS.SERVICE_SHORTAGE]: 120,
  [PLACEMENT_BLOCKERS.FISCAL_RESTRICTION]: 125,
  [PLACEMENT_BLOCKERS.INSUFFICIENT_FUNDS]: 130
});

const ORDINARY_DEVELOPMENT_CATEGORIES = new Set([
  'RESIDENTIAL',
  'COMMERCIAL',
  'OPERATIONS'
]);

const SERVICE_LABELS = Object.freeze({
  power: 'Power',
  water: 'Water',
  fire: 'Fire safety'
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function freezeResult(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeResult(child);
  return Object.freeze(value);
}

function money(value) {
  return `$${Math.round(Math.abs(finite(value))).toLocaleString('en-US')}`;
}

function makeBlocker(code, message, remedy, detail = {}) {
  return {
    code,
    priority: BLOCKER_PRIORITY[code] ?? 1_000,
    message,
    remedy,
    detail
  };
}

function getRequiredServices(spec) {
  if (Array.isArray(spec.requiredServices)) {
    return spec.requiredServices.filter(service => SERVICE_LABELS[service]);
  }
  if (spec.generatorType === 'ROAD_SEGMENT' || spec.generatorType === 'PARK_PLAZA') return [];
  if (spec.generatorType === 'ENERGY_ARRAY') return spec.waterDemand > 0 ? ['water'] : [];
  if (spec.generatorType === 'UTILITY') return spec.powerDemand > 0 ? ['power'] : [];
  return Object.keys(SERVICE_LABELS).filter(service => {
    if (service === 'fire' && finite(spec.fireCoverage) > 0) return false;
    // Phase 4.2 gates ordinary operation on the two critical utility inputs.
    // Fire demand remains forecast as risk, but becomes a hard placement
    // prerequisite only when content explicitly authors fireDemand; P4.3 owns
    // the broader safety/reach model.
    if (service === 'fire') return finite(spec.fireDemand) > 0;
    return finite(spec[`${service}Demand`]) > 0
      || ORDINARY_DEVELOPMENT_CATEGORIES.has(spec.category);
  });
}

function getPayback(cost, netCashflow) {
  if (netCashflow <= 0) {
    return {
      category: 'PUBLIC_SERVICE',
      label: 'No direct payback',
      minutes: null
    };
  }
  const minutes = cost / netCashflow;
  const category = minutes <= 60 ? 'FAST' : minutes <= 240 ? 'MEDIUM' : 'LONG';
  return {
    category,
    label: `${category[0]}${category.slice(1).toLowerCase()} · ${Math.ceil(minutes)} min`,
    minutes
  };
}

function getDemandEffect(spec, economySnapshot = {}) {
  const categoryToDemand = {
    RESIDENTIAL: 'residential',
    COMMERCIAL: 'commercial',
    OPERATIONS: 'operations',
    FACILITIES: 'services'
  };
  const type = categoryToDemand[spec.category] || null;
  if (!type) return { type: null, current: null, effect: 'NEUTRAL', label: 'No aggregate demand effect' };
  const current = finite(economySnapshot.demand?.[type], 0);
  const capacity = type === 'residential'
    ? finite(spec.residents)
    : type === 'services'
      ? finite(spec.powerSupply) + finite(spec.waterSupply) + finite(spec.fireCoverage)
      : finite(spec.employees);
  const effect = capacity >= 300 ? 'HIGH' : capacity > 0 ? 'MODERATE' : 'LOW';
  return {
    type,
    current,
    effect,
    label: `${type[0].toUpperCase()}${type.slice(1)} demand ${Math.round(current)} · ${effect.toLowerCase()} relief`
  };
}

function projectServices(spec, economySnapshot = {}) {
  const result = {};
  for (const service of Object.keys(SERVICE_LABELS)) {
    const current = economySnapshot.services?.[service] || {};
    const capacityDelta = Math.max(0, finite(spec[`${service}Supply`] ?? (service === 'fire' ? spec.fireCoverage : 0)));
    const demandDelta = Math.max(0, finite(spec[`${service}Demand`], service === 'fire'
      ? Math.ceil((finite(spec.residents) + finite(spec.employees)) / 180)
      : 0));
    const capacity = finite(current.capacity) + capacityDelta;
    const demand = finite(current.demand) + demandDelta;
    result[service] = {
      capacityDelta,
      demandDelta,
      projectedCapacity: capacity,
      projectedDemand: demand,
      projectedSurplus: capacity - demand,
      adequate: capacity >= demand
    };
  }
  return result;
}

export function createPlacementPreview(spec, economySnapshot = {}, {
  availableCredits = null,
  spendingDecision = null
} = {}) {
  if (!spec || typeof spec !== 'object') throw new TypeError('placement preview requires a building spec');
  const cost = Math.max(0, finite(spec.cost));
  const authoredNet = finite(spec.incomePerMinute);
  const grossIncome = Math.max(0, finite(spec.revenuePerMinute ?? spec.grossIncomePerMinute, Math.max(0, authoredNet)));
  const operatingCost = Math.max(0, finite(spec.operatingCostPerMinute ?? spec.upkeepPerMinute, Math.max(0, -authoredNet)));
  const netCashflow = spec.revenuePerMinute != null || spec.grossIncomePerMinute != null
    ? grossIncome - operatingCost
    : authoredNet;
  const services = projectServices(spec, economySnapshot);
  const economyRecord = createBuildingEconomyRecord({
    id: 'PLACEMENT_PREVIEW',
    name: spec.name,
    plot: { x: 0, z: 0 },
    residents: finite(spec.residents),
    employees: finite(spec.employees)
  }, { spec, id: 'PLACEMENT_PREVIEW', fallbackIncomePerMinute: 0 });
  const risks = [];
  const shortages = Object.entries(services).filter(([, state]) => !state.adequate);
  if (shortages.length > 0) risks.push({ level: 'HIGH', label: 'Service shortage' });
  if (finite(spec.happiness) < 0) risks.push({ level: 'MODERATE', label: 'Local satisfaction pressure' });
  if (availableCredits != null && cost > finite(availableCredits) * 0.6) {
    risks.push({ level: 'MODERATE', label: 'Treasury concentration' });
  }
  if (spendingDecision?.warning) {
    risks.push({ level: 'HIGH', label: spendingDecision.warning });
  } else if (spendingDecision && !spendingDecision.allowed && spendingDecision.code !== 'INSUFFICIENT_FUNDS') {
    risks.push({ level: 'HIGH', label: spendingDecision.reason });
  }
  if (risks.length === 0) risks.push({ level: 'LOW', label: 'No material forecast risk' });

  return freezeResult({
    specId: spec.id || null,
    name: spec.name || spec.id || 'Structure',
    cost,
    operatingCost,
    grossIncome,
    netCashflow,
    payback: getPayback(cost, netCashflow),
    capacity: {
      residents: Math.max(0, Math.round(finite(spec.residents))),
      jobs: Math.max(0, Math.round(finite(spec.employees))),
      traffic: Math.max(0, Math.round(finite(spec.trafficCapacity)))
    },
    demandEffect: getDemandEffect(spec, economySnapshot),
    serviceEffect: services,
    happiness: finite(spec.happiness),
    landValue: economyRecord.landValueModifier,
    risks,
    summary: {
      cost: money(cost),
      operatingCost: `${money(operatingCost)}/min`,
      netCashflow: `${netCashflow >= 0 ? '+' : '−'}${money(netCashflow)}/min`
    }
  });
}

/**
 * Converts already-observed world facts into one immutable placement decision.
 * Rendering and Three.js stay outside this module, making the contract usable by
 * UI previews, commit-time revalidation, save restore, and deterministic tests.
 */
export function evaluatePlacement({
  spec,
  position,
  access = { unlocked: true },
  district = { allowed: true },
  inBounds = true,
  protectedLandmark = null,
  water = false,
  slopeDegrees = 0,
  maxSlopeDegrees = 8,
  playerOccupied = false,
  roadOverlap = false,
  collision = null,
  zone = null,
  zoneCompatible = true,
  requiresRoadAccess = ORDINARY_DEVELOPMENT_CATEGORIES.has(spec?.category),
  hasRoadAccess = true,
  economySnapshot = {},
  availableCredits = null,
  spendingDecision = null
} = {}) {
  if (!spec || !Number.isFinite(position?.x) || !Number.isFinite(position?.y) || !Number.isFinite(position?.z)) {
    const blocker = makeBlocker(
      PLACEMENT_BLOCKERS.INVALID_INPUT,
      'The placement target is not available.',
      'Move the cursor onto buildable terrain and try again.'
    );
    return freezeResult({ valid: false, blockers: [blocker], primaryBlocker: blocker, preview: null });
  }

  const preview = createPlacementPreview(spec, economySnapshot, { availableCredits, spendingDecision });
  const blockers = [];
  if (!access.unlocked) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.CONTENT_LOCKED,
    access.reason || `${spec.name} is not unlocked.`,
    `Reach the ${access.requiredTier || 'required'} progression tier, then select this blueprint again.`,
    { requiredTier: access.requiredTier || null }
  ));
  if (!district.allowed) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.DISTRICT_LOCKED,
    district.reason || 'This district is not open for development.',
    district.remedy || 'Unlock the district or choose a parcel in the current MVP footprint.',
    { districtId: district.id || null }
  ));
  if (!inBounds) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.OUT_OF_BOUNDS,
    'The full footprint extends beyond the buildable city boundary.',
    'Move the structure inward until the complete footprint is inside the boundary.'
  ));
  if (protectedLandmark) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.PROTECTED_LANDMARK,
    `${protectedLandmark} is protected from construction.`,
    'Choose a parcel outside the landmark protection boundary.',
    { landmark: protectedLandmark }
  ));
  if (water && spec.roadType !== 'BRIDGE') blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.WATER,
    `${spec.name} cannot be supported on open water.`,
    'Move onto dry terrain or use an unlocked bridge segment where a crossing is valid.'
  ));
  if (slopeDegrees > maxSlopeDegrees) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.SLOPE,
    `Terrain slope is ${slopeDegrees.toFixed(1)}°; ${spec.name} supports up to ${maxSlopeDegrees.toFixed(1)}°.`,
    'Move to flatter ground or rotate the footprint to follow the terrain.',
    { slopeDegrees, maxSlopeDegrees }
  ));
  if (playerOccupied) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.PLAYER_OCCUPIED,
    'The controlled character or vehicle is inside the construction safety area.',
    'Move clear of the highlighted footprint before confirming construction.'
  ));
  if (roadOverlap) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.ROAD_OVERLAP,
    'The structure overlaps an active road corridor.',
    spec.generatorType === 'ROAD_SEGMENT'
      ? 'Align the road segment edge-to-edge with the road socket without overlapping it.'
      : 'Set the building beside the road while keeping the travel lanes clear.'
  ));
  if (collision) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.COLLISION,
    collision.message || `The footprint collides with ${collision.name || 'another world object'}.`,
    collision.remedy || 'Choose an unoccupied parcel with clearance on every side.',
    { kind: collision.kind || 'WORLD', id: collision.id || null }
  ));
  if (zone && !zoneCompatible) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.ZONE_RESTRICTION,
    `${spec.name} is incompatible with ${zone.label || zone.zoneType || 'the current'} zoning.`,
    `Choose a compatible ${spec.category.toLowerCase()} parcel or rezone this parcel first.`,
    { zoneType: zone.zoneType || null }
  ));
  if (requiresRoadAccess && !hasRoadAccess) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.ROAD_ACCESS,
    `${spec.name} has no valid road access.`,
    'Place it beside a connected road, or construct and connect a road segment first.'
  ));

  const requiredServices = getRequiredServices(spec);
  for (const service of requiredServices) {
    const projected = preview.serviceEffect[service];
    if (projected?.adequate) continue;
    const shortage = Math.abs(projected?.projectedSurplus || 0);
    blockers.push(makeBlocker(
      PLACEMENT_BLOCKERS.SERVICE_SHORTAGE,
      `${SERVICE_LABELS[service]} needs ${shortage.toLocaleString('en-US')} more capacity after placement.`,
      `Add a ${SERVICE_LABELS[service].toLowerCase()} facility before constructing ${spec.name}.`,
      { service, shortage }
    ));
  }
  if (availableCredits != null && availableCredits < preview.cost) blockers.push(makeBlocker(
    PLACEMENT_BLOCKERS.INSUFFICIENT_FUNDS,
    `${spec.name} costs ${money(preview.cost)}, but the treasury has ${money(availableCredits)}.`,
    `Earn or recover ${money(preview.cost - availableCredits)} before construction.`,
    { cost: preview.cost, availableCredits, shortfall: preview.cost - availableCredits }
  ));
  if (spendingDecision && !spendingDecision.allowed && spendingDecision.code !== 'INSUFFICIENT_FUNDS') {
    blockers.push(makeBlocker(
      PLACEMENT_BLOCKERS.FISCAL_RESTRICTION,
      spendingDecision.reason,
      spendingDecision.remedy || 'Choose a lower-risk action and rebuild city reserves.',
      { decisionCode: spendingDecision.code, fiscalState: spendingDecision.state }
    ));
  }

  blockers.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  return freezeResult({
    valid: blockers.length === 0,
    blockers,
    primaryBlocker: blockers[0] || null,
    preview,
    position: { x: position.x, y: position.y, z: position.z }
  });
}

export function isOrdinaryDevelopment(spec) {
  return ORDINARY_DEVELOPMENT_CATEGORIES.has(spec?.category);
}
