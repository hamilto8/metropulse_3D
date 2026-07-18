function countSceneObjects(scene) {
  let count = 0;
  scene?.traverse?.(() => { count += 1; });
  return count;
}

function identifyControlledEntity(app) {
  const entity = app.trafficSystem?.controlledVehicle
    || app.pedestrianSystem?.controlledPedestrian
    || app.aircraftSystem?.controlledAircraft
    || null;
  if (!entity) return null;
  return Object.freeze({
    type: entity.type || 'UNKNOWN',
    id: entity.id || entity.economyId || entity.name || null
  });
}

function rendererSnapshot(renderer, lastRenderStats = null) {
  const info = renderer?.info;
  if (!info) return null;
  return Object.freeze({
    calls: lastRenderStats?.calls ?? info.render?.calls ?? 0,
    triangles: lastRenderStats?.triangles ?? info.render?.triangles ?? 0,
    lines: lastRenderStats?.lines ?? info.render?.lines ?? 0,
    points: lastRenderStats?.points ?? info.render?.points ?? 0,
    geometries: info.memory?.geometries || 0,
    textures: info.memory?.textures || 0,
    programs: Array.isArray(info.programs) ? info.programs.length : null
  });
}

function browserMemorySnapshot() {
  const memory = globalThis.performance?.memory;
  if (!memory) return null;
  return Object.freeze({
    usedHeapBytes: memory.usedJSHeapSize,
    totalHeapBytes: memory.totalJSHeapSize,
    heapLimitBytes: memory.jsHeapSizeLimit
  });
}

export class DiagnosticsService {
  constructor(app, { enabled = false, updateIntervalMs = 500 } = {}) {
    this.app = app;
    this.enabled = Boolean(enabled);
    this.updateIntervalMs = updateIntervalMs;
    this.panel = null;
    this.timer = null;

    if (this.enabled && typeof document !== 'undefined') {
      this.panel = document.createElement('pre');
      this.panel.id = 'development-diagnostics';
      this.panel.className = 'development-diagnostics';
      this.panel.setAttribute('role', 'status');
      this.panel.setAttribute('aria-label', 'Development diagnostics');
      document.body.appendChild(this.panel);
      this.render();
      this.timer = setInterval(() => this.render(), this.updateIntervalMs);
    }
  }

  snapshot() {
    const app = this.app;
    const mission = app.missionSystem;
    const physicsWorld = app.physicsWorld?.world;
    const renderer = app.sceneManager?.renderer;

    return Object.freeze({
      capturedAt: new Date().toISOString(),
      state: Object.freeze({
        mode: app.gameManager?.state || 'BOOT',
        revision: app.gameManager?.revision || 0,
        activeTransition: app.gameManager?.activeTransition || null,
        lastTransition: app.gameManager?.lastTransition || null
      }),
      scheduler: Object.freeze({
        owner: app.scheduler ? 'SimulationScheduler' : 'legacy-frame-loop',
        paused: Boolean(app.scheduler?.paused || app.fatalError),
        cityTimePaused: app.timeManager ? !app.timeManager.isPlaying : true
      }),
      controlledEntity: identifyControlledEntity(app),
      mission: Object.freeze({
        state: mission?.state || 'UNAVAILABLE',
        id: mission?.activeMission?.id || null,
        timeRemaining: mission?.timeRemaining || 0
      }),
      save: app.persistenceSystem?.getStatus?.() || null,
      entities: Object.freeze({
        vehicles: app.trafficSystem?.vehicles?.length || 0,
        pedestrians: app.pedestrianSystem?.pedestrians?.length || 0,
        aircraft: app.aircraftSystem?.aircraft ? 1 : 0,
        physicsBodies: physicsWorld?.bodies?.length || 0,
        sceneObjects: countSceneObjects(app.sceneManager?.scene)
      }),
      performance: Object.freeze({
        interactiveMs: Number.isFinite(app.interactiveAtMs)
          ? app.interactiveAtMs - (app.bootStartedAtMs || 0)
          : null,
        fps: Number.isFinite(app.currentFps) ? app.currentFps : 0,
        frameTimeMs: app.currentFps > 0 ? 1000 / app.currentFps : null,
        quality: app.sceneManager?.renderQuality || null,
        renderer: rendererSnapshot(renderer, app.sceneManager?.lastRenderStats),
        memory: browserMemorySnapshot()
      }),
      features: app.features?.snapshot?.() || null,
      testMode: app.runtimeConfig?.test
        ? Object.freeze({ ...app.runtimeConfig.test })
        : null
    });
  }

  render() {
    if (!this.panel) return;
    const snapshot = this.snapshot();
    const controlled = snapshot.controlledEntity
      ? `${snapshot.controlledEntity.type}:${snapshot.controlledEntity.id}`
      : 'none';
    const renderer = snapshot.performance.renderer || {};
    this.panel.textContent = [
      `STATE ${snapshot.state.mode}  TRANSITION ${snapshot.state.activeTransition?.id || 'none'}`,
      `PAUSED ${snapshot.scheduler.paused}  CONTROL ${controlled}`,
      `MISSION ${snapshot.mission.state}:${snapshot.mission.id || 'none'}  SAVE ${snapshot.save?.status || 'unavailable'}`,
      `ENTITIES v${snapshot.entities.vehicles} p${snapshot.entities.pedestrians} a${snapshot.entities.aircraft} bodies${snapshot.entities.physicsBodies}`,
      `RENDER ${snapshot.performance.fps.toFixed(1)}fps ${renderer.calls || 0} calls ${renderer.triangles || 0} tris`,
      `GPU ${renderer.geometries || 0} geometries ${renderer.textures || 0} textures`
    ].join('\n');
    this.panel.dataset.snapshot = JSON.stringify(snapshot);
  }

  destroy() {
    clearInterval(this.timer);
    this.panel?.remove();
    this.panel = null;
  }
}
