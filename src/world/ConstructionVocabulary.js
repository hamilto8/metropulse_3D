/**
 * Canonical MVP construction vocabulary and renderer-independent catalog
 * disclosure policy. Stable building IDs remain in BuildingCatalog; this file
 * owns the smaller set of concepts shared by content, saves, editor rules, and
 * presentation.
 */

export const MVP_ZONE_IDS = Object.freeze({
  RESIDENTIAL: 'RESIDENTIAL',
  COMMERCIAL: 'COMMERCIAL',
  OPERATIONS: 'OPERATIONS'
});

export const MVP_ZONE_LABELS = Object.freeze({
  [MVP_ZONE_IDS.RESIDENTIAL]: 'Residential',
  [MVP_ZONE_IDS.COMMERCIAL]: 'Commercial',
  [MVP_ZONE_IDS.OPERATIONS]: 'Operations'
});

export const CONSTRUCTION_CATEGORIES = Object.freeze({
  RESIDENTIAL: 'Residential',
  COMMERCIAL: 'Commercial',
  OPERATIONS: 'Operations',
  FACILITIES: 'Facilities',
  INFRASTRUCTURE: 'Infrastructure'
});

export const CATALOG_STAGES = Object.freeze({
  STARTER: 'STARTER',
  ADVANCED: 'ADVANCED'
});

export const PROGRESSION_TIERS = Object.freeze({
  OPERATOR: 'OPERATOR',
  BROKER: 'BROKER',
  MAGNATE: 'MAGNATE'
});

const TIER_RANK = Object.freeze({
  [PROGRESSION_TIERS.OPERATOR]: 1,
  [PROGRESSION_TIERS.BROKER]: 2,
  [PROGRESSION_TIERS.MAGNATE]: 3
});

const ZONE_ALIASES = Object.freeze({
  RES: MVP_ZONE_IDS.RESIDENTIAL,
  RESIDENTIAL: MVP_ZONE_IDS.RESIDENTIAL,
  COM: MVP_ZONE_IDS.COMMERCIAL,
  COMMERCIAL: MVP_ZONE_IDS.COMMERCIAL,
  OFFICE: MVP_ZONE_IDS.COMMERCIAL,
  OPS: MVP_ZONE_IDS.OPERATIONS,
  IND: MVP_ZONE_IDS.OPERATIONS,
  INDUSTRIAL: MVP_ZONE_IDS.OPERATIONS,
  OPERATIONS: MVP_ZONE_IDS.OPERATIONS,
  // These IDs are load-only compatibility records. New players construct
  // facilities instead of painting service zones.
  POWER: 'POWER_SERVICE',
  POWER_SERVICE: 'POWER_SERVICE',
  WATER: 'WATER_SERVICE',
  WATER_SERVICE: 'WATER_SERVICE',
  FIRE: 'FIRE_SERVICE',
  FIRE_SERVICE: 'FIRE_SERVICE',
  SUBURBAN_RESIDENTIAL: 'SUBURBAN_RESIDENTIAL'
});

export function normalizeZoneId(value) {
  if (typeof value !== 'string') return null;
  return ZONE_ALIASES[value.trim().toUpperCase()] || null;
}

export function isMvpDevelopmentZone(value) {
  const normalized = normalizeZoneId(value);
  return Object.values(MVP_ZONE_IDS).includes(normalized);
}

export function getZoneLabel(value) {
  const normalized = normalizeZoneId(value);
  return MVP_ZONE_LABELS[normalized] || normalized;
}

export function getUnlockedProgressionTier(values = {}) {
  let rank = TIER_RANK[PROGRESSION_TIERS.OPERATOR];
  for (const [tier, tierRank] of Object.entries(TIER_RANK)) {
    if (values?.[tier] === true) rank = Math.max(rank, tierRank);
  }
  return Object.keys(TIER_RANK).find(tier => TIER_RANK[tier] === rank)
    || PROGRESSION_TIERS.OPERATOR;
}

export function getCatalogAccess(spec, progression = {}) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('catalog spec must be an object');
  }
  const requiredTier = spec.progressionTier || PROGRESSION_TIERS.OPERATOR;
  const currentTier = getUnlockedProgressionTier(progression);
  const requiredRank = TIER_RANK[requiredTier];
  if (!requiredRank) throw new RangeError(`Unknown catalog progression tier: ${requiredTier}`);
  const unlocked = TIER_RANK[currentTier] >= requiredRank;
  return Object.freeze({
    unlocked,
    currentTier,
    requiredTier,
    stage: spec.catalogStage || CATALOG_STAGES.ADVANCED,
    reason: unlocked ? null : `Unlocks at ${requiredTier[0]}${requiredTier.slice(1).toLowerCase()} tier`
  });
}

export function isCatalogSpecDisclosed(spec, { includeAdvanced = false } = {}) {
  return spec?.catalogStage === CATALOG_STAGES.STARTER || includeAdvanced;
}

