import { MISSION_OUTCOME_COMMANDS, OUTCOME_SOURCE_KINDS } from './MissionOutcomeService.js';
import { assertFiniteNumber, assertId, assertRecord, clone, deepFreeze } from './ContractUtils.js';
import { getMissionWeatherPolicy } from './MissionPolicyDefinitions.js';

export const MISSION_LIFECYCLE_VERSION = 1;

export const MISSION_PHASES = Object.freeze({
  IDLE: 'IDLE',
  PREPARATION: 'PREPARATION',
  BRIEFING: 'BRIEFING',
  APPROACH: 'APPROACH',
  ACTIVE: 'ACTIVE',
  CHECKPOINT: 'CHECKPOINT',
  COMPLETION: 'COMPLETION',
  FAILURE: 'FAILURE',
  CLEANUP: 'CLEANUP',
  RESULT: 'RESULT',
  RECOVERY: 'RECOVERY'
});

export const MISSION_WEATHER_DISPOSITIONS = Object.freeze({
  ALLOWED: 'ALLOWED',
  ADAPTED: 'ADAPTED',
  DELAYED: 'DELAYED',
  BLOCKED: 'BLOCKED'
});

export const MISSION_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  DELAYED: 'DELAYED',
  LOCKED: 'LOCKED',
  BLOCKED: 'BLOCKED'
});

export const MISSION_RETRY_STRATEGIES = Object.freeze({
  RESTART: 'RESTART',
  LAST_CHECKPOINT: 'LAST_CHECKPOINT',
  NO_RETRY: 'NO_RETRY'
});

export const MISSION_PREREQUISITE_TYPES = Object.freeze({
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  FOLLOW_UP_STATUS: 'FOLLOW_UP_STATUS',
  CITY_CONDITION: 'CITY_CONDITION'
});

const WEATHER_DISPOSITIONS = new Set(Object.values(MISSION_WEATHER_DISPOSITIONS));
const MISSION_CONTENT_TYPE = 'missions';
const PHASE_VALUES = new Set(Object.values(MISSION_PHASES));
const UNRESOLVED_PHASES = new Set([
  MISSION_PHASES.PREPARATION,
  MISSION_PHASES.BRIEFING,
  MISSION_PHASES.APPROACH,
  MISSION_PHASES.ACTIVE,
  MISSION_PHASES.CHECKPOINT,
  MISSION_PHASES.COMPLETION,
  MISSION_PHASES.FAILURE,
  MISSION_PHASES.CLEANUP,
  MISSION_PHASES.RESULT,
  MISSION_PHASES.RECOVERY
]);
const SAVE_BLOCKING_PHASES = new Set([
  MISSION_PHASES.PREPARATION,
  MISSION_PHASES.BRIEFING,
  MISSION_PHASES.COMPLETION,
  MISSION_PHASES.FAILURE,
  MISSION_PHASES.CLEANUP,
  MISSION_PHASES.RECOVERY
]);

const DEFAULT_RETRY_POLICIES = Object.freeze({
  TAXI: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.RESTART, maxAttempts: 3 }),
  COURIER: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.RESTART, maxAttempts: 3 }),
  DELIVERY: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.RESTART, maxAttempts: 3 }),
  RACE: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.LAST_CHECKPOINT, maxAttempts: 3 }),
  SABOTAGE: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.LAST_CHECKPOINT, maxAttempts: 3 }),
  SURVIVAL: Object.freeze({ strategy: MISSION_RETRY_STRATEGIES.RESTART, maxAttempts: 2 })
});

function emptyProgress() {
  return {
    completedMissionIds: [],
    dialogueChoices: [],
    chronologyStep: 0,
    runCounts: []
  };
}

function createInitialState() {
  return {
    version: MISSION_LIFECYCLE_VERSION,
    revision: 0,
    phase: MISSION_PHASES.IDLE,
    selectedMissionId: null,
    run: null,
    progress: emptyProgress()
  };
}

function objectiveOf(mission) {
  return mission.missionType || mission.objectiveType || 'DELIVERY';
}

function normalizeWeatherEntry(entry, fallbackDisposition = MISSION_WEATHER_DISPOSITIONS.ALLOWED) {
  const source = typeof entry === 'string' ? { disposition: entry } : (entry || {});
  const disposition = String(source.disposition ?? fallbackDisposition).toUpperCase();
  if (!WEATHER_DISPOSITIONS.has(disposition)) {
    throw new RangeError(`Unsupported mission weather disposition: ${disposition}`);
  }
  const timeLimitMultiplier = source.timeLimitMultiplier ?? 1;
  const rewardMultiplier = source.rewardMultiplier ?? 1;
  assertFiniteNumber(timeLimitMultiplier, 'weather timeLimitMultiplier');
  assertFiniteNumber(rewardMultiplier, 'weather rewardMultiplier');
  if (timeLimitMultiplier <= 0 || rewardMultiplier < 0) {
    throw new RangeError('Mission weather multipliers must be positive (reward may be zero)');
  }
  return {
    disposition,
    reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : null,
    timeLimitMultiplier,
    rewardMultiplier
  };
}

export function evaluateMissionWeather(mission, weatherMode) {
  assertRecord(mission, 'mission');
  const policy = assertRecord(getMissionWeatherPolicy(mission.weatherPolicy), `${mission.id}.weatherPolicy`);
  const mode = assertId(weatherMode || 'clear', 'weatherMode').toLowerCase();
  const fallback = normalizeWeatherEntry({
    disposition: policy.defaultDisposition,
    reason: policy.defaultReason,
    timeLimitMultiplier: policy.timeLimitMultiplier,
    rewardMultiplier: policy.rewardMultiplier
  });
  const decision = normalizeWeatherEntry(policy.modes?.[mode], fallback.disposition);
  const normalized = policy.modes?.[mode]
    ? {
        ...decision,
        reason: decision.reason ?? fallback.reason,
        timeLimitMultiplier: policy.modes[mode].timeLimitMultiplier ?? fallback.timeLimitMultiplier,
        rewardMultiplier: policy.modes[mode].rewardMultiplier ?? fallback.rewardMultiplier
      }
    : fallback;
  const reason = normalized.reason || (
    normalized.disposition === MISSION_WEATHER_DISPOSITIONS.DELAYED
      ? `${mission.title} is delayed until conditions improve.`
      : normalized.disposition === MISSION_WEATHER_DISPOSITIONS.BLOCKED
        ? `${mission.title} cannot be attempted in ${mode} weather.`
        : normalized.disposition === MISSION_WEATHER_DISPOSITIONS.ADAPTED
          ? `${mission.title} is adapted for ${mode} conditions.`
          : `${mission.title} allows ${mode} conditions.`
  );
  return deepFreeze({
    mode,
    ...normalized,
    reason,
    allowed: normalized.disposition === MISSION_WEATHER_DISPOSITIONS.ALLOWED
      || normalized.disposition === MISSION_WEATHER_DISPOSITIONS.ADAPTED,
    delayed: normalized.disposition === MISSION_WEATHER_DISPOSITIONS.DELAYED
  });
}

function normalizeRetryPolicy(mission) {
  const fallback = DEFAULT_RETRY_POLICIES[objectiveOf(mission)] || DEFAULT_RETRY_POLICIES.DELIVERY;
  const policy = mission.retryPolicy || fallback;
  const strategy = String(policy.strategy ?? fallback.strategy).toUpperCase();
  if (!Object.values(MISSION_RETRY_STRATEGIES).includes(strategy)) {
    throw new RangeError(`Unsupported retry strategy: ${strategy}`);
  }
  const maxAttempts = policy.maxAttempts ?? fallback.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('retryPolicy.maxAttempts must be a positive integer');
  }
  return deepFreeze({ strategy, maxAttempts });
}

function normalizeProgress(progress) {
  const source = progress || emptyProgress();
  if (!Array.isArray(source.completedMissionIds) || !Array.isArray(source.dialogueChoices) || !Array.isArray(source.runCounts)) {
    throw new TypeError('mission lifecycle progress collections must be arrays');
  }
  if (!Number.isInteger(source.chronologyStep) || source.chronologyStep < 0) {
    throw new RangeError('mission lifecycle chronologyStep must be a non-negative integer');
  }
  const completedMissionIds = [...new Set(source.completedMissionIds.map(id => assertId(id, 'completed mission ID')))];
  const runCounts = source.runCounts.map(([missionId, count]) => {
    assertId(missionId, 'run count mission ID');
    if (!Number.isInteger(count) || count < 0) throw new RangeError('mission run count must be non-negative');
    return [missionId, count];
  });
  return {
    completedMissionIds,
    dialogueChoices: clone(source.dialogueChoices),
    chronologyStep: source.chronologyStep,
    runCounts
  };
}

export function validateMissionLifecycleState(value, { contentRegistry = null } = {}) {
  assertRecord(value, 'mission lifecycle state');
  if (value.version !== MISSION_LIFECYCLE_VERSION) {
    throw new RangeError(`Unsupported mission lifecycle version: ${String(value.version)}`);
  }
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    throw new RangeError('mission lifecycle revision must be a non-negative integer');
  }
  if (!PHASE_VALUES.has(value.phase)) throw new RangeError(`Unknown mission lifecycle phase: ${String(value.phase)}`);
  const progress = normalizeProgress(value.progress);
  for (const id of progress.completedMissionIds) {
    if (contentRegistry?.has && !contentRegistry.has(MISSION_CONTENT_TYPE, id)) {
      throw new RangeError(`mission lifecycle references unknown completed mission ${id}`);
    }
  }
  if (value.phase === MISSION_PHASES.IDLE) {
    if (value.selectedMissionId !== null || value.run !== null) {
      throw new Error('idle mission lifecycle cannot retain a selection or run');
    }
    return true;
  }
  const missionId = assertId(value.selectedMissionId, 'mission lifecycle selectedMissionId');
  if (contentRegistry?.has && !contentRegistry.has(MISSION_CONTENT_TYPE, missionId)) {
    throw new RangeError(`mission lifecycle references unknown mission ${missionId}`);
  }
  if ([MISSION_PHASES.PREPARATION, MISSION_PHASES.BRIEFING].includes(value.phase)) {
    if (value.run !== null) throw new Error(`${value.phase} cannot retain an accepted mission run`);
    return true;
  }
  assertRecord(value.run, 'mission lifecycle run');
  if (value.run.missionId !== missionId) throw new Error('mission lifecycle run and selection IDs must match');
  assertId(value.run.runId, 'mission lifecycle run.runId');
  if (!Number.isInteger(value.run.attempt) || value.run.attempt < 1) throw new RangeError('mission attempt must be positive');
  normalizeRetryPolicy({ missionType: value.run.objective, retryPolicy: value.run.retryPolicy });
  if (value.run.weather == null) throw new Error('mission lifecycle run requires a weather decision');
  normalizeWeatherEntry(value.run.weather);
  if (value.run.checkpoint != null) {
    assertRecord(value.run.checkpoint, 'mission lifecycle checkpoint');
    assertId(value.run.checkpoint.id, 'mission lifecycle checkpoint.id');
    if (!Number.isInteger(value.run.checkpoint.sequence) || value.run.checkpoint.sequence < 1) {
      throw new RangeError('mission lifecycle checkpoint sequence must be positive');
    }
  }
  return true;
}

export class MissionLifecycleError extends Error {
  constructor(message, { code = 'MISSION_LIFECYCLE_REJECTED', details = {} } = {}) {
    super(message);
    this.name = 'MissionLifecycleError';
    this.code = code;
    this.details = deepFreeze(clone(details));
  }
}

export class MissionLifecycleController {
  #missions;
  #conditionService;
  #outcomeService;
  #weatherProvider;
  #state = createInitialState();
  #listeners = new Set();

  constructor({ missions, conditionService = null, outcomeService = null, weatherProvider = () => 'clear' } = {}) {
    if (!Array.isArray(missions) || missions.length === 0) throw new TypeError('MissionLifecycleController requires missions');
    this.#missions = new Map(missions.map(mission => [mission.id, mission]));
    if (this.#missions.size !== missions.length) throw new Error('Mission lifecycle mission IDs must be unique');
    this.#conditionService = conditionService;
    this.#outcomeService = outcomeService;
    this.#weatherProvider = weatherProvider;
  }

  get phase() { return this.#state.phase; }
  get isMissionCritical() { return UNRESOLVED_PHASES.has(this.#state.phase); }
  get hasActiveRun() { return this.#state.run !== null; }
  get currentMission() { return this.#state.selectedMissionId ? this.#missions.get(this.#state.selectedMissionId) ?? null : null; }

  snapshot() { return deepFreeze(clone(this.#state)); }

  progressSnapshot() { return deepFreeze(clone(this.#state.progress)); }

  evaluateAvailability(missionOrId, { weatherMode = this.#weatherProvider?.() || 'clear' } = {}) {
    const mission = typeof missionOrId === 'string' ? this.#missions.get(missionOrId) : missionOrId;
    if (!mission || !this.#missions.has(mission.id)) {
      return deepFreeze({ missionId: mission?.id ?? null, available: false, status: MISSION_AVAILABILITY.BLOCKED, reasons: ['Mission data is unavailable.'], prerequisites: [], weather: null });
    }
    const prerequisiteResults = (mission.prerequisites || []).map(requirement => this.#evaluatePrerequisite(requirement));
    const failed = prerequisiteResults.filter(result => !result.passed);
    const followUp = this.#outcomeService?.snapshot?.().followUpMissions?.[mission.id] ?? null;
    if (followUp && ['LOCKED', 'FAILED', 'EXPIRED'].includes(followUp.status)) {
      failed.push({ passed: false, reason: `Mission status is ${followUp.status.toLowerCase()}.`, requirement: { type: 'FOLLOW_UP_STATUS' } });
    }
    const alreadyCompleted = this.#state.progress.completedMissionIds.includes(mission.id);
    if (alreadyCompleted && mission.repeatable === false) {
      failed.push({ passed: false, reason: 'This mission has already been completed.', requirement: { type: 'MISSION_COMPLETED' } });
    }
    const weather = evaluateMissionWeather(mission, weatherMode);
    const reasons = failed.map(result => result.reason);
    let status = MISSION_AVAILABILITY.AVAILABLE;
    if (failed.length > 0) status = MISSION_AVAILABILITY.LOCKED;
    else if (weather.delayed) {
      status = MISSION_AVAILABILITY.DELAYED;
      reasons.push(weather.reason);
    } else if (!weather.allowed) {
      status = MISSION_AVAILABILITY.BLOCKED;
      reasons.push(weather.reason);
    }
    return deepFreeze({
      missionId: mission.id,
      available: status === MISSION_AVAILABILITY.AVAILABLE,
      status,
      reasons,
      prerequisites: prerequisiteResults,
      weather
    });
  }

  prepare(missionId, context = {}) {
    this.#requirePhase(MISSION_PHASES.IDLE);
    const availability = this.evaluateAvailability(missionId, context);
    if (!availability.available) {
      throw new MissionLifecycleError(availability.reasons[0] || 'Mission is unavailable.', {
        code: `MISSION_${availability.status}`,
        details: availability
      });
    }
    this.#commit(MISSION_PHASES.PREPARATION, { selectedMissionId: missionId }, { availability });
    return this.snapshot();
  }

  beginBriefing() {
    this.#requirePhase(MISSION_PHASES.PREPARATION);
    this.#commit(MISSION_PHASES.BRIEFING);
    return this.snapshot();
  }

  abandonBriefing() {
    if (![MISSION_PHASES.PREPARATION, MISSION_PHASES.BRIEFING].includes(this.phase)) return false;
    this.#resetToIdle({ reason: 'briefing-abandoned' });
    return true;
  }

  accept({ choice = null, baseTimeLimit, baseReward } = {}) {
    this.#requirePhase(MISSION_PHASES.BRIEFING);
    const mission = this.currentMission;
    assertFiniteNumber(baseTimeLimit, 'mission baseTimeLimit');
    assertFiniteNumber(baseReward, 'mission baseReward');
    if (baseTimeLimit <= 0 || baseReward < 0) {
      throw new RangeError('mission baseTimeLimit must be positive and baseReward cannot be negative');
    }
    const availability = this.evaluateAvailability(mission);
    if (!availability.available) {
      throw new MissionLifecycleError(availability.reasons[0], { code: `MISSION_${availability.status}`, details: availability });
    }
    const runCounts = new Map(this.#state.progress.runCounts);
    const runNumber = (runCounts.get(mission.id) || 0) + 1;
    runCounts.set(mission.id, runNumber);
    const weather = availability.weather;
    const retryPolicy = normalizeRetryPolicy(mission);
    const run = {
      runId: `${mission.id}:run-${runNumber}`,
      missionId: mission.id,
      objective: objectiveOf(mission),
      runNumber,
      attempt: 1,
      retryPolicy,
      weather,
      choice: choice == null ? null : clone(choice),
      initialTimeLimit: baseTimeLimit * weather.timeLimitMultiplier,
      baseReward: Math.round(baseReward * weather.rewardMultiplier),
      checkpoint: null,
      resolution: null,
      transactionId: null,
      receipt: null,
      cleanupError: null
    };
    this.#state.progress.runCounts = [...runCounts];
    this.#commit(MISSION_PHASES.APPROACH, { run });
    return this.snapshot();
  }

  beginExecution() {
    this.#requirePhase(MISSION_PHASES.APPROACH);
    this.#commit(MISSION_PHASES.ACTIVE);
    return this.snapshot();
  }

  recordCheckpoint(checkpointId, payload = {}) {
    this.#requirePhase(MISSION_PHASES.ACTIVE);
    const sequence = (this.#state.run.checkpoint?.sequence || 0) + 1;
    const checkpoint = {
      id: assertId(checkpointId, 'checkpointId'),
      sequence,
      payload: clone(payload)
    };
    this.#commit(MISSION_PHASES.CHECKPOINT, { run: { ...this.#state.run, checkpoint } }, { checkpoint });
    return this.snapshot();
  }

  resumeFromCheckpoint() {
    this.#requirePhase(MISSION_PHASES.CHECKPOINT);
    this.#commit(MISSION_PHASES.ACTIVE);
    return this.snapshot();
  }

  resolveSuccess(result = {}) { return this.#resolve('SUCCESS', result, MISSION_PHASES.COMPLETION); }

  resolveFailure(reason, result = {}) {
    return this.#resolve('FAILURE', { ...result, reason: assertId(reason, 'failure reason') }, MISSION_PHASES.FAILURE);
  }

  beginCleanup() {
    if (![MISSION_PHASES.COMPLETION, MISSION_PHASES.FAILURE].includes(this.phase)) {
      this.#reject(`Cannot begin cleanup from ${this.phase}`, 'INVALID_MISSION_PHASE');
    }
    const transactionId = `mission:${this.#state.run.runId}:attempt-${this.#state.run.attempt}:${this.#state.run.resolution.outcome}`;
    this.#commit(MISSION_PHASES.CLEANUP, {
      run: { ...this.#state.run, transactionId, cleanupError: null }
    });
    return this.snapshot();
  }

  createOutcomeTransaction({ commands = [], title = null, description = null } = {}) {
    this.#requirePhase(MISSION_PHASES.CLEANUP);
    const mission = this.currentMission;
    const run = this.#state.run;
    const payout = run.resolution.outcome === 'SUCCESS' ? run.resolution.payout ?? run.baseReward : 0;
    const normalizedCommands = commands.length > 0
      ? clone(commands)
      : [{
          type: MISSION_OUTCOME_COMMANDS.CAPITAL_ADJUSTED,
          amount: payout,
          reason: run.resolution.outcome === 'SUCCESS'
            ? `${mission.title} paid ${payout.toLocaleString('en-US')} Capital.`
            : `${mission.title} ended without a Capital reward.`
        }];
    return deepFreeze({
      transactionId: run.transactionId,
      source: {
        kind: OUTCOME_SOURCE_KINDS.MISSION,
        contentId: mission.id,
        outcome: run.resolution.outcome,
        runId: run.runId,
        reason: run.resolution.reason || null
      },
      summary: {
        title: title || (run.resolution.outcome === 'SUCCESS' ? `${mission.title} complete` : `${mission.title} failed`),
        description: description || run.resolution.summary || (
          run.resolution.outcome === 'SUCCESS'
            ? `The mission completed and its city consequences were committed.`
            : `The mission failed; recovery remains available under its retry policy.`
        )
      },
      commands: normalizedCommands
    });
  }

  commitCleanup(receipt) {
    this.#requirePhase(MISSION_PHASES.CLEANUP);
    if (!receipt || receipt.transactionId !== this.#state.run.transactionId) {
      this.#reject('Cleanup receipt does not match the active mission transaction', 'INVALID_OUTCOME_RECEIPT');
    }
    const progress = clone(this.#state.progress);
    if (this.#state.run.resolution.outcome === 'SUCCESS') {
      progress.completedMissionIds = [...new Set([...progress.completedMissionIds, this.currentMission.id])];
      progress.chronologyStep = Math.max(progress.chronologyStep, progress.completedMissionIds.length);
    }
    this.#commit(MISSION_PHASES.RESULT, {
      progress,
      run: { ...this.#state.run, receipt: clone(receipt), cleanupError: null }
    }, { receipt });
    return this.snapshot();
  }

  recordCleanupFailure(error) {
    this.#requirePhase(MISSION_PHASES.CLEANUP);
    const message = error?.message || String(error || 'Unknown mission cleanup failure');
    this.#commit(MISSION_PHASES.CLEANUP, {
      run: { ...this.#state.run, cleanupError: message }
    }, { cleanupError: message });
    return this.snapshot();
  }

  getRetryDecision() {
    if (this.phase !== MISSION_PHASES.RESULT || this.#state.run?.resolution?.outcome !== 'FAILURE') {
      return deepFreeze({ allowed: false, reason: 'Only a failed mission result can be retried.', strategy: null, checkpoint: null });
    }
    const { retryPolicy, attempt, checkpoint } = this.#state.run;
    if (retryPolicy.strategy === MISSION_RETRY_STRATEGIES.NO_RETRY) {
      return deepFreeze({ allowed: false, reason: 'This activity does not support retry.', strategy: retryPolicy.strategy, checkpoint: null });
    }
    if (attempt >= retryPolicy.maxAttempts) {
      return deepFreeze({ allowed: false, reason: `Retry limit reached (${retryPolicy.maxAttempts} attempts).`, strategy: retryPolicy.strategy, checkpoint: null });
    }
    const selectedCheckpoint = retryPolicy.strategy === MISSION_RETRY_STRATEGIES.LAST_CHECKPOINT ? checkpoint : null;
    return deepFreeze({
      allowed: true,
      reason: selectedCheckpoint ? `Retry from ${selectedCheckpoint.id}.` : 'Restart from mission approach.',
      strategy: retryPolicy.strategy,
      checkpoint: clone(selectedCheckpoint),
      nextAttempt: attempt + 1,
      attemptsRemaining: retryPolicy.maxAttempts - attempt
    });
  }

  beginRecovery({ retry = false } = {}) {
    this.#requirePhase(MISSION_PHASES.RESULT);
    const decision = retry ? this.getRetryDecision() : null;
    if (retry && !decision.allowed) {
      throw new MissionLifecycleError(decision.reason, { code: 'MISSION_RETRY_UNAVAILABLE', details: decision });
    }
    const run = retry
      ? {
          ...this.#state.run,
          attempt: decision.nextAttempt,
          resolution: null,
          transactionId: null,
          receipt: null,
          cleanupError: null
        }
      : this.#state.run;
    this.#commit(MISSION_PHASES.RECOVERY, { run }, { retry, decision });
    return deepFreeze({ snapshot: this.snapshot(), retry, decision });
  }

  finishRecovery({ retry = false } = {}) {
    this.#requirePhase(MISSION_PHASES.RECOVERY);
    if (retry) {
      this.#commit(MISSION_PHASES.APPROACH);
    } else {
      this.#resetToIdle({ reason: 'result-acknowledged' });
    }
    return this.snapshot();
  }

  canSave() {
    const blocked = SAVE_BLOCKING_PHASES.has(this.phase);
    return deepFreeze({
      allowed: !blocked,
      code: blocked ? 'MISSION_COMMIT_IN_PROGRESS' : null,
      reason: blocked ? `Saving is deferred while mission ${this.phase.toLowerCase()} is being committed.` : null
    });
  }

  recordDialogueChoice(missionId, nodeId, choice) {
    const entry = {
      missionId: assertId(missionId, 'dialogue missionId'),
      nodeId: assertId(nodeId, 'dialogue nodeId'),
      choice: assertId(choice?.label, 'dialogue choice label'),
      next: assertId(choice?.next, 'dialogue choice next')
    };
    this.#state.progress.dialogueChoices.push(entry);
    this.#touch({ type: 'DIALOGUE_CHOICE_RECORDED', entry });
    return deepFreeze(clone(entry));
  }

  serialize() { return clone(this.#state); }

  restore(value, { contentRegistry = null } = {}) {
    validateMissionLifecycleState(value, { contentRegistry });
    if (value.selectedMissionId && !this.#missions.has(value.selectedMissionId)) {
      throw new RangeError(`Mission lifecycle cannot restore unavailable mission ${value.selectedMissionId}`);
    }
    this.#state = clone(value);
    this.#publish({ type: 'RESTORED' });
    return this.snapshot();
  }

  restoreProgress(progress) {
    this.#state.progress = normalizeProgress(progress);
    this.#touch({ type: 'PROGRESS_RESTORED' });
    return this.progressSnapshot();
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('mission lifecycle listener must be a function');
    this.#listeners.add(listener);
    if (emitCurrent) listener(deepFreeze({ type: 'SNAPSHOT', current: this.snapshot() }));
    return () => this.#listeners.delete(listener);
  }

  #evaluatePrerequisite(requirement) {
    const source = typeof requirement === 'string'
      ? { type: MISSION_PREREQUISITE_TYPES.MISSION_COMPLETED, missionId: requirement }
      : requirement;
    assertRecord(source, 'mission prerequisite');
    const type = assertId(source.type, 'mission prerequisite.type').toUpperCase();
    let passed = false;
    let reason = source.reason || null;
    if (type === MISSION_PREREQUISITE_TYPES.MISSION_COMPLETED) {
      const missionId = assertId(source.missionId, 'mission prerequisite.missionId');
      passed = this.#state.progress.completedMissionIds.includes(missionId);
      reason ||= `Complete ${this.#missions.get(missionId)?.title || missionId} first.`;
    } else if (type === MISSION_PREREQUISITE_TYPES.FOLLOW_UP_STATUS) {
      const missionId = assertId(source.missionId, 'mission prerequisite.missionId');
      const expected = assertId(source.status || 'AVAILABLE', 'mission prerequisite.status').toUpperCase();
      const actual = this.#outcomeService?.snapshot?.().followUpMissions?.[missionId]?.status ?? null;
      passed = actual === expected;
      reason ||= `${this.#missions.get(missionId)?.title || missionId} must be ${expected.toLowerCase()}.`;
    } else if (type === MISSION_PREREQUISITE_TYPES.CITY_CONDITION) {
      if (!this.#conditionService?.evaluate) {
        passed = false;
        reason ||= 'Required city conditions cannot currently be evaluated.';
      } else {
        const evaluation = this.#conditionService.evaluate(source.requirement);
        passed = evaluation.passed;
        reason ||= source.requirement?.reason || 'Required city conditions are not met.';
      }
    } else {
      throw new RangeError(`Unsupported mission prerequisite type: ${type}`);
    }
    return deepFreeze({ passed, reason, requirement: clone(source) });
  }

  #resolve(outcome, result, phase) {
    this.#requirePhase(MISSION_PHASES.ACTIVE);
    const resolution = { outcome, ...clone(result) };
    this.#commit(phase, { run: { ...this.#state.run, resolution } }, { resolution });
    return this.snapshot();
  }

  #requirePhase(...allowed) {
    if (!allowed.includes(this.phase)) {
      this.#reject(`Mission phase ${this.phase} is invalid; expected ${allowed.join(' or ')}`, 'INVALID_MISSION_PHASE');
    }
  }

  #reject(message, code) {
    throw new MissionLifecycleError(message, { code, details: { phase: this.phase } });
  }

  #resetToIdle(detail) {
    const previousPhase = this.#state.phase;
    const progress = this.#state.progress;
    this.#state = {
      ...createInitialState(),
      revision: this.#state.revision + 1,
      progress
    };
    this.#publish({ type: 'PHASE_CHANGED', previousPhase, detail });
  }

  #commit(phase, patch = {}, detail = {}) {
    const previousPhase = this.#state.phase;
    this.#state = {
      ...this.#state,
      ...clone(patch),
      phase,
      revision: this.#state.revision + 1
    };
    this.#publish({ type: 'PHASE_CHANGED', previousPhase, detail });
  }

  #touch(detail) {
    this.#state.revision += 1;
    this.#publish(detail);
  }

  #publish(event) {
    const immutable = deepFreeze({ ...clone(event), current: this.snapshot() });
    for (const listener of [...this.#listeners]) {
      try { listener(immutable); } catch (error) { console.error('Mission lifecycle listener failed.', error); }
    }
  }
}

export default MissionLifecycleController;
