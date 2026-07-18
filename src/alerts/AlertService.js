const ALERT_STATE_VERSION = 2;

export const ALERT_TYPES = Object.freeze({
  SYSTEM: 'SYSTEM',
  MISSION: 'MISSION',
  CRIME: 'CRIME',
  TRAFFIC: 'TRAFFIC',
  ECONOMY: 'ECONOMY',
  INFRASTRUCTURE: 'INFRASTRUCTURE',
  CONSTRUCTION: 'CONSTRUCTION',
  WEATHER: 'WEATHER',
  CONTROL: 'CONTROL'
});

export const ALERT_SEVERITIES = Object.freeze({
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL'
});

export const ALERT_STATES = Object.freeze({
  ACTIVE: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  SUPERSEDED: 'SUPERSEDED'
});

export const ALERT_DURATION_KINDS = Object.freeze({
  TIMED: 'TIMED',
  UNTIL_RESOLVED: 'UNTIL_RESOLVED',
  PERSISTENT: 'PERSISTENT'
});

export const ALERT_FOCUS_ACTIONS = Object.freeze({
  NONE: 'NONE',
  MANAGEMENT_CAMERA: 'MANAGEMENT_CAMERA',
  STREET_WAYPOINT: 'STREET_WAYPOINT'
});

const SEVERITIES = new Set(Object.values(ALERT_SEVERITIES));
const STATES = new Set(Object.values(ALERT_STATES));
const DURATION_KINDS = new Set(Object.values(ALERT_DURATION_KINDS));
const FOCUS_ACTIONS = new Set(Object.values(ALERT_FOCUS_ACTIONS));
const SEVERITY_RANK = Object.freeze({ INFO: 0, SUCCESS: 1, WARNING: 2, CRITICAL: 3 });

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function optionalString(value, label) {
  if (value == null) return null;
  return nonEmptyString(value, label);
}

function isoTime(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} must be a valid date`);
  return date.toISOString();
}

function normalizePosition(value, label = 'position') {
  if (value == null) return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.z)) {
    throw new TypeError(`${label} requires finite x and z coordinates`);
  }
  return Object.freeze({ x: value.x, y: Number.isFinite(value.y) ? value.y : 0, z: value.z });
}

function normalizeLocation(value) {
  if (typeof value === 'string') {
    return Object.freeze({ label: nonEmptyString(value, 'alert.location'), districtId: null, position: null });
  }
  const source = value || {};
  return Object.freeze({
    label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : 'Citywide',
    districtId: optionalString(source.districtId, 'alert.location.districtId'),
    position: normalizePosition(source.position, 'alert.location.position')
  });
}

function normalizeDuration(value) {
  const source = value || { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED };
  const kind = source.kind || ALERT_DURATION_KINDS.UNTIL_RESOLVED;
  if (!DURATION_KINDS.has(kind)) throw new RangeError(`Unsupported alert duration: ${String(kind)}`);
  const seconds = kind === ALERT_DURATION_KINDS.TIMED ? Number(source.seconds) : null;
  if (kind === ALERT_DURATION_KINDS.TIMED && (!Number.isFinite(seconds) || seconds <= 0)) {
    throw new RangeError('Timed alerts require a positive duration in seconds');
  }
  return Object.freeze({ kind, seconds });
}

function normalizeFocusAction(value, location) {
  const source = typeof value === 'string' ? { type: value } : (value || {});
  const type = source.type || ALERT_FOCUS_ACTIONS.NONE;
  if (!FOCUS_ACTIONS.has(type)) throw new RangeError(`Unsupported alert focus action: ${String(type)}`);
  const position = normalizePosition(source.position || location.position, 'alert.focusAction.position');
  if (type !== ALERT_FOCUS_ACTIONS.NONE && !position) {
    throw new TypeError(`${type} alert actions require a world position`);
  }
  return Object.freeze({
    type,
    label: type === ALERT_FOCUS_ACTIONS.NONE
      ? null
      : (optionalString(source.label, 'alert.focusAction.label')
        || (type === ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA ? 'Focus camera' : 'Set waypoint')),
    position
  });
}

function normalizeRelatedIds(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('alert.relatedEntityIds must be an array');
  return Object.freeze([...new Set(value.map((id, index) => nonEmptyString(id, `alert.relatedEntityIds[${index}]`)))]);
}

function normalizeType(value) {
  const type = nonEmptyString(value || ALERT_TYPES.SYSTEM, 'alert.type').toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(type)) throw new TypeError('alert.type must be a stable uppercase token');
  return type;
}

function normalizeInput(input, { now, idFactory, existing = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('alert must be an object');
  if (input.version != null && input.version !== 1) {
    throw new RangeError(`Unsupported alert record version: ${String(input.version)}`);
  }
  const observedAt = isoTime(input.lastObservedAt || now(), 'alert.lastObservedAt');
  const location = normalizeLocation(input.location);
  const severity = String(input.severity || ALERT_SEVERITIES.INFO).toUpperCase();
  if (!SEVERITIES.has(severity)) throw new RangeError(`Unsupported alert severity: ${String(input.severity)}`);
  const state = String(input.state || ALERT_STATES.ACTIVE).toUpperCase();
  if (!STATES.has(state)) throw new RangeError(`Unsupported alert state: ${String(input.state)}`);
  const id = nonEmptyString(existing?.id || input.id || idFactory(), 'alert.id');
  const startTime = isoTime(existing?.startTime || input.startTime || observedAt, 'alert.startTime');
  const title = nonEmptyString(input.title || input.cause, 'alert.title');
  const cause = nonEmptyString(input.cause || title, 'alert.cause');
  const recommendation = nonEmptyString(input.recommendation || 'Monitor conditions and review City Tools for available actions.', 'alert.recommendation');
  const duration = normalizeDuration(input.duration || existing?.duration);
  const resolvedAt = state === ALERT_STATES.ACTIVE
    ? null
    : isoTime(input.resolvedAt || observedAt, 'alert.resolvedAt');

  return freeze({
    version: 1,
    id,
    dedupeKey: nonEmptyString(input.dedupeKey || existing?.dedupeKey || id, 'alert.dedupeKey'),
    type: normalizeType(input.type),
    severity,
    title,
    cause,
    location,
    startTime,
    lastObservedAt: observedAt,
    duration,
    state,
    recommendation,
    relatedEntityIds: normalizeRelatedIds(input.relatedEntityIds),
    focusAction: normalizeFocusAction(input.focusAction, location),
    occurrences: Number.isInteger(input.occurrences) && input.occurrences > 0
      ? input.occurrences
      : ((existing?.occurrences || 0) + 1),
    resolvedAt,
    resolutionReason: state === ALERT_STATES.ACTIVE
      ? null
      : (optionalString(input.resolutionReason, 'alert.resolutionReason') || 'Condition ended'),
    supersededBy: state === ALERT_STATES.SUPERSEDED
      ? nonEmptyString(input.supersededBy, 'alert.supersededBy')
      : null
  });
}

function compareAlerts(left, right) {
  const activeDifference = Number(right.state === ALERT_STATES.ACTIVE) - Number(left.state === ALERT_STATES.ACTIVE);
  if (activeDifference) return activeDifference;
  const severityDifference = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
  if (severityDifference) return severityDifference;
  return Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt);
}

function legacyType(message) {
  if (/police|crime|arrest|hit-and-run|assault/i.test(message)) return ALERT_TYPES.CRIME;
  if (/traffic|vehicle|motorbike|lane|bridge/i.test(message)) return ALERT_TYPES.TRAFFIC;
  if (/build|structure|parcel|zone|editor/i.test(message)) return ALERT_TYPES.CONSTRUCTION;
  if (/mission|result|payout/i.test(message)) return ALERT_TYPES.MISSION;
  if (/capital|market|valuation|cash|economy/i.test(message)) return ALERT_TYPES.ECONOMY;
  if (/weather|rain|storm|mist/i.test(message)) return ALERT_TYPES.WEATHER;
  return ALERT_TYPES.SYSTEM;
}

function stripDecorativePrefix(message) {
  return message.replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

export function createLegacyAlertInput(message, level = 'info', context = {}) {
  const cause = nonEmptyString(message, 'alert message');
  const severity = {
    info: ALERT_SEVERITIES.INFO,
    success: ALERT_SEVERITIES.SUCCESS,
    warn: ALERT_SEVERITIES.WARNING,
    warning: ALERT_SEVERITIES.WARNING,
    danger: ALERT_SEVERITIES.CRITICAL,
    critical: ALERT_SEVERITIES.CRITICAL
  }[String(level).toLowerCase()] || ALERT_SEVERITIES.INFO;
  const title = stripDecorativePrefix(context.title || cause).slice(0, 96);
  const type = context.type || legacyType(cause);
  const dedupeText = stripDecorativePrefix(cause).toLowerCase().replace(/\d+/g, '#').replace(/[^a-z#]+/g, '-').replace(/^-|-$/g, '');
  return {
    ...context,
    type,
    severity,
    title,
    cause: context.cause || cause,
    location: context.location || 'Citywide',
    duration: context.duration || { kind: ALERT_DURATION_KINDS.TIMED, seconds: 120 },
    recommendation: context.recommendation || (severity === ALERT_SEVERITIES.CRITICAL
      ? 'Move to safety and use the alert action for situational guidance.'
      : 'No immediate intervention is required; monitor City Tools for changes.'),
    relatedEntityIds: context.relatedEntityIds || [],
    focusAction: context.focusAction || { type: ALERT_FOCUS_ACTIONS.NONE },
    dedupeKey: context.dedupeKey || `legacy:${type}:${dedupeText}`
  };
}

export function validateAlertState(value, { allowLegacy = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('alert state must be an object');
  if (value.version === 1 && allowLegacy) {
    if (!Array.isArray(value.items)) throw new TypeError('legacy alert state items must be an array');
    value.items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || typeof item.message !== 'string' || typeof item.type !== 'string') {
        throw new TypeError(`legacy alert state item ${index} requires message and type strings`);
      }
    });
    return true;
  }
  if (value.version !== ALERT_STATE_VERSION) throw new RangeError(`Unsupported alert state version: ${String(value.version)}`);
  if (!Number.isInteger(value.sequence) || value.sequence < 0) throw new RangeError('alert state sequence must be non-negative');
  if (!Array.isArray(value.items)) throw new TypeError('alert state items must be an array');
  const ids = new Set();
  const dedupeKeys = new Set();
  for (const item of value.items) {
    const normalized = normalizeInput(item, {
      now: () => item.lastObservedAt || item.startTime,
      idFactory: () => item.id
    });
    if (ids.has(normalized.id)) throw new Error(`Duplicate alert ID: ${normalized.id}`);
    ids.add(normalized.id);
    if (normalized.state === ALERT_STATES.ACTIVE && dedupeKeys.has(normalized.dedupeKey)) {
      throw new Error(`Duplicate active alert key: ${normalized.dedupeKey}`);
    }
    if (normalized.state === ALERT_STATES.ACTIVE) dedupeKeys.add(normalized.dedupeKey);
  }
  return true;
}

export class AlertService {
  #records = new Map();
  #listeners = new Set();
  #sequence = 0;
  #idSequence = 0;

  constructor({
    now = () => new Date(),
    idFactory = null,
    maxRecords = 100
  } = {}) {
    if (typeof now !== 'function') throw new TypeError('AlertService now must be a function');
    if (!Number.isInteger(maxRecords) || maxRecords < 10) throw new RangeError('AlertService maxRecords must be at least 10');
    this.now = now;
    this.maxRecords = maxRecords;
    this.idFactory = idFactory || (() => `alert-${++this.#idSequence}`);
  }

  publish(input) {
    const requestedKey = input?.dedupeKey || input?.id || null;
    const sameId = input?.id ? this.#records.get(input.id) : null;
    if (sameId && sameId.state !== ALERT_STATES.ACTIVE) {
      throw new Error(`Cannot reuse inactive alert ID: ${input.id}`);
    }
    const existing = sameId || (requestedKey
      ? [...this.#records.values()].find(record => record.state === ALERT_STATES.ACTIVE && record.dedupeKey === requestedKey)
      : null);
    if (sameId && input.dedupeKey && input.dedupeKey !== sameId.dedupeKey) {
      throw new Error(`Alert ID ${input.id} cannot change its dedupe key`);
    }
    const record = normalizeInput(input, {
      now: this.now,
      idFactory: this.idFactory,
      existing
    });
    if (!existing && this.#records.has(record.id)) throw new Error(`Duplicate alert ID: ${record.id}`);

    this.#records.set(record.id, record);
    for (const target of input.supersedes || []) {
      const prior = this.find(target);
      if (prior?.state === ALERT_STATES.ACTIVE && prior.id !== record.id) {
        this.#replaceState(prior, ALERT_STATES.SUPERSEDED, `Superseded by ${record.title}`, record.id);
      }
    }
    this.#trimHistory();
    this.#notify({ type: existing ? 'UPDATED' : 'PUBLISHED', alert: record });
    return record;
  }

  publishLegacy(message, level = 'info', context = {}) {
    return this.publish(createLegacyAlertInput(message, level, context));
  }

  find(idOrDedupeKey) {
    if (typeof idOrDedupeKey !== 'string') return null;
    return this.#records.get(idOrDedupeKey)
      || [...this.#records.values()].find(record => record.dedupeKey === idOrDedupeKey && record.state === ALERT_STATES.ACTIVE)
      || null;
  }

  resolve(idOrDedupeKey, reason = 'Condition resolved') {
    const record = this.find(idOrDedupeKey);
    if (!record || record.state !== ALERT_STATES.ACTIVE) return null;
    const resolved = this.#replaceState(record, ALERT_STATES.RESOLVED, reason, null);
    this.#notify({ type: 'RESOLVED', alert: resolved });
    return resolved;
  }

  expire(at = this.now()) {
    const timestamp = Date.parse(isoTime(at, 'alert expiry time'));
    const expired = [];
    for (const record of this.#records.values()) {
      if (record.state !== ALERT_STATES.ACTIVE || record.duration.kind !== ALERT_DURATION_KINDS.TIMED) continue;
      if (timestamp < Date.parse(record.lastObservedAt) + record.duration.seconds * 1000) continue;
      const resolved = this.#replaceState(record, ALERT_STATES.RESOLVED, 'Timed notification ended', null, at);
      expired.push(resolved);
    }
    if (expired.length > 0) this.#notify({ type: 'EXPIRED', alerts: expired });
    return Object.freeze(expired);
  }

  snapshot() {
    const items = [...this.#records.values()].sort(compareAlerts).map(clone);
    return freeze({
      version: ALERT_STATE_VERSION,
      revision: this.#sequence,
      items,
      active: items.filter(item => item.state === ALERT_STATES.ACTIVE)
    });
  }

  serialize() {
    return {
      version: ALERT_STATE_VERSION,
      sequence: this.#sequence,
      items: [...this.#records.values()].map(clone)
    };
  }

  restore(value) {
    validateAlertState(value);
    this.#records.clear();
    this.#sequence = 0;
    this.#idSequence = 0;
    if (value.version === 1) {
      for (const item of [...value.items].reverse()) {
        this.publishLegacy(item.message, item.type, {
          startTime: Number.isFinite(Date.parse(item.time)) ? item.time : undefined
        });
      }
    } else {
      for (const item of value.items) {
        const record = normalizeInput(item, {
          now: () => item.lastObservedAt,
          idFactory: () => item.id
        });
        this.#records.set(record.id, record);
        const match = /^alert-(\d+)$/.exec(record.id);
        if (match) this.#idSequence = Math.max(this.#idSequence, Number(match[1]));
      }
      this.#sequence = value.sequence;
      this.#trimHistory();
      this.#notify({ type: 'RESTORED' }, { increment: false });
    }
    return this.snapshot();
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('alert listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(freeze({ type: 'SNAPSHOT', current: this.snapshot() }));
    return () => this.#listeners.delete(listener);
  }

  destroy() {
    this.#listeners.clear();
  }

  #replaceState(record, state, reason, supersededBy = null, at = this.now()) {
    const replacement = freeze({
      ...clone(record),
      state,
      resolvedAt: isoTime(at, 'alert resolution time'),
      resolutionReason: nonEmptyString(reason, 'alert resolution reason'),
      supersededBy
    });
    this.#records.set(record.id, replacement);
    return replacement;
  }

  #trimHistory() {
    if (this.#records.size <= this.maxRecords) return;
    const removable = [...this.#records.values()]
      .filter(record => record.state !== ALERT_STATES.ACTIVE)
      .sort((left, right) => Date.parse(left.lastObservedAt) - Date.parse(right.lastObservedAt));
    while (this.#records.size > this.maxRecords && removable.length > 0) {
      this.#records.delete(removable.shift().id);
    }
  }

  #notify(detail, { increment = true } = {}) {
    if (increment) this.#sequence += 1;
    const event = freeze({ ...detail, current: this.snapshot() });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('AlertService listener failed.', error);
      }
    }
  }
}
