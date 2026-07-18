import { MISSION_OUTCOME_COMMANDS as COMMANDS } from '../missions/MissionOutcomeService.js';
import { clone, deepFreeze } from '../missions/ContractUtils.js';

export const MISSION_RESULT_KINDS = Object.freeze({
  SUCCESS: 'SUCCESS',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  FAILURE: 'FAILURE',
  ABANDONED: 'ABANDONED',
  ARRESTED: 'ARRESTED',
  VEHICLE_LOSS: 'VEHICLE_LOSS'
});

export const RESULT_SECTION_IDS = Object.freeze({
  REWARD: 'REWARD',
  CITY: 'CITY',
  FACTION: 'FACTION',
  PROGRESSION: 'PROGRESSION'
});

const OUTCOME_ALIASES = Object.freeze({
  SUCCESS: MISSION_RESULT_KINDS.SUCCESS,
  COMPLETE: MISSION_RESULT_KINDS.SUCCESS,
  COMPLETED: MISSION_RESULT_KINDS.SUCCESS,
  PARTIAL: MISSION_RESULT_KINDS.PARTIAL_SUCCESS,
  PARTIAL_SUCCESS: MISSION_RESULT_KINDS.PARTIAL_SUCCESS,
  ABANDONED: MISSION_RESULT_KINDS.ABANDONED,
  ABANDONMENT: MISSION_RESULT_KINDS.ABANDONED,
  CANCELLED: MISSION_RESULT_KINDS.ABANDONED,
  CANCELED: MISSION_RESULT_KINDS.ABANDONED,
  ARREST: MISSION_RESULT_KINDS.ARRESTED,
  ARRESTED: MISSION_RESULT_KINDS.ARRESTED,
  CAPTURED: MISSION_RESULT_KINDS.ARRESTED,
  VEHICLE_LOSS: MISSION_RESULT_KINDS.VEHICLE_LOSS,
  VEHICLE_LOST: MISSION_RESULT_KINDS.VEHICLE_LOSS,
  VEHICLE_DESTROYED: MISSION_RESULT_KINDS.VEHICLE_LOSS,
  FAILURE: MISSION_RESULT_KINDS.FAILURE,
  FAILED: MISSION_RESULT_KINDS.FAILURE
});

const KIND_PRESENTATION = Object.freeze({
  [MISSION_RESULT_KINDS.SUCCESS]: Object.freeze({ label: 'Success', tone: 'success' }),
  [MISSION_RESULT_KINDS.PARTIAL_SUCCESS]: Object.freeze({ label: 'Partial success', tone: 'partial' }),
  [MISSION_RESULT_KINDS.FAILURE]: Object.freeze({ label: 'Mission failed', tone: 'failure' }),
  [MISSION_RESULT_KINDS.ABANDONED]: Object.freeze({ label: 'Mission abandoned', tone: 'abandoned' }),
  [MISSION_RESULT_KINDS.ARRESTED]: Object.freeze({ label: 'Operator arrested', tone: 'arrested' }),
  [MISSION_RESULT_KINDS.VEHICLE_LOSS]: Object.freeze({ label: 'Vehicle lost', tone: 'vehicle-loss' })
});

const REASON_EXPLANATIONS = Object.freeze({
  timeout: 'The mission timer expired before the final objective was completed.',
  cancelled: 'You abandoned the mission before its final objective was completed.',
  canceled: 'You abandoned the mission before its final objective was completed.',
  abandoned: 'You abandoned the mission before its final objective was completed.',
  released: 'Control of the required mission vehicle was released during the run.',
  vehicle_lost: 'The required mission vehicle was lost, destroyed, or exchanged during the run.',
  vehicle_destroyed: 'The required mission vehicle was destroyed during the run.',
  arrest: 'Enforcement captured the operator before the mission could be completed.',
  arrested: 'Enforcement captured the operator before the mission could be completed.',
  captured: 'Enforcement captured the operator before the mission could be completed.',
  race_lost: 'A rival reached the finish before the player.'
});

const EFFECT_LABELS = Object.freeze({
  [COMMANDS.CAPITAL_ADJUSTED]: 'Capital',
  [COMMANDS.BUILDING_STATE_SET]: 'Building state',
  [COMMANDS.INFRASTRUCTURE_STATE_SET]: 'Infrastructure',
  [COMMANDS.INCIDENT_RECORDED]: 'Incident',
  [COMMANDS.INCIDENT_RESOLVED]: 'Incident resolved',
  [COMMANDS.REPAIR_SET]: 'Repair status',
  [COMMANDS.SERVICE_OUTAGE_SET]: 'Service coverage',
  [COMMANDS.TRAFFIC_SET]: 'Traffic conditions',
  [COMMANDS.FACTION_REPUTATION_ADJUSTED]: 'Reputation',
  [COMMANDS.PROGRESSION_SET]: 'Career tier',
  [COMMANDS.UNLOCK_SET]: 'Capability',
  [COMMANDS.NEWS_PUBLISHED]: 'City news',
  [COMMANDS.FOLLOW_UP_MISSION_SET]: 'Follow-up mission',
  [COMMANDS.AUTHORED_FLAG_SET]: 'City state'
});

const SECTION_META = Object.freeze({
  [RESULT_SECTION_IDS.REWARD]: Object.freeze({
    title: 'Reward & performance',
    empty: 'No Capital or performance reward was recorded.'
  }),
  [RESULT_SECTION_IDS.CITY]: Object.freeze({
    title: 'City consequences',
    empty: 'No persistent city condition changed.'
  }),
  [RESULT_SECTION_IDS.FACTION]: Object.freeze({
    title: 'Faction consequences',
    empty: 'No faction reputation changed.'
  }),
  [RESULT_SECTION_IDS.PROGRESSION]: Object.freeze({
    title: 'Progression & unlocks',
    empty: 'No progression, capability, or follow-up unlocked.'
  })
});

const PROGRESSION_TYPES = new Set([
  COMMANDS.PROGRESSION_SET,
  COMMANDS.UNLOCK_SET,
  COMMANDS.FOLLOW_UP_MISSION_SET
]);

function normalizedToken(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function humanizeId(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Unknown';
  const words = text.replace(/[._-]+/g, ' ');
  const normalized = words === words.toUpperCase() ? words.toLowerCase() : words;
  return normalized
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function signedNumber(value) {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;
}

function currency(value) {
  const absolute = Math.abs(value).toLocaleString('en-US');
  return `${value < 0 ? '-' : ''}$${absolute}`;
}

function percentage(value) {
  return `${Math.round(value * 100)}%`;
}

function primaryRecordValue(record) {
  if (record == null || typeof record !== 'object') return record;
  if (typeof record.headline === 'string') return record.headline;
  if (typeof record.status === 'string') return humanizeId(record.status);
  if (typeof record.state === 'string') return humanizeId(record.state);
  if (typeof record.access === 'string') return `${humanizeId(record.access)} access`;
  if (typeof record.active === 'boolean') return record.active ? 'Active' : 'Resolved';
  if (typeof record.unlocked === 'boolean') return record.unlocked ? 'Unlocked' : 'Locked';
  if (finite(record.coverageMultiplier)) return `${percentage(record.coverageMultiplier)} coverage`;
  if (finite(record.densityMultiplier)) return `${record.densityMultiplier.toFixed(2)}× traffic`;
  if (finite(record.condition)) return `${percentage(record.condition)} condition`;
  if (Object.hasOwn(record, 'value')) return String(record.value);
  return null;
}

function formatChange(effect) {
  const before = effect.before;
  const after = effect.after;
  if (effect.type === COMMANDS.CAPITAL_ADJUSTED && finite(before) && finite(after)) {
    const delta = after - before;
    return `${currency(before)} → ${currency(after)} (${delta >= 0 ? '+' : '-'}${currency(Math.abs(delta))})`;
  }
  if (effect.type === COMMANDS.FACTION_REPUTATION_ADJUSTED && finite(before) && finite(after)) {
    return `${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')} (${signedNumber(after - before)})`;
  }
  if (typeof after === 'boolean') return after ? 'Unlocked' : 'Locked';
  if (finite(before) && finite(after)) return `${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')} (${signedNumber(after - before)})`;
  const beforeValue = primaryRecordValue(before);
  const afterValue = primaryRecordValue(after);
  if (beforeValue != null && afterValue != null && beforeValue !== afterValue) return `${beforeValue} → ${afterValue}`;
  if (afterValue != null) return String(afterValue);
  if (beforeValue != null && after == null) return `${beforeValue} → Resolved`;
  return before == null ? 'Recorded' : 'Updated';
}

function classifyKind(resolution = {}, source = {}) {
  const reasonToken = normalizedToken(resolution.reason ?? source.reason);
  if (reasonToken === 'CANCELLED' || reasonToken === 'CANCELED' || reasonToken === 'ABANDONED') {
    return MISSION_RESULT_KINDS.ABANDONED;
  }
  if (reasonToken === 'ARREST' || reasonToken === 'ARRESTED' || reasonToken === 'CAPTURED') {
    return MISSION_RESULT_KINDS.ARRESTED;
  }
  if (['VEHICLE_LOSS', 'VEHICLE_LOST', 'VEHICLE_DESTROYED'].includes(reasonToken)) {
    return MISSION_RESULT_KINDS.VEHICLE_LOSS;
  }
  return OUTCOME_ALIASES[normalizedToken(resolution.outcome ?? source.outcome)] || MISSION_RESULT_KINDS.FAILURE;
}

function sectionForEffect(type) {
  if (type === COMMANDS.CAPITAL_ADJUSTED) return RESULT_SECTION_IDS.REWARD;
  if (type === COMMANDS.FACTION_REPUTATION_ADJUSTED) return RESULT_SECTION_IDS.FACTION;
  if (PROGRESSION_TYPES.has(type)) return RESULT_SECTION_IDS.PROGRESSION;
  return RESULT_SECTION_IDS.CITY;
}

function createEffectItem(effect, labels = {}) {
  const subjectLabel = labels[effect.subjectId] || humanizeId(effect.subjectId);
  return {
    id: `${effect.type}:${effect.subjectId}`,
    type: effect.type,
    label: effect.type === COMMANDS.CAPITAL_ADJUSTED
      ? EFFECT_LABELS[effect.type]
      : `${EFFECT_LABELS[effect.type] || humanizeId(effect.type)} · ${subjectLabel}`,
    value: formatChange(effect),
    explanation: effect.explanation || 'The committed mission outcome changed this value.'
  };
}

function performanceItems(resolution = {}) {
  const items = [];
  if (finite(resolution.satisfaction)) {
    items.push({
      id: 'performance:satisfaction',
      type: 'SATISFACTION',
      label: 'Passenger satisfaction',
      value: `${Math.round(resolution.satisfaction)}%`,
      explanation: 'Satisfaction reflects time used and traffic encountered during the run.'
    });
  }
  if (finite(resolution.damage)) {
    items.push({
      id: 'performance:damage',
      type: 'DAMAGE',
      label: 'Damage',
      value: resolution.damage <= 1 ? percentage(resolution.damage) : resolution.damage.toLocaleString('en-US'),
      explanation: 'Damage recorded when the mission resolved.'
    });
  }
  if (finite(resolution.heat)) {
    items.push({
      id: 'performance:heat',
      type: 'HEAT',
      label: 'Heat',
      value: resolution.heat.toLocaleString('en-US'),
      explanation: 'Enforcement Heat recorded when the mission resolved.'
    });
  }
  return items;
}

function buildWhy(resolution, explanation, weather) {
  const rawReason = resolution.reason ?? explanation.source?.reason;
  const key = String(rawReason ?? '').trim().toLowerCase();
  const primary = REASON_EXPLANATIONS[key]
    || (typeof rawReason === 'string' && rawReason.trim() ? humanizeId(rawReason) : explanation.description);
  const details = [primary];
  if (weather?.disposition === 'ADAPTED' && weather.reason && weather.reason !== primary) details.push(weather.reason);
  return [...new Set(details.filter(Boolean))];
}

function buildNextAction(kind, retry) {
  if (retry?.allowed) {
    const remaining = finite(retry.attemptsRemaining) ? ` ${retry.attemptsRemaining} attempt${retry.attemptsRemaining === 1 ? '' : 's'} remain.` : '';
    return {
      title: 'Retry or return to the city',
      description: `${retry.reason || 'Restart from the mission approach.'}${remaining}`,
      canRetry: true,
      retryLabel: retry.checkpoint ? 'Retry from checkpoint' : 'Retry mission',
      continueLabel: 'Return to Management'
    };
  }
  if (kind === MISSION_RESULT_KINDS.SUCCESS || kind === MISSION_RESULT_KINDS.PARTIAL_SUCCESS) {
    return {
      title: 'Review the changed city',
      description: 'Return to Management to inspect the committed consequences and choose the next priority.',
      canRetry: false,
      retryLabel: 'Retry mission',
      continueLabel: 'Return to Management'
    };
  }
  return {
    title: 'Recover in Management',
    description: retry?.reason || 'Return to Management. The committed result remains in the outcome log.',
    canRetry: false,
    retryLabel: 'Retry mission',
    continueLabel: 'Return to Management'
  };
}

function explanationFromReceipt(receipt) {
  return {
    transactionId: receipt.transactionId,
    source: clone(receipt.source),
    title: receipt.summary?.title || 'Recorded outcome',
    description: receipt.summary?.description || receipt.source?.reason || 'A persistent outcome was committed.',
    effects: clone(receipt.effects || [])
  };
}

export function buildMissionResultViewModel({
  lifecycleSnapshot = null,
  explanation,
  mission = null,
  retryDecision = null,
  labels = {},
  sequence = null
} = {}) {
  if (!explanation || typeof explanation !== 'object') throw new TypeError('A result explanation is required');
  const run = lifecycleSnapshot?.run || null;
  const resolution = run?.resolution || {};
  const kind = classifyKind(resolution, explanation.source);
  const presentation = KIND_PRESENTATION[kind];
  const sectionItems = new Map(Object.values(RESULT_SECTION_IDS).map(id => [id, []]));
  for (const effect of explanation.effects || []) {
    sectionItems.get(sectionForEffect(effect.type)).push(createEffectItem(effect, labels));
  }
  sectionItems.get(RESULT_SECTION_IDS.REWARD).push(...performanceItems(resolution));
  const sections = Object.values(RESULT_SECTION_IDS).map(id => ({
    id,
    ...SECTION_META[id],
    items: sectionItems.get(id)
  }));
  const nextAction = buildNextAction(kind, retryDecision);
  const missionTitle = mission?.title || explanation.title || humanizeId(explanation.source?.contentId);
  const why = buildWhy(resolution, explanation, run?.weather);
  const changeCount = sections.reduce((total, section) => total + section.items.length, 0);
  const announcement = [
    `${presentation.label}: ${missionTitle}.`,
    explanation.description,
    `${changeCount} recorded change${changeCount === 1 ? '' : 's'}.`,
    nextAction.description
  ].filter(Boolean).join(' ');

  return deepFreeze({
    transactionId: explanation.transactionId,
    sequence,
    kind,
    outcomeLabel: presentation.label,
    tone: presentation.tone,
    missionTitle,
    title: explanation.title || missionTitle,
    description: explanation.description || 'The mission outcome was committed.',
    why,
    attempt: run?.attempt ?? null,
    sections,
    nextAction,
    announcement
  });
}

export function buildMissionResultHistory({ receipts = [], lifecycleSnapshot = null, missions = [], labels = {} } = {}) {
  const missionMap = new Map(missions.map(mission => [mission.id, mission]));
  const currentTransactionId = lifecycleSnapshot?.run?.transactionId;
  const entries = [...receipts]
    .filter(receipt => receipt.source?.kind === 'MISSION')
    .sort((left, right) => (right.sequence || 0) - (left.sequence || 0))
    .map(receipt => buildMissionResultViewModel({
      lifecycleSnapshot: receipt.transactionId === currentTransactionId ? lifecycleSnapshot : null,
      explanation: explanationFromReceipt(receipt),
      mission: missionMap.get(receipt.source?.contentId) || null,
      labels,
      sequence: receipt.sequence ?? null
    }));
  return deepFreeze(entries);
}

export function classifyMissionResult({ resolution = {}, source = {} } = {}) {
  return classifyKind(resolution, source);
}
