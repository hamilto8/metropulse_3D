import * as THREE from 'three';
import {
  applyWeatherToSky,
  getNightFactor,
  getSkyPalette
} from '../systems/TimeOfDayVisuals.js';
import {
  DEFAULT_WEATHER_MODE,
  getWeatherDefinition,
  normalizeWeatherMode,
  stepWeatherCycle
} from '../systems/Weather.js';
import {
  CELESTIAL_ORBIT,
  getCelestialOrbitPosition,
  isCelestialBodyVisible
} from './CelestialOrbit.js';

export class Environment {
  constructor(scene, inspectorHud = null, app = null) {
    this.scene = scene;
    this.inspectorHud = inspectorHud;
    this.app = app;
    this.weatherMode = DEFAULT_WEATHER_MODE;
    this.rainParticles = null;
    this.starfield = null;
    this.moon = null;
    this.sun = null;
    this.sunGlow = null;
    this.sunOrbitPosition = { x: 0, y: 0, z: 0 };
    this.moonOrbitPosition = { x: 0, y: 0, z: 0 };

    // Lightning and delayed thunder state
    this.lightningTimer = 5.0 + Math.random() * 10.0;
    this.flashIntensity = 0;
    this.flashSequence = [];
    this.flashAge = 0;
    this.thunderTimer = -1;
    this.thunderVolume = 1.0;

    // Dynamic weather cycle state
    this.isDynamicWeather = true;
    this.weatherCycleTimer = getWeatherDefinition(this.weatherMode).durationSeconds;

    // Wet-surface state. Materials are captured lazily so editor-placed roads
    // can join the effect without requiring a hard dependency on CityBuilder.
    this.wetness = 0;
    this.targetWetness = 0;
    this.wetSurfaceEntries = [];
    this.wetSurfaceMaterials = new Set();
    this.wetSurfaceScanTimer = 0;
    this.wetSurfaceTint = new THREE.Color(0x101827);

    this.initSkyAndStars();
    this.initRain();
    this.collectWetSurfaceMaterials();
  }

  initSkyAndStars() {
    // 1. Low-poly-friendly gradient sky dome. It preserves the simple retro
    // art direction while avoiding a flat near-black void at night.
    const skyGeometry = new THREE.SphereGeometry(620, 32, 16);
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f72d8) },
        horizonColor: { value: new THREE.Color(0x72b8ef) }
      },
      vertexShader: `
        varying float vSkyHeight;
        void main() {
          vSkyHeight = normalize(position).y * 0.5 + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying float vSkyHeight;
        void main() {
          float blend = smoothstep(0.18, 0.78, vSkyHeight);
          gl_FragColor = vec4(mix(horizonColor, topColor, blend), 1.0);
        }
      `
    });
    this.skyDome = new THREE.Mesh(skyGeometry, this.skyMaterial);
    this.skyDome.renderOrder = -100;
    this.scene.add(this.skyDome);

    // 2. Starfield
    const starCount = 1200;
    const starGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      // Position stars on a high dome sphere
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 400 + Math.random() * 50;

      positions[i] = r * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta)); // Keep above horizon
      positions[i + 2] = r * Math.cos(phi);
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xc7dcff,
      size: 1.25,
      transparent: true,
      opacity: 0 // Start invisible (daytime)
    });

    this.starfield = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.starfield);

    // 3. Moon
    const moonGeo = new THREE.SphereGeometry(68, 32, 32);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xffffdd,
      emissive: 0xffeedd,
      emissiveIntensity: 0.9,
      roughness: 0.9,
      fog: false
    });
    this.moon = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moon);

    if (this.inspectorHud) {
      this.inspectorHud.registerObject(this.moon, {
        type: 'CELESTIAL BODY 🌙',
        name: 'The Moon (Luna)',
        info: {
          'Surface Temp': '-130 °C to 120 °C 🌑',
          'Distance': '384,400 km',
          'Status': 'Nighttime Illumination ✨'
        }
      });
    }

    // 4. Sun (Larger, brighter, layered realistic solar sphere)
    const sunGeo = new THREE.SphereGeometry(110, 48, 48);
    const sunMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffbb22,
      emissiveIntensity: 3.5,
      roughness: 0.0,
      metalness: 0.0,
      fog: false
    });
    this.sun = new THREE.Mesh(sunGeo, sunMat);

    // Soft glowing aura halo around the sun
    const glowGeo = new THREE.SphereGeometry(180, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff9922,
      transparent: true,
      opacity: 0.42,
      fog: false
    });
    this.sunGlow = new THREE.Mesh(glowGeo, glowMat);
    this.sun.add(this.sunGlow);

    // Outer Solar Corona haze for atmospheric realism
    const coronaGeo = new THREE.SphereGeometry(290, 32, 32);
    const coronaMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.22,
      fog: false
    });
    this.sunCorona = new THREE.Mesh(coronaGeo, coronaMat);
    this.sun.add(this.sunCorona);

    this.scene.add(this.sun);

    if (this.inspectorHud) {
      this.inspectorHud.registerObject(this.sun, {
        type: 'CELESTIAL BODY ☀️',
        name: 'The Sun (Sol)',
        info: {
          'Surface Temp': '5,778 K (9,941 °F) 🔥',
          'Distance': '149.6 Million km',
          'Status': 'Rising & Setting in Sky 🌅'
        }
      });
    }
  }

  initRain() {
    const dropCount = 12000;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(dropCount * 3);

    for (let i = 0; i < dropCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 800;
      positions[i + 1] = Math.random() * 230 - 10;
      positions[i + 2] = (Math.random() - 0.5) * 800;
    }

    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0xaaaaee,
      size: 0.9,
      transparent: true,
      opacity: 0
    });

    this.rainParticles = new THREE.Points(rainGeo, this.rainMat);
    this.scene.add(this.rainParticles);
  }

  setWeather(mode, { sync = true, resetCycleTimer = true } = {}) {
    const normalizedMode = normalizeWeatherMode(mode);
    const definition = getWeatherDefinition(normalizedMode);
    this.weatherMode = normalizedMode;
    this.flashIntensity = 0;
    this.flashSequence = [];
    this.thunderTimer = -1;

    if (this.scene.fog) this.scene.fog.density = definition.fogDensity;
    if (this.rainMat) this.rainMat.opacity = definition.rainOpacity;
    this.targetWetness = definition.wetness;

    if (normalizedMode === 'thunderstorm') {
      this.lightningTimer = 3.0 + Math.random() * 5.0; // Trigger lightning soon!
    }

    this.collectWetSurfaceMaterials();
    if (resetCycleTimer && this.isDynamicWeather) {
      this.weatherCycleTimer = this.getWeatherDuration(normalizedMode);
    }
    if (sync) this.syncWeatherIntegration(normalizedMode);
    return normalizedMode;
  }

  setDynamicWeather(enabled) {
    const nextEnabled = Boolean(enabled);
    this.isDynamicWeather = nextEnabled;
    this.weatherCycleTimer = this.isDynamicWeather ? this.getWeatherDuration(this.weatherMode) : 0;
    this.app?.uiManager?.syncDynamicWeatherControl?.(this.isDynamicWeather);
    return this.isDynamicWeather;
  }

  getWeatherDuration(mode = this.weatherMode) {
    return getWeatherDefinition(mode).durationSeconds;
  }

  updateDynamicWeather(delta) {
    const nextState = stepWeatherCycle(
      this.weatherMode,
      this.weatherCycleTimer,
      delta,
      this.isDynamicWeather
    );
    this.weatherCycleTimer = nextState.remainingSeconds;
    if (nextState.mode !== this.weatherMode) {
      this.setWeather(nextState.mode, { sync: true, resetCycleTimer: false });
    }
    return nextState.transitions;
  }

  syncWeatherIntegration(mode) {
    this.app?.physicsWorld?.setWeatherFriction?.(mode);
    this.app?.uiManager?.syncWeatherButtons?.(mode);
    this.app?.persistenceSystem?.scheduleSave?.();
  }

  collectWetSurfaceMaterials() {
    const wetSurfaceColors = new Set([
      0x1e2534, // city ground
      0x2c3344, // asphalt road grid
      0x222633, // suspension bridge deck
      0x3d312a, // countryside bridge deck
      0x22252a, // editor-placed road segment
      0x647488  // sidewalks
    ]);

    this.scene.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material?.isMeshStandardMaterial || !material.color) continue;
        if (this.wetSurfaceMaterials.has(material)) continue;
        if (!wetSurfaceColors.has(material.color.getHex())) continue;

        this.wetSurfaceMaterials.add(material);
        this.wetSurfaceEntries.push({
          material,
          baseColor: material.color.clone(),
          baseRoughness: material.roughness,
          baseMetalness: material.metalness
        });
      }
    });
  }

  updateWetSurfaces(delta) {
    const blend = 1 - Math.exp(-Math.max(0, delta) * 1.7);
    this.wetness += (this.targetWetness - this.wetness) * blend;
    if (Math.abs(this.targetWetness - this.wetness) < 0.001) this.wetness = this.targetWetness;

    this.wetSurfaceScanTimer -= delta;
    if (this.wetSurfaceScanTimer <= 0) {
      this.collectWetSurfaceMaterials();
      this.wetSurfaceScanTimer = 5;
    }

    for (const entry of this.wetSurfaceEntries) {
      const { material, baseColor, baseRoughness, baseMetalness } = entry;
      if (!material) continue;
      material.color.copy(baseColor).lerp(this.wetSurfaceTint, this.wetness * 0.22);
      material.roughness = THREE.MathUtils.lerp(baseRoughness, 0.2, this.wetness);
      material.metalness = THREE.MathUtils.lerp(baseMetalness, Math.max(baseMetalness, 0.48), this.wetness);
    }
  }

  update(timeVal, delta) {
    // Dynamic weather cycling
    this.updateDynamicWeather(delta);

    this.updateWetSurfaces(delta);

    // Exponential fog that reads well at street level can completely flatten
    // a 300 m management overview. Fade density with camera altitude while
    // preserving each weather state's relative visibility penalty.
    const cameraHeight = this.app?.sceneManager?.camera?.position?.y || 0;
    const altitudeBlend = THREE.MathUtils.smoothstep(cameraHeight, 60, 300);
    const altitudeScale = THREE.MathUtils.lerp(1, 0.32, altitudeBlend);
    if (this.scene.fog) {
      this.scene.fog.density = getWeatherDefinition(this.weatherMode).fogDensity * altitudeScale;
    }

    // 1. Sky & fog color transitions use separate zenith/horizon colors so
    // the street silhouette remains readable without making night look like day.
    const skyPalette = applyWeatherToSky(getSkyPalette(timeVal), this.weatherMode);
    const targetBg = skyPalette.top.clone();
    const targetFog = skyPalette.horizon.clone().lerp(targetBg, 0.3);
    let starOpacity = getNightFactor(timeVal) * 0.82;

    // Update delayed thunder timer
    if (this.thunderTimer > 0) {
      this.thunderTimer -= delta;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = -1;
        if (this.app && this.app.audioSystem) {
          this.app.audioSystem.playThunder(this.thunderVolume);
        }
      }
    }

    // Update lightning flash sequence
    if (this.weatherMode === 'thunderstorm') {
      this.lightningTimer -= delta;
      if (this.lightningTimer <= 0) {
        // Trigger lightning strike!
        const distance = 250 + Math.random() * 950; // distance (meters)
        this.thunderTimer = distance / 343; // delayed sound w/ speed of sound
        this.thunderVolume = Math.max(0.18, 1.0 - (distance - 250) / 950);

        // Flash sequence wiggles
        this.flashSequence = [
          { time: 0.0, intensity: 1.0 },
          { time: 0.06, intensity: 0.0 },
          { time: 0.12, intensity: 0.8 },
          { time: 0.22, intensity: 0.0 }
        ];
        if (Math.random() < 0.65) {
          this.flashSequence.push({ time: 0.28, intensity: 0.5 });
          this.flashSequence.push({ time: 0.36, intensity: 0.0 });
        }
        this.flashAge = 0;
        this.lightningTimer = 7.0 + Math.random() * 14.0;
      }

      if (this.flashSequence.length > 0) {
        this.flashAge += delta;
        let activeIntensity = 0;
        for (let i = 0; i < this.flashSequence.length; i++) {
          if (this.flashAge >= this.flashSequence[i].time) {
            activeIntensity = this.flashSequence[i].intensity;
          }
        }
        this.flashIntensity = activeIntensity;

        if (this.flashAge > this.flashSequence[this.flashSequence.length - 1].time) {
          this.flashSequence = [];
          this.flashIntensity = 0;
        }
      }
    } else {
      this.flashIntensity = 0;
      this.flashSequence = [];
    }

    const isFunMode = (this.app && this.app.funMode) || (window.app && window.app.funMode);
    if (isFunMode) {
      targetBg.setHex(0x4a1205); // Fiery orange-red apocalyptic sky!
      targetFog.setHex(0x5a1806);
      this.scene.background.copy(targetBg);
      this.scene.fog.color.copy(targetFog);
      starOpacity = 0.35;
    } else {
      if (this.weatherMode === 'thunderstorm' && this.flashIntensity > 0) {
        const flashColor = new THREE.Color(0xd0e8ff).lerp(targetBg, 1.0 - this.flashIntensity);
        this.scene.background.copy(flashColor);
        this.scene.fog.color.copy(flashColor);
      } else {
        this.scene.background.copy(targetBg);
        this.scene.fog.color.copy(targetFog);
      }
    }
    if (this.skyMaterial) {
      this.skyMaterial.uniforms.topColor.value.copy(targetBg);
      this.skyMaterial.uniforms.horizonColor.value.copy(targetFog);
    }
    this.starMat.opacity = starOpacity;

    // 2. Position Sun and Moon in opposition across the celestial dome
    // Keep the bodies outside the playable terrain so the landscape can
    // naturally occlude sunrise and moonrise instead of intersecting meshes.
    // The orbit follows the active view horizontally like the sky dome.
    const activeCamera = this.app?.sceneManager?.camera;
    const skyCenterX = activeCamera?.position.x || 0;
    const skyCenterZ = activeCamera?.position.z || 0;
    const skyCenter = { x: skyCenterX, z: skyCenterZ };

    if (this.starfield && activeCamera) {
      this.starfield.position.x = skyCenterX;
      this.starfield.position.z = skyCenterZ;
    }
    if (this.skyDome && activeCamera) {
      this.skyDome.position.x = skyCenterX;
      this.skyDome.position.z = skyCenterZ;
    }
    
    if (this.moon) {
      const position = getCelestialOrbitPosition(
        timeVal,
        'moon',
        skyCenter,
        CELESTIAL_ORBIT,
        this.moonOrbitPosition
      );
      this.moon.position.set(position.x, position.y, position.z);
      this.moon.visible = isCelestialBodyVisible(
        this.moon.position.y,
        CELESTIAL_ORBIT.moonBodyRadius
      );
    }

    if (this.sun) {
      const position = getCelestialOrbitPosition(
        timeVal,
        'sun',
        skyCenter,
        CELESTIAL_ORBIT,
        this.sunOrbitPosition
      );
      this.sun.position.set(position.x, position.y, position.z);
      this.sun.visible = isCelestialBodyVisible(
        this.sun.position.y,
        CELESTIAL_ORBIT.sunBodyRadius
      );

      // Dynamic color transition based on altitude (sunrise/sunset horizon vs zenith midday)
      if (this.sun.visible && this.sun.material) {
        const altFactor = Math.min(1.0, Math.max(0.0, (this.sun.position.y + 100) / 900));
        // Horizon: fiery orange-gold, Midday: brilliant pure white-gold
        const hue = 0.06 + altFactor * 0.08;
        const lightness = 0.5 + altFactor * 0.25;
        this.sun.material.emissive.setHSL(hue, 1.0, lightness);
        if (this.sunGlow && this.sunGlow.material) {
          this.sunGlow.material.color.setHSL(hue, 1.0, lightness * 0.85);
          this.sunGlow.material.opacity = 0.28 + (1.0 - altFactor) * 0.25;
        }
        if (this.sunCorona && this.sunCorona.material) {
          this.sunCorona.material.color.setHSL(hue, 1.0, lightness * 0.7);
          this.sunCorona.material.opacity = 0.15 + (1.0 - altFactor) * 0.15;
        }
      }
    }

    // 3. Update Rain Particle physics and center horizontally on active view for map-wide rainfall
    if ((this.weatherMode === 'rain' || this.weatherMode === 'thunderstorm') && this.rainParticles) {
      const activeCamera = this.app?.sceneManager?.camera;
      if (activeCamera) {
        this.rainParticles.position.x = activeCamera.position.x;
        this.rainParticles.position.z = activeCamera.position.z;
      }
      const posAttr = this.rainParticles.geometry.attributes.position;
      const arr = posAttr.array;
      const fallSpeed = this.weatherMode === 'thunderstorm' ? 170 : 120;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= fallSpeed * delta;
        if (arr[i] < -15) {
          arr[i] = 220;
        }
      }
      posAttr.needsUpdate = true;
    }
  }
}
