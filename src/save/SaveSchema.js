import { normalizeZoneId } from '../world/ConstructionVocabulary.js';

export const SAVE_FORMAT = 'METROPULSE_3D_SAVE';
export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_FEATURE_VERSION = 2;
export const LEGACY_LOCAL_STORAGE_SAVE_KEY = 'metropulse3d:city-session:v1';

export const SAVE_SLOTS = Object.freeze({
  CURRENT: 'current',
  RECOVERY: 'recovery'
});

export const INTENTIONALLY_TRANSIENT_STATE = Object.freeze([
  'renderer and GPU resources',
  'physics contacts and solver caches',
  'particles, explosions, comets, and temporary visual effects',
  'ambient traffic and pedestrian AI internals',
  'held input and pointer state',
  'open DOM modals, focus, hover, and animation state',
  'audio playback cursors and transient sounds',
  'in-flight mode transitions and scheduler accumulators'
]);

const REQUIRED_DOMAINS = Object.freeze([
  'game',
  'economy',
  'world',
  'player',
  'timeWeather',
  'missions',
  'factions',
  'progression',
  'heat',
  'settings',
  'bindings',
  'alerts'
]);

export class SaveValidationError extends Error {
  constructor(message, { code = 'INVALID_SAVE', path = null } = {}) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'SaveValidationError';
    this.code = code;
    this.path = path;
    this.userMessage = code === 'FUTURE_SAVE_VERSION'
      ? 'This city was saved by a newer MetroPulse version and cannot be opened safely here.'
      : path
        ? `This city save was not applied because ${path} ${message}`
        : `This city save is incomplete or damaged and was not applied (${message})`;
  }
}

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SaveValidationError('must be an object.', { path });
  }
  return value;
}

function assertIsoDate(value, path) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new SaveValidationError('must be an ISO date.', { path });
  }
  return value;
}

function clone(value) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new SaveValidationError(`contains non-serializable data (${error?.message || 'clone failed'}).`);
  }
}

function migrateSchema0(document) {
  return {
    ...document,
    schemaVersion: 1,
    metadata: {
      ...document.metadata,
      migratedFromSchema: 0
    }
  };
}

function normalizePersistedZoneIds(data) {
  const normalize = zone => {
    if (!zone || typeof zone !== 'object') return zone;
    const field = 'zoneType' in zone ? 'zoneType' : 'type';
    const normalized = normalizeZoneId(zone[field]);
    return normalized ? { ...zone, [field]: normalized } : zone;
  };
  return {
    ...data,
    world: data.world ? {
      ...data.world,
      zones: (data.world.zones || []).map(normalize)
    } : data.world,
    economy: data.economy ? {
      ...data.economy,
      buildings: (data.economy.buildings || []).map(building => ({
        ...building,
        kind: normalizeZoneId(building?.kind) || building?.kind
      })),
      zones: (data.economy.zones || []).map(normalize)
    } : data.economy
  };
}

function migrateSchema1(document) {
  return {
    ...document,
    schemaVersion: 2,
    featureVersion: Math.max(2, document.featureVersion || 1),
    metadata: {
      ...document.metadata,
      migrationHistory: [
        ...(document.metadata?.migrationHistory || []),
        'P4.1_ZONE_VOCABULARY'
      ]
    },
    data: normalizePersistedZoneIds(document.data)
  };
}

export const SAVE_MIGRATIONS = Object.freeze(new Map([
  [0, migrateSchema0],
  [1, migrateSchema1]
]));

export function migrateSaveDocument(input) {
  let document = clone(assertRecord(input, 'save'));
  if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 0) {
    throw new SaveValidationError('schemaVersion must be a non-negative integer.', {
      path: 'save.schemaVersion'
    });
  }
  if (document.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SaveValidationError(
      `schema ${document.schemaVersion} is newer than supported schema ${SAVE_SCHEMA_VERSION}.`,
      { code: 'FUTURE_SAVE_VERSION', path: 'save.schemaVersion' }
    );
  }
  while (document.schemaVersion < SAVE_SCHEMA_VERSION) {
    const migrate = SAVE_MIGRATIONS.get(document.schemaVersion);
    if (!migrate) {
      throw new SaveValidationError(`no migration exists for schema ${document.schemaVersion}.`, {
        code: 'MIGRATION_UNAVAILABLE',
        path: 'save.schemaVersion'
      });
    }
    document = migrate(document);
  }
  return document;
}

export function validateSaveDocument(input, { validateDomains = null } = {}) {
  const document = migrateSaveDocument(input);
  if (document.format !== SAVE_FORMAT) {
    throw new SaveValidationError(`expected format ${SAVE_FORMAT}.`, { path: 'save.format' });
  }
  if (!Number.isInteger(document.featureVersion) || document.featureVersion < 1) {
    throw new SaveValidationError('must be a positive integer.', { path: 'save.featureVersion' });
  }
  const metadata = assertRecord(document.metadata, 'save.metadata');
  assertIsoDate(metadata.savedAt, 'save.metadata.savedAt');
  if (typeof metadata.saveId !== 'string' || !metadata.saveId.trim()) {
    throw new SaveValidationError('must be a non-empty string.', { path: 'save.metadata.saveId' });
  }
  if (typeof metadata.reason !== 'string' || !metadata.reason.trim()) {
    throw new SaveValidationError('must be a non-empty string.', { path: 'save.metadata.reason' });
  }
  if (!Array.isArray(metadata.reasons) || metadata.reasons.some(reason => typeof reason !== 'string')) {
    throw new SaveValidationError('must be an array of strings.', { path: 'save.metadata.reasons' });
  }
  const data = assertRecord(document.data, 'save.data');
  for (const domain of REQUIRED_DOMAINS) assertRecord(data[domain], `save.data.${domain}`);
  validateDomains?.(data);
  return Object.freeze(document);
}

export function createSaveDocument(data, {
  now = () => new Date(),
  idFactory = () => globalThis.crypto?.randomUUID?.() || `save-${Date.now()}`,
  reason = 'manual',
  reasons = [reason],
  checkpoint = null
} = {}) {
  const savedAt = now().toISOString();
  return validateSaveDocument({
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    featureVersion: SAVE_FEATURE_VERSION,
    metadata: {
      saveId: idFactory(),
      savedAt,
      reason,
      reasons: [...new Set(reasons)],
      checkpoint
    },
    data
  });
}

export function convertLegacyV1Save(legacy) {
  assertRecord(legacy, 'legacy save');
  if (legacy.version !== 1) {
    throw new SaveValidationError(`unsupported LocalStorage version ${String(legacy.version)}.`, {
      code: 'UNSUPPORTED_LEGACY_SAVE',
      path: 'legacy save.version'
    });
  }
  const savedAt = typeof legacy.savedAt === 'string' && Number.isFinite(Date.parse(legacy.savedAt))
    ? legacy.savedAt
    : new Date(0).toISOString();
  return validateSaveDocument({
    format: SAVE_FORMAT,
    schemaVersion: SAVE_SCHEMA_VERSION,
    featureVersion: SAVE_FEATURE_VERSION,
    metadata: {
      saveId: `legacy-v1-${savedAt}`,
      savedAt,
      reason: 'legacy-migration',
      reasons: ['legacy-migration'],
      checkpoint: null,
      migratedFrom: 'localStorage-v1'
    },
    data: normalizePersistedZoneIds({
      game: { version: 1, state: 'MANAGEMENT', resumeState: null, mayhemEnabled: Boolean(legacy.settings?.mayhem) },
      economy: legacy.economy,
      world: legacy.world,
      player: { version: 1, controlled: null },
      timeWeather: {
        version: 1,
        time: legacy.settings?.time ?? 8,
        playing: legacy.settings?.timePlaying ?? true,
        speed: legacy.settings?.timeSpeed ?? 10,
        weather: legacy.settings?.weather ?? 'clear'
      },
      missions: {
        version: 1,
        completedMissionIds: [],
        dialogueChoices: [],
        chronologyStep: 0,
        runCounts: [],
        ...(legacy.mission || {}),
        active: null
      },
      factions: { version: 1, values: {} },
      progression: { version: 1, values: {} },
      heat: { version: 1, wanted: false, escapeTimer: 0, activeIncidentId: null },
      settings: {
        version: 1,
        values: structuredClone(legacy.settings || {}),
        heatmap: Boolean(legacy.settings?.heatmap)
      },
      bindings: { version: 1, overrides: {} },
      alerts: { version: 1, items: [] }
    })
  });
}

export function inspectSaveDocument(value, slot = SAVE_SLOTS.CURRENT, { validateDomains = null } = {}) {
  if (value == null) {
    return Object.freeze({ slot, source: 'indexedDB', present: false, valid: false, savedAt: null, reason: null, document: null });
  }
  try {
    const document = validateSaveDocument(value, { validateDomains });
    return Object.freeze({
      slot,
      source: 'indexedDB',
      present: true,
      valid: true,
      savedAt: document.metadata.savedAt,
      reason: null,
      document
    });
  } catch (error) {
    return Object.freeze({
      slot,
      source: 'indexedDB',
      present: true,
      valid: false,
      savedAt: null,
      reason: error?.userMessage || error?.message || String(error),
      document: null
    });
  }
}
