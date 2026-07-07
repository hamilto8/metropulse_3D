import * as THREE from 'three';

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.weatherMode = 'clear';
    this.rainParticles = null;
    this.starfield = null;
    this.moon = null;

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
    const moonGeo = new THREE.SphereGeometry(12, 16, 16);
    const moonMat = new THREE.MeshStandardMaterial({
      color: 0xffffdd,
      emissive: 0xffeedd,
      emissiveIntensity: 0.8,
      roughness: 0.9
    });
    this.moon = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moon);
  }

  initRain() {
    const dropCount = 3000;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(dropCount * 3);

    for (let i = 0; i < dropCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 250;
      positions[i + 1] = Math.random() * 150;
      positions[i + 2] = (Math.random() - 0.5) * 250;
    }

    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0x88ccff,
      size: 0.6,
      transparent: true,
      opacity: 0 // Start disabled
    });

    this.rainParticles = new THREE.Points(rainGeo, this.rainMat);
    this.scene.add(this.rainParticles);
  }

  setWeather(mode) {
    this.weatherMode = mode;
    if (mode === 'clear') {
      this.scene.fog.density = 0.0035;
      this.rainMat.opacity = 0;
    } else if (mode === 'mist') {
      this.scene.fog.density = 0.015;
      this.rainMat.opacity = 0;
    } else if (mode === 'rain') {
      this.scene.fog.density = 0.008;
      this.rainMat.opacity = 0.6;
    }
  }

  update(timeVal, delta) {
    // 1. Update Sky & Fog Color based on time of day
    // Colors for Dawn, Day, Dusk, Night
    const nightColor = new THREE.Color(0x070913);
    const dawnColor = new THREE.Color(0xff6a88);
    const dayColor = new THREE.Color(0x3a88e9);
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
    }

    this.scene.background.copy(targetBg);
    this.scene.fog.color.copy(targetBg);
    this.starMat.opacity = starOpacity;

    // 2. Position Moon in opposition to Sun
    const sunAngle = ((timeVal - 6.0) / 24.0) * Math.PI * 2.0;
    const moonAngle = sunAngle + Math.PI;
    const orbitRadius = 320;
    
    this.moon.position.x = Math.cos(moonAngle) * orbitRadius;
    this.moon.position.y = Math.sin(moonAngle) * orbitRadius;
    this.moon.position.z = -50;
    this.moon.visible = this.moon.position.y > -20;

    // 3. Update Rain Particle physics
    if (this.weatherMode === 'rain' && this.rainParticles) {
      const posAttr = this.rainParticles.geometry.attributes.position;
      const arr = posAttr.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= 120 * delta; // Fall speed
        if (arr[i] < 0) {
          arr[i] = 150; // Respawn at top
        }
      }
      posAttr.needsUpdate = true;
    }
  }
}
