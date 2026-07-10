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
import { AudioSystem } from './systems/AudioSystem.js';
import { ExplosionManager } from './effects/ExplosionManager.js';
import { CometManager } from './effects/CometManager.js';

import { UIManager } from './ui/UIManager.js';
import { InspectorHUD } from './ui/InspectorHUD.js';
import { DialogueOverlay } from './ui/DialogueOverlay.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { MissionSystem } from './systems/MissionSystem.js';

class MetroPulseApp {
  constructor() {
    const container = document.getElementById('canvas-container');
    
    // 0. Physics World (cannon-es Phase 1 prototype)
    this.physicsWorld = new PhysicsWorld();

    // 1. Core Scene & Camera
    this.sceneManager = new SceneManager(this, container);

    // 2. Audio System
    this.audioSystem = new AudioSystem(this);

    // 3. Raycaster / Inspector HUD
    this.inspectorHud = new InspectorHUD(this);

    // 4. Canvas Billboards
    this.billboardCanvas = new BillboardCanvas(this);

    // 5. Build City Infrastructure
    this.cityBuilder = new CityBuilder(this.sceneManager.scene, this.inspectorHud, this.billboardCanvas);
    this.cityBuilder.build();

    // 6. Build Skyscrapers & Commercial Businesses
    this.buildingFactory = new BuildingFactory(this.sceneManager.scene, this.billboardCanvas, this.inspectorHud);
    this.buildingFactory.app = this;
    this.buildingFactory.buildAll(this.cityBuilder.buildingPlots);

    // Register static obstacle colliders in PhysicsWorld (Buildings & Lamp Posts)
    for (const b of this.buildingFactory.buildings) {
      if (b.plot) {
        this.physicsWorld.addStaticBoxCollider(
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
            new THREE.Vector3(1.6, 6, 1.6)
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
      new THREE.Vector3(622, billboardCenterHeight + 11.0, -160),
      new THREE.Vector3(32, 22, 2)
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
    this.trafficSystem = new TrafficSystem(this);

    // 10. Pedestrian Simulation
    this.pedestrianSystem = new PedestrianSystem(this);
    this.physicsWorld.terrainSystem = this.pedestrianSystem;

    // 11. UI Controls Manager
    this.uiManager = new UIManager(this);

    // 11.5 Phase 3 Mission Logic & Branching Dialogue Overlay
    this.dialogueOverlay = new DialogueOverlay();
    this.missionSystem = new MissionSystem(this, this.dialogueOverlay);

    // 12. Animation Loop Setup
    this.clock = new THREE.Clock();
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

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
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

  animate() {
    requestAnimationFrame(this.animate);

    const delta = Math.min(0.1, this.clock.getDelta());
    
    // FPS counter
    this.frameCount++;
    this.fpsTimer += delta;
    if (this.fpsTimer >= 1.0) {
      this.currentFps = this.frameCount / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.uiManager.updateStats(
        this.trafficSystem.vehicles.length,
        this.pedestrianSystem.pedestrians.length,
        this.currentFps
      );
    }

    // Update simulation systems
    this.physicsWorld.step(delta);
    this.timeManager.update(delta);
    this.trafficSystem.update(delta);
    this.pedestrianSystem.update(delta);
    this.explosionManager.update(delta);
    this.cometManager.update(delta);
    this.audioSystem.update(this.timeManager.timeVal, delta);
    if (this.missionSystem) this.missionSystem.update(delta);
    this.uiManager.updateInspectorLive();
    this.uiManager.updateRealEstateTracker(delta);

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

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MetroPulseApp();
});
