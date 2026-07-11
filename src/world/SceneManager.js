import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CameraRig } from '../camera/CameraRig.js';

export class SceneManager {
  constructor(app, container) {
    this.app = app;
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.container.appendChild(this.renderer.domElement);

    // A restrained bloom pass reinforces emissive signs, headlights, and
    // weather flashes without washing out the management UI or daytime scene.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.38,
      0.22,
      0.88
    );
    this.composer.addPass(this.bloomPass);

    // Controls setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableKeys = false;
    this.controls.keys = {};
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Don't go below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 350;
    this.controls.target.set(0, 0, 0);

    this.controls.addEventListener('start', () => {
      if (this.activePreset || this.targetCameraPos || this.followTarget) {
        this.breakToFreeOrbit();
      }
    });

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
    this.activePreset = 'birdseye';
    this.camera.position.copy(this.presets.birdseye.pos);
    this.controls.target.copy(this.presets.birdseye.target);
    this.controls.update();
    this.initResizeHandler();
  }

  breakToFreeOrbit() {
    this.targetCameraPos = null;
    this.targetLookAt = null;
    this.followTarget = null;
    this.activePreset = null;
    if (this.cameraRig) {
      this.cameraRig.state = 'ORBIT_MACRO';
    }
    this.controls.enabled = true;

    const freeBtn = document.querySelector('[data-camera="free"]');
    if (freeBtn && !freeBtn.classList.contains('active')) {
      const cameraButtons = document.querySelectorAll('[data-camera]');
      cameraButtons.forEach(b => b.classList.remove('active'));
      freeBtn.classList.add('active');
    }

    const btnFollow = document.getElementById('btn-follow-target');
    if (btnFollow) {
      btnFollow.innerHTML = '👁️ Follow Camera';
      btnFollow.classList.remove('active');
    }
  }

  earthquakeShake(intensity = 2.5, duration = 0.8) {
    this.shakeIntensity = intensity;
    this.shakeTimer = duration;
    if (this.cameraRig) {
      this.cameraRig.triggerShake(intensity);
    }
  }

  initPresets() {
    this.presets = {
      birdseye: { pos: new THREE.Vector3(80, 320, 15), target: new THREE.Vector3(80, 0, 0) },
      street: { pos: new THREE.Vector3(15, 3.5, 45), target: new THREE.Vector3(0, 2, -20) },
      park: { pos: new THREE.Vector3(-45, 12, -45), target: new THREE.Vector3(-60, 4, -60) },
      downtown: { pos: new THREE.Vector3(35, 18, 35), target: new THREE.Vector3(-10, 8, -10) },
      bridge: { pos: new THREE.Vector3(160, 28, 65), target: new THREE.Vector3(160, 8, -15) },
      rocket: { pos: new THREE.Vector3(670, 52, -245), target: new THREE.Vector3(700, 28, -280) },
      free: { pos: new THREE.Vector3(160, 95, 130), target: new THREE.Vector3(80, 0, 0) }
    };
  }

  setCameraPreset(mode) {
    this.stopFollowTarget();
    this.activePreset = mode;
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
    const needsAscent = Boolean(
      this.followTarget
      || (this.cameraRig && this.cameraRig.state !== 'ORBIT_MACRO')
    );
    this.followTarget = null;
    if (this.cameraRig && needsAscent) {
      this.cameraRig.ascendToMacro(1.0);
    } else if (this.cameraRig) {
      this.cameraRig.state = 'ORBIT_MACRO';
      this.cameraRig.followTarget = null;
      this.controls.enabled = true;
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
      this.composer?.setSize(window.innerWidth, window.innerHeight);
    });
  }

  update(delta) {
    this.cameraRig?.removeAppliedShake?.();

    if (this.app && this.app.inputManager) {
      const rsX = this.app.inputManager.state.cameraPanX;
      const rsY = this.app.inputManager.state.cameraPanY;
      if (Math.abs(rsX) > 0.05 || Math.abs(rsY) > 0.05) {
        const target = this.controls ? this.controls.target : new THREE.Vector3(0, 0, 0);
        const offset = this.camera.position.clone().sub(target);
        const angleX = -rsX * delta * 2.5;
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleX);
        const right = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
        const angleY = rsY * delta * 1.5;
        offset.applyAxisAngle(right, angleY);
        this.camera.position.copy(target).add(offset);
        this.camera.lookAt(target);
      }
    }

    const ts = this.app ? this.app.trafficSystem : null;
    const ps = this.app ? this.app.pedestrianSystem : null;
    const keys = ts ? ts.keys : null;

    let isVehControlled = false;
    if (ts) {
      if (ts.controlledVehicle != null) {
        isVehControlled = true;
      } else if (ts.vehicles) {
        for (const v of ts.vehicles) {
          if (v.userControlled) {
            isVehControlled = true;
            break;
          }
        }
      }
    }

    let isPedControlled = false;
    if (ps) {
      if (ps.controlledPedestrian != null) {
        isPedControlled = true;
      } else if (ps.pedestrians) {
        for (const p of ps.pedestrians) {
          if (p.userControlled) {
            isPedControlled = true;
            break;
          }
        }
      }
    }

    const isControlling = isVehControlled || isPedControlled;

    if (keys && !isControlling) {
      const isW = keys['w'] || keys['arrowup'];
      const isS = keys['s'] || keys['arrowdown'];
      const isA = keys['a'] || keys['arrowleft'];
      const isD = keys['d'] || keys['arrowright'];
      const isQ = keys['q'];
      const isE = keys['e'] || keys[' '] || keys['space'] || keys['spacebar'];

      if (isW || isS || isA || isD || isQ || isE) {
        this.breakToFreeOrbit();

        // Project look vectors in 3D
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);

        const right = new THREE.Vector3();
        right.crossVectors(forward, this.camera.up).normalize();

        const moveVec = new THREE.Vector3();
        if (isW) moveVec.add(forward);
        if (isS) moveVec.sub(forward);
        if (isD) moveVec.add(right);
        if (isA) moveVec.sub(right);
        if (isE) moveVec.y += 1.0;
        if (isQ) moveVec.y -= 1.0;

        if (moveVec.lengthSq() > 0) {
          moveVec.normalize();
          const speed = (keys['shift'] ? 120 : 50) * delta;
          moveVec.multiplyScalar(speed);

          this.camera.position.add(moveVec);
          this.controls.target.add(moveVec);
        }
      }
    }

    // Phase 2: Delegate dynamic chase & cinematic swoops to CameraRig
    if (this.cameraRig && this.cameraRig.state !== 'ORBIT_MACRO') {
      this.cameraRig.update(delta);
      return;
    }

    // Dynamic hover tracking for Rocket preset
    if (this.activePreset === 'rocket' && this.app && this.app.cityBuilder && this.app.cityBuilder.rocketGroup) {
      const rocketY = this.app.cityBuilder.rocketGroup.position.y;
      if (rocketY > 1.6) {
        const deltaY = rocketY - 1.5;
        this.targetCameraPos = new THREE.Vector3(670, 52 + deltaY * 0.9, -245);
        this.targetLookAt = new THREE.Vector3(700, 28 + deltaY, -280);
      }
    }

    // Preset transition interpolation
    if (this.targetCameraPos && this.targetLookAt) {
      this.camera.position.lerp(this.targetCameraPos, 0.05);
      this.controls.target.lerp(this.targetLookAt, 0.05);

      if (
        this.camera.position.distanceTo(this.targetCameraPos) < 1.0 &&
        this.controls.target.distanceTo(this.targetLookAt) < 1.0
      ) {
        const isRocketLaunching = this.activePreset === 'rocket' && this.app && this.app.cityBuilder &&
          this.app.cityBuilder.rocketGroup && this.app.cityBuilder.rocketGroup.position.y > 1.6;
        if (!isRocketLaunching) {
          this.targetCameraPos = null;
          this.targetLookAt = null;
        }
      }
    }

    if (this.cameraRig) {
      this.cameraRig.update(delta);
    } else {
      this.controls.update();
    }
  }

  render() {
    this.composer.render();
  }
}
