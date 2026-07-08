import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070913);
    this.scene.fog = new THREE.FogExp2(0x070913, 0.0035);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.5,
      1000
    );
    this.camera.position.set(120, 90, 120);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Controls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 350;
    this.controls.target.set(0, 0, 0);

    // Camera Transition / Follow state
    this.targetCameraPos = null;
    this.targetLookAt = null;
    this.followTarget = null;
    this.followOffset = new THREE.Vector3(0, 8, -16);
    this.shakeTimer = 0;
    this.shakeIntensity = 0;

    this.initPresets();
    this.initResizeHandler();
  }

  earthquakeShake(intensity = 2.5, duration = 0.8) {
    this.shakeIntensity = intensity;
    this.shakeTimer = duration;
  }

  initPresets() {
    this.presets = {
      birdseye: { pos: new THREE.Vector3(80, 320, 15), target: new THREE.Vector3(80, 0, 0) },
      street: { pos: new THREE.Vector3(15, 3.5, 45), target: new THREE.Vector3(0, 2, -20) },
      park: { pos: new THREE.Vector3(-45, 12, -45), target: new THREE.Vector3(-60, 4, -60) },
      downtown: { pos: new THREE.Vector3(35, 18, 35), target: new THREE.Vector3(-10, 8, -10) },
      bridge: { pos: new THREE.Vector3(160, 28, 65), target: new THREE.Vector3(160, 8, -15) },
      free: { pos: new THREE.Vector3(160, 95, 130), target: new THREE.Vector3(80, 0, 0) }
    };
  }

  setCameraPreset(mode) {
    this.stopFollowTarget();
    if (!this.presets[mode]) return;
    this.targetCameraPos = this.presets[mode].pos.clone();
    this.targetLookAt = this.presets[mode].target.clone();
  }

  toggleFollowTarget(entity) {
    if (this.followTarget === entity) {
      this.stopFollowTarget();
      return false;
    } else {
      this.followTarget = entity;
      this.targetCameraPos = null;
      this.targetLookAt = null;
      return true;
    }
  }

  startFollowTarget(target) {
    this.targetCameraPos = null;
    this.targetLookAt = null;
    this.followTarget = target;
  }

  stopFollowTarget() {
    this.followTarget = null;
  }

  initResizeHandler() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  update(delta) {
    // 1. Follow Target Logic
    if (this.followTarget && this.followTarget.mesh) {
      const mesh = this.followTarget.mesh;
      const targetPos = mesh.position.clone();
      
      // Calculate offset based on vehicle/pedestrian rotation
      const rotation = mesh.rotation.y;
      const distance = this.followTarget.type === 'VEHICLE' ? 18 : 8;
      const height = this.followTarget.type === 'VEHICLE' ? 7 : 3.5;
      
      const offsetX = -Math.sin(rotation) * distance;
      const offsetZ = -Math.cos(rotation) * distance;
      
      const desiredCamPos = new THREE.Vector3(
        targetPos.x + offsetX,
        targetPos.y + height,
        targetPos.z + offsetZ
      );

      this.camera.position.lerp(desiredCamPos, 0.08);
      this.controls.target.lerp(new THREE.Vector3(targetPos.x, targetPos.y + 2, targetPos.z), 0.1);
      this.controls.update();
      // Skip return here if we want to allow shake on top of follow
    } else if (this.targetCameraPos && this.targetLookAt) {
      // 2. Camera Preset Transition Logic
      this.camera.position.lerp(this.targetCameraPos, 0.05);
      this.controls.target.lerp(this.targetLookAt, 0.05);

      if (
        this.camera.position.distanceTo(this.targetCameraPos) < 1.0 &&
        this.controls.target.distanceTo(this.targetLookAt) < 1.0
      ) {
        this.targetCameraPos = null;
        this.targetLookAt = null;
      }
    }

    this.controls.update();

    // 3. Earthquake / Impact Camera Shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= delta;
      const shakeFactor = (this.shakeTimer / 0.8) * this.shakeIntensity;
      this.camera.position.x += (Math.random() - 0.5) * shakeFactor;
      this.camera.position.y += (Math.random() - 0.5) * shakeFactor;
      this.camera.position.z += (Math.random() - 0.5) * shakeFactor;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
