export const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*$/;

export class DataValidationError extends Error {
  constructor(message, {
    code = 'INVALID_GAME_DATA',
    source,
    recordId = null,
    field = null
  } = {}) {
    const record = recordId == null ? '' : `[${recordId}]`;
    const path = `${source || 'game-data'}${record}${field ? `.${field}` : ''}`;
    super(`${path}: ${message}`);
    this.name = 'DataValidationError';
    this.code = code;
    this.source = source || 'game-data';
    this.recordId = recordId;
    this.field = field;
    this.path = path;
    this.userMessage = `MetroPulse found invalid authored data in ${path}. ${message}`;
    this.actions = Object.freeze([
      'Correct the identified source record and field, then reload MetroPulse.'
    ]);
  }
}

export function failData(message, details) {
  throw new DataValidationError(message, details);
}

export function assertRecord(value, details) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failData('must be an object.', details);
  }
  return value;
}

export function assertString(value, details, { stableId = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    failData(stableId ? 'requires a stable non-empty ID.' : 'must be a non-empty string.', details);
  }
  const normalized = value.trim();
  if (stableId && !STABLE_ID_PATTERN.test(normalized)) {
    failData('must be a stable ID containing only letters, numbers, underscores, or hyphens.', details);
  }
  return normalized;
}

export function assertFinite(value, details, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    const range = Number.isFinite(min) || Number.isFinite(max)
      ? ` in the range ${String(min)}..${String(max)}`
      : '';
    failData(`must be a finite number${range}.`, details);
  }
  return value;
}

export function assertEnum(value, allowed, details) {
  if (!allowed.has(value)) {
    failData(`uses invalid enum value ${String(value)}; expected one of ${[...allowed].join(', ')}.`, {
      ...details,
      code: 'INVALID_ENUM'
    });
  }
  return value;
}

export function indexUniqueRecords(records, source, validateRecord) {
  if (!Array.isArray(records) || records.length === 0) {
    failData('must be a non-empty array.', { source });
  }
  const index = new Map();
  records.forEach((record, position) => {
    assertRecord(record, { source, recordId: position });
    const id = assertString(record.id, {
      source,
      recordId: position,
      field: 'id'
    }, { stableId: true });
    if (index.has(id)) {
      failData(`duplicates stable ID ${id}.`, {
        source,
        recordId: id,
        field: 'id',
        code: 'DUPLICATE_ID'
      });
    }
    validateRecord?.(record, id, position);
    index.set(id, record);
  });
  return index;
}

export function assertKnownReference(id, index, details, targetSource) {
  const stableId = assertString(id, details, { stableId: true });
  if (!index.has(stableId)) {
    failData(`references missing ${targetSource} record ${stableId}.`, {
      ...details,
      code: 'MISSING_REFERENCE'
    });
  }
  return stableId;
}

export function assertAcyclicPrerequisites(index, source, field = 'prerequisiteIds') {
  const visited = new Set();
  const active = new Set();

  const visit = (id, ancestry = []) => {
    if (active.has(id)) {
      const cycle = [...ancestry.slice(ancestry.indexOf(id)), id].join(' -> ');
      failData(`contains circular prerequisites (${cycle}).`, {
        source,
        recordId: id,
        field,
        code: 'CIRCULAR_REFERENCE'
      });
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const prerequisiteId of index.get(id)[field]) {
      visit(prerequisiteId, [...ancestry, id]);
    }
    active.delete(id);
    visited.add(id);
  };

  for (const id of index.keys()) visit(id);
}

