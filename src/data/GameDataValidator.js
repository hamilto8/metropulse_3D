import missions from './missions.json' with { type: 'json' };
import {
  DISTRICT_DEFINITIONS,
  FACTION_DEFINITIONS,
  PROGRESSION_DEFINITIONS,
  VEHICLE_CONTENT_IDS,
  WORLD_BOUNDS,
  ZONE_DEFINITIONS
} from './ContentDefinitions.js';
import {
  DataValidationError,
  assertAcyclicPrerequisites,
  assertEnum,
  assertFinite,
  assertKnownReference,
  assertRecord,
  assertString,
  failData,
  indexUniqueRecords
} from './DataValidation.js';
import { validateMissionData } from './MissionDataValidator.js';
import { BUILDING_CATALOG, BUILDING_CATEGORIES } from '../world/BuildingCatalog.js';
import { CATALOG_STAGES, PROGRESSION_TIERS } from '../world/ConstructionVocabulary.js';
import { DEFAULT_WEATHER_MODE, WEATHER_DEFINITIONS } from '../systems/Weather.js';
import {
  MVP_ACTIVITY_TEMPLATES,
  MVP_MISSION_IDS,
  MVP_WORLD_FOOTPRINT,
  MVP_ZONE_LABELS
} from '../config/MvpScope.js';

export const CONTENT_TYPES = Object.freeze({
  MISSION: 'missions',
  BUILDING: 'buildings',
  ZONE: 'zones',
  DISTRICT: 'districts',
  FACTION: 'factions',
  PROGRESSION: 'progression',
  WEATHER: 'weather'
});

const RELEASE_SCOPES = new Set(['MVP', 'POST_MVP', 'COMPATIBILITY']);
const ZONE_KINDS = new Set(['DEVELOPMENT', 'SERVICE', 'AUTHORED_WORLD']);
const BUILDING_GENERATORS = new Set([
  'SKYSCRAPER', 'SHOP', 'RESIDENTIAL', 'CIVIC', 'PARK_PLAZA',
  'ROAD_SEGMENT', 'ENERGY_ARRAY', 'INDUSTRIAL', 'UTILITY'
]);
const ROAD_TYPES = new Set(['STRAIGHT', 'INTERSECTION', 'BRIDGE']);
const CATALOG_STAGE_IDS = new Set(Object.values(CATALOG_STAGES));
const PROGRESSION_TIER_IDS = new Set(Object.values(PROGRESSION_TIERS));

function immutableCounts(indexes, dialogueCount) {
  const counts = Object.fromEntries(
    Object.entries(indexes).map(([type, index]) => [type, index.size])
  );
  counts.dialogue = dialogueCount;
  return Object.freeze(counts);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableIndex(index) {
  return new Map([...index].map(([id, record]) => [
    id,
    deepFreeze(structuredClone(record))
  ]));
}

export class ContentRegistry {
  #indexes;
  #dialogueNodes;

  constructor(indexes, dialogueNodes) {
    this.#indexes = Object.fromEntries(
      Object.entries(indexes).map(([type, index]) => [type, immutableIndex(index)])
    );
    this.#dialogueNodes = immutableIndex(dialogueNodes);
    this.counts = immutableCounts(indexes, dialogueNodes.size);
    Object.freeze(this);
  }

  has(type, id) {
    return this.#indexes[type]?.has(id) || false;
  }

  get(type, id) {
    return this.#indexes[type]?.get(id) || null;
  }

  hasDialogueNode(missionId, nodeId) {
    return this.#dialogueNodes.has(`${missionId}:${nodeId}`);
  }

  ids(type) {
    return Object.freeze([...(this.#indexes[type]?.keys() || [])]);
  }
}

function validateBounds(bounds, source, id) {
  assertRecord(bounds, { source, recordId: id, field: 'bounds' });
  for (const field of ['minX', 'maxX', 'minZ', 'maxZ']) {
    assertFinite(bounds[field], { source, recordId: id, field: `bounds.${field}` });
  }
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
    failData('must have minimum coordinates below maximum coordinates.', {
      source, recordId: id, field: 'bounds', code: 'IMPOSSIBLE_COORDINATES'
    });
  }
  if (
    bounds.minX < WORLD_BOUNDS.minX || bounds.maxX > WORLD_BOUNDS.maxX
    || bounds.minZ < WORLD_BOUNDS.minZ || bounds.maxZ > WORLD_BOUNDS.maxZ
  ) {
    failData('extends outside supported world coordinates.', {
      source, recordId: id, field: 'bounds', code: 'IMPOSSIBLE_COORDINATES'
    });
  }
}

function validateDistricts(records) {
  return indexUniqueRecords(records, CONTENT_TYPES.DISTRICT, (record, id) => {
    assertString(record.label, { source: CONTENT_TYPES.DISTRICT, recordId: id, field: 'label' });
    assertEnum(record.releaseScope, RELEASE_SCOPES, {
      source: CONTENT_TYPES.DISTRICT, recordId: id, field: 'releaseScope'
    });
    validateBounds(record.bounds, CONTENT_TYPES.DISTRICT, id);
  });
}

function validateZones(records) {
  const aliases = new Map();
  const index = indexUniqueRecords(records, CONTENT_TYPES.ZONE, (record, id) => {
    assertString(record.label, { source: CONTENT_TYPES.ZONE, recordId: id, field: 'label' });
    assertEnum(record.kind, ZONE_KINDS, { source: CONTENT_TYPES.ZONE, recordId: id, field: 'kind' });
    assertEnum(record.releaseScope, RELEASE_SCOPES, {
      source: CONTENT_TYPES.ZONE, recordId: id, field: 'releaseScope'
    });
    assertFinite(record.color, { source: CONTENT_TYPES.ZONE, recordId: id, field: 'color' }, {
      min: 0, max: 0xffffff
    });
    assertFinite(record.happiness, { source: CONTENT_TYPES.ZONE, recordId: id, field: 'happiness' });
    assertFinite(record.landValue, { source: CONTENT_TYPES.ZONE, recordId: id, field: 'landValue' });
    if (!Array.isArray(record.aliases)) {
      failData('must be an array.', { source: CONTENT_TYPES.ZONE, recordId: id, field: 'aliases' });
    }
    for (const [aliasIndex, alias] of record.aliases.entries()) {
      const normalized = assertString(alias, {
        source: CONTENT_TYPES.ZONE, recordId: id, field: `aliases[${aliasIndex}]`
      }, { stableId: true });
      if (aliases.has(normalized) || records.some(candidate => candidate.id === normalized)) {
        failData(`duplicates zone ID or alias ${normalized}.`, {
          source: CONTENT_TYPES.ZONE,
          recordId: id,
          field: `aliases[${aliasIndex}]`,
          code: 'DUPLICATE_ID'
        });
      }
      aliases.set(normalized, id);
    }
  });
  return index;
}

function validateBuildingCategories(categories) {
  assertRecord(categories, { source: 'building-categories' });
  if (Object.keys(categories).length === 0) {
    failData('must define at least one category.', { source: 'building-categories' });
  }
  const keys = new Set();
  for (const [id, label] of Object.entries(categories)) {
    assertString(id, { source: 'building-categories', recordId: id, field: 'id' }, { stableId: true });
    assertString(label, { source: 'building-categories', recordId: id, field: 'label' });
    keys.add(id);
  }
  return keys;
}

function validateBuildings(records, categories) {
  const numericNonNegative = [
    'height', 'cost', 'value', 'employees', 'residents', 'powerDemand',
    'waterDemand', 'powerSupply', 'waterSupply', 'fireCoverage',
    'amenityRadius', 'trafficCapacity'
  ];
  return indexUniqueRecords(records, CONTENT_TYPES.BUILDING, (record, id) => {
    for (const field of ['name', 'description', 'status', 'specialty']) {
      assertString(record[field], { source: CONTENT_TYPES.BUILDING, recordId: id, field });
    }
    assertEnum(record.category, categories, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'category'
    });
    assertEnum(record.catalogStage, CATALOG_STAGE_IDS, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'catalogStage'
    });
    assertEnum(record.progressionTier, PROGRESSION_TIER_IDS, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'progressionTier'
    });
    assertEnum(record.generatorType, BUILDING_GENERATORS, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'generatorType'
    });
    assertRecord(record.footprint, { source: CONTENT_TYPES.BUILDING, recordId: id, field: 'footprint' });
    assertFinite(record.footprint.width, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'footprint.width'
    }, { min: 0.001 });
    assertFinite(record.footprint.depth, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'footprint.depth'
    }, { min: 0.001 });
    for (const field of numericNonNegative) {
      if (record[field] != null) {
        assertFinite(record[field], { source: CONTENT_TYPES.BUILDING, recordId: id, field }, { min: 0 });
      }
    }
    assertFinite(record.incomePerMinute, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'incomePerMinute'
    });
    assertFinite(record.happiness ?? 0, {
      source: CONTENT_TYPES.BUILDING, recordId: id, field: 'happiness'
    });
    for (const field of ['baseColor', 'accentColor']) {
      assertFinite(record[field], { source: CONTENT_TYPES.BUILDING, recordId: id, field }, {
        min: 0, max: 0xffffff
      });
    }
    if (record.generatorType === 'ROAD_SEGMENT') {
      assertEnum(record.roadType, ROAD_TYPES, {
        source: CONTENT_TYPES.BUILDING, recordId: id, field: 'roadType'
      });
    }
  });
}

function validateFactions(records) {
  return indexUniqueRecords(records, CONTENT_TYPES.FACTION, (record, id) => {
    assertString(record.label, { source: CONTENT_TYPES.FACTION, recordId: id, field: 'label' });
    assertFinite(record.minReputation, {
      source: CONTENT_TYPES.FACTION, recordId: id, field: 'minReputation'
    });
    assertFinite(record.maxReputation, {
      source: CONTENT_TYPES.FACTION, recordId: id, field: 'maxReputation'
    });
    if (record.minReputation >= record.maxReputation) {
      failData('minReputation must be below maxReputation.', {
        source: CONTENT_TYPES.FACTION, recordId: id, field: 'minReputation'
      });
    }
  });
}

function validateProgression(records) {
  const ranks = new Set();
  const index = indexUniqueRecords(records, CONTENT_TYPES.PROGRESSION, (record, id) => {
    assertString(record.label, { source: CONTENT_TYPES.PROGRESSION, recordId: id, field: 'label' });
    assertFinite(record.rank, { source: CONTENT_TYPES.PROGRESSION, recordId: id, field: 'rank' }, { min: 1 });
    if (!Number.isInteger(record.rank)) {
      failData('must be an integer.', { source: CONTENT_TYPES.PROGRESSION, recordId: id, field: 'rank' });
    }
    if (ranks.has(record.rank)) {
      failData(`duplicates progression rank ${record.rank}.`, {
        source: CONTENT_TYPES.PROGRESSION, recordId: id, field: 'rank', code: 'DUPLICATE_ID'
      });
    }
    ranks.add(record.rank);
    if (!Array.isArray(record.prerequisiteIds)) {
      failData('must be an array.', {
        source: CONTENT_TYPES.PROGRESSION, recordId: id, field: 'prerequisiteIds'
      });
    }
  });
  for (const [id, record] of index) {
    record.prerequisiteIds.forEach((prerequisiteId, prerequisiteIndex) => {
      assertKnownReference(prerequisiteId, index, {
        source: CONTENT_TYPES.PROGRESSION,
        recordId: id,
        field: `prerequisiteIds[${prerequisiteIndex}]`
      }, CONTENT_TYPES.PROGRESSION);
    });
  }
  assertAcyclicPrerequisites(index, CONTENT_TYPES.PROGRESSION);
  return index;
}

function validateWeather(records, defaultMode) {
  const index = indexUniqueRecords(records, CONTENT_TYPES.WEATHER, (record, id) => {
    assertFinite(record.durationSeconds, {
      source: CONTENT_TYPES.WEATHER, recordId: id, field: 'durationSeconds'
    }, { min: 0.001 });
    for (const field of ['fogDensity', 'rainOpacity', 'wetness', 'groundFriction', 'gripMultiplier']) {
      assertFinite(record[field], { source: CONTENT_TYPES.WEATHER, recordId: id, field }, { min: 0 });
    }
    for (const field of ['rainOpacity', 'wetness', 'groundFriction', 'gripMultiplier']) {
      if (record[field] > 1) {
        failData('must be between 0 and 1.', { source: CONTENT_TYPES.WEATHER, recordId: id, field });
      }
    }
    assertString(record.statusText, { source: CONTENT_TYPES.WEATHER, recordId: id, field: 'statusText' });
  });
  assertKnownReference(defaultMode, index, {
    source: CONTENT_TYPES.WEATHER, recordId: '<default>', field: 'id'
  }, CONTENT_TYPES.WEATHER);
  return index;
}

function validateScope(scope, indexes) {
  const unique = (values, source) => {
    if (!Array.isArray(values)) failData('must be an array.', { source });
    if (new Set(values).size !== values.length) {
      failData('contains duplicate stable IDs.', { source, code: 'DUPLICATE_ID' });
    }
  };
  unique(scope.missionIds, 'mvp-scope.missionIds');
  unique(scope.activityTemplates, 'mvp-scope.activityTemplates');
  unique(scope.worldFootprint, 'mvp-scope.worldFootprint');
  for (const [index, missionId] of scope.missionIds.entries()) {
    assertKnownReference(missionId, indexes.missions, {
      source: 'mvp-scope', recordId: 'missionIds', field: `[${index}]`
    }, CONTENT_TYPES.MISSION);
  }
  const objectives = new Set(scope.activityTemplates);
  for (const [index, objective] of scope.activityTemplates.entries()) {
    if (!indexes.missions.size || ![...indexes.missions.values()].some(mission => (
      (mission.missionType || mission.objectiveType || 'DELIVERY') === objective
    ))) {
      failData(`references activity template ${objective} with no authored mission.`, {
        source: 'mvp-scope', recordId: 'activityTemplates', field: `[${index}]`, code: 'MISSING_REFERENCE'
      });
    }
  }
  for (const [index, districtId] of scope.worldFootprint.entries()) {
    assertKnownReference(districtId, indexes.districts, {
      source: 'mvp-scope', recordId: 'worldFootprint', field: `[${index}]`
    }, CONTENT_TYPES.DISTRICT);
  }
  for (const [zoneId, label] of Object.entries(scope.zoneLabels)) {
    const definition = indexes.zones.get(zoneId);
    if (!definition) {
      failData(`references missing zone ${zoneId}.`, {
        source: 'mvp-scope', recordId: 'zoneLabels', field: zoneId, code: 'MISSING_REFERENCE'
      });
    }
    if (definition.label !== label) {
      failData(`label ${label} disagrees with zone label ${definition.label}.`, {
        source: 'mvp-scope', recordId: 'zoneLabels', field: zoneId
      });
    }
  }
  return objectives;
}

export const PRODUCTION_GAME_DATA = Object.freeze({
  missions,
  buildings: BUILDING_CATALOG,
  buildingCategories: BUILDING_CATEGORIES,
  zones: ZONE_DEFINITIONS,
  districts: DISTRICT_DEFINITIONS,
  factions: FACTION_DEFINITIONS,
  progression: PROGRESSION_DEFINITIONS,
  weather: Object.values(WEATHER_DEFINITIONS),
  defaultWeather: DEFAULT_WEATHER_MODE,
  vehicleIds: VEHICLE_CONTENT_IDS,
  scope: Object.freeze({
    missionIds: MVP_MISSION_IDS,
    activityTemplates: MVP_ACTIVITY_TEMPLATES,
    worldFootprint: MVP_WORLD_FOOTPRINT,
    zoneLabels: MVP_ZONE_LABELS
  })
});

export function validateGameData(sources = PRODUCTION_GAME_DATA) {
  assertRecord(sources, { source: 'game-data' });
  const districts = validateDistricts(sources.districts);
  const zones = validateZones(sources.zones);
  const buildingCategories = validateBuildingCategories(sources.buildingCategories);
  const buildings = validateBuildings(sources.buildings, buildingCategories);
  const factions = validateFactions(sources.factions);
  const progression = validateProgression(sources.progression);
  const weather = validateWeather(sources.weather, sources.defaultWeather);
  if (!Array.isArray(sources.vehicleIds) || sources.vehicleIds.length === 0) {
    failData('must be a non-empty array.', { source: 'vehicle-content' });
  }
  const vehicleIds = new Set();
  sources.vehicleIds.forEach((vehicleId, index) => {
    const id = assertString(vehicleId, {
      source: 'vehicle-content', recordId: index, field: 'id'
    }, { stableId: true });
    if (vehicleIds.has(id)) {
      failData(`duplicates stable vehicle content ID ${id}.`, {
        source: 'vehicle-content', recordId: id, field: 'id', code: 'DUPLICATE_ID'
      });
    }
    vehicleIds.add(id);
  });
  validateMissionData(sources.missions, {
    districtIndex: districts,
    vehicleIds,
    weatherIds: new Set(Object.keys(WEATHER_DEFINITIONS))
  });
  const missionIndex = new Map(sources.missions.map(mission => [mission.id, mission]));

  const indexes = {
    missions: missionIndex,
    buildings,
    zones,
    districts,
    factions,
    progression,
    weather
  };
  validateScope(sources.scope, indexes);

  const dialogueNodes = new Map();
  for (const mission of sources.missions) {
    for (const [nodeId, node] of Object.entries(mission.dialogueTree)) {
      dialogueNodes.set(`${mission.id}:${nodeId}`, node);
    }
  }
  return new ContentRegistry(indexes, dialogueNodes);
}

let productionRegistry = null;

export function getProductionContentRegistry() {
  productionRegistry ||= validateGameData(PRODUCTION_GAME_DATA);
  return productionRegistry;
}

export { DataValidationError };

export default validateGameData;
