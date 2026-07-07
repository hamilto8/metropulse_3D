import * as THREE from 'three';

export class TimeManager {
  constructor(app) {
    this.app = app;
    this.timeVal = 14.5; // Start at 2:30 PM
    this.isPlaying = true;
    this.speed = 1.0; // Normal 1x speed

    this.initLights();
  }

  initLights() {
    // 1. Ambient Light
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.app.sceneManager.scene.add(this.ambientLight);

    // 2. Directional Sun Light
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 500;
    const d = 150;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.app.sceneManager.scene.add(this.sunLight);

    // 3. Directional Moon Light (for night shadows and rim lighting)
    this.moonLight = new THREE.DirectionalLight(0x88bbff, 0.0);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.width = 1024;
    this.moonLight.shadow.mapSize.height = 1024;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 500;
    this.moonLight.shadow.camera.left = -d;
    this.moonLight.shadow.camera.right = d;
    this.moonLight.shadow.camera.top = d;
    this.moonLight.shadow.camera.bottom = -d;
    this.moonLight.shadow.bias = -0.0005;
    this.app.sceneManager.scene.add(this.moonLight);
  }

  setTime(timeVal) {
    this.timeVal = Math.max(0, Math.min(24, timeVal));
  }

  setPlaying(isPlaying) {
    this.isPlaying = isPlaying;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  update(delta) {
    if (this.isPlaying) {
      // 1 real second = 1 simulation minute at 1x speed (24 minutes for full day)
      // At 15x speed, full day takes ~1.6 minutes
      const hoursPerSecond = (1.0 / 60.0) * this.speed;
      this.timeVal += hoursPerSecond * delta;
      if (this.timeVal >= 24.0) {
        this.timeVal -= 24.0;
      }
    }

    // Update UI
    if (this.app.uiManager) {
      this.app.uiManager.updateTimeDisplay(this.timeVal);
    }

    // Update Environment & Billboards
    if (this.app.environment) {
      this.app.environment.update(this.timeVal, delta);
    }
    if (this.app.billboardCanvas) {
      this.app.billboardCanvas.update(this.timeVal, delta);
    }

    // Update Sun & Moon positions and intensities
    this.updateLighting();
    
    // Update city night lights (buildings, streetlamps, vehicle headlights)
    this.updateNightIllumination();
  }

  updateLighting() {
    // Sun angle from 6:00 (0 rad) to 18:00 (PI rad)
    const sunAngle = ((this.timeVal - 6.0) / 24.0) * Math.PI * 2.0;
    const distance = 250;

    this.sunLight.position.x = Math.cos(sunAngle) * distance;
    this.sunLight.position.y = Math.sin(sunAngle) * distance;
    this.sunLight.position.z = Math.sin(sunAngle * 0.5) * 80;

    const moonAngle = sunAngle + Math.PI;
    this.moonLight.position.x = Math.cos(moonAngle) * distance;
    this.moonLight.position.y = Math.sin(moonAngle) * distance;
    this.moonLight.position.z = -Math.sin(sunAngle * 0.5) * 80;

    // Intensities
    if (this.timeVal >= 6.0 && this.timeVal < 18.0) {
      // Daytime
      const elevation = Math.sin(((this.timeVal - 6.0) / 12.0) * Math.PI);
      this.sunLight.intensity = Math.max(0, elevation * 1.6);
      this.moonLight.intensity = 0;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.4 + elevation * 0.3;
    } else {
      // Nighttime
      this.sunLight.intensity = 0;
      let nightElev = 0;
      if (this.timeVal >= 18.0) {
        nightElev = Math.sin(((this.timeVal - 18.0) / 12.0) * Math.PI);
      } else {
        nightElev = Math.sin(((this.timeVal + 6.0) / 12.0) * Math.PI);
      }
      this.moonLight.intensity = Math.max(0, nightElev * 0.6);
      this.ambientLight.color.setHex(0x335588);
      this.ambientLight.intensity = 0.25;
    }
  }

  updateNightIllumination() {
    // Calculate night factor: 0 during day (07:00 - 17:00), smoothly transitioning to 1 at night (18:00 - 06:00)
    let nightFactor = 0;
    if (this.timeVal >= 17.0 && this.timeVal <= 18.5) {
      nightFactor = (this.timeVal - 17.0) / 1.5;
    } else if (this.timeVal > 18.5 || this.timeVal < 5.5) {
      nightFactor = 1.0;
    } else if (this.timeVal >= 5.5 && this.timeVal <= 7.0) {
      nightFactor = 1.0 - (this.timeVal - 5.5) / 1.5;
    }
    nightFactor = Math.max(0, Math.min(1, nightFactor));

    // 1. Building emissive materials & neon signs
    if (this.app.buildingFactory && this.app.buildingFactory.nightLights) {
      for (const nl of this.app.buildingFactory.nightLights) {
        nl.mat.emissiveIntensity = nl.maxIntensity * nightFactor;
      }
    }

    // 2. Streetlamp bulbs & spot lights
    if (this.app.cityBuilder && this.app.cityBuilder.streetlamps) {
      for (const lamp of this.app.cityBuilder.streetlamps) {
        lamp.bulb.material.emissiveIntensity = 2.0 * nightFactor;
        lamp.light.intensity = 40.0 * nightFactor;
      }
    }

    // 3. Vehicle headlights & taillights
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const vehicle of this.app.trafficSystem.vehicles) {
        vehicle.setNightLights(nightFactor > 0.3);
      }
    }
  }
}
