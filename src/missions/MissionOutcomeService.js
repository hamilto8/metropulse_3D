import { CONTENT_TYPES } from '../data/GameDataValidator.js';
import { SERVICE_TYPES } from '../systems/EconomySystem.js';
import {
  assertBoolean,
  assertFiniteNumber,
  assertId,
  assertRecord,
  clamp,
  clone,
  deepFreeze,
  optionalString,
  stableStringify
} from './ContractUtils.js';

export const MISSION_OUTCOME_STATE_VERSION = 1;

export const OUTCOME_SOURCE_KINDS = Object.freeze({
  MISSION: 'MISSION',
  MANAGEMENT: 'MANAGEMENT',
  SYSTEM: 'SYSTEM',
  MIGRATION: 'MIGRATION'
});

export const MISSION_OUTCOME_COMMANDS = Object.freeze({
  CAPITAL_ADJUSTED: 'CAPITAL_ADJUSTED',
  BUILDING_STATE_SET: 'BUILDING_STATE_SET',
  INFRASTRUCTURE_STATE_SET: 'INFRASTRUCTURE_STATE_SET',
  INCIDENT_RECORDED: 'INCIDENT_RECORDED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  REPAIR_SET: 'REPAIR_SET',
  SERVICE_OUTAGE_SET: 'SERVICE_OUTAGE_SET',
  TRAFFIC_SET: 'TRAFFIC_SET',
  FACTION_REPUTATION_ADJUSTED: 'FACTION_REPUTATION_ADJUSTED',
  PROGRESSION_SET: 'PROGRESSION_SET',
  UNLOCK_SET: 'UNLOCK_SET',
  NEWS_PUBLISHED: 'NEWS_PUBLISHED',
  FOLLOW_UP_MISSION_SET: 'FOLLOW_UP_MISSION_SET',
  AUTHORED_FLAG_SET: 'AUTHORED_FLAG_SET'
});

export const REPAIR_STATUSES = Object.freeze(['NOT_STARTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED']);
export const ACCESS_STATES = Object.freeze(['OPEN', 'RESTRICTED', 'CLOSED']);
export const FOLLOW_UP_STATUSES = Object.freeze(['LOCKED', 'AVAILABLE', 'COMPLETED', 'FAILED', 'EXPIRED']);

const SOURCE_KINDS = new Set(Object.values(OUTCOME_SOURCE_KINDS));
const SERVICE_NAMES = new Set(Object.values(SERVICE_TYPES));

export class OutcomeConflictError extends Error {
  constructor(transactionId) {
    super(`Outcome transaction ${transactionId} was already applied with different content`);
    this.name = 'OutcomeConflictError';
    this.transactionId = transactionId;
  }
}

export class OutcomeApplicationError extends Error {
  constructor(message, { transactionId = null, commandIndex = null } = {}) {
    super(message);
    this.name = 'OutcomeApplicationError';
    this.transactionId = transactionId;
    this.commandIndex = commandIndex;
  }
}

function emptyState() {
  return {
    buildingStates: {},
    infrastructure: {},
    incidents: {},
    repairs: {},
    serviceOutages: {},
    traffic: {},
    factions: {},
    progression: {},
    unlocks: {},
    news: {},
    followUpMissions: {},
    flags: {}
  };
}

export function createEmptyMissionOutcomeState({ factions = {}, progression = {} } = {}) {
  assertRecord(factions, 'factions');
  assertRecord(progression, 'progression');
  return {
    version: MISSION_OUTCOME_STATE_VERSION,
    sequence: 0,
    state: {
      ...emptyState(),
      factions: clone(factions),
      progression: clone(progression)
    },
    transactions: []
  };
}

function enumValue(value, allowed, label, fallback) {
  const normalized = value == null ? fallback : assertId(value, label).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new RangeError(`${label} must be one of ${allowed.join(', ')}`);
  }
  return normalized;
}

function numberInRange(value, min, max, label, fallback) {
  const normalized = value == null ? fallback : assertFiniteNumber(value, label);
  if (normalized == null) throw new TypeError(`${label} must be a finite number`);
  if (normalized < min || normalized > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}`);
  }
  return normalized;
}

function normalizeSource(source) {
  assertRecord(source, 'outcome.source');
  const kind = assertId(source.kind, 'outcome.source.kind').toUpperCase();
  if (!SOURCE_KINDS.has(kind)) {
    throw new RangeError(`outcome.source.kind must be one of ${[...SOURCE_KINDS].join(', ')}`);
  }
  return {
    kind,
    contentId: assertId(source.contentId, 'outcome.source.contentId'),
    outcome: optionalString(source.outcome, 'outcome.source.outcome'),
    runId: optionalString(source.runId, 'outcome.source.runId'),
    actorId: optionalString(source.actorId, 'outcome.source.actorId'),
    reason: optionalString(source.reason, 'outcome.source.reason')
  };
}

function normalizeSummary(summary, source) {
  if (summary == null) {
    return {
      title: `${source.kind.toLowerCase()} outcome`,
      description: source.reason || `Outcome from ${source.contentId}`
    };
  }
  assertRecord(summary, 'outcome.summary');
  return {
    title: assertId(summary.title, 'outcome.summary.title'),
    description: assertId(summary.description, 'outcome.summary.description')
  };
}

function recordEffect(type, subjectId, before, after, explanation) {
  return { type, subjectId, before: clone(before), after: clone(after), explanation };
}

function setRecord(state, collection, id, value, type, explanation) {
  const before = state[collection][id] ?? null;
  state[collection][id] = value;
  return recordEffect(type, id, before, value, explanation);
}

function normalizeCommand(command, index, context) {
  assertRecord(command, `outcome.commands[${index}]`);
  const type = assertId(command.type, `outcome.commands[${index}].type`).toUpperCase();
  if (!Object.hasOwn(MISSION_OUTCOME_COMMANDS, type)) {
    throw new RangeError(`Unsupported mission outcome command: ${type}`);
  }
  const commandId = optionalString(command.commandId, `outcome.commands[${index}].commandId`, `command-${index + 1}`);
  const reason = optionalString(command.reason, `outcome.commands[${index}].reason`);
  const base = { type, commandId, reason };

  switch (type) {
    case MISSION_OUTCOME_COMMANDS.CAPITAL_ADJUSTED:
      return { ...base, amount: assertFiniteNumber(command.amount, `${type}.amount`) };
    case MISSION_OUTCOME_COMMANDS.BUILDING_STATE_SET: {
      const buildingId = assertId(command.buildingId, `${type}.buildingId`);
      const state = assertId(command.state, `${type}.state`).toUpperCase();
      if (context.economySystem?.getBuilding && !context.economySystem.getBuilding(buildingId)) {
        throw new RangeError(`Unknown economy building: ${buildingId}`);
      }
      return {
        ...base,
        buildingId,
        state,
        operational: command.operational == null
          ? state === 'ACTIVE'
          : assertBoolean(command.operational, `${type}.operational`)
      };
    }
    case MISSION_OUTCOME_COMMANDS.INFRASTRUCTURE_STATE_SET:
      return {
        ...base,
        infrastructureId: assertId(command.infrastructureId, `${type}.infrastructureId`),
        districtId: context.knownDistrict(command.districtId, `${type}.districtId`, true),
        state: assertId(command.state, `${type}.state`).toUpperCase(),
        access: enumValue(command.access, ACCESS_STATES, `${type}.access`, 'OPEN'),
        condition: numberInRange(command.condition, 0, 1, `${type}.condition`, 1),
        safety: numberInRange(command.safety, 0, 1, `${type}.safety`, 1)
      };
    case MISSION_OUTCOME_COMMANDS.INCIDENT_RECORDED:
      return {
        ...base,
        incidentId: assertId(command.incidentId, `${type}.incidentId`),
        incidentType: assertId(command.incidentType ?? 'GENERAL', `${type}.incidentType`).toUpperCase(),
        districtId: context.knownDistrict(command.districtId, `${type}.districtId`, true),
        severity: numberInRange(command.severity, 0, 10, `${type}.severity`, 1),
        active: true,
        happinessModifier: assertFiniteNumber(command.happinessModifier ?? 0, `${type}.happinessModifier`),
        landValueModifier: assertFiniteNumber(command.landValueModifier ?? 0, `${type}.landValueModifier`),
        position: command.position == null ? null : normalizePosition(command.position, `${type}.position`),
        influenceRadius: Math.max(0, assertFiniteNumber(command.influenceRadius ?? 0, `${type}.influenceRadius`))
      };
    case MISSION_OUTCOME_COMMANDS.INCIDENT_RESOLVED:
      return { ...base, incidentId: assertId(command.incidentId, `${type}.incidentId`) };
    case MISSION_OUTCOME_COMMANDS.REPAIR_SET:
      return {
        ...base,
        targetId: assertId(command.targetId, `${type}.targetId`),
        status: enumValue(command.status, REPAIR_STATUSES, `${type}.status`, 'NOT_STARTED'),
        progress: numberInRange(command.progress, 0, 1, `${type}.progress`, 0),
        estimatedCost: Math.max(0, assertFiniteNumber(command.estimatedCost ?? 0, `${type}.estimatedCost`))
      };
    case MISSION_OUTCOME_COMMANDS.SERVICE_OUTAGE_SET: {
      const service = assertId(command.service, `${type}.service`).toLowerCase();
      if (!SERVICE_NAMES.has(service)) throw new RangeError(`${type}.service must be power, water, or fire`);
      return {
        ...base,
        outageId: assertId(command.outageId, `${type}.outageId`),
        service,
        districtId: context.knownDistrict(command.districtId, `${type}.districtId`, true),
        active: command.active == null ? true : assertBoolean(command.active, `${type}.active`),
        severity: numberInRange(command.severity, 0, 1, `${type}.severity`, 1),
        coverageMultiplier: numberInRange(command.coverageMultiplier, 0, 1, `${type}.coverageMultiplier`, 0)
      };
    }
    case MISSION_OUTCOME_COMMANDS.TRAFFIC_SET:
      return {
        ...base,
        scopeId: assertId(command.scopeId, `${type}.scopeId`),
        districtId: context.knownDistrict(command.districtId, `${type}.districtId`, true),
        densityMultiplier: numberInRange(command.densityMultiplier, 0, 5, `${type}.densityMultiplier`, 1),
        access: enumValue(command.access, ACCESS_STATES, `${type}.access`, 'OPEN'),
        enforcement: numberInRange(command.enforcement, 0, 1, `${type}.enforcement`, 0.5),
        hazardLevel: numberInRange(command.hazardLevel, 0, 1, `${type}.hazardLevel`, 0)
      };
    case MISSION_OUTCOME_COMMANDS.FACTION_REPUTATION_ADJUSTED:
      return {
        ...base,
        factionId: context.knownContent(CONTENT_TYPES.FACTION, command.factionId, `${type}.factionId`),
        delta: assertFiniteNumber(command.delta, `${type}.delta`)
      };
    case MISSION_OUTCOME_COMMANDS.PROGRESSION_SET:
      return {
        ...base,
        progressionId: context.knownContent(CONTENT_TYPES.PROGRESSION, command.progressionId, `${type}.progressionId`),
        unlocked: command.unlocked == null ? true : assertBoolean(command.unlocked, `${type}.unlocked`)
      };
    case MISSION_OUTCOME_COMMANDS.UNLOCK_SET:
      return {
        ...base,
        unlockId: assertId(command.unlockId, `${type}.unlockId`),
        unlocked: command.unlocked == null ? true : assertBoolean(command.unlocked, `${type}.unlocked`)
      };
    case MISSION_OUTCOME_COMMANDS.NEWS_PUBLISHED:
      return {
        ...base,
        newsId: assertId(command.newsId, `${type}.newsId`),
        headline: assertId(command.headline, `${type}.headline`),
        body: assertId(command.body, `${type}.body`),
        priority: numberInRange(command.priority, 0, 3, `${type}.priority`, 1)
      };
    case MISSION_OUTCOME_COMMANDS.FOLLOW_UP_MISSION_SET:
      return {
        ...base,
        missionId: context.knownContent(CONTENT_TYPES.MISSION, command.missionId, `${type}.missionId`),
        status: enumValue(command.status, FOLLOW_UP_STATUSES, `${type}.status`, 'AVAILABLE')
      };
    case MISSION_OUTCOME_COMMANDS.AUTHORED_FLAG_SET:
      if (!['string', 'number', 'boolean'].includes(typeof command.value) && command.value !== null) {
        throw new TypeError(`${type}.value must be a string, number, boolean, or null`);
      }
      if (typeof command.value === 'number') assertFiniteNumber(command.value, `${type}.value`);
      return { ...base, flagId: assertId(command.flagId, `${type}.flagId`), value: command.value };
    default:
      throw new RangeError(`Unsupported mission outcome command: ${type}`);
  }
}

function normalizePosition(position, label) {
  assertRecord(position, label);
  return {
    x: assertFiniteNumber(position.x, `${label}.x`),
    z: assertFiniteNumber(position.z, `${label}.z`)
  };
}

function applyCommand(state, command, transactionId, context) {
  const source = { transactionId, commandId: command.commandId };
  const explanation = command.reason || context.defaultExplanation;
  switch (command.type) {
    case MISSION_OUTCOME_COMMANDS.CAPITAL_ADJUSTED: {
      const before = context.projectedCapital;
      context.projectedCapital += command.amount;
      return recordEffect(command.type, 'capital', before, context.projectedCapital, explanation);
    }
    case MISSION_OUTCOME_COMMANDS.BUILDING_STATE_SET:
      return setRecord(state, 'buildingStates', command.buildingId, {
        state: command.state, operational: command.operational, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.INFRASTRUCTURE_STATE_SET:
      return setRecord(state, 'infrastructure', command.infrastructureId, {
        districtId: command.districtId, state: command.state, access: command.access,
        condition: command.condition, safety: command.safety, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.INCIDENT_RECORDED:
      return setRecord(state, 'incidents', command.incidentId, {
        type: command.incidentType, districtId: command.districtId, severity: command.severity,
        active: true, happinessModifier: command.happinessModifier,
        landValueModifier: command.landValueModifier, position: command.position,
        influenceRadius: command.influenceRadius, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.INCIDENT_RESOLVED: {
      const before = state.incidents[command.incidentId] ?? null;
      const after = before ? { ...before, active: false, ...source } : null;
      if (after) state.incidents[command.incidentId] = after;
      return recordEffect(command.type, command.incidentId, before, after, explanation);
    }
    case MISSION_OUTCOME_COMMANDS.REPAIR_SET:
      return setRecord(state, 'repairs', command.targetId, {
        status: command.status, progress: command.progress, estimatedCost: command.estimatedCost, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.SERVICE_OUTAGE_SET:
      return setRecord(state, 'serviceOutages', command.outageId, {
        service: command.service, districtId: command.districtId, active: command.active,
        severity: command.severity, coverageMultiplier: command.coverageMultiplier, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.TRAFFIC_SET:
      return setRecord(state, 'traffic', command.scopeId, {
        districtId: command.districtId, densityMultiplier: command.densityMultiplier,
        access: command.access, enforcement: command.enforcement,
        hazardLevel: command.hazardLevel, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.FACTION_REPUTATION_ADJUSTED: {
      const definition = context.contentRegistry?.get?.(CONTENT_TYPES.FACTION, command.factionId);
      const before = state.factions[command.factionId] ?? 0;
      const after = clamp(before + command.delta, definition?.minReputation ?? -100, definition?.maxReputation ?? 100);
      state.factions[command.factionId] = after;
      return recordEffect(command.type, command.factionId, before, after, explanation);
    }
    case MISSION_OUTCOME_COMMANDS.PROGRESSION_SET:
      return setRecord(state, 'progression', command.progressionId, command.unlocked, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.UNLOCK_SET:
      return setRecord(state, 'unlocks', command.unlockId, command.unlocked, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.NEWS_PUBLISHED:
      return setRecord(state, 'news', command.newsId, {
        headline: command.headline, body: command.body, priority: command.priority, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.FOLLOW_UP_MISSION_SET:
      return setRecord(state, 'followUpMissions', command.missionId, {
        status: command.status, ...source
      }, command.type, explanation);
    case MISSION_OUTCOME_COMMANDS.AUTHORED_FLAG_SET:
      return setRecord(state, 'flags', command.flagId, {
        value: command.value, ...source
      }, command.type, explanation);
    default:
      throw new RangeError(`Unsupported mission outcome command: ${command.type}`);
  }
}

function validateStateShape(state) {
  assertRecord(state, 'outcome state');
  for (const key of Object.keys(emptyState())) assertRecord(state[key], `outcome state.${key}`);
}

function validateStoredState(state, contentRegistry) {
  validateStateShape(state);
  for (const [id, reputation] of Object.entries(state.factions)) {
    assertId(id, 'outcome state faction ID');
    assertFiniteNumber(reputation, `outcome state.factions.${id}`);
    const definition = contentRegistry?.get?.(CONTENT_TYPES.FACTION, id);
    if (contentRegistry?.has && !contentRegistry.has(CONTENT_TYPES.FACTION, id)) {
      throw new RangeError(`outcome state references unknown faction ${id}`);
    }
    if (definition && (reputation < definition.minReputation || reputation > definition.maxReputation)) {
      throw new RangeError(`outcome state faction ${id} is outside its authored reputation range`);
    }
  }
  for (const [id, unlocked] of Object.entries(state.progression)) {
    if (contentRegistry?.has && !contentRegistry.has(CONTENT_TYPES.PROGRESSION, id)) {
      throw new RangeError(`outcome state references unknown progression ${id}`);
    }
    assertBoolean(unlocked, `outcome state.progression.${id}`);
  }
  for (const [id, unlocked] of Object.entries(state.unlocks)) {
    assertId(id, 'outcome state unlock ID');
    assertBoolean(unlocked, `outcome state.unlocks.${id}`);
  }
  for (const [id, followUp] of Object.entries(state.followUpMissions)) {
    if (contentRegistry?.has && !contentRegistry.has(CONTENT_TYPES.MISSION, id)) {
      throw new RangeError(`outcome state references unknown follow-up mission ${id}`);
    }
    assertRecord(followUp, `outcome state.followUpMissions.${id}`);
    enumValue(followUp.status, FOLLOW_UP_STATUSES, `outcome state.followUpMissions.${id}.status`, null);
  }
  for (const [id, repair] of Object.entries(state.repairs)) {
    assertRecord(repair, `outcome state.repairs.${id}`);
    enumValue(repair.status, REPAIR_STATUSES, `outcome state.repairs.${id}.status`, null);
    numberInRange(repair.progress, 0, 1, `outcome state.repairs.${id}.progress`, null);
    if (repair.estimatedCost < 0) throw new RangeError(`outcome state.repairs.${id}.estimatedCost cannot be negative`);
    assertFiniteNumber(repair.estimatedCost, `outcome state.repairs.${id}.estimatedCost`);
  }
  for (const [id, outage] of Object.entries(state.serviceOutages)) {
    assertRecord(outage, `outcome state.serviceOutages.${id}`);
    if (!SERVICE_NAMES.has(outage.service)) throw new RangeError(`outcome state.serviceOutages.${id}.service is invalid`);
    assertBoolean(outage.active, `outcome state.serviceOutages.${id}.active`);
    numberInRange(outage.severity, 0, 1, `outcome state.serviceOutages.${id}.severity`, null);
    numberInRange(outage.coverageMultiplier, 0, 1, `outcome state.serviceOutages.${id}.coverageMultiplier`, null);
  }
  for (const [id, policy] of Object.entries(state.traffic)) {
    assertRecord(policy, `outcome state.traffic.${id}`);
    numberInRange(policy.densityMultiplier, 0, 5, `outcome state.traffic.${id}.densityMultiplier`, null);
    enumValue(policy.access, ACCESS_STATES, `outcome state.traffic.${id}.access`, null);
    numberInRange(policy.enforcement, 0, 1, `outcome state.traffic.${id}.enforcement`, null);
    numberInRange(policy.hazardLevel, 0, 1, `outcome state.traffic.${id}.hazardLevel`, null);
  }
  for (const collection of ['buildingStates', 'infrastructure', 'incidents', 'news', 'flags']) {
    for (const [id, record] of Object.entries(state[collection])) {
      assertId(id, `outcome state.${collection} ID`);
      assertRecord(record, `outcome state.${collection}.${id}`);
    }
  }
}

export function validateMissionOutcomeState(value, { contentRegistry = null } = {}) {
  assertRecord(value, 'mission outcome state');
  if (value.version !== MISSION_OUTCOME_STATE_VERSION) {
    throw new RangeError(`Unsupported mission outcome state version: ${String(value.version)}`);
  }
  if (!Number.isInteger(value.sequence) || value.sequence < 0) {
    throw new RangeError('mission outcome state.sequence must be a non-negative integer');
  }
  validateStoredState(value.state, contentRegistry);
  if (!Array.isArray(value.transactions)) throw new TypeError('mission outcome state.transactions must be an array');

  const transactionIds = new Set();
  const sequences = new Set();
  for (const [index, receipt] of value.transactions.entries()) {
    assertRecord(receipt, `mission outcome state.transactions[${index}]`);
    const transactionId = assertId(receipt.transactionId, `mission outcome state.transactions[${index}].transactionId`);
    if (transactionIds.has(transactionId)) throw new Error(`Duplicate outcome transaction: ${transactionId}`);
    transactionIds.add(transactionId);
    assertId(receipt.fingerprint, `mission outcome state.transactions[${index}].fingerprint`);
    const source = normalizeSource(receipt.source);
    const summary = normalizeSummary(receipt.summary, source);
    if (!Number.isInteger(receipt.sequence) || receipt.sequence < 1) {
      throw new RangeError(`mission outcome state.transactions[${index}].sequence must be positive`);
    }
    if (sequences.has(receipt.sequence)) throw new Error(`Duplicate outcome sequence: ${receipt.sequence}`);
    sequences.add(receipt.sequence);
    if (!Array.isArray(receipt.commands) || !Array.isArray(receipt.effects)) {
      throw new TypeError(`mission outcome state.transactions[${index}] requires command and effect arrays`);
    }
    if (receipt.commands.length !== receipt.effects.length) {
      throw new RangeError(`mission outcome state.transactions[${index}] command/effect counts must match`);
    }
    const context = {
      economySystem: null,
      knownContent: (type, rawId, label) => {
        const id = assertId(rawId, label);
        if (contentRegistry?.has && !contentRegistry.has(type, id)) {
          throw new RangeError(`${label} references unknown ${type} content ID ${id}`);
        }
        return id;
      },
      knownDistrict: (rawId, label, optional) => {
        if (rawId == null && optional) return null;
        const id = assertId(rawId, label);
        if (contentRegistry?.has && !contentRegistry.has(CONTENT_TYPES.DISTRICT, id)) {
          throw new RangeError(`${label} references unknown district ${id}`);
        }
        return id;
      }
    };
    const commands = receipt.commands.map((command, commandIndex) => normalizeCommand(command, commandIndex, context));
    const expectedFingerprint = stableStringify({ transactionId, source, summary, commands });
    if (receipt.fingerprint !== expectedFingerprint) {
      throw new Error(`mission outcome state transaction ${transactionId} fingerprint does not match its content`);
    }
    for (const [effectIndex, effect] of receipt.effects.entries()) {
      assertRecord(effect, `mission outcome state.transactions[${index}].effects[${effectIndex}]`);
      assertId(effect.type, `mission outcome state.transactions[${index}].effects[${effectIndex}].type`);
      assertId(effect.subjectId, `mission outcome state.transactions[${index}].effects[${effectIndex}].subjectId`);
      assertId(effect.explanation, `mission outcome state.transactions[${index}].effects[${effectIndex}].explanation`);
    }
  }
  if (value.transactions.length > value.sequence) {
    throw new RangeError('mission outcome state.sequence cannot precede its transaction count');
  }
  if (sequences.size > 0 && Math.max(...sequences) > value.sequence) {
    throw new RangeError('mission outcome transaction sequence exceeds state.sequence');
  }
  return true;
}

export class MissionOutcomeService {
  #economySystem;
  #contentRegistry;
  #districtIds;
  #state = emptyState();
  #transactions = new Map();
  #listeners = new Set();
  #sequence = 0;
  #activeTransactionId = null;

  constructor({ economySystem = null, contentRegistry = null, districtDefinitions = [] } = {}) {
    this.#economySystem = economySystem;
    this.#contentRegistry = contentRegistry;
    this.#districtIds = new Set(districtDefinitions.map(definition => definition.id));
  }

  apply(transaction) {
    const normalized = this.#normalizeTransaction(transaction);
    const existing = this.#transactions.get(normalized.transactionId);
    if (existing) {
      if (existing.fingerprint !== normalized.fingerprint) throw new OutcomeConflictError(normalized.transactionId);
      return deepFreeze({ ...clone(existing), duplicate: true });
    }

    const draft = clone(this.#state);
    const initialCapital = this.#economySystem?.treasury ?? 0;
    const context = {
      projectedCapital: initialCapital,
      defaultExplanation: normalized.summary.description,
      contentRegistry: this.#contentRegistry
    };
    const effects = normalized.commands.map(command => (
      applyCommand(draft, command, normalized.transactionId, context)
    ));
    const capitalDelta = context.projectedCapital - initialCapital;
    if (context.projectedCapital < 0) {
      throw new OutcomeApplicationError('Outcome would reduce Capital below zero', {
        transactionId: normalized.transactionId
      });
    }

    if (this.#activeTransactionId) {
      throw new OutcomeApplicationError(
        `Cannot apply ${normalized.transactionId} while outcome ${this.#activeTransactionId} is committing`,
        { transactionId: normalized.transactionId }
      );
    }

    let receipt;
    this.#activeTransactionId = normalized.transactionId;
    try {
      // Capital is projected only after the entire transaction has validated
      // and reduced successfully. Economy operations used here cannot
      // partially fail. The reentrancy guard prevents economy observers from
      // replaying an outcome before its receipt is committed.
      if (capitalDelta > 0) {
        this.#economySystem?.earn?.(capitalDelta, { source: 'mission-outcome', referenceId: normalized.transactionId });
      } else if (capitalDelta < 0) {
        const applied = this.#economySystem?.spend?.(-capitalDelta, { source: 'mission-outcome', referenceId: normalized.transactionId });
        if (this.#economySystem && !applied) {
          throw new OutcomeApplicationError('Outcome Capital debit could not be applied', {
            transactionId: normalized.transactionId
          });
        }
      }

      this.#state = draft;
      this.#sequence += 1;
      receipt = deepFreeze({
        version: 1,
        transactionId: normalized.transactionId,
        fingerprint: normalized.fingerprint,
        sequence: this.#sequence,
        source: normalized.source,
        summary: normalized.summary,
        commands: normalized.commands,
        effects,
        duplicate: false
      });
      this.#transactions.set(receipt.transactionId, receipt);
    } finally {
      this.#activeTransactionId = null;
    }
    this.#publish(receipt);
    return receipt;
  }

  hasApplied(transactionId) {
    return this.#transactions.has(assertId(transactionId, 'transactionId'));
  }

  getReceipt(transactionId) {
    return this.#transactions.get(assertId(transactionId, 'transactionId')) ?? null;
  }

  explain(transactionId) {
    const receipt = this.getReceipt(transactionId);
    if (!receipt) return null;
    return deepFreeze({
      transactionId: receipt.transactionId,
      source: clone(receipt.source),
      title: receipt.summary.title,
      description: receipt.summary.description,
      effects: receipt.effects.map(effect => ({
        type: effect.type,
        subjectId: effect.subjectId,
        before: clone(effect.before),
        after: clone(effect.after),
        explanation: effect.explanation
      }))
    });
  }

  snapshot() {
    return deepFreeze({
      revision: this.#sequence,
      ...clone(this.#state),
      transactions: [...this.#transactions.values()].map(clone)
    });
  }

  serialize() {
    return {
      version: MISSION_OUTCOME_STATE_VERSION,
      sequence: this.#sequence,
      state: clone(this.#state),
      transactions: [...this.#transactions.values()].map(clone)
    };
  }

  restore(value) {
    validateMissionOutcomeState(value, { contentRegistry: this.#contentRegistry });
    const transactions = new Map();
    for (const receipt of value.transactions) {
      if (transactions.has(receipt.transactionId)) {
        throw new Error(`Duplicate restored outcome transaction: ${receipt.transactionId}`);
      }
      transactions.set(receipt.transactionId, deepFreeze(clone(receipt)));
    }
    this.#state = clone(value.state);
    this.#transactions = transactions;
    this.#sequence = value.sequence;
    return this.snapshot();
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(deepFreeze({ type: 'SNAPSHOT', current: this.snapshot() }));
    return () => this.#listeners.delete(listener);
  }

  destroy() {
    this.#listeners.clear();
  }

  #normalizeTransaction(transaction) {
    assertRecord(transaction, 'outcome');
    const transactionId = assertId(transaction.transactionId, 'outcome.transactionId');
    const source = normalizeSource(transaction.source);
    const summary = normalizeSummary(transaction.summary, source);
    if (!Array.isArray(transaction.commands) || transaction.commands.length === 0) {
      throw new TypeError('outcome.commands must be a non-empty array');
    }
    const context = {
      economySystem: this.#economySystem,
      knownContent: (type, value, label) => this.#knownContent(type, value, label),
      knownDistrict: (value, label, optional) => this.#knownDistrict(value, label, optional)
    };
    const commands = transaction.commands.map((command, index) => normalizeCommand(command, index, context));
    const commandIds = new Set();
    for (const command of commands) {
      if (commandIds.has(command.commandId)) throw new Error(`Duplicate outcome commandId: ${command.commandId}`);
      commandIds.add(command.commandId);
    }
    const payload = { transactionId, source, summary, commands };
    return { ...payload, fingerprint: stableStringify(payload) };
  }

  #knownContent(type, value, label) {
    const id = assertId(value, label);
    if (this.#contentRegistry?.has && !this.#contentRegistry.has(type, id)) {
      throw new RangeError(`${label} references unknown ${type} content ID ${id}`);
    }
    return id;
  }

  #knownDistrict(value, label, optional = false) {
    if (value == null && optional) return null;
    const id = assertId(value, label);
    if (this.#districtIds.size > 0 && !this.#districtIds.has(id)) {
      throw new RangeError(`${label} references unknown district ${id}`);
    }
    return id;
  }

  #publish(receipt) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(receipt);
      } catch (error) {
        console.error('MissionOutcomeService listener failed.', error);
      }
    }
  }
}
