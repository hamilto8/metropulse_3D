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
import { InteractionPrompt } from './ui/InteractionPrompt.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { MissionSystem } from './systems/MissionSystem.js';
import { CityEditorSystem } from './world/CityEditorSystem.js';
import { CityEditorUI } from './ui/CityEditorUI.js';
import { MinimapHUD } from './ui/MinimapHUD.js';
import { MissionResultScreen } from './ui/MissionResultScreen.js';
import { InputManager } from './systems/InputManager.js';
import { TrafficHeatmapSystem } from './systems/TrafficHeatmapSystem.js';
import { TrafficProductivityModel } from './systems/TrafficProductivityModel.js';
import { TrafficAlertAdapter } from './systems/TrafficAlertAdapter.js';
import { EconomySystem } from './systems/EconomySystem.js';
import { CONTROL_KINDS, GAME_STATES, GameManager } from './core/GameManager.js';
import { TransitionCoordinator } from './core/TransitionCoordinator.js';
import { PauseManager } from './core/PauseManager.js';
import { MetroPulseTransitionRuntime } from './app/MetroPulseTransitionRuntime.js';
import { createMetroPulseSimulationScheduler } from './app/MetroPulseSimulationSchedule.js';
import { createMetroPulseInteractionService } from './app/MetroPulseInteractions.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { SaveService } from './save/SaveService.js';
import { createBuildingEconomyRecord } from './systems/BuildingEconomyAdapter.js';
import { FEATURE_IDS, applyFeatureVisibility } from './config/FeatureFlags.js';
import {
  createRuntimeConfig,
  installDeterministicRandom
} from './app/RuntimeConfig.js';
import { DiagnosticsService } from './debug/DiagnosticsService.js';
import { installBrowserTestBridge } from './testing/BrowserTestBridge.js';
import { MVP_MISSION_IDS } from './config/MvpScope.js';
import { validateGameData } from './data/GameDataValidator.js';
import { BootPipeline } from './boot/BootPipeline.js';
import { CapabilityChecker } from './boot/CapabilityChecker.js';
import { SettingsBootstrap } from './boot/SettingsBootstrap.js';
import { SettingsRuntime } from './settings/SettingsRuntime.js';
import { SettingsMenu } from './ui/SettingsMenu.js';
import { BOOT_ACTIONS, SaveDiscovery } from './boot/SaveDiscovery.js';
import { AssetPreloader } from './boot/AssetPreloader.js';
import { BootScreen } from './ui/BootScreen.js';
import { DISTRICT_DEFINITIONS } from './data/ContentDefinitions.js';
import { MissionOutcomeService } from './missions/MissionOutcomeService.js';
import { CityConditionService } from './missions/CityConditionService.js';
import { CityServiceModel } from './systems/CityServiceModel.js';
import { IncidentResponseService } from './systems/IncidentResponseService.js';
import { ServiceWorkInteractionProvider } from './systems/ServiceWorkInteractionProvider.js';
import { ServiceTaskMarkerSystem } from './world/ServiceTaskMarkerSystem.js';
import { CityServicesPanel } from './ui/CityServicesPanel.js';
import { TrafficProductivityPanel } from './ui/TrafficProductivityPanel.js';
import { MobilityStreetFeedbackSystem } from './world/MobilityStreetFeedbackSystem.js';
import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_TYPES,
  AlertService
} from './alerts/AlertService.js';
import { AlertActionController } from './alerts/AlertActionController.js';
import bootHeroUrl from './assets/hero.png?url';

const bootStartedAtMs = performance.now();

export class MetroPulseApp {
  constructor(runtimeConfig, bootSession) {
    const container = document.getElementById('canvas-container');
    if (!bootSession || !Object.values(BOOT_ACTIONS).includes(bootSession.action)) {
      throw new TypeError('MetroPulseApp requires a validated boot session.');
    }
    this.runtimeConfig = runtimeConfig;
    this.bootSession = bootSession;
    this.contentRegistry = bootSession.contentRegistry;
    if (!this.contentRegistry?.has) throw new TypeError('MetroPulseApp requires validated game content.');
    if (!bootSession.settingsStore?.snapshot) throw new TypeError('MetroPulseApp requires a validated settings store.');
    this.settingsStore = bootSession.settingsStore;
    this.settings = this.settingsStore.getSettings();
    this.bootStartedAtMs = bootStartedAtMs;
    this.features = runtimeConfig.featureFlags;
    applyFeatureVisibility(document, this.features);

    // The boot owner creates the canonical session state before any runtime
    // service exists; the app supplies its live renderer-free context here.
    this.gameManager = bootSession.gameManager;
    if (!(this.gameManager instanceof GameManager) || this.gameManager.state !== GAME_STATES.LOAD) {
      throw new Error('MetroPulse runtime must be composed from the authoritative LOAD state.');
    }
    this.gameManager.setContextProvider(() => this.getGameStateContext());
    this.transitionCoordinator = new TransitionCoordinator({
      gameManager: this.gameManager
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
    this.missionOutcomeService = new MissionOutcomeService({
      economySystem: this.economySystem,
      contentRegistry: this.contentRegistry,
      districtDefinitions: DISTRICT_DEFINITIONS
    });
    this.cityServiceModel = new CityServiceModel({
      economySystem: this.economySystem,
      outcomeService: this.missionOutcomeService,
      districtDefinitions: DISTRICT_DEFINITIONS
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
    this.trafficProductivityModel = new TrafficProductivityModel({
      economySystem: this.economySystem,
      outcomeService: this.missionOutcomeService,
      roadProvider: this.trafficSystem,
      presentationVehicleCap: runtimeConfig.test?.trafficCount ?? 48
    });
    this.mobilityStreetFeedbackSystem = new MobilityStreetFeedbackSystem({
      scene: this.sceneManager.scene,
      model: this.trafficProductivityModel,
      roadProvider: this.trafficSystem,
      groundHeight: (x, z) => this.cityBuilder.getHillHeight(x, z)
    });
    this.cityConditionService = new CityConditionService({
      economySystem: this.economySystem,
      outcomeService: this.missionOutcomeService,
      serviceModel: this.cityServiceModel,
      trafficProvider: () => this.trafficSystem.getCongestionMetrics(),
      bridgeProvider: bridgeId => ({
        id: bridgeId,
        state: 'OPEN',
        access: 'OPEN',
        condition: 1,
        safety: 1
      }),
      weatherProvider: () => ({ mode: this.environment.weatherMode })
    });

    this.alertService = new AlertService();
    this.trafficAlertAdapter = new TrafficAlertAdapter({
      model: this.trafficProductivityModel,
      alertService: this.alertService
    });
    this.alertService.publish({
      dedupeKey: 'system:city-grid-online',
      type: ALERT_TYPES.SYSTEM,
      severity: ALERT_SEVERITIES.SUCCESS,
      title: 'City grid online',
      cause: 'Simulation initialized and authoritative city services are responding.',
      location: 'Citywide',
      duration: { kind: ALERT_DURATION_KINDS.TIMED, seconds: 120 },
      recommendation: 'No action required. Review City Tools when you are ready to make a management decision.',
      relatedEntityIds: [],
      focusAction: { type: ALERT_FOCUS_ACTIONS.NONE }
    });
    this.alertActionController = new AlertActionController({
      alertService: this.alertService,
      sceneManager: this.sceneManager,
      getGameState: () => this.gameManager?.state,
      onFeedback: message => this.uiManager?.showToast?.(message)
    });
    this.incidentResponseService = new IncidentResponseService({
      outcomeService: this.missionOutcomeService,
      economySystem: this.economySystem,
      alertService: this.alertService
    });
    this.serviceTaskMarkerSystem = new ServiceTaskMarkerSystem({
      scene: this.sceneManager.scene,
      incidentResponseService: this.incidentResponseService,
      groundHeight: (x, z) => this.cityBuilder.getHillHeight(x, z)
    });

    // 11. UI Controls Manager
    this.uiManager = new UIManager(this);
    this.cityServicesPanel = new CityServicesPanel({
      cityServiceModel: this.cityServiceModel,
      incidentResponseService: this.incidentResponseService,
      root: document.getElementById('city-services-panel'),
      onFeedback: message => this.uiManager.showToast(message)
    });
    this.trafficProductivityPanel = new TrafficProductivityPanel({
      model: this.trafficProductivityModel,
      root: document.getElementById('traffic-productivity-panel'),
      policyButton: document.getElementById('btn-bridge-priority'),
      onPolicyChange: enabled => this.trafficSystem.toggleBridgePriority(enabled),
      onFeedback: message => this.uiManager.showToast(message)
    });
    this.settingsRuntime = new SettingsRuntime({ store: this.settingsStore, app: this });

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
    this.serviceWorkInteractionProvider = new ServiceWorkInteractionProvider({
      incidentResponseService: this.incidentResponseService,
      getPlayerPosition: () => {
        const controlled = this.pedestrianSystem?.controlledPedestrian || this.trafficSystem?.controlledVehicle;
        const position = controlled?.mesh?.position;
        return position ? { x: position.x, z: position.z } : null;
      },
      isMissionCritical: () => Boolean(this.missionSystem?.lifecycle?.isMissionCritical)
    });
    this.resultScreen = new MissionResultScreen({
      lifecycle: this.missionSystem.lifecycle,
      outcomeService: this.missionOutcomeService,
      missions: this.missionSystem.missions,
      onRetry: () => this.missionSystem.retryMission(),
      onContinue: () => this.missionSystem.acknowledgeResult()
    });
    this.interactionService = createMetroPulseInteractionService(this);
    this.interactionPrompt = new InteractionPrompt({
      service: this.interactionService,
      getActionLabel: action => this.inputManager.getActionLabel(action)
    });
    this.saveService = new SaveService(this, { repository: bootSession.saveRepository });
    this.uiManager.bindSaveService?.(this.saveService);
    if (bootSession.restore && !this.saveService.restore(bootSession.saveDocument, { deferRuntime: true })) {
      const error = new Error('The selected city save passed discovery but could not be restored safely.');
      error.userMessage = 'MetroPulse stopped before entering the city because the selected save could not be applied safely.';
      error.actions = ['Reload and choose Recover Previous Save, or start a New Game.'];
      throw error;
    }

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
    this.settingsMenu = new SettingsMenu({ store: this.settingsStore });
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
    if (bootSession.restore && !this.saveService.restoreRuntime()) {
      const error = new Error('The selected city save could not restore its player/session state safely.');
      error.userMessage = this.saveService.getStatus().error || 'MetroPulse stopped before applying the selected city save.';
      error.actions = ['Reload and choose Recover Previous Save, or start a New Game.'];
      throw error;
    }
    if (!bootSession.restore && !runtimeConfig.test) this.createInitialServiceIncident();

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

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  assertReady() {
    const requiredServices = {
      world: this.sceneManager?.renderer?.domElement && this.cityBuilder,
      input: this.inputManager,
      save: this.saveService,
      mission: this.missionSystem,
      scheduler: this.scheduler,
      transitions: this.transitionCoordinator && this.transitionRuntime
    };
    const missing = Object.entries(requiredServices)
      .filter(([, service]) => !service)
      .map(([name]) => name);
    const interactiveStates = new Set([
      GAME_STATES.MANAGEMENT,
      GAME_STATES.BUILDER,
      GAME_STATES.STREET_ON_FOOT,
      GAME_STATES.STREET_VEHICLE,
      GAME_STATES.RESULT,
      GAME_STATES.PAUSED
    ]);
    if (missing.length > 0 || !interactiveStates.has(this.gameManager?.state)) {
      throw new Error(`Runtime readiness gate failed: ${missing.join(', ') || 'interactive state unavailable'}.`);
    }
    return true;
  }

  markInteractive() {
    this.interactiveAtMs = performance.now();
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
    const missionState = this.missionSystem?.lifecycle?.phase || 'IDLE';
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
      missionCritical: this.missionSystem?.lifecycle?.isMissionCritical ?? (missionActive || missionState !== 'IDLE'),
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

  createInitialServiceIncident() {
    return this.incidentResponseService.reportIncident({
      id: 'bridge-relay-failure',
      type: 'ENERGY_RELAY_DAMAGE',
      title: 'Bridge energy relay damaged',
      cause: 'A transformer strike scattered debris and reduced power along the primary bridge approach.',
      targetId: 'primary-bridge-relay',
      infrastructureId: 'primary-bridge-relay',
      districtId: 'PRIMARY_BRIDGE_CORRIDOR',
      service: 'power',
      severity: 5,
      cleanupRequired: true,
      repairRequired: true,
      cleanupCost: 1_500,
      repairCost: 4_500,
      coverageMultiplier: 0.45,
      position: { x: 205, z: 18 },
      influenceRadius: 90
    });
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

function nextPaint() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createBootPipeline({ runtimeConfig, screen, saveDiscovery }) {
  const capabilityChecker = new CapabilityChecker({
    forceUnavailable: runtimeConfig.test?.unavailableCapabilities || []
  });
  const settingsBootstrap = new SettingsBootstrap();
  const assetPreloader = new AssetPreloader();

  return new BootPipeline({
    onProgress: event => screen.renderProgress(event),
    stages: [
      {
        id: 'capabilities',
        label: 'Checking browser and storage capabilities…',
        run: () => capabilityChecker.assertCompatible()
      },
      {
        id: 'data',
        label: 'Validating city and mission data…',
        run: () => validateGameData()
      },
      {
        id: 'settings',
        label: 'Loading player settings…',
        run: () => settingsBootstrap.load()
      },
      {
        id: 'saves',
        label: 'Discovering local city saves…',
        run: results => saveDiscovery.discover(results.data)
      },
      {
        id: 'assets',
        label: 'Preparing core visual assets…',
        run: () => assetPreloader.prepare({ images: [bootHeroUrl] })
      }
    ]
  });
}

export async function startMetroPulseBoot({ runtimeConfig, screen } = {}) {
  const saveDiscovery = new SaveDiscovery();
  const gameManager = new GameManager({
    onListenerError: error => {
      console.error('A game-state observer failed without interrupting the session.', error);
    }
  });
  // BOOT and LOAD precede runtime composition, so this renderer-free handoff
  // uses the state owner directly. All post-composition transitions continue
  // through TransitionCoordinator.
  gameManager.transitionTo(GAME_STATES.LOAD, {
    reason: 'startup-checks',
    source: 'MetroPulseBoot'
  });
  const pipeline = createBootPipeline({ runtimeConfig, screen, saveDiscovery });
  screen.reset();

  try {
    const results = await pipeline.run();
    gameManager.transitionTo(GAME_STATES.MENU, {
      reason: 'startup-actions-ready',
      source: 'MetroPulseBoot'
    });
    screen.renderReady(results);
    screen.onAction(async action => {
      if (!screen.renderLaunching(action)) return;
      try {
        gameManager.transitionTo(GAME_STATES.LOAD, {
          reason: `session-action-${action.toLowerCase()}`,
          source: 'MetroPulseBoot'
        });
        const prepared = await saveDiscovery.prepare(action, results.saves);
        await nextPaint();
        const app = new MetroPulseApp(runtimeConfig, {
          ...prepared,
          gameManager,
          settingsStore: results.settings.store,
          contentRegistry: results.data
        });
        app.assertReady();
        window.app = app;
        screen.complete();
        app.markInteractive();
        document.body.dataset.appState = 'ready';
      } catch (error) {
        console.error('MetroPulse failed to initialize the selected session.', error);
        document.body.dataset.appState = 'boot-error';
        screen.renderError(error);
        screen.onRetry(() => window.location.reload());
      }
    });
    return results;
  } catch (error) {
    if (error?.code === 'INCOMPATIBLE_BROWSER') {
      console.warn('MetroPulse startup checks found an incompatible browser.', error);
    } else {
      console.error('MetroPulse startup checks failed.', error);
    }
    document.body.dataset.appState = 'boot-error';
    screen.renderError(error);
    screen.onRetry(() => startMetroPulseBoot({ runtimeConfig, screen }));
    return null;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
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
    const screen = new BootScreen({ heroUrl: bootHeroUrl });
    await startMetroPulseBoot({ runtimeConfig, screen });
  } catch (error) {
    console.error('MetroPulse failed to initialize.', error);
    showFatalError('Unable to start the city simulation', error);
  }
});

window.addEventListener('unhandledrejection', event => {
  runtimeErrorMonitor.rejected.push(event.reason?.message || String(event.reason));
  console.error('MetroPulse encountered an unhandled operation.', event.reason);
  if (window.app) window.app.fatalError = true;
  window.app?.saveService?.saveNow?.({ reason: 'page-unload' });
  showFatalError('The city simulation was interrupted', event.reason);
});
