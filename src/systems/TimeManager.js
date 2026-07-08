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

    // 2. Directional Sun Light (Optimized shadow map size for high FPS on Apple Silicon)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 500;
    const d = 150;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.app.sceneManager.scene.add(this.sunLight);

    // 3. Directional Moon Light (Disable shadow casting to save duplicate shadow pass overhead)
    this.moonLight = new THREE.DirectionalLight(0x88bbff, 0.0);
    this.moonLight.castShadow = false;
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
      const hoursPerSecond = (1.0 / 60.0) * this.speed;
      this.timeVal += hoursPerSecond * delta;
      if (this.timeVal >= 24.0) {
        this.timeVal -= 24.0;
      }
    }

    if (this.app.uiManager) {
      this.app.uiManager.updateTimeDisplay(this.timeVal);
    }

    if (this.app.environment) {
      this.app.environment.update(this.timeVal, delta);
    }
    if (this.app.billboardCanvas) {
      this.app.billboardCanvas.update(this.timeVal, delta);
    }

    this.updateLighting();
    this.updateNightIllumination();
  }

  updateLighting() {
    const sunAngle = ((this.timeVal - 6.0) / 24.0) * Math.PI * 2.0;
    const distance = 250;

    this.sunLight.position.x = Math.cos(sunAngle) * distance;
    this.sunLight.position.y = Math.sin(sunAngle) * distance;
    this.sunLight.position.z = Math.sin(sunAngle * 0.5) * 80;

    const moonAngle = sunAngle + Math.PI;
    this.moonLight.position.x = Math.cos(moonAngle) * distance;
    this.moonLight.position.y = Math.sin(moonAngle) * distance;
    this.moonLight.position.z = -Math.sin(sunAngle * 0.5) * 80;

    if (this.timeVal >= 6.0 && this.timeVal < 18.0) {
      const elevation = Math.sin(((this.timeVal - 6.0) / 12.0) * Math.PI);
      this.sunLight.intensity = Math.max(0, elevation * 1.6);
      this.moonLight.intensity = 0;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.4 + elevation * 0.3;
    } else {
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

    const isFunMode = (this.app && this.app.funMode) || (window.app && window.app.funMode);
    if (isFunMode) {
      this.ambientLight.color.setHex(0xff5533);
      this.ambientLight.intensity = Math.max(0.6, this.ambientLight.intensity);
      if (this.sunLight.intensity > 0) {
        this.sunLight.color.setHex(0xff3311);
      }
    } else {
      this.sunLight.color.setHex(0xffffff);
    }
  }

  updateNightIllumination() {
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

    // 2. Streetlamp bulbs & high-perf volumetric cones
    if (this.app.cityBuilder && this.app.cityBuilder.streetlamps) {
      for (const lamp of this.app.cityBuilder.streetlamps) {
        lamp.bulb.material.emissiveIntensity = 2.0 * nightFactor;
        if (lamp.cone) {
          lamp.cone.opacity = 0.18 * nightFactor;
        }
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
