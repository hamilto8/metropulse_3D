import * as THREE from 'three';

export function getPlanarTargetHeading(target) {
  const quaternion = target?.physicsVehicle?.chassisBody?.quaternion;
  if (quaternion) {
    const { x, y, z, w } = quaternion;
    const forwardX = 2 * (x * z + w * y);
    const forwardZ = 1 - 2 * (x * x + y * y);
    if (Number.isFinite(forwardX) && Number.isFinite(forwardZ)) {
      return Math.atan2(forwardX, forwardZ);
    }
  }
  const meshHeading = Number(target?.mesh?.rotation?.y);
  return Number.isFinite(meshHeading) ? meshHeading : 0;
}

export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;

    this.state = 'ORBIT_MACRO'; // ORBIT_MACRO | SWOOP_TO_STREET | CHASE_MICRO
    this.followTarget = null;

    // Transition interpolation variables
    this.transitionTimer = 0;
    this.transitionDuration = 1.25;

    this.startCamPos = new THREE.Vector3();
    this.startLookAt = new THREE.Vector3();

    // Shake offset
    this.shakeIntensity = 0;
    this.shakeOffset = new THREE.Vector3();
    this.appliedShakeOffset = new THREE.Vector3();

    // Smoothed FOV
    this.currentFov = 60;

    // Street-level mouse look (hold right mouse button while in chase mode).
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.isPointerLooking = false;
    this.bindPointerLook();
  }

  bindPointerLook() {
    const element = this.controls?.domElement;
    if (!element?.addEventListener) return;

    this._onPointerDown = event => {
      if (event.button !== 2 || this.state === 'ORBIT_MACRO') return;
      this.isPointerLooking = true;
      element.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    this._onPointerMove = event => {
      if (!this.isPointerLooking) return;
      this.chaseYaw -= event.movementX * 0.004;
      this.chasePitch = THREE.MathUtils.clamp(
        this.chasePitch - event.movementY * 0.003,
        -0.3,
        0.55
      );
    };
    this._onPointerUp = event => {
      if (event.button !== 2) return;
      this.isPointerLooking = false;
      element.releasePointerCapture?.(event.pointerId);
    };
    this._onContextMenu = event => {
      if (this.state !== 'ORBIT_MACRO') event.preventDefault();
    };

    element.addEventListener('pointerdown', this._onPointerDown);
    element.addEventListener('pointermove', this._onPointerMove);
    element.addEventListener('pointerup', this._onPointerUp);
    element.addEventListener('pointercancel', this._onPointerUp);
    element.addEventListener('contextmenu', this._onContextMenu);
  }

  // Quintic smoothstep for ultra-silky cinematic swoops
  easeQuintic(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Transition from high overhead down to street level chase behind vehicle
  swoopToStreet(targetEntity, duration = 1.25) {
    if (!targetEntity || !targetEntity.mesh) return;
    this.removeAppliedShake();

    this.followTarget = targetEntity;
    this.chaseYaw = 0;
    this.chasePitch = 0;
    this.state = 'SWOOP_TO_STREET';
    this.transitionTimer = 0;
    this.transitionDuration = duration;

    this.startCamPos.copy(this.camera.position);
    this.startLookAt.copy(this.controls.target);

    this.controls.enabled = false;
  }

  /**
   * Detaches from a chase target without changing the current camera or orbit
   * pivot. This is the normal direct-control release path: the player should
   * remain at the part of the city they just reached instead of returning to
   * the macro pose captured before takeover.
   */
  releaseToLocalOrbit() {
    this.removeAppliedShake();
    this.followTarget = null;
    this.isPointerLooking = false;
    this.state = 'ORBIT_MACRO';
    this.transitionTimer = 0;
    this.controls.enabled = true;

    // Chase mode may widen the FOV. Restore the ordinary free-camera lens
    // immediately so the detached pose is stable and predictable.
    this.currentFov = 60;
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix?.();
    this.controls.update?.();
  }

  triggerShake(intensity = 0.35) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  removeAppliedShake() {
    if (this.appliedShakeOffset.lengthSq() === 0) return false;
    this.camera.position.sub(this.appliedShakeOffset);
    this.appliedShakeOffset.set(0, 0, 0);
    return true;
  }

  applyShake() {
    if (this.shakeIntensity <= 0 || this.shakeOffset.lengthSq() === 0) return;
    this.camera.position.add(this.shakeOffset);
    this.appliedShakeOffset.copy(this.shakeOffset);
  }

  getDesiredChasePose() {
    if (!this.followTarget || !this.followTarget.mesh) {
      return {
        camPos: this.camera.position.clone(),
        lookAt: this.controls.target.clone()
      };
    }

    const mesh = this.followTarget.mesh;
    const targetPos = mesh.position.clone();
    // Physics vehicles can pitch and roll, and motorbikes add a render-only
    // lean. Read the chassis' planar forward vector so those visual motions do
    // not make the chase camera twitch sideways.
    const rotation = getPlanarTargetHeading(this.followTarget);
    const viewRotation = rotation + this.chaseYaw;

    const isPhysicsCar = this.followTarget.physicsVehicle || this.followTarget.userControlled;
    const distance = isPhysicsCar ? 15.0 : (this.followTarget.type === 'VEHICLE' ? 17.0 : 8.0);
    const height = isPhysicsCar ? 4.5 : (this.followTarget.type === 'VEHICLE' ? 6.5 : 3.5);

    const horizontalDistance = distance * Math.cos(this.chasePitch);
    const offsetX = -Math.sin(viewRotation) * horizontalDistance;
    const offsetZ = -Math.cos(viewRotation) * horizontalDistance;

    const desiredCamPos = new THREE.Vector3(
      targetPos.x + offsetX,
      targetPos.y + height + Math.sin(this.chasePitch) * distance,
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
    // Remove the previous frame's render-only offset before updating the base
    // camera pose. Without this, repeated impacts random-walk the orbit camera.
    this.removeAppliedShake();

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
      this.applyShake();
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
    }

    // Apply shake offset
    this.applyShake();
  }
}
