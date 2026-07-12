import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Vehicle } from '../src/entities/Vehicle.js';
import { TimeManager } from '../src/systems/TimeManager.js';
import {
  applyWeatherToSky,
  getNightFactor,
  getSkyPalette,
  normalizeHour,
  TIME_OF_DAY_VISUALS
} from '../src/systems/TimeOfDayVisuals.js';
import { SceneManager } from '../src/world/SceneManager.js';

test('night factor is bounded, wraps time, and transitions smoothly', () => {
  assert.equal(normalizeHour(26), 2);
  assert.equal(normalizeHour(-1), 23);
  assert.equal(getNightFactor(2), 1);
  assert.equal(getNightFactor(12), 0);
  assert.equal(getNightFactor(17), 0);
  assert.equal(getNightFactor(19), 1);
  assert.ok(getNightFactor(18) > 0 && getNightFactor(18) < 1);
  assert.ok(getNightFactor(6) > 0 && getNightFactor(6) < 1);
  assert.equal(getNightFactor(Number.NaN), 0);
});

test('night sky keeps a readable indigo horizon across clear and rainy weather', () => {
  const clearNight = getSkyPalette(2);
  assert.equal(clearNight.top.getHex(), 0x080b20);
  assert.equal(clearNight.horizon.getHex(), 0x1a2850);
  assert.ok(clearNight.horizon.getHSL({}).l > clearNight.top.getHSL({}).l);

  const rainyNight = applyWeatherToSky(clearNight, 'rain');
  assert.ok(rainyNight.horizon.getHSL({}).l > rainyNight.top.getHSL({}).l);
  assert.notEqual(rainyNight.horizon.getHex(), 0x070913);
});

test('night lighting provides cool fill while preserving stronger daylight', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { app: null };
  try {
    const scene = new THREE.Scene();
    let visualProfile = null;
    const app = {
      funMode: false,
      environment: { weatherMode: 'clear' },
      sceneManager: {
        scene,
        setTimeOfDayVisuals(nightFactor, weatherMode) {
          visualProfile = { nightFactor, weatherMode };
        }
      }
    };
    const manager = new TimeManager(app);
    manager.timeVal = 2;
    manager.updateLighting();
    assert.ok(manager.ambientLight.intensity >= 0.63);
    assert.ok(manager.hemiLight.intensity >= 0.7);
    assert.ok(manager.moonLight.intensity > 0.5);
    assert.ok(manager.cityFillLight.intensity > 0.25);
    assert.deepEqual(visualProfile, { nightFactor: 1, weatherMode: 'clear' });

    manager.timeVal = 12;
    manager.updateLighting();
    assert.ok(manager.sunLight.intensity > manager.moonLight.intensity);
    assert.equal(manager.cityFillLight.intensity, 0);
    assert.equal(visualProfile.nightFactor, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('renderer exposure and bloom adapt to night without unbounded highlights', () => {
  const manager = Object.create(SceneManager.prototype);
  manager.renderer = { toneMappingExposure: 0 };
  manager.bloomPass = { strength: 0, threshold: 0, radius: 0 };
  manager.setTimeOfDayVisuals(1, 'rain');
  assert.ok(manager.renderer.toneMappingExposure > TIME_OF_DAY_VISUALS.dayExposure);
  assert.ok(manager.renderer.toneMappingExposure < 1.7);
  assert.equal(manager.bloomPass.strength, TIME_OF_DAY_VISUALS.nightBloomStrength);
  assert.equal(manager.bloomPass.threshold, TIME_OF_DAY_VISUALS.nightBloomThreshold);
});

test('vehicle lights scale continuously through twilight', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Twilight Vehicle');
  vehicle.setNightLights(0.5);
  assert.equal(vehicle.headlights[0].material.emissiveIntensity, 0.6);
  assert.equal(vehicle.taillights[0].material.emissiveIntensity, 0.39);
  vehicle.setNightLights(false);
  assert.equal(vehicle.headlights[0].material.emissiveIntensity, 0);
});
