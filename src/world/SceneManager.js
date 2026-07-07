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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    this.initPresets();
    this.initResizeHandler();
  }

  initPresets() {
    this.presets = {
      birdseye: { pos: new THREE.Vector3(0, 220, 10), target: new THREE.Vector3(0, 0, 0) },
      street: { pos: new THREE.Vector3(15, 3.5, 45), target: new THREE.Vector3(0, 2, -20) },
      park: { pos: new THREE.Vector3(-45, 12, -45), target: new THREE.Vector3(-60, 4, -60) },
      downtown: { pos: new THREE.Vector3(35, 18, 35), target: new THREE.Vector3(-10, 8, -10) },
      free: { pos: new THREE.Vector3(100, 75, 100), target: new THREE.Vector3(0, 0, 0) }
    };
  }

  setCameraPreset(mode) {
    this.stopFollowTarget();
    const preset = this.presets[mode];
    if (preset) {
      this.targetCameraPos = preset.pos.clone();
      this.targetLookAt = preset.target.clone();
    }
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
      return;
    }

    // 2. Camera Preset Transition Logic
    if (this.targetCameraPos && this.targetLookAt) {
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
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
