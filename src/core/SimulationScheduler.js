import { CLOCK_POLICIES } from './GameState.js';

export const SIMULATION_CLOCKS = Object.freeze({
  RENDER: 'RENDER',
  GAMEPLAY: 'GAMEPLAY_REAL_TIME',
  PHYSICS: 'PHYSICS_FIXED',
  CITY: 'CITY_LOGICAL',
  UI: 'UI',
  PAUSED: 'PAUSED'
});

export const SIMULATION_STAGES = Object.freeze({
  INPUT: 'INPUT',
  FIXED_PHYSICS: 'FIXED_PHYSICS',
  GAMEPLAY: 'GAMEPLAY',
  CITY: 'CITY',
  PRESENTATION: 'PRESENTATION',
  CAMERA: 'CAMERA',
  RENDER: 'RENDER'
});

export const SIMULATION_STAGE_ORDER = Object.freeze([
  SIMULATION_STAGES.INPUT,
  SIMULATION_STAGES.FIXED_PHYSICS,
  SIMULATION_STAGES.GAMEPLAY,
  SIMULATION_STAGES.CITY,
  SIMULATION_STAGES.PRESENTATION,
  SIMULATION_STAGES.CAMERA,
  SIMULATION_STAGES.RENDER
]);

const STAGE_CLOCKS = Object.freeze({
  [SIMULATION_STAGES.INPUT]: SIMULATION_CLOCKS.UI,
  [SIMULATION_STAGES.FIXED_PHYSICS]: SIMULATION_CLOCKS.PHYSICS,
  [SIMULATION_STAGES.GAMEPLAY]: SIMULATION_CLOCKS.GAMEPLAY,
  [SIMULATION_STAGES.CITY]: SIMULATION_CLOCKS.CITY,
  [SIMULATION_STAGES.PRESENTATION]: SIMULATION_CLOCKS.UI,
  [SIMULATION_STAGES.CAMERA]: SIMULATION_CLOCKS.RENDER,
  [SIMULATION_STAGES.RENDER]: SIMULATION_CLOCKS.RENDER
});

const ACTIVE_GAMEPLAY_POLICIES = new Set([
  CLOCK_POLICIES.CITY,
  CLOCK_POLICIES.BUILDER,
  CLOCK_POLICIES.STREET
]);

const ACTIVE_CITY_POLICIES = new Set([
  CLOCK_POLICIES.CITY,
  CLOCK_POLICIES.BUILDER,
  CLOCK_POLICIES.STREET
]);

const MULTIPLIED_CITY_POLICIES = new Set([
  CLOCK_POLICIES.CITY,
  CLOCK_POLICIES.BUILDER
]);

const VALID_CLOCK_POLICIES = new Set(Object.values(CLOCK_POLICIES));
const VALID_STAGES = new Set(SIMULATION_STAGE_ORDER);
const EPSILON = 1e-9;

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
}

function normalizeDelta(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function createClock() {
  return { delta: 0, elapsed: 0, ticks: 0 };
}

function snapshotClock(clock) {
  return Object.freeze({
    delta: clock.delta,
    elapsed: clock.elapsed,
    ticks: clock.ticks
  });
}

/**
 * Renderer-independent owner of MetroPulse's frame policy and clock domains.
 *
 * The scheduler intentionally knows nothing about Three.js, cannon-es, the DOM,
 * or individual game systems. The composition root registers small tasks in a
 * documented stage; the scheduler supplies timing, ordering, and state gates.
 */
export class SimulationScheduler {
  constructor({
    fixedPhysicsStep = 1 / 120,
    cityStep = 1,
    maxFrameDelta = 0.1,
    maxPhysicsStepsPerFrame = 10,
    maxCityTicksPerFrame = 30,
    getCityTimeScale = () => 1,
    initialClockPolicy = CLOCK_POLICIES.STOPPED
  } = {}) {
    assertPositiveFinite(fixedPhysicsStep, 'fixedPhysicsStep');
    assertPositiveFinite(cityStep, 'cityStep');
    assertPositiveFinite(maxFrameDelta, 'maxFrameDelta');
    if (!Number.isInteger(maxPhysicsStepsPerFrame) || maxPhysicsStepsPerFrame < 1) {
      throw new RangeError('maxPhysicsStepsPerFrame must be a positive integer');
    }
    if (!Number.isInteger(maxCityTicksPerFrame) || maxCityTicksPerFrame < 1) {
      throw new RangeError('maxCityTicksPerFrame must be a positive integer');
    }
    if (typeof getCityTimeScale !== 'function') {
      throw new TypeError('getCityTimeScale must be a function');
    }

    this.fixedPhysicsStep = fixedPhysicsStep;
    this.cityStep = cityStep;
    this.maxFrameDelta = maxFrameDelta;
    this.maxPhysicsStepsPerFrame = maxPhysicsStepsPerFrame;
    this.maxCityTicksPerFrame = maxCityTicksPerFrame;
    this.getCityTimeScale = getCityTimeScale;
    this.clockPolicy = CLOCK_POLICIES.STOPPED;
    this.tasks = new Map(SIMULATION_STAGE_ORDER.map(stage => [stage, []]));
    this.taskIds = new Set();
    this.registrationSerial = 0;
    this.frame = 0;
    this.lastTimestampMs = null;
    this.physicsAccumulator = 0;
    this.cityAccumulator = 0;
    this.lastFrameStats = Object.freeze({ physicsSteps: 0, cityTicks: 0, cityTimeScale: 0 });
    this.clocks = Object.fromEntries(
      Object.values(SIMULATION_CLOCKS).map(clock => [clock, createClock()])
    );
    this.setClockPolicy(initialClockPolicy);
  }

  get paused() {
    return this.clockPolicy === CLOCK_POLICIES.PAUSED;
  }

  get gameplayActive() {
    return ACTIVE_GAMEPLAY_POLICIES.has(this.clockPolicy);
  }

  get cityActive() {
    return ACTIVE_CITY_POLICIES.has(this.clockPolicy);
  }

  setClockPolicy(clockPolicy) {
    if (!VALID_CLOCK_POLICIES.has(clockPolicy)) {
      throw new RangeError(`Unknown simulation clock policy: ${String(clockPolicy)}`);
    }
    this.clockPolicy = clockPolicy;
    return this.clockPolicy;
  }

  registerTask({ id, stage, update, order = 0, enabled = null }) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('task id must be a non-empty string');
    }
    if (this.taskIds.has(id)) throw new Error(`Simulation task already registered: ${id}`);
    if (!VALID_STAGES.has(stage)) throw new RangeError(`Unknown simulation stage: ${String(stage)}`);
    if (typeof update !== 'function') throw new TypeError('task update must be a function');
    if (!Number.isFinite(order)) throw new TypeError('task order must be finite');
    if (enabled !== null && typeof enabled !== 'function') {
      throw new TypeError('task enabled predicate must be a function or null');
    }

    const task = {
      id,
      stage,
      update,
      order,
      enabled,
      serial: this.registrationSerial++
    };
    const stageTasks = this.tasks.get(stage);
    stageTasks.push(task);
    stageTasks.sort((left, right) => left.order - right.order || left.serial - right.serial);
    this.taskIds.add(id);

    let registered = true;
    return () => {
      if (!registered) return false;
      registered = false;
      this.taskIds.delete(id);
      const index = stageTasks.indexOf(task);
      if (index >= 0) stageTasks.splice(index, 1);
      return index >= 0;
    };
  }

  getCityTimeScaleForPolicy() {
    if (!this.cityActive) return 0;
    const requestedScale = Number(this.getCityTimeScale({
      clockPolicy: this.clockPolicy,
      frame: this.frame
    }));
    const safeScale = Number.isFinite(requestedScale) ? Math.max(0, requestedScale) : 0;
    return MULTIPLIED_CITY_POLICIES.has(this.clockPolicy)
      ? safeScale
      : (safeScale > 0 ? 1 : 0);
  }

  runFrame(timestampMs) {
    const timestamp = Number(timestampMs);
    if (!Number.isFinite(timestamp)) return this.#advanceFrame(0);
    if (this.lastTimestampMs === null) {
      this.lastTimestampMs = timestamp;
      return this.#advanceFrame(0);
    }
    const deltaSeconds = Math.max(0, (timestamp - this.lastTimestampMs) / 1000);
    this.lastTimestampMs = timestamp;
    return this.#advanceFrame(deltaSeconds);
  }

  resetFrameClock(timestampMs = null) {
    this.lastTimestampMs = Number.isFinite(timestampMs) ? Number(timestampMs) : null;
  }

  advanceFrame(realDeltaSeconds) {
    this.#advanceFrame(realDeltaSeconds);
    return this.snapshot();
  }

  #advanceFrame(realDeltaSeconds) {
    const renderDelta = normalizeDelta(realDeltaSeconds);
    const boundedDelta = Math.min(renderDelta, this.maxFrameDelta);
    this.frame += 1;

    this.#advanceClock(SIMULATION_CLOCKS.RENDER, renderDelta);
    this.#advanceClock(SIMULATION_CLOCKS.UI, boundedDelta);

    const frameContext = {
      frame: this.frame,
      clockPolicy: this.clockPolicy,
      renderDelta,
      boundedDelta,
      gameplayDelta: 0,
      cityTimeScale: 0,
      physicsAlpha: 0,
      clocks: this.clocks
    };

    this.#runStage(SIMULATION_STAGES.INPUT, boundedDelta, frameContext);

    // Input can synchronously request a state transition. Re-read the policy
    // here so pausing cannot leak one final physics/gameplay/city update.
    const gameplayDelta = this.gameplayActive ? boundedDelta : 0;
    const cityTimeScale = this.getCityTimeScaleForPolicy();
    frameContext.clockPolicy = this.clockPolicy;
    frameContext.gameplayDelta = gameplayDelta;
    frameContext.cityTimeScale = cityTimeScale;
    this.#advanceClock(SIMULATION_CLOCKS.GAMEPLAY, gameplayDelta);
    this.#advanceClock(SIMULATION_CLOCKS.PAUSED, this.paused ? renderDelta : 0);
    this.clocks[SIMULATION_CLOCKS.PHYSICS].delta = 0;
    this.clocks[SIMULATION_CLOCKS.CITY].delta = 0;

    let physicsSteps = 0;
    if (gameplayDelta > 0) {
      this.physicsAccumulator += gameplayDelta;
      while (
        this.physicsAccumulator + EPSILON >= this.fixedPhysicsStep
        && physicsSteps < this.maxPhysicsStepsPerFrame
      ) {
        this.#advanceClock(SIMULATION_CLOCKS.PHYSICS, this.fixedPhysicsStep);
        this.#runStage(SIMULATION_STAGES.FIXED_PHYSICS, this.fixedPhysicsStep, frameContext);
        this.physicsAccumulator -= this.fixedPhysicsStep;
        if (Math.abs(this.physicsAccumulator) < EPSILON) this.physicsAccumulator = 0;
        physicsSteps += 1;
      }
    }
    frameContext.physicsAlpha = Math.min(1, this.physicsAccumulator / this.fixedPhysicsStep);

    if (gameplayDelta > 0) {
      this.#runStage(SIMULATION_STAGES.GAMEPLAY, gameplayDelta, frameContext);
    }

    let cityTicks = 0;
    const cityDelta = gameplayDelta * cityTimeScale;
    if (cityDelta > 0) {
      this.cityAccumulator += cityDelta;
      while (
        this.cityAccumulator + EPSILON >= this.cityStep
        && cityTicks < this.maxCityTicksPerFrame
      ) {
        this.#advanceClock(SIMULATION_CLOCKS.CITY, this.cityStep);
        this.#runStage(SIMULATION_STAGES.CITY, this.cityStep, frameContext);
        this.cityAccumulator -= this.cityStep;
        if (Math.abs(this.cityAccumulator) < EPSILON) this.cityAccumulator = 0;
        cityTicks += 1;
      }
    }

    this.#runStage(SIMULATION_STAGES.PRESENTATION, boundedDelta, frameContext);
    this.#runStage(SIMULATION_STAGES.CAMERA, boundedDelta, frameContext);
    this.#runStage(SIMULATION_STAGES.RENDER, renderDelta, frameContext);

    this.lastFrameStats = Object.freeze({ physicsSteps, cityTicks, cityTimeScale });
    return this.lastFrameStats;
  }

  #advanceClock(clockName, delta) {
    const clock = this.clocks[clockName];
    clock.delta = delta;
    if (delta <= 0) return;
    clock.elapsed += delta;
    clock.ticks += 1;
  }

  #runStage(stage, delta, frameContext) {
    frameContext.stage = stage;
    frameContext.clock = STAGE_CLOCKS[stage];
    frameContext.delta = delta;
    for (const task of this.tasks.get(stage)) {
      if (task.enabled && !task.enabled(frameContext)) continue;
      task.update(delta, frameContext);
    }
  }

  snapshot() {
    return Object.freeze({
      frame: this.frame,
      clockPolicy: this.clockPolicy,
      paused: this.paused,
      gameplayActive: this.gameplayActive,
      cityActive: this.cityActive,
      fixedPhysicsStep: this.fixedPhysicsStep,
      cityStep: this.cityStep,
      physicsRemainder: this.physicsAccumulator,
      cityRemainder: this.cityAccumulator,
      lastFrame: this.lastFrameStats,
      clocks: Object.freeze(Object.fromEntries(
        Object.entries(this.clocks).map(([name, clock]) => [name, snapshotClock(clock)])
      ))
    });
  }
}

export default SimulationScheduler;
