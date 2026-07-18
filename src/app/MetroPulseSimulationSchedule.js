import {
  SIMULATION_CLOCKS,
  SIMULATION_STAGES,
  SimulationScheduler
} from '../core/SimulationScheduler.js';

const CITY_LOGICAL_STEP_SECONDS = 1;

function register(scheduler, id, stage, order, update, enabled = null) {
  scheduler.registerTask({ id, stage, order, update, enabled });
}

function updateFrameMetrics(app, delta) {
  app.frameCount += 1;
  app.fpsTimer += delta;
  if (app.fpsTimer < 1) return;

  app.currentFps = app.fpsTimer > 0 ? app.frameCount / app.fpsTimer : 0;
  app.performanceSystem.recordFrameRate(app.currentFps);
  app.frameCount = 0;
  app.fpsTimer = 0;
  app.uiManager.updateStats(
    app.trafficSystem.vehicles.length,
    app.pedestrianSystem.pedestrians.length,
    app.currentFps
  );
}

function updateRocketSimulation(app, delta, context) {
  const cityBuilder = app.cityBuilder;
  if (!cityBuilder?.rocketFlame) return;

  if (!app.funMode) {
    cityBuilder.rocketFlame.visible = false;
    for (const vapor of cityBuilder.rocketVapors || []) vapor.visible = false;
    return;
  }

  if (!app.rocketLaunched && app.rocketCountdown > 0) {
    app.rocketCountdown = Math.max(0, app.rocketCountdown - delta);
    if (app.rocketCountdown <= 0) app.triggerRocketLaunch();
  } else if (app.rocketLaunched && cityBuilder.rocketGroup) {
    cityBuilder.rocketVelocityY += 45 * delta;
    cityBuilder.rocketAltitude += cityBuilder.rocketVelocityY * delta;
    cityBuilder.rocketGroup.position.y = cityBuilder.rocketAltitude;
  }

  const pulsePhase = context.clocks[SIMULATION_CLOCKS.GAMEPLAY].elapsed * 20;
  const pulse = (app.rocketLaunched ? 2.2 : 1) + Math.sin(pulsePhase) * 0.15;
  cityBuilder.rocketFlame.scale.set(
    pulse,
    pulse * (app.rocketLaunched ? 2.8 : 1.2),
    pulse
  );
  cityBuilder.rocketFlame.visible = true;

  const nozzleY = (cityBuilder.rocketGroup?.position.y || 1.5) + 17;
  for (const vapor of cityBuilder.rocketVapors || []) {
    vapor.visible = true;
    vapor.userData.age += delta * (app.rocketLaunched ? 2 : 1);
    const progress = vapor.userData.age / vapor.userData.lifetime;

    if (progress >= 1) {
      vapor.userData.age = 0;
      vapor.userData.lifetime = 1.5 + Math.random() * 1.5;
      vapor.userData.speedY = 8 + Math.random() * 6;
      vapor.userData.offsetX = (Math.random() - 0.5) * 1.5;
      vapor.userData.offsetZ = (Math.random() - 0.5) * 1.5;
      vapor.position.set(vapor.userData.offsetX, nozzleY, vapor.userData.offsetZ);
      vapor.scale.set(1, 1, 1);
      vapor.material.opacity = 0;
      continue;
    }

    vapor.position.y -= vapor.userData.speedY * delta;
    vapor.position.x += Math.sin(vapor.userData.age * 3 + vapor.userData.offsetX) * 2 * delta;
    vapor.position.z += Math.cos(vapor.userData.age * 3 + vapor.userData.offsetZ) * 2 * delta;
    const scale = 1 + progress * 4.5;
    vapor.scale.set(scale, scale, scale);
    vapor.material.opacity = progress < 0.2
      ? (progress / 0.2) * 0.45
      : (1 - progress) * 0.45;
  }
}

/**
 * Declares the production update pipeline without teaching the generic
 * scheduler about application systems. Numeric order is local to a stage and
 * leaves room for future tasks without changing unrelated registrations.
 */
export function createMetroPulseSimulationScheduler(app) {
  if (!app) throw new TypeError('app is required');

  const scheduler = new SimulationScheduler({
    cityStep: CITY_LOGICAL_STEP_SECONDS,
    getCityTimeScale: () => (
      app.timeManager?.isPlaying ? app.timeManager.speed : 0
    )
  });

  register(scheduler, 'input.sample', SIMULATION_STAGES.INPUT, 100,
    delta => app.inputManager?.update?.(delta));

  register(scheduler, 'physics.world', SIMULATION_STAGES.FIXED_PHYSICS, 100,
    delta => app.physicsWorld?.stepFixed?.(delta));

  register(scheduler, 'performance.spatial-index', SIMULATION_STAGES.GAMEPLAY, 100,
    () => app.performanceSystem?.beginFrame?.());
  register(scheduler, 'traffic.simulation', SIMULATION_STAGES.GAMEPLAY, 200,
    delta => app.trafficSystem?.update?.(delta));
  register(scheduler, 'pedestrians.simulation', SIMULATION_STAGES.GAMEPLAY, 300,
    delta => app.pedestrianSystem?.update?.(delta));
  register(scheduler, 'aircraft.simulation', SIMULATION_STAGES.GAMEPLAY, 400,
    delta => app.aircraftSystem?.update?.(delta));
  register(scheduler, 'effects.explosions', SIMULATION_STAGES.GAMEPLAY, 500,
    delta => app.explosionManager?.update?.(delta));
  register(scheduler, 'effects.comets', SIMULATION_STAGES.GAMEPLAY, 510,
    delta => app.cometManager?.update?.(delta));
  register(scheduler, 'traffic.heatmap', SIMULATION_STAGES.GAMEPLAY, 600,
    delta => app.trafficHeatmapSystem?.update?.(delta));
  register(scheduler, 'audio.world', SIMULATION_STAGES.GAMEPLAY, 700,
    delta => app.audioSystem?.update?.(app.timeManager.timeVal, delta));
  register(scheduler, 'missions.lifecycle', SIMULATION_STAGES.GAMEPLAY, 800,
    delta => app.missionSystem?.update?.(delta));
  register(scheduler, 'world.city-builder', SIMULATION_STAGES.GAMEPLAY, 900,
    delta => app.cityBuilder?.update?.(delta));
  register(scheduler, 'world.rocket', SIMULATION_STAGES.GAMEPLAY, 910,
    (delta, context) => updateRocketSimulation(app, delta, context));

  // Time-of-day advances before economy so every city tick observes the same
  // authoritative logical instant. Both receive exactly one logical second.
  register(scheduler, 'city.time-of-day', SIMULATION_STAGES.CITY, 100,
    delta => app.timeManager?.advance?.(delta, 1));
  register(scheduler, 'city.economy', SIMULATION_STAGES.CITY, 200,
    delta => app.economySystem?.update?.(delta));

  // Presentation is intentionally independent of gameplay/city scaling. World
  // presentation is gated when gameplay is stopped; DOM/menu work remains live.
  register(scheduler, 'world.presentation', SIMULATION_STAGES.PRESENTATION, 100,
    delta => app.timeManager?.updatePresentation?.(delta),
    context => context.gameplayDelta > 0);
  register(scheduler, 'ui.inspector', SIMULATION_STAGES.PRESENTATION, 200,
    () => app.uiManager?.updateInspectorLive?.());
  register(scheduler, 'ui.primary-interaction', SIMULATION_STAGES.PRESENTATION, 205,
    () => app.interactionPrompt?.update?.());
  register(scheduler, 'ui.actions', SIMULATION_STAGES.PRESENTATION, 210,
    () => app.uiManager?.updateActionHUD?.());
  register(scheduler, 'ui.real-estate', SIMULATION_STAGES.PRESENTATION, 220,
    delta => app.uiManager?.updateRealEstateTracker?.(delta),
    context => context.gameplayDelta > 0);
  register(scheduler, 'ui.alerts', SIMULATION_STAGES.PRESENTATION, 230,
    delta => app.uiManager?.updateAlertFeed?.(delta),
    context => context.gameplayDelta > 0);
  register(scheduler, 'ui.minimap', SIMULATION_STAGES.PRESENTATION, 240,
    (_delta, context) => app.minimapHud?.update?.(context.clocks.RENDER.elapsed));
  register(scheduler, 'performance.frame-rate', SIMULATION_STAGES.PRESENTATION, 900,
    (_delta, context) => updateFrameMetrics(app, context.boundedDelta));

  register(scheduler, 'camera.update', SIMULATION_STAGES.CAMERA, 100,
    delta => app.sceneManager?.update?.(delta));
  register(scheduler, 'renderer.draw', SIMULATION_STAGES.RENDER, 100,
    () => app.sceneManager?.render?.());

  return scheduler;
}

export default createMetroPulseSimulationScheduler;
