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
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { MissionSystem } from './systems/MissionSystem.js';
import { CityEditorSystem } from './world/CityEditorSystem.js';
import { CityEditorUI } from './ui/CityEditorUI.js';
import { MinimapHUD } from './ui/MinimapHUD.js';
import { InputManager } from './systems/InputManager.js';
import { TrafficHeatmapSystem } from './systems/TrafficHeatmapSystem.js';
import { EconomySystem } from './systems/EconomySystem.js';
import { GameManager } from './core/GameManager.js';
import { PerformanceSystem } from './systems/PerformanceSystem.js';
import { PersistenceSystem } from './systems/PersistenceSystem.js';

class MetroPulseApp {
  constructor() {
    const container = document.getElementById('canvas-container');

    // Canonical state stores are renderer-agnostic and shared by both loops.
    this.gameManager = new GameManager();
    this.nextEconomyBuildingId = 1;
    this.economySystem = new EconomySystem({
      initialTreasury: 1_250_300,
      passiveIncomeRate: 350,
      population: 2450,
      happiness: 72,
      landValue: 100,
      reputation: 0,
      services: {
        power: { capacity: 120, demand: 90 },
        water: { capacity: 100, demand: 82 },
        fire: { capacity: 70, demand: 60 }
      },
      eastDistrictUnlockCost: 500_000
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
    this.trafficSystem = new TrafficSystem(this);

    // 10. Pedestrian Simulation
    this.pedestrianSystem = new PedestrianSystem(this);
    this.aircraftSystem = new AircraftSystem(this);
    this.performanceSystem = new PerformanceSystem(this);
    this.physicsWorld.terrainSystem = this.cityBuilder;
    this.physicsWorld.initCountrysideTerrain(this.cityBuilder);
    this.trafficHeatmapSystem = new TrafficHeatmapSystem(this);

    // 11. UI Controls Manager
    this.uiManager = new UIManager(this);

    // 11.2 City Editor & Map Expansion System
    this.cityEditorSystem = new CityEditorSystem(this);
    this.uiManager.cityEditorUI = new CityEditorUI(this);

    // 11.5 Phase 3 Mission Logic & Branching Dialogue Overlay
    this.dialogueOverlay = new DialogueOverlay();
    this.missionSystem = new MissionSystem(this, this.dialogueOverlay);
    this.persistenceSystem = new PersistenceSystem(this);
    this.persistenceSystem.restore();

    // 12. Animation Loop Setup
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.elapsedTime = 0;
    this.economyAccumulator = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.currentFps = 60;

    // Initial UI sync
    this.uiManager.updateTimeDisplay(this.timeManager.timeVal);
    this.uiManager.updateStats(
      this.trafficSystem.vehicles.length,
      this.pedestrianSystem.pedestrians.length,
      this.currentFps
    );

    this.minimapHud = new MinimapHUD(this);

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  toEconomyBuilding(building, fallbackId = null) {
    const spec = building?.spec || {};
    const id = building?.economyId || fallbackId || `building-${this.nextEconomyBuildingId++}`;
    building.economyId = id;
    const estimatedEmployees = Number(building.employees ?? spec.employees ?? Math.max(0, Math.round((building.height || 20) * 8)));
    const estimatedValue = Number(building.value ?? spec.value ?? spec.cost ?? Math.max(50_000, (building.height || 20) * 8_500));
    const population = Number(spec.residents ?? building.residents ?? 0);
    const serviceCapacity = {
      power: Number(spec.powerSupply ?? 0),
      water: Number(spec.waterSupply ?? 0),
      fire: Number(spec.fireCoverage ?? 0)
    };
    const serviceDemand = {
      power: Number(spec.powerDemand ?? (building.isUserPlaced ? 4 : 0)),
      water: Number(spec.waterDemand ?? (building.isUserPlaced ? 3 : 0)),
      fire: Number(spec.fireDemand ?? (building.isUserPlaced ? 2 : 0))
    };
    const sourcePosition = building.plot || building.group?.position;
    const position = Number.isFinite(sourcePosition?.x) && Number.isFinite(sourcePosition?.z)
      ? { x: sourcePosition.x, z: sourcePosition.z }
      : undefined;

    return {
      id,
      name: building.name || spec.name || id,
      kind: spec.category || building.businessType || building.type || 'COMMERCIAL',
      value: estimatedValue,
      employees: estimatedEmployees,
      population,
      status: building.status || spec.status || 'Operational',
      operational: !building.isDestroyed,
      passiveIncomeRate: Math.max(0, Number(spec.incomePerMinute ?? (building.isUserPlaced ? 1200 : 900)) / 60),
      happinessModifier: Number(spec.happiness ?? 0),
      landValueModifier: Number(spec.happiness ?? 0) * 0.6 + (spec.amenityRadius ? 3 : 0),
      position,
      amenityRadius: Number(spec.amenityRadius ?? 0),
      serviceCapacity,
      serviceDemand
    };
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
    this.rocketLaunched = true;
    this.rocketCountdown = 0;
    if (this.audioSystem) {
      this.audioSystem.playExplosion(1.5);
    }
    if (this.billboardCanvas) {
      this.billboardCanvas.forceRedrawAll();
    }
  }

  animate(timestamp) {
    if (this.fatalError) return;
    requestAnimationFrame(this.animate);

    this.timer.update(timestamp);
    const delta = Math.min(0.1, this.timer.getDelta());
    this.elapsedTime += delta;
    
    // FPS counter
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 1.0) {
      this.currentFps = this.frameCount / this.fpsTimer;
      this.performanceSystem.recordFrameRate(this.currentFps);
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.uiManager.updateStats(
        this.trafficSystem.vehicles.length,
        this.pedestrianSystem.pedestrians.length,
        this.currentFps
      );
    }

    // Update simulation systems
    if (this.inputManager) this.inputManager.update(delta);
    this.performanceSystem.beginFrame();
    this.physicsWorld.step(delta);
    this.timeManager.update(delta);
    this.trafficSystem.update(delta);
    this.pedestrianSystem.update(delta);
    this.aircraftSystem.update(delta);
    this.explosionManager.update(delta);
    this.cometManager.update(delta);
    this.trafficHeatmapSystem.update(delta);
    this.audioSystem.update(this.timeManager.timeVal, delta);
    if (this.missionSystem) this.missionSystem.update(delta);
    this.uiManager.updateInspectorLive();
    this.uiManager.updateActionHUD();
    this.uiManager.updateRealEstateTracker(delta);
    this.uiManager.updateAlertFeed(delta);
    if (this.cityBuilder && this.cityBuilder.update) {
      this.cityBuilder.update(delta);
    }
    this.economyAccumulator += delta;
    if (this.economyAccumulator >= 1) {
      this.economySystem.update(this.economyAccumulator);
      this.economyAccumulator = 0;
    }
    if (this.minimapHud) {
      this.minimapHud.update(this.elapsedTime);
    }

    // Animate space rocket vapors, countdown & liftoff in Fun Mode
    if (this.cityBuilder && this.cityBuilder.rocketFlame) {
      if (this.funMode) {
        if (!this.rocketLaunched) {
          if (this.rocketCountdown > 0) {
            this.rocketCountdown = Math.max(0, this.rocketCountdown - delta);
            if (this.rocketCountdown <= 0) {
              this.triggerRocketLaunch();
            }
          }
        } else {
          // Rocket is lifting off!
          if (this.cityBuilder.rocketGroup) {
            this.cityBuilder.rocketVelocityY += 45.0 * delta;
            this.cityBuilder.rocketAltitude += this.cityBuilder.rocketVelocityY * delta;
            this.cityBuilder.rocketGroup.position.y = this.cityBuilder.rocketAltitude;
          }
        }

        // Pulse rocket flame (enlarged when launched)
        const pulse = (this.rocketLaunched ? 2.2 : 1.0) + Math.sin(Date.now() * 0.02) * 0.15;
        this.cityBuilder.rocketFlame.scale.set(pulse, pulse * (this.rocketLaunched ? 2.8 : 1.2), pulse);
        this.cityBuilder.rocketFlame.visible = true;

        // Animate vapors
        if (this.cityBuilder.rocketVapors) {
          const nozzleY = (this.cityBuilder.rocketGroup ? this.cityBuilder.rocketGroup.position.y : 1.5) + 17.0;
          for (const vapor of this.cityBuilder.rocketVapors) {
            vapor.visible = true;
            vapor.userData.age += delta * (this.rocketLaunched ? 2.0 : 1.0);
            const progress = vapor.userData.age / vapor.userData.lifetime;
            
            if (progress >= 1.0) {
              vapor.userData.age = 0.0;
              vapor.userData.lifetime = 1.5 + Math.random() * 1.5;
              vapor.userData.speedY = 8.0 + Math.random() * 6.0;
              vapor.userData.offsetX = (Math.random() - 0.5) * 1.5;
              vapor.userData.offsetZ = (Math.random() - 0.5) * 1.5;
              vapor.position.set(vapor.userData.offsetX, nozzleY, vapor.userData.offsetZ);
              vapor.scale.set(1.0, 1.0, 1.0);
              vapor.material.opacity = 0.0;
            } else {
              vapor.position.y -= vapor.userData.speedY * delta;
              vapor.position.x += Math.sin(vapor.userData.age * 3.0 + vapor.userData.offsetX) * 2.0 * delta;
              vapor.position.z += Math.cos(vapor.userData.age * 3.0 + vapor.userData.offsetZ) * 2.0 * delta;
              const scaleVal = 1.0 + progress * 4.5;
              vapor.scale.set(scaleVal, scaleVal, scaleVal);
              if (progress < 0.2) {
                vapor.material.opacity = (progress / 0.2) * 0.45;
              } else {
                vapor.material.opacity = (1.0 - progress) * 0.45;
              }
            }
          }
        }
      } else {
        this.cityBuilder.rocketFlame.visible = false;
        if (this.cityBuilder.rocketVapors) {
          for (const vapor of this.cityBuilder.rocketVapors) {
            vapor.visible = false;
          }
        }
      }
    }

    // Update camera controls and render
    this.sceneManager.update(delta);
    this.sceneManager.render();
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
window.addEventListener('DOMContentLoaded', () => {
  try {
    window.app = new MetroPulseApp();
  } catch (error) {
    console.error('MetroPulse failed to initialize.', error);
    showFatalError('Unable to start the city simulation', error);
  }
});

window.addEventListener('unhandledrejection', event => {
  console.error('MetroPulse encountered an unhandled operation.', event.reason);
  if (window.app) window.app.fatalError = true;
  window.app?.persistenceSystem?.saveNow?.();
  showFatalError('The city simulation was interrupted', event.reason);
});
