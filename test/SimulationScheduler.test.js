import test from 'node:test';
import assert from 'node:assert/strict';

import { CLOCK_POLICIES } from '../src/core/GameState.js';
import {
  SIMULATION_CLOCKS,
  SIMULATION_STAGES,
  SimulationScheduler
} from '../src/core/SimulationScheduler.js';
import { createMetroPulseSimulationScheduler } from '../src/app/MetroPulseSimulationSchedule.js';
import { MetroPulseTransitionRuntime } from '../src/app/MetroPulseTransitionRuntime.js';

function scheduler(options = {}) {
  return new SimulationScheduler({
    fixedPhysicsStep: 1,
    cityStep: 1,
    maxFrameDelta: 1,
    ...options
  });
}

test('runs the declared stage pipeline in stable order', () => {
  const calls = [];
  const subject = scheduler({ initialClockPolicy: CLOCK_POLICIES.CITY });
  const stages = [
    SIMULATION_STAGES.INPUT,
    SIMULATION_STAGES.FIXED_PHYSICS,
    SIMULATION_STAGES.GAMEPLAY,
    SIMULATION_STAGES.CITY,
    SIMULATION_STAGES.PRESENTATION,
    SIMULATION_STAGES.CAMERA,
    SIMULATION_STAGES.RENDER
  ];

  stages.forEach((stage, index) => {
    subject.registerTask({
      id: `task-${index}`,
      stage,
      update: () => calls.push(stage)
    });
  });
  subject.registerTask({
    id: 'gameplay-first',
    stage: SIMULATION_STAGES.GAMEPLAY,
    order: -1,
    update: () => calls.push('GAMEPLAY_FIRST')
  });

  subject.advanceFrame(1);

  assert.deepEqual(calls, [
    'INPUT',
    'FIXED_PHYSICS',
    'GAMEPLAY_FIRST',
    'GAMEPLAY',
    'CITY',
    'PRESENTATION',
    'CAMERA',
    'RENDER'
  ]);
});

test('separates render, gameplay, fixed physics, city, UI, and paused clocks', () => {
  const subject = scheduler({
    fixedPhysicsStep: 0.25,
    initialClockPolicy: CLOCK_POLICIES.PAUSED
  });
  let gameplayUpdates = 0;
  let uiUpdates = 0;
  let renderUpdates = 0;
  subject.registerTask({
    id: 'gameplay',
    stage: SIMULATION_STAGES.GAMEPLAY,
    update: () => { gameplayUpdates += 1; }
  });
  subject.registerTask({
    id: 'ui',
    stage: SIMULATION_STAGES.PRESENTATION,
    update: () => { uiUpdates += 1; }
  });
  subject.registerTask({
    id: 'render',
    stage: SIMULATION_STAGES.RENDER,
    update: () => { renderUpdates += 1; }
  });

  const paused = subject.advanceFrame(0.5);
  assert.equal(paused.paused, true);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.RENDER].elapsed, 0.5);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.UI].elapsed, 0.5);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.PAUSED].elapsed, 0.5);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed, 0);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.PHYSICS].elapsed, 0);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.CITY].elapsed, 0);
  assert.equal(gameplayUpdates, 0);
  assert.equal(uiUpdates, 1);
  assert.equal(renderUpdates, 1);

  subject.setClockPolicy(CLOCK_POLICIES.STREET);
  const resumed = subject.advanceFrame(0.5);
  assert.equal(resumed.clocks[SIMULATION_CLOCKS.PAUSED].elapsed, 0.5);
  assert.equal(resumed.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed, 0.5);
  assert.equal(resumed.clocks[SIMULATION_CLOCKS.PHYSICS].elapsed, 0.5);
  assert.equal(gameplayUpdates, 1);
});

test('fixed-step and city accumulators preserve fractional remainder', () => {
  const physicsDeltas = [];
  const cityDeltas = [];
  const subject = scheduler({
    fixedPhysicsStep: 0.1,
    initialClockPolicy: CLOCK_POLICIES.CITY
  });
  subject.registerTask({
    id: 'physics',
    stage: SIMULATION_STAGES.FIXED_PHYSICS,
    update: delta => physicsDeltas.push(delta)
  });
  subject.registerTask({
    id: 'city',
    stage: SIMULATION_STAGES.CITY,
    update: delta => cityDeltas.push(delta)
  });

  let snapshot = subject.advanceFrame(0.6);
  assert.equal(physicsDeltas.length, 6);
  assert.deepEqual(cityDeltas, []);
  assert.ok(Math.abs(snapshot.cityRemainder - 0.6) < 1e-9);

  snapshot = subject.advanceFrame(0.6);
  assert.equal(physicsDeltas.length, 12);
  assert.deepEqual(cityDeltas, [1]);
  assert.ok(Math.abs(snapshot.cityRemainder - 0.2) < 1e-9);

  snapshot = subject.advanceFrame(0.8);
  assert.equal(physicsDeltas.length, 20);
  assert.deepEqual(cityDeltas, [1, 1]);
  assert.ok(Math.abs(snapshot.cityRemainder) < 1e-9);
});

test('catch-up budgets retain backlog instead of dropping elapsed time', () => {
  const subject = scheduler({
    fixedPhysicsStep: 0.1,
    maxPhysicsStepsPerFrame: 2,
    maxCityTicksPerFrame: 1,
    initialClockPolicy: CLOCK_POLICIES.CITY,
    getCityTimeScale: () => 5
  });

  let snapshot = subject.advanceFrame(1);
  assert.equal(snapshot.lastFrame.physicsSteps, 2);
  assert.equal(snapshot.lastFrame.cityTicks, 1);
  assert.ok(Math.abs(snapshot.physicsRemainder - 0.8) < 1e-9);
  assert.ok(Math.abs(snapshot.cityRemainder - 4) < 1e-9);

  snapshot = subject.advanceFrame(0);
  assert.equal(snapshot.lastFrame.physicsSteps, 0);
  assert.equal(snapshot.lastFrame.cityTicks, 0);
  assert.ok(Math.abs(snapshot.physicsRemainder - 0.8) < 1e-9);
  assert.ok(Math.abs(snapshot.cityRemainder - 4) < 1e-9);
});

test('Street policy forces city time to 1x while management allows its multiplier', () => {
  const street = scheduler({
    initialClockPolicy: CLOCK_POLICIES.STREET,
    getCityTimeScale: () => 15
  });
  const management = scheduler({
    initialClockPolicy: CLOCK_POLICIES.CITY,
    getCityTimeScale: () => 15
  });

  assert.equal(street.advanceFrame(1).lastFrame.cityTicks, 1);
  assert.equal(street.snapshot().lastFrame.cityTimeScale, 1);
  assert.equal(management.advanceFrame(1).lastFrame.cityTicks, 15);
  assert.equal(management.snapshot().lastFrame.cityTimeScale, 15);

  street.getCityTimeScale = () => 0.5;
  assert.equal(street.advanceFrame(1).lastFrame.cityTimeScale, 1);
  street.getCityTimeScale = () => 0;
  assert.equal(street.advanceFrame(1).lastFrame.cityTimeScale, 0);
});

test('stopped policies gate simulation while keeping input, presentation, and rendering live', () => {
  const calls = [];
  const subject = scheduler({ initialClockPolicy: CLOCK_POLICIES.RESULT });
  for (const stage of Object.values(SIMULATION_STAGES)) {
    subject.registerTask({
      id: stage,
      stage,
      update: () => calls.push(stage)
    });
  }

  subject.advanceFrame(1);
  assert.deepEqual(calls, [
    SIMULATION_STAGES.INPUT,
    SIMULATION_STAGES.PRESENTATION,
    SIMULATION_STAGES.CAMERA,
    SIMULATION_STAGES.RENDER
  ]);
});

test('an input-stage state change gates the same frame without a pause leak', () => {
  const pausing = scheduler({ initialClockPolicy: CLOCK_POLICIES.CITY });
  let pausedGameplayUpdates = 0;
  pausing.registerTask({
    id: 'pause-request',
    stage: SIMULATION_STAGES.INPUT,
    update: () => pausing.setClockPolicy(CLOCK_POLICIES.PAUSED)
  });
  pausing.registerTask({
    id: 'paused-gameplay',
    stage: SIMULATION_STAGES.GAMEPLAY,
    update: () => { pausedGameplayUpdates += 1; }
  });

  const paused = pausing.advanceFrame(0.25);
  assert.equal(pausedGameplayUpdates, 0);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed, 0);
  assert.equal(paused.clocks[SIMULATION_CLOCKS.PAUSED].elapsed, 0.25);

  const resuming = scheduler({ initialClockPolicy: CLOCK_POLICIES.PAUSED });
  let resumedGameplayUpdates = 0;
  resuming.registerTask({
    id: 'resume-request',
    stage: SIMULATION_STAGES.INPUT,
    update: () => resuming.setClockPolicy(CLOCK_POLICIES.STREET)
  });
  resuming.registerTask({
    id: 'resumed-gameplay',
    stage: SIMULATION_STAGES.GAMEPLAY,
    update: () => { resumedGameplayUpdates += 1; }
  });

  const resumed = resuming.advanceFrame(0.25);
  assert.equal(resumedGameplayUpdates, 1);
  assert.equal(resumed.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed, 0.25);
  assert.equal(resumed.clocks[SIMULATION_CLOCKS.PAUSED].elapsed, 0);
});

test('task registration is unique, deterministic, predicate-gated, and removable', () => {
  const subject = scheduler();
  let calls = 0;
  const unregister = subject.registerTask({
    id: 'optional-ui',
    stage: SIMULATION_STAGES.PRESENTATION,
    enabled: context => context.frame > 1,
    update: () => { calls += 1; }
  });

  assert.throws(() => subject.registerTask({
    id: 'optional-ui',
    stage: SIMULATION_STAGES.RENDER,
    update() {}
  }), /already registered/);
  subject.advanceFrame(0.1);
  subject.advanceFrame(0.1);
  assert.equal(calls, 1);
  assert.equal(unregister(), true);
  assert.equal(unregister(), false);
  subject.advanceFrame(0.1);
  assert.equal(calls, 1);
});

test('timestamp frames clamp simulation deltas but retain real render time', () => {
  const subject = scheduler({
    maxFrameDelta: 0.1,
    initialClockPolicy: CLOCK_POLICIES.STREET
  });

  subject.runFrame(1_000);
  subject.runFrame(2_000);
  const snapshot = subject.snapshot();
  assert.equal(snapshot.clocks[SIMULATION_CLOCKS.RENDER].elapsed, 1);
  assert.equal(snapshot.clocks[SIMULATION_CLOCKS.UI].elapsed, 0.1);
  assert.equal(snapshot.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed, 0.1);
});

test('production schedule advances time and economy once per logical city tick', () => {
  const timeCalls = [];
  const economyCalls = [];
  const app = {
    frameCount: 0,
    fpsTimer: 0,
    currentFps: 60,
    timeManager: {
      isPlaying: true,
      speed: 15,
      timeVal: 12,
      advance(delta, speed) { timeCalls.push([delta, speed]); },
      updatePresentation() {}
    },
    economySystem: {
      update(delta) { economyCalls.push(delta); }
    },
    performanceSystem: {
      beginFrame() {},
      recordFrameRate() {}
    },
    trafficSystem: { vehicles: [] },
    pedestrianSystem: { pedestrians: [] },
    uiManager: { updateStats() {} }
  };
  const subject = createMetroPulseSimulationScheduler(app);
  subject.setClockPolicy(CLOCK_POLICIES.CITY);

  let snapshot = subject.advanceFrame(0.1);
  assert.deepEqual(timeCalls, [[1, 1]]);
  assert.deepEqual(economyCalls, [1]);
  assert.ok(Math.abs(snapshot.cityRemainder - 0.5) < 1e-9);

  const streetApp = {
    ...app,
    frameCount: 0,
    fpsTimer: 0,
    timeManager: { ...app.timeManager, speed: 0.5 }
  };
  const street = createMetroPulseSimulationScheduler(streetApp);
  street.setClockPolicy(CLOCK_POLICIES.STREET);
  snapshot = street.advanceFrame(1);
  assert.equal(snapshot.lastFrame.cityTimeScale, 1);
  assert.equal(snapshot.lastFrame.cityTicks, 0);
  assert.ok(Math.abs(snapshot.cityRemainder - 0.1) < 1e-9);
});

test('transition configuration and compensation move the authoritative clock policy', () => {
  const clock = scheduler({ initialClockPolicy: CLOCK_POLICIES.CITY });
  const runtime = Object.create(MetroPulseTransitionRuntime.prototype);
  runtime.app = { scheduler: clock, simulationClockPolicy: CLOCK_POLICIES.CITY };

  runtime.configureSimulation({
    transition: {
      effects: { simulationClock: { to: CLOCK_POLICIES.PAUSED } }
    }
  });
  assert.equal(clock.clockPolicy, CLOCK_POLICIES.PAUSED);
  assert.equal(runtime.app.simulationClockPolicy, CLOCK_POLICIES.PAUSED);

  runtime.restoreSourceState({
    sourceState: {
      poses: [],
      control: {},
      controlSessions: {},
      camera: null,
      clockPolicy: CLOCK_POLICIES.CITY,
      editorVisible: false
    }
  });
  assert.equal(clock.clockPolicy, CLOCK_POLICIES.CITY);
  assert.equal(runtime.app.simulationClockPolicy, CLOCK_POLICIES.CITY);
});
