import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CameraRig } from '../camera/CameraRig.js';

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

    // Phase 2: Cinematic Camera Rig
    this.cameraRig = new CameraRig(this.camera, this.controls);

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
      this.startFollowTarget(entity);
      return true;
    }
  }

  startFollowTarget(target) {
    this.targetCameraPos = null;
    this.targetLookAt = null;
    this.followTarget = target;
    if (this.cameraRig) {
      this.cameraRig.swoopToStreet(target, 1.25);
    }
  }

  stopFollowTarget() {
    this.followTarget = null;
    if (this.cameraRig) {
      this.cameraRig.ascendToMacro(1.0);
    }
  }

  triggerShake(intensity = 0.35) {
    this.shakeIntensity = intensity;
    this.shakeTimer = 0.8;
    if (this.cameraRig) {
      this.cameraRig.triggerShake(intensity);
    }
  }

  initResizeHandler() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  update(delta) {
    // Phase 2: Delegate dynamic chase & cinematic swoops to CameraRig
    if (this.cameraRig && this.cameraRig.state !== 'ORBIT_MACRO') {
      this.cameraRig.update(delta);
      return;
    }

    // Preset transition interpolation
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

    if (this.cameraRig) {
      this.cameraRig.update(delta);
    } else {
      this.controls.update();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
