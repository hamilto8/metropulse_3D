import * as THREE from 'three';
import './index.css';

import { SceneManager } from './world/SceneManager.js';
import { CityBuilder } from './world/CityBuilder.js';
import { BuildingFactory } from './world/BuildingFactory.js';
import { BillboardCanvas } from './world/BillboardCanvas.js';
import { Environment } from './world/Environment.js';

import { TimeManager } from './systems/TimeManager.js';
import { TrafficSystem } from './systems/TrafficSystem.js';
import { PedestrianSystem } from './systems/PedestrianSystem.js';
import { AircraftSystem } from './systems/AircraftSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { ExplosionManager } from './effects/ExplosionManager.js';
import { CometManager } from './effects/CometManager.js';

import { UIManager } from './ui/UIManager.js';
import { InspectorHUD } from './ui/InspectorHUD.js';
import { DialogueOverlay } from './ui/DialogueOverlay.js';
import { PauseMenu } from './ui/PauseMenu.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { MissionSystem } from './systems/MissionSystem.js';
import { CityEditorSystem } from './world/CityEditorSystem.js';
import { CityEditorUI } from './ui/CityEditorUI.js';
import { MinimapHUD } from './ui/MinimapHUD.js';
import { InputManager } from './systems/InputManager.js';
import { TrafficHeatmapSystem } from './systems/TrafficHeatmapSystem.js';
import { EconomySystem } from './systems/EconomySystem.js';
import { CONTROL_KINDS, GAME_STATES, GameManager } from './core/GameManager.js';
import { TransitionCoordinator } from './core/TransitionCoordinator.js';
import { PauseManager } from './core/PauseManager.js';
import { MetroPulseTransitionRuntime } from './app/MetroPulseTransitionRuntime.js';
import { createMetroPulseSimulationScheduler } from './app/MetroPulseSimulationSchedule.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { PersistenceSystem } from './systems/PersistenceSystem.js';
import { createBuildingEconomyRecord } from './systems/BuildingEconomyAdapter.js';
import { FEATURE_IDS, applyFeatureVisibility } from './config/FeatureFlags.js';
import {
  createRuntimeConfig,
  installDeterministicRandom
} from './app/RuntimeConfig.js';
import { DiagnosticsService } from './debug/DiagnosticsService.js';
import { installBrowserTestBridge } from './testing/BrowserTestBridge.js';
import { MVP_MISSION_IDS } from './config/MvpScope.js';

const bootStartedAtMs = performance.now();

class MetroPulseApp {
  constructor(runtimeConfig) {
    const container = document.getElementById('canvas-container');
    this.runtimeConfig = runtimeConfig;
    this.bootStartedAtMs = bootStartedAtMs;
    this.features = runtimeConfig.featureFlags;
    applyFeatureVisibility(document, this.features);

    // Canonical state stores are renderer-agnostic and shared by both loops.
    this.gameManager = new GameManager({
      contextProvider: () => this.getGameStateContext(),
      onListenerError: error => {
        console.error('A game-state observer failed without interrupting the session.', error);
      }
    });
    this.transitionCoordinator = new TransitionCoordinator({
      gameManager: this.gameManager
    });
    this.transitionCoordinator.transitionTo(GAME_STATES.LOAD, {
      reason: 'runtime-initialization',
      source: 'MetroPulseApp'
    });
    this.nextEconomyBuildingId = 1;
    this.economySystem = new EconomySystem({
      initialTreasury: 650_000,
      passiveIncomeRate: 8,
      population: 2450,
      happiness: 72,
      landValue: 100,
      reputation: 0,
      services: {
        power: { capacity: 120, demand: 90 },
        water: { capacity: 100, demand: 82 },
        fire: { capacity: 70, demand: 60 }
      },
      eastDistrictUnlockCost: 1_000_000
    });

    // 0. Physics World (cannon-es Phase 1 prototype)
    this.physicsWorld = new PhysicsWorld();

    // 1. Core Scene & Camera
    this.sceneManager = new SceneManager(this, container);
    // Compatibility alias for systems that need the active camera.
    this.camera = this.sceneManager.camera;

    // 2. Audio System
    this.audioSystem = new AudioSystem(this);

    // 3. Raycaster / Inspector HUD
    this.inspectorHud = new InspectorHUD(this);

    // 4. Canvas Billboards
    this.billboardCanvas = new BillboardCanvas(this);

    // 5. Build City Infrastructure
    this.cityBuilder = new CityBuilder(this.sceneManager.scene, this.inspectorHud, this.billboardCanvas);
    this.cityBuilder.app = this;
    this.cityBuilder.build();

    // 6. Build Skyscrapers & Commercial Businesses
    this.buildingFactory = new BuildingFactory(this.sceneManager.scene, this.billboardCanvas, this.inspectorHud);
    this.buildingFactory.app = this;
    this.buildingFactory.buildAll(this.cityBuilder.buildingPlots);

    // Register the existing skyline as live economic data. User buildings use
    // the same adapter through CityEditorSystem.
    this.buildingFactory.buildings.forEach((building, index) => {
      this.registerEconomyBuilding(building, `existing-${index + 1}`);
    });

    // Register static obstacle colliders in PhysicsWorld (Buildings & Lamp Posts)
    for (const b of this.buildingFactory.buildings) {
      if (b.plot) {
        b.physicsBody = this.physicsWorld.addStaticBoxCollider(
          new THREE.Vector3(b.plot.x, (b.height || 40) * 0.5, b.plot.z),
          new THREE.Vector3(b.plot.width - 2, b.height || 40, b.plot.depth - 2)
        );
      }
    }
    if (this.cityBuilder && this.cityBuilder.streetlamps) {
      for (const lamp of this.cityBuilder.streetlamps) {
        if (lamp.pos) {
          this.physicsWorld.addStaticBoxCollider(
            new THREE.Vector3(lamp.pos.x, 3, lamp.pos.z),
            new THREE.Vector3(0.6, 6, 0.6)
          );
        }
      }
    }

    // Register space launch facility & space billboard colliders
    const rocketCenterHeight = this.cityBuilder.getHillHeight(700, -280);
    // Launchpad
    this.physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(700, rocketCenterHeight + 0.75, -280),
      new THREE.Vector3(36, 1.5, 36)
    );
    // Launch Gantry Tower
    this.physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(690, rocketCenterHeight + 27.5, -280),
      new THREE.Vector3(5.2, 55, 5.2)
    );
    // Space Billboard
    const billboardCenterHeight = this.cityBuilder.getHillHeight(622, -160);
    this.physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(622, billboardCenterHeight + 19.0, -160),
      new THREE.Vector3(33, 20, 2)
    );
    const missionControlHeight = this.cityBuilder.getHillHeight(735, -245);
    this.physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(735, missionControlHeight + 5.3, -245),
      new THREE.Vector3(18, 10, 12)
    );

    // 7. Environment (Sky, Moon, Stars, Weather)
    this.environment = new Environment(this.sceneManager.scene, this.inspectorHud, this);

    // 8. Time Manager (Day-night cycle & dynamic lighting)
    this.timeManager = new TimeManager(this);

    // 9. Traffic Simulation & Fun Mode
    this.funMode = false;
    this.rocketCountdown = 300.0; // 5 minutes countdown
    this.rocketLaunched = false;
    this.explosionManager = new ExplosionManager(this.sceneManager.scene);
    this.cometManager = new CometManager(this);
    // Input is created before gameplay systems so there is exactly one
    // keyboard/gamepad state owner from their first frame onward.
    this.inputManager = new InputManager(this);
    this.trafficSystem = new TrafficSystem(this, {
      targetMovingVehicleCount: runtimeConfig.test?.trafficCount ?? 48
    });

    // 10. Pedestrian Simulation
    this.pedestrianSystem = new PedestrianSystem(this, {
      targetPedestrianCount: runtimeConfig.test?.pedestrianCount ?? 60
    });
    this.aircraftSystem = this.features.isEnabled(FEATURE_IDS.AIRCRAFT)
      ? new AircraftSystem(this)
      : null;
    this.performanceSystem = new PerformanceSystem(this);
    this.physicsWorld.terrainSystem = this.cityBuilder;
    // Retained scenery remains collision-safe even while its gameplay/content
    // flag is off. A scope flag must never turn an existing road into a void.
    this.physicsWorld.initCountrysideTerrain(this.cityBuilder);
    this.trafficHeatmapSystem = new TrafficHeatmapSystem(this);

    // 11. UI Controls Manager
    this.uiManager = new UIManager(this);

    // 11.2 City Editor & Map Expansion System
    this.cityEditorSystem = new CityEditorSystem(this);
    this.uiManager.cityEditorUI = new CityEditorUI(this);

    // 11.5 Phase 3 Mission Logic & Branching Dialogue Overlay
    this.dialogueOverlay = new DialogueOverlay();
    this.missionSystem = new MissionSystem(this, this.dialogueOverlay, {
      missionId: runtimeConfig.test?.missionId || null,
      missionIds: runtimeConfig.test ? null : MVP_MISSION_IDS,
      includeMayhem: this.features.isEnabled(FEATURE_IDS.TEMPORARY_MAYHEM)
    });
    this.persistenceSystem = new PersistenceSystem(this);
    this.persistenceSystem.restore();

    // The scheduler is the sole owner of frame timing, fixed-step accumulation,
    // city cadence, update order, and state-based simulation gates.
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.currentFps = 60;
    this.minimapHud = new MinimapHUD(this);
    this.scheduler = createMetroPulseSimulationScheduler(this);
    this.simulationClockPolicy = this.scheduler.clockPolicy;

    this.transitionRuntime = new MetroPulseTransitionRuntime(this);
    this.transitionCoordinator.setRuntime(this.transitionRuntime);
    this.pauseManager = new PauseManager({
      gameManager: this.gameManager,
      transitionCoordinator: this.transitionCoordinator,
      clearHeldActions: () => this.inputManager?.clearTransientInputState?.()
    });
    this.pauseMenu = new PauseMenu({ pauseManager: this.pauseManager });
    this.dialogueOverlay.setPauseManager(this.pauseManager);

    if (runtimeConfig.test) {
      this.timeManager.setTime(runtimeConfig.test.time);
      this.environment.setDynamicWeather(false);
      this.environment.setWeather(runtimeConfig.test.weather);
    }

    this.transitionCoordinator.transitionTo(GAME_STATES.MANAGEMENT, {
      reason: 'boot-complete',
      source: 'MetroPulseApp'
    });

    // Initial UI sync
    this.uiManager.updateTimeDisplay(this.timeManager.timeVal);
    this.uiManager.updateStats(
      this.trafficSystem.vehicles.length,
      this.pedestrianSystem.pedestrians.length,
      this.currentFps
    );

    this.diagnostics = new DiagnosticsService(this, {
      enabled: runtimeConfig.diagnosticsEnabled
    });
    installBrowserTestBridge(this, this.diagnostics, runtimeErrorMonitor);
    this.interactiveAtMs = performance.now();
    document.body.dataset.appState = 'ready';

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Supplies renderer-free facts to GameManager guards. GameManager owns the
   * policy decision; runtime systems remain the owners of their domain data.
   */
  getGameStateContext() {
    const controlled = [
      this.trafficSystem?.controlledVehicle
        ? { kind: CONTROL_KINDS.VEHICLE, entity: this.trafficSystem.controlledVehicle }
        : null,
      this.pedestrianSystem?.controlledPedestrian
        ? { kind: CONTROL_KINDS.PEDESTRIAN, entity: this.pedestrianSystem.controlledPedestrian }
        : null,
      this.aircraftSystem?.controlledAircraft
        ? { kind: CONTROL_KINDS.AIRCRAFT, entity: this.aircraftSystem.controlledAircraft }
        : null
    ].filter(Boolean);
    const missionState = this.missionSystem?.state || 'IDLE';
    const missionActive = Boolean(this.missionSystem?.activeMission || this.missionSystem?.pendingMission);

    return {
      controlledEntityCount: controlled.length,
      controlledEntityKind: controlled.length === 1
        ? controlled[0].kind
        : controlled.length > 1
          ? CONTROL_KINDS.MULTIPLE
          : CONTROL_KINDS.NONE,
      handoffPending: Boolean(this.pedestrianSystem?.hijackTransition),
      missionActive,
      missionCritical: missionActive || missionState !== 'IDLE',
      missionState,
      heatActive: Boolean(this.pedestrianSystem?.isWanted)
    };
  }

  toEconomyBuilding(building, fallbackId = null) {
    const spec = building?.spec || {};
    const id = building?.economyId || fallbackId || `building-${this.nextEconomyBuildingId++}`;
    building.economyId = id;
    return createBuildingEconomyRecord(building, {
      spec,
      id,
      fallbackIncomePerMinute: building.isUserPlaced ? 1_200 : 0,
      fallbackEmployees: Math.max(0, Math.round((building.height || 20) * 8)),
      fallbackValue: Math.max(50_000, (building.height || 20) * 8_500)
    });
  }

  registerEconomyBuilding(building, fallbackId = null) {
    if (!building) return null;
    const record = this.toEconomyBuilding(building, fallbackId);
    if (!this.economySystem.getBuilding(record.id)) this.economySystem.registerBuilding(record);
    return record;
  }

  removeEconomyBuilding(building) {
    if (!building?.economyId) return null;
    return this.economySystem.removeBuilding(building.economyId);
  }

  triggerRocketLaunch() {
    if (!this.features.isEnabled(FEATURE_IDS.ROCKET_LAUNCH)) return false;
    this.rocketLaunched = true;
    this.rocketCountdown = 0;
    if (this.audioSystem) {
      this.audioSystem.playExplosion(1.5);
    }
    if (this.billboardCanvas) {
      this.billboardCanvas.forceRedrawAll();
    }
    return true;
  }

  animate(timestamp) {
    if (this.fatalError) return;
    requestAnimationFrame(this.animate);
    this.scheduler.runFrame(timestamp);
  }
}

function showFatalError(title, error) {
  let panel = document.getElementById('fatal-error-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'fatal-error-panel';
    panel.className = 'fatal-error-panel';
    panel.setAttribute('role', 'alert');
    panel.append(
      Object.assign(document.createElement('h2'), { textContent: title }),
      Object.assign(document.createElement('p'), { textContent: 'MetroPulse encountered a problem and paused safely. Reload the page to retry; your city is saved locally.' }),
      Object.assign(document.createElement('button'), { textContent: 'Reload MetroPulse' })
    );
    panel.querySelector('button').addEventListener('click', () => window.location.reload());
    document.body.appendChild(panel);
  }
  panel.dataset.error = error?.name || 'Error';
}

// Start application when DOM is ready
const runtimeErrorMonitor = {
  uncaught: [],
  rejected: []
};

window.addEventListener('error', event => {
  runtimeErrorMonitor.uncaught.push(event.error?.message || event.message || 'Unknown error');
});

window.addEventListener('DOMContentLoaded', () => {
  try {
    const runtimeConfig = createRuntimeConfig({
      search: window.location.search,
      allowTestMode: import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_MODE === 'true',
      allowFeatureOverrides: import.meta.env.DEV
    });
    if (runtimeConfig.test?.cleanProfile) {
      window.localStorage?.clear?.();
    }
    installDeterministicRandom(runtimeConfig.test);
    window.app = new MetroPulseApp(runtimeConfig);
  } catch (error) {
    console.error('MetroPulse failed to initialize.', error);
    showFatalError('Unable to start the city simulation', error);
  }
});

window.addEventListener('unhandledrejection', event => {
  runtimeErrorMonitor.rejected.push(event.reason?.message || String(event.reason));
  console.error('MetroPulse encountered an unhandled operation.', event.reason);
  if (window.app) window.app.fatalError = true;
  window.app?.persistenceSystem?.saveNow?.();
  showFatalError('The city simulation was interrupted', event.reason);
});
