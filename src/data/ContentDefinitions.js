import { normalizeZoneId } from '../world/ConstructionVocabulary.js';

/**
 * Renderer-independent authored definitions used by validation and domain
 * consumers. Stable IDs are persistence contracts; labels and presentation
 * metadata may change without migrating saves.
 */

export const WORLD_BOUNDS = Object.freeze({
  minX: -190,
  maxX: 810,
  minY: -100,
  maxY: 2_000,
  minZ: -390,
  maxZ: 390
});

export const DISTRICT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'WEST_CORE',
    label: 'West Core',
    bounds: Object.freeze({ minX: -190, maxX: 105, minZ: -150, maxZ: 150 }),
    releaseScope: 'MVP'
  }),
  Object.freeze({
    id: 'CENTRAL_PARK',
    label: 'Central Park',
    bounds: Object.freeze({ minX: -105, maxX: -45, minZ: -105, maxZ: -45 }),
    releaseScope: 'MVP'
  }),
  Object.freeze({
    id: 'PRIMARY_BRIDGE_CORRIDOR',
    label: 'Primary Bridge Corridor',
    bounds: Object.freeze({ minX: 105, maxX: 330, minZ: -150, maxZ: 150 }),
    releaseScope: 'MVP'
  }),
  Object.freeze({
    id: 'EAST_CYBER_METROPOLIS',
    label: 'East Cyber Metropolis',
    bounds: Object.freeze({ minX: 330, maxX: 810, minZ: -390, maxZ: 390 }),
    releaseScope: 'POST_MVP'
  })
]);

const zone = (id, label, {
  aliases = [],
  color,
  happiness = 0,
  landValue = 0,
  kind = 'DEVELOPMENT',
  releaseScope = 'MVP'
} = {}) => Object.freeze({
  id,
  label,
  aliases: Object.freeze([...aliases]),
  color,
  happiness,
  landValue,
  kind,
  releaseScope
});

export const ZONE_DEFINITIONS = Object.freeze([
  zone('RESIDENTIAL', 'Residential', {
    aliases: ['RES'], color: 0x22c55e, happiness: 1.2, landValue: 1.5
  }),
  zone('COMMERCIAL', 'Commercial', {
    aliases: ['COM', 'OFFICE'], color: 0xd946ef, happiness: 0.3, landValue: 2.2
  }),
  zone('OPERATIONS', 'Operations', {
    aliases: ['OPS', 'IND', 'INDUSTRIAL'], color: 0xf97316, happiness: -1.5, landValue: -1
  }),
  zone('POWER_SERVICE', 'Legacy Power Parcel', {
    aliases: ['POWER'], color: 0xfacc15, happiness: 0.2, landValue: 0.4,
    kind: 'SERVICE', releaseScope: 'COMPATIBILITY'
  }),
  zone('WATER_SERVICE', 'Legacy Water Parcel', {
    aliases: ['WATER'], color: 0x06b6d4, happiness: 0.8, landValue: 0.7,
    kind: 'SERVICE', releaseScope: 'COMPATIBILITY'
  }),
  zone('FIRE_SERVICE', 'Legacy Fire Parcel', {
    aliases: ['FIRE'], color: 0xef4444, happiness: 1.5, landValue: 1.2,
    kind: 'SERVICE', releaseScope: 'COMPATIBILITY'
  }),
  zone('SUBURBAN_RESIDENTIAL', 'Suburban Residential', {
    color: 0x65a30d, happiness: 1.4, landValue: 1.1,
    kind: 'AUTHORED_WORLD', releaseScope: 'POST_MVP'
  })
]);

const ZONES_BY_INPUT = new Map();
for (const definition of ZONE_DEFINITIONS) {
  ZONES_BY_INPUT.set(definition.id, definition);
  for (const alias of definition.aliases) ZONES_BY_INPUT.set(alias, definition);
}

export function getZoneDefinition(idOrAlias) {
  if (typeof idOrAlias !== 'string') return null;
  const normalized = normalizeZoneId(idOrAlias);
  return ZONES_BY_INPUT.get(normalized || idOrAlias.trim().toUpperCase()) || null;
}

export const FACTION_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'QUANTUM_DYNAMICS', label: 'Quantum Dynamics', minReputation: -100, maxReputation: 100 }),
  Object.freeze({ id: 'AETHER_SKYSPIRE', label: 'Aether Skyspire', minReputation: -100, maxReputation: 100 }),
  Object.freeze({ id: 'RESIDENTS', label: 'Residents', minReputation: -100, maxReputation: 100 }),
  Object.freeze({ id: 'OPERATIONS', label: 'Operations', minReputation: -100, maxReputation: 100 })
]);

export const PROGRESSION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'OPERATOR',
    label: 'Operator',
    rank: 1,
    prerequisiteIds: Object.freeze([])
  }),
  Object.freeze({
    id: 'BROKER',
    label: 'Broker',
    rank: 2,
    prerequisiteIds: Object.freeze(['OPERATOR'])
  }),
  Object.freeze({
    id: 'MAGNATE',
    label: 'Magnate',
    rank: 3,
    prerequisiteIds: Object.freeze(['BROKER'])
  })
]);

export const VEHICLE_CONTENT_IDS = Object.freeze([
  'SEDAN', 'SPORTS', 'SPORTS_CAR', 'BUS', 'TRUCK', 'TAXI', 'POLICE',
  'AMBULANCE', 'ICECREAM', 'DUMP_TRUCK', 'MOTORBIKE'
]);
