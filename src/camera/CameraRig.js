import * as THREE from 'three';

export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;

    this.state = 'ORBIT_MACRO'; // ORBIT_MACRO | SWOOP_TO_STREET | CHASE_MICRO | ASCEND_TO_MACRO
    this.followTarget = null;

    // Transition interpolation variables
    this.transitionTimer = 0;
    this.transitionDuration = 1.25;

    this.startCamPos = new THREE.Vector3();
    this.startLookAt = new THREE.Vector3();

    this.macroCamPos = new THREE.Vector3(0, 180, 220);
    this.macroLookAt = new THREE.Vector3(0, 0, 0);

    // Shake offset
    this.shakeIntensity = 0;
    this.shakeOffset = new THREE.Vector3();

    // Smoothed FOV
    this.currentFov = 60;
  }

  // Quintic smoothstep for ultra-silky cinematic swoops
  easeQuintic(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Transition from high overhead down to street level chase behind vehicle
  swoopToStreet(targetEntity, duration = 1.25) {
    if (!targetEntity || !targetEntity.mesh) return;

    // Save current macro view so we can ascend back to it later
    if (this.state === 'ORBIT_MACRO') {
      this.macroCamPos.copy(this.camera.position);
      this.macroLookAt.copy(this.controls.target);
    }

    this.followTarget = targetEntity;
    this.state = 'SWOOP_TO_STREET';
    this.transitionTimer = 0;
    this.transitionDuration = duration;

    this.startCamPos.copy(this.camera.position);
    this.startLookAt.copy(this.controls.target);

    this.controls.enabled = false;
  }

  // Transition back up to overhead city planner view
  ascendToMacro(duration = 1.0) {
    this.state = 'ASCEND_TO_MACRO';
    this.transitionTimer = 0;
    this.transitionDuration = duration;

    this.startCamPos.copy(this.camera.position);
    this.startLookAt.copy(this.controls.target);

    this.controls.enabled = false;
  }

  triggerShake(intensity = 0.35) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  getDesiredChasePose() {
    if (!this.followTarget || !this.followTarget.mesh) {
      return {
        camPos: this.macroCamPos.clone(),
        lookAt: this.macroLookAt.clone()
      };
    }

    const mesh = this.followTarget.mesh;
    const targetPos = mesh.position.clone();
    const rotation = mesh.rotation.y;

    const isPhysicsCar = this.followTarget.physicsVehicle || this.followTarget.userControlled;
    const distance = isPhysicsCar ? 15.0 : (this.followTarget.type === 'VEHICLE' ? 17.0 : 8.0);
    const height = isPhysicsCar ? 4.5 : (this.followTarget.type === 'VEHICLE' ? 6.5 : 3.5);

    const offsetX = -Math.sin(rotation) * distance;
    const offsetZ = -Math.cos(rotation) * distance;

    const desiredCamPos = new THREE.Vector3(
      targetPos.x + offsetX,
      targetPos.y + height,
      targetPos.z + offsetZ
    );

    // Dynamic look-ahead target along vehicle trajectory
    const lookAtPos = new THREE.Vector3(targetPos.x, targetPos.y + 1.4, targetPos.z);

    if (isPhysicsCar) {
      // Look ahead along forward heading so driver sees intersections ahead
      const forwardDist = Math.min(6.0, Math.abs(this.followTarget.speed || 0) * 0.12);
      lookAtPos.x += Math.sin(rotation) * forwardDist;
      lookAtPos.z += Math.cos(rotation) * forwardDist;
    }

    return { camPos: desiredCamPos, lookAt: lookAtPos };
  }

  update(delta) {
    // 1. Update shake intensity decay
    if (this.shakeIntensity > 0) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * this.shakeIntensity * 1.5,
        (Math.random() - 0.5) * this.shakeIntensity * 1.5,
        (Math.random() - 0.5) * this.shakeIntensity * 1.5
      );
      this.shakeIntensity *= Math.pow(0.1, delta); // Decay
      if (this.shakeIntensity < 0.01) {
        this.shakeIntensity = 0;
        this.shakeOffset.set(0, 0, 0);
      }
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // 2. State Machine
    if (this.state === 'ORBIT_MACRO') {
      this.controls.enabled = true;
      this.controls.update();
      // Apply shake if any
      if (this.shakeIntensity > 0) {
        this.camera.position.add(this.shakeOffset);
      }
      return;
    }

    if (this.state === 'SWOOP_TO_STREET') {
      this.transitionTimer += delta;
      const progress = Math.min(1.0, this.transitionTimer / this.transitionDuration);
      const ease = this.easeQuintic(progress);

      const pose = this.getDesiredChasePose();

      this.camera.position.lerpVectors(this.startCamPos, pose.camPos, ease);
      this.controls.target.lerpVectors(this.startLookAt, pose.lookAt, ease);
      this.camera.lookAt(this.controls.target);

      if (progress >= 1.0) {
        this.state = 'CHASE_MICRO';
      }
    } else if (this.state === 'CHASE_MICRO') {
      const pose = this.getDesiredChasePose();
      const followSpeed = Math.min(1.0, delta * 9.5);

      this.camera.position.lerp(pose.camPos, followSpeed);
      this.controls.target.lerp(pose.lookAt, followSpeed * 1.25);
      this.camera.lookAt(this.controls.target);

      // Dynamic Speed FOV Warp
      if (this.followTarget && this.followTarget.speed !== undefined) {
        const speedRatio = Math.min(1.0, Math.abs(this.followTarget.speed) / 130);
        const targetFov = 60 + speedRatio * 16;
        this.currentFov += (targetFov - this.currentFov) * Math.min(1.0, delta * 6.0);
        this.camera.fov = this.currentFov;
        this.camera.updateProjectionMatrix();
      }
    } else if (this.state === 'ASCEND_TO_MACRO') {
      this.transitionTimer += delta;
      const progress = Math.min(1.0, this.transitionTimer / this.transitionDuration);
      const ease = this.easeQuintic(progress);

      this.camera.position.lerpVectors(this.startCamPos, this.macroCamPos, ease);
      this.controls.target.lerpVectors(this.startLookAt, this.macroLookAt, ease);
      this.camera.lookAt(this.controls.target);

      // Restore FOV to 60 during ascent
      this.currentFov += (60 - this.currentFov) * Math.min(1.0, delta * 8.0);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();

      if (progress >= 1.0) {
        this.state = 'ORBIT_MACRO';
        this.followTarget = null;
        this.controls.enabled = true;
      }
    }

    // Apply shake offset
    if (this.shakeIntensity > 0) {
      this.camera.position.add(this.shakeOffset);
    }
  }
}
