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
    // 1. Ambient & Hemisphere Light for rich sky-to-ground fill lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    this.app.sceneManager.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 0.95);
    this.app.sceneManager.scene.add(this.hemiLight);

    // 2. Directional Sun Light (Optimized shadow map size for high FPS on Apple Silicon)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
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

  getFormattedTime() {
    const normalized = ((this.timeVal % 24) + 24) % 24;
    const hours = Math.floor(normalized);
    const minutes = Math.floor((normalized - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
    const distance = 1800;

    this.sunLight.position.x = Math.cos(sunAngle) * distance;
    this.sunLight.position.y = Math.sin(sunAngle) * distance;
    this.sunLight.position.z = Math.sin(sunAngle * 0.5) * 250;

    const moonAngle = sunAngle + Math.PI;
    this.moonLight.position.x = Math.cos(moonAngle) * distance;
    this.moonLight.position.y = Math.sin(moonAngle) * distance;
    this.moonLight.position.z = -Math.sin(sunAngle * 0.5) * 250;

    if (this.timeVal >= 6.0 && this.timeVal < 18.0) {
      const elevation = Math.sin(((this.timeVal - 6.0) / 12.0) * Math.PI);
      this.sunLight.intensity = Math.max(0.65, elevation * 2.5 + 0.8);
      this.moonLight.intensity = 0;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.65 + elevation * 0.45;
      if (this.hemiLight) {
        this.hemiLight.intensity = 0.85 + elevation * 0.4;
        this.hemiLight.color.setHex(0xe0f2fe);
        this.hemiLight.groundColor.setHex(0x334155);
      }
    } else {
      this.sunLight.intensity = 0;
      let nightElev = 0;
      if (this.timeVal >= 18.0) {
        nightElev = Math.sin(((this.timeVal - 18.0) / 12.0) * Math.PI);
      } else {
        nightElev = Math.sin(((this.timeVal + 6.0) / 12.0) * Math.PI);
      }
      this.moonLight.intensity = Math.max(0.35, nightElev * 0.95);
      this.ambientLight.color.setHex(0x5577aa);
      this.ambientLight.intensity = 0.45;
      if (this.hemiLight) {
        this.hemiLight.intensity = 0.48;
        this.hemiLight.color.setHex(0x384d66);
        this.hemiLight.groundColor.setHex(0x1e293b);
      }
    }

    const isFunMode = (this.app && this.app.funMode) || (window.app && window.app.funMode);
    if (isFunMode) {
      this.ambientLight.color.setHex(0xff5533);
      this.ambientLight.intensity = Math.max(0.8, this.ambientLight.intensity);
      if (this.sunLight.intensity > 0) {
        this.sunLight.color.setHex(0xff3311);
      }
    } else {
      this.sunLight.color.setHex(0xfff8ee);
    }

    // Apply lightning flash light override
    const env = this.app.environment;
    if (env && env.weatherMode === 'thunderstorm' && env.flashIntensity > 0) {
      this.sunLight.intensity = Math.max(this.sunLight.intensity, env.flashIntensity * 3.5);
      this.ambientLight.intensity = Math.max(this.ambientLight.intensity, env.flashIntensity * 1.8);
      this.ambientLight.color.setHex(0xd0e8ff);
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
        const base = nl.baseIntensity || 0;
        nl.mat.emissiveIntensity = base + (nl.maxIntensity - base) * nightFactor;
      }
    }

    // 2. Streetlamp bulbs & high-perf volumetric cones
    if (this.app.cityBuilder && this.app.cityBuilder.streetlamps) {
      for (const lamp of this.app.cityBuilder.streetlamps) {
        lamp.bulb.material.emissiveIntensity = 0.3 + 2.2 * nightFactor;
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
