import * as THREE from 'three';

export class Environment {
  constructor(scene, inspectorHud = null, app = null) {
    this.scene = scene;
    this.inspectorHud = inspectorHud;
    this.app = app;
    this.weatherMode = 'clear';
    this.rainParticles = null;
    this.starfield = null;
    this.moon = null;
    this.sun = null;
    this.sunGlow = null;

    // Lightning and delayed thunder state
    this.lightningTimer = 5.0 + Math.random() * 10.0;
    this.flashIntensity = 0;
    this.flashSequence = [];
    this.flashAge = 0;
    this.thunderTimer = -1;
    this.thunderVolume = 1.0;

    // Dynamic weather cycle state
    this.isDynamicWeather = false;
    this.weatherCycleTimer = 0;

    this.initSkyAndStars();
    this.initRain();
  }

  initSkyAndStars() {
    // 1. Starfield
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
      color: 0xffffff,
      size: 1.5,
      transparent: true,
      opacity: 0 // Start invisible (daytime)
    });

    this.starfield = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.starfield);

    // 2. Moon
    const moonGeo = new THREE.SphereGeometry(68, 32, 32);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xffffdd,
      emissive: 0xffeedd,
      emissiveIntensity: 0.9,
      roughness: 0.9
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

    // 3. Sun (Larger, brighter, layered realistic solar sphere)
    const sunGeo = new THREE.SphereGeometry(110, 48, 48);
    const sunMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffbb22,
      emissiveIntensity: 3.5,
      roughness: 0.0,
      metalness: 0.0
    });
    this.sun = new THREE.Mesh(sunGeo, sunMat);

    // Soft glowing aura halo around the sun
    const glowGeo = new THREE.SphereGeometry(180, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff9922,
      transparent: true,
      opacity: 0.42
    });
    this.sunGlow = new THREE.Mesh(glowGeo, glowMat);
    this.sun.add(this.sunGlow);

    // Outer Solar Corona haze for atmospheric realism
    const coronaGeo = new THREE.SphereGeometry(290, 32, 32);
    const coronaMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.22
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

  setWeather(mode) {
    this.weatherMode = mode;
    this.flashIntensity = 0;
    this.flashSequence = [];
    this.thunderTimer = -1;

    if (mode === 'clear') {
      this.scene.fog.density = 0.0035;
      if (this.rainMat) this.rainMat.opacity = 0;
    } else if (mode === 'mist') {
      this.scene.fog.density = 0.015;
      if (this.rainMat) this.rainMat.opacity = 0;
    } else if (mode === 'rain') {
      this.scene.fog.density = 0.008;
      if (this.rainMat) this.rainMat.opacity = 0.6;
    } else if (mode === 'thunderstorm') {
      this.scene.fog.density = 0.012;
      if (this.rainMat) this.rainMat.opacity = 0.85;
      this.lightningTimer = 3.0 + Math.random() * 5.0; // Trigger lightning soon!
    }
  }

  update(timeVal, delta) {
    // Dynamic weather cycling
    if (this.isDynamicWeather) {
      this.weatherCycleTimer -= delta;
      if (this.weatherCycleTimer <= 0) {
        const modes = ['clear', 'mist', 'rain', 'thunderstorm'];
        let nextModes = modes.filter(m => m !== this.weatherMode);
        // Bias towards clear weather slightly so it doesn't storm non-stop
        if (this.weatherMode !== 'clear' && Math.random() < 0.45) {
          nextModes = ['clear'];
        }
        const newMode = nextModes[Math.floor(Math.random() * nextModes.length)];
        this.setWeather(newMode);

        if (this.app && this.app.uiManager) {
          this.app.uiManager.syncWeatherButtons(newMode);
        }

        // Cycle every 25 to 50 seconds
        this.weatherCycleTimer = 25.0 + Math.random() * 25.0;
      }
    }

    // 1. Sky & Fog color transitions based on time of day
    const dayColor = new THREE.Color(0x3882f6); // Bright blue
    const nightColor = new THREE.Color(0x070913); // Deep navy/black
    const dawnColor = new THREE.Color(0xf69d3c); // Warm orange
    const duskColor = new THREE.Color(0xff5e62);

    let targetBg = new THREE.Color();
    let starOpacity = 0;

    if (timeVal >= 5.0 && timeVal < 7.0) {
      // Dawn transition (Night -> Dawn -> Day)
      const t = (timeVal - 5.0) / 2.0;
      targetBg.copy(nightColor).lerp(dawnColor, t).lerp(dayColor, Math.max(0, (t - 0.5) * 2));
      starOpacity = 1.0 - t;
    } else if (timeVal >= 7.0 && timeVal < 17.0) {
      // Daytime
      targetBg.copy(dayColor);
      starOpacity = 0;
    } else if (timeVal >= 17.0 && timeVal < 19.0) {
      // Dusk transition (Day -> Dusk -> Night)
      const t = (timeVal - 17.0) / 2.0;
      targetBg.copy(dayColor).lerp(duskColor, t).lerp(nightColor, Math.max(0, (t - 0.5) * 2));
      starOpacity = t;
    } else {
      // Nighttime
      targetBg.copy(nightColor);
      starOpacity = 1.0;
    }

    if (this.weatherMode === 'mist') {
      targetBg.lerp(new THREE.Color(0x112233), 0.5);
    } else if (this.weatherMode === 'rain') {
      targetBg.lerp(new THREE.Color(0x1a222a), 0.6);
    } else if (this.weatherMode === 'thunderstorm') {
      targetBg.lerp(new THREE.Color(0x0e1115), 0.75); // Dark stormy clouds
    }

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
      this.scene.background.copy(targetBg);
      this.scene.fog.color.setHex(0x5a1806);
      starOpacity = 0.35;
    } else {
      if (this.weatherMode === 'thunderstorm' && this.flashIntensity > 0) {
        const flashColor = new THREE.Color(0xd0e8ff).lerp(targetBg, 1.0 - this.flashIntensity);
        this.scene.background.copy(flashColor);
        this.scene.fog.color.copy(flashColor);
      } else {
        this.scene.background.copy(targetBg);
        this.scene.fog.color.copy(targetBg);
      }
    }
    this.starMat.opacity = starOpacity;

    // 2. Position Sun and Moon in opposition across the celestial dome
    const sunAngle = ((timeVal - 6.0) / 24.0) * Math.PI * 2.0;
    const moonAngle = sunAngle + Math.PI;
    const orbitRadius = 1800; // Far beyond the entire terrain/city limits (X: -300 to 820) so sun/moon never intersect ground
    
    if (this.moon) {
      this.moon.position.x = Math.cos(moonAngle) * orbitRadius;
      this.moon.position.y = Math.sin(moonAngle) * orbitRadius;
      this.moon.position.z = -Math.sin(sunAngle * 0.5) * 250;
      this.moon.visible = this.moon.position.y > -80;
    }

    if (this.sun) {
      this.sun.position.x = Math.cos(sunAngle) * orbitRadius;
      this.sun.position.y = Math.sin(sunAngle) * orbitRadius;
      this.sun.position.z = Math.sin(sunAngle * 0.5) * 250;
      this.sun.visible = this.sun.position.y > -80;

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
      if (this.app && this.app.camera) {
        this.rainParticles.position.x = this.app.camera.position.x;
        this.rainParticles.position.z = this.app.camera.position.z;
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
