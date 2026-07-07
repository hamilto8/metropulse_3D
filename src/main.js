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

import { UIManager } from './ui/UIManager.js';
import { InspectorHUD } from './ui/InspectorHUD.js';

class MetroPulseApp {
  constructor() {
    const container = document.getElementById('canvas-container');
    
    // 1. Core Scene & Camera
    this.sceneManager = new SceneManager(container);

    // 2. Audio System
    this.audioSystem = new AudioSystem();

    // 3. Raycaster / Inspector HUD
    this.inspectorHud = new InspectorHUD(this);

    // 4. Canvas Billboards
    this.billboardCanvas = new BillboardCanvas();

    // 5. Build City Infrastructure
    this.cityBuilder = new CityBuilder(this.sceneManager.scene, this.inspectorHud);
    this.cityBuilder.build();

    // 6. Build Skyscrapers & Commercial Businesses
    this.buildingFactory = new BuildingFactory(this.sceneManager.scene, this.billboardCanvas, this.inspectorHud);
    this.buildingFactory.buildAll(this.cityBuilder.buildingPlots);

    // 7. Environment (Sky, Moon, Stars, Weather)
    this.environment = new Environment(this.sceneManager.scene);

    // 8. Time Manager (Day-night cycle & dynamic lighting)
    this.timeManager = new TimeManager(this);

    // 9. Traffic Simulation
    this.trafficSystem = new TrafficSystem(this);

    // 10. Pedestrian Simulation
    this.pedestrianSystem = new PedestrianSystem(this);

    // 11. UI Controls Manager
    this.uiManager = new UIManager(this);

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
    this.timeManager.update(delta);
    this.trafficSystem.update(delta);
    this.pedestrianSystem.update(delta);
    this.audioSystem.update(this.timeManager.timeVal, delta);
    this.uiManager.updateInspectorLive();

    // Update camera controls and render
    this.sceneManager.update(delta);
    this.sceneManager.render();
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MetroPulseApp();
});
