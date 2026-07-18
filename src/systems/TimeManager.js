import * as THREE from 'three';
import { getNightFactor } from './TimeOfDayVisuals.js';
import { getCelestialAngles } from '../world/CelestialOrbit.js';

export const DEFAULT_TIME_SPEED = 1;
export const TIME_SPEED_OPTIONS = Object.freeze([0.5, 1, 5, 15]);
export const BASE_GAME_MINUTES_PER_REAL_SECOND = 1;

export function normalizeTimeSpeed(speed) {
  const numericSpeed = Number(speed);
  return TIME_SPEED_OPTIONS.includes(numericSpeed) ? numericSpeed : DEFAULT_TIME_SPEED;
}

export function advanceSimulationTime(timeVal, deltaSeconds, speed = DEFAULT_TIME_SPEED) {
  const currentTime = Number.isFinite(timeVal) ? timeVal : 0;
  const elapsedSeconds = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const hoursElapsed = (
    elapsedSeconds
    * BASE_GAME_MINUTES_PER_REAL_SECOND
    * normalizeTimeSpeed(speed)
  ) / 60;
  return ((currentTime + hoursElapsed) % 24 + 24) % 24;
}

export class TimeManager {
  constructor(app) {
    this.app = app;
    this.timeVal = 14.5; // Start at 2:30 PM
    this.isPlaying = true;
    this.speed = DEFAULT_TIME_SPEED;
    this.celestialAngles = { sun: 0, moon: Math.PI };

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

    // A subtle violet-blue rim preserves simple silhouettes on shadowed
    // façades without adding another expensive shadow pass.
    this.cityFillLight = new THREE.DirectionalLight(0x8b78d8, 0);
    this.cityFillLight.position.set(-420, 260, 330);
    this.cityFillLight.castShadow = false;
    this.app.sceneManager.scene.add(this.cityFillLight);

    this.dayAmbientColor = new THREE.Color(0xffffff);
    this.nightAmbientColor = new THREE.Color(0x8aa9dc);
    this.dayHemiColor = new THREE.Color(0xe0f2fe);
    this.nightHemiColor = new THREE.Color(0x7393d2);
    this.dayGroundColor = new THREE.Color(0x334155);
    this.nightGroundColor = new THREE.Color(0x3b466f);
  }

  setTime(timeVal) {
    if (!Number.isFinite(timeVal)) return this.timeVal;
    this.timeVal = Math.max(0, Math.min(24, timeVal));
    this.app?.persistenceSystem?.scheduleSave?.();
    return this.timeVal;
  }

  setPlaying(isPlaying) {
    const nextPlaying = Boolean(isPlaying);
    const changed = nextPlaying !== this.isPlaying;
    this.isPlaying = nextPlaying;
    this.app?.uiManager?.syncTimePlayingControl?.(this.isPlaying);
    if (changed) this.app?.persistenceSystem?.scheduleSave?.();
    return this.isPlaying;
  }

  setSpeed(speed) {
    const nextSpeed = normalizeTimeSpeed(speed);
    const changed = nextSpeed !== this.speed;
    this.speed = nextSpeed;
    this.app?.uiManager?.syncTimeSpeedControl?.(this.speed);
    if (changed) this.app?.persistenceSystem?.scheduleSave?.();
    return this.speed;
  }

  getFormattedTime() {
    const normalized = ((this.timeVal % 24) + 24) % 24;
    const hours = Math.floor(normalized);
    const minutes = Math.floor((normalized - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  advance(delta, speed = this.speed) {
    if (this.isPlaying) {
      this.timeVal = advanceSimulationTime(this.timeVal, delta, speed);
    }
    return this.timeVal;
  }

  updatePresentation(delta) {
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

  /** Compatibility entry point for isolated consumers outside the scheduler. */
  update(delta) {
    this.advance(delta);
    this.updatePresentation(delta);
  }

  updateLighting() {
    const { sun: sunAngle, moon: moonAngle } = getCelestialAngles(
      this.timeVal,
      this.celestialAngles
    );
    const distance = 1800;

    this.sunLight.position.x = Math.cos(sunAngle) * distance;
    this.sunLight.position.y = Math.sin(sunAngle) * distance;
    this.sunLight.position.z = Math.sin(sunAngle * 0.5) * 250;

    this.moonLight.position.x = Math.cos(moonAngle) * distance;
    this.moonLight.position.y = Math.sin(moonAngle) * distance;
    this.moonLight.position.z = -Math.sin(sunAngle * 0.5) * 250;

    const normalizedHour = ((this.timeVal % 24) + 24) % 24;
    const nightFactor = getNightFactor(normalizedHour);
    const daylightElevation = normalizedHour >= 6 && normalizedHour < 18
      ? Math.sin(((normalizedHour - 6) / 12) * Math.PI)
      : 0;
    const nightElevation = normalizedHour >= 18
      ? Math.sin(((normalizedHour - 18) / 12) * Math.PI)
      : Math.sin(((normalizedHour + 6) / 12) * Math.PI);

    this.sunLight.intensity = (1 - nightFactor) * (0.62 + daylightElevation * 2.68);
    this.moonLight.intensity = nightFactor * (0.58 + Math.max(0, nightElevation) * 0.62);
    this.ambientLight.color.copy(this.dayAmbientColor).lerp(this.nightAmbientColor, nightFactor);
    this.ambientLight.intensity = THREE.MathUtils.lerp(
      0.7 + daylightElevation * 0.42,
      0.76,
      nightFactor
    );
    if (this.hemiLight) {
      this.hemiLight.intensity = THREE.MathUtils.lerp(
        0.88 + daylightElevation * 0.35,
        0.8,
        nightFactor
      );
      this.hemiLight.color.copy(this.dayHemiColor).lerp(this.nightHemiColor, nightFactor);
      this.hemiLight.groundColor.copy(this.dayGroundColor).lerp(this.nightGroundColor, nightFactor);
    }
    this.cityFillLight.intensity = 0.34 * nightFactor;
    this.app.sceneManager?.setTimeOfDayVisuals?.(nightFactor, this.app.environment?.weatherMode);

    const isFunMode = (this.app && this.app.funMode) || (window.app && window.app.funMode);
    if (isFunMode) {
      this.ambientLight.color.setHex(0xff5533);
      this.ambientLight.intensity = Math.max(0.8, this.ambientLight.intensity);
      if (this.sunLight.intensity > 0) {
        this.sunLight.color.setHex(0xff3311);
      }
      this.cityFillLight.color.setHex(0xff4433);
      this.cityFillLight.intensity = Math.max(0.32, this.cityFillLight.intensity);
    } else {
      this.sunLight.color.setHex(0xfff8ee);
      this.moonLight.color.setHex(0xa8c7ff);
      this.cityFillLight.color.setHex(0x8b78d8);
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
    const nightFactor = getNightFactor(this.timeVal);

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
        lamp.bulb.material.emissiveIntensity = 0.12 + 1.02 * nightFactor;
        if (lamp.cone) {
          lamp.cone.opacity = 0.038 * nightFactor;
        }
        if (lamp.pool) lamp.pool.opacity = 0.15 * nightFactor;
      }
    }

    // 3. Vehicle headlights & taillights
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const vehicle of this.app.trafficSystem.vehicles) {
        vehicle.setNightLights(nightFactor);
      }
    }
  }
}
