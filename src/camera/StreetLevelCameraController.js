import * as THREE from 'three';

export const STREET_CAMERA_MAX_SURFACE_DISTANCE = 8;
export const STREET_CAMERA_EXIT_SURFACE_DISTANCE = 10;
export const STREET_CAMERA_PIVOT_DISTANCE = 0.75;
export const STREET_CAMERA_MIN_PITCH = THREE.MathUtils.degToRad(-55);
export const STREET_CAMERA_MAX_PITCH = THREE.MathUtils.degToRad(65);
export const STREET_CAMERA_LEVELING_RESPONSE = 4.5;

const POINTER_YAW_SENSITIVITY = 0.004;
const POINTER_PITCH_SENSITIVITY = 0.003;
const DIRECTION_EPSILON = 1e-8;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function isStreetCameraAltitude(cameraY, surfaceY, alreadyActive = false) {
  return Number.isFinite(cameraY)
    && Number.isFinite(surfaceY)
    && cameraY - surfaceY <= (
      alreadyActive
        ? STREET_CAMERA_EXIT_SURFACE_DISTANCE
        : STREET_CAMERA_MAX_SURFACE_DISTANCE
    );
}

export function rotateStreetLookDirection(
  sourceDirection,
  yawDelta = 0,
  pitchDelta = 0,
  lockLevel = false
) {
  const direction = sourceDirection?.clone?.() || new THREE.Vector3(0, 0, -1);
  if (direction.lengthSq() <= DIRECTION_EPSILON) direction.set(0, 0, -1);
  direction.normalize();

  const yaw = Math.atan2(direction.x, -direction.z)
    + (Number.isFinite(yawDelta) ? yawDelta : 0);
  const currentPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
  const pitch = lockLevel
    ? 0
    : THREE.MathUtils.clamp(
      currentPitch + (Number.isFinite(pitchDelta) ? pitchDelta : 0),
      STREET_CAMERA_MIN_PITCH,
      STREET_CAMERA_MAX_PITCH
    );
  const horizontalScale = Math.cos(pitch);

  return direction.set(
    Math.sin(yaw) * horizontalScale,
    Math.sin(pitch),
    -Math.cos(yaw) * horizontalScale
  ).normalize();
}

/** Smoothly eases an existing look pitch toward the horizon without changing yaw. */
export function levelStreetLookDirection(
  sourceDirection,
  delta,
  response = STREET_CAMERA_LEVELING_RESPONSE
) {
  const direction = sourceDirection?.clone?.() || new THREE.Vector3(0, 0, -1);
  if (direction.lengthSq() <= DIRECTION_EPSILON) direction.set(0, 0, -1);
  direction.normalize();

  const safeDelta = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.1) : 0;
  const safeResponse = Number.isFinite(response) && response > 0
    ? response
    : STREET_CAMERA_LEVELING_RESPONSE;
  const currentPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
  const pitch = Math.abs(currentPitch) < 1e-4
    ? 0
    : currentPitch * Math.exp(-safeResponse * safeDelta);
  const yaw = Math.atan2(direction.x, -direction.z);
  const horizontalScale = Math.cos(pitch);

  return direction.set(
    Math.sin(yaw) * horizontalScale,
    Math.sin(pitch),
    -Math.cos(yaw) * horizontalScale
  ).normalize();
}

/**
 * Provides a turn-in-place camera at street height while leaving OrbitControls
 * responsible for elevated city-planning views, panning, damping, and zoom.
 */
export class StreetLevelCameraController {
  constructor(camera, controls, options = {}) {
    this.camera = camera;
    this.controls = controls;
    this.element = controls?.domElement || null;
    this.onInteractionStart = options.onInteractionStart || (() => {});
    this.onModeChange = options.onModeChange || (() => {});
    this.enabled = false;
    this.lockLevel = false;
    this.activePointerId = null;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.defaultMinDistance = Number.isFinite(controls?.minDistance)
      ? controls.minDistance
      : 5;
    this.defaultEnableRotate = controls?.enableRotate !== false;

    this.bindPointerLook();
  }

  bindPointerLook() {
    if (!this.element?.addEventListener) return;

    this._onPointerDown = event => {
      if (
        !this.enabled
        || this.controls?.enabled === false
        || event.button !== 0
        || event.pointerType === 'touch'
      ) return;

      this.activePointerId = event.pointerId;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.onInteractionStart();
      this.element.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    };

    this._onPointerMove = event => {
      if (event.pointerId !== this.activePointerId) return;
      const movementX = Number.isFinite(event.movementX) && event.movementX !== 0
        ? event.movementX
        : event.clientX - this.lastPointerX;
      const movementY = Number.isFinite(event.movementY) && event.movementY !== 0
        ? event.movementY
        : event.clientY - this.lastPointerY;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.rotateLook(
        movementX * POINTER_YAW_SENSITIVITY,
        -movementY * POINTER_PITCH_SENSITIVITY
      );
      event.preventDefault?.();
    };

    this._onPointerUp = event => {
      if (event.pointerId !== this.activePointerId) return;
      this.activePointerId = null;
      if (this.element.hasPointerCapture?.(event.pointerId)) {
        this.element.releasePointerCapture?.(event.pointerId);
      }
    };

    this._onLostPointerCapture = event => {
      if (event.pointerId === this.activePointerId) this.activePointerId = null;
    };

    this.element.addEventListener('pointerdown', this._onPointerDown);
    this.element.addEventListener('pointermove', this._onPointerMove);
    this.element.addEventListener('pointerup', this._onPointerUp);
    this.element.addEventListener('pointercancel', this._onPointerUp);
    this.element.addEventListener('lostpointercapture', this._onLostPointerCapture);
  }

  getLookDirection() {
    const direction = this.controls?.target?.clone?.().sub(this.camera.position)
      || new THREE.Vector3();
    if (direction.lengthSq() <= DIRECTION_EPSILON) {
      this.camera.getWorldDirection(direction);
    }
    if (direction.lengthSq() <= DIRECTION_EPSILON) direction.set(0, 0, -1);
    return direction.normalize();
  }

  syncLocalPivot({ smoothLeveling = false, delta = 0 } = {}) {
    if (!this.enabled || !this.controls?.target || !this.camera?.position) return false;
    const currentDirection = this.getLookDirection();
    const direction = smoothLeveling && this.lockLevel
      ? levelStreetLookDirection(currentDirection, delta)
      : rotateStreetLookDirection(currentDirection, 0, 0, this.lockLevel);
    this.controls.target.copy(this.camera.position).addScaledVector(
      direction,
      STREET_CAMERA_PIVOT_DISTANCE
    );
    this.camera.lookAt?.(this.controls.target);
    return true;
  }

  rotateLook(yawDelta, pitchDelta) {
    if (!this.enabled) return false;
    // During automatic ground leveling, retain the current transitional pitch
    // and ignore manual pitch input. Yaw remains responsive throughout.
    const direction = this.lockLevel
      ? this.getLookDirection().applyAxisAngle(
        WORLD_UP,
        Number.isFinite(yawDelta) ? -yawDelta : 0
      ).normalize()
      : rotateStreetLookDirection(this.getLookDirection(), yawDelta, pitchDelta, false);
    this.controls.target.copy(this.camera.position).addScaledVector(
      direction,
      STREET_CAMERA_PIVOT_DISTANCE
    );
    this.camera.lookAt?.(this.controls.target);
    return true;
  }

  restoreMacroPivotDistance() {
    if (!this.controls?.target || !this.camera?.position) return;
    const direction = this.getLookDirection();
    const distance = this.controls.target.distanceTo(this.camera.position);
    if (distance < this.defaultMinDistance) {
      this.controls.target.copy(this.camera.position).addScaledVector(
        direction,
        this.defaultMinDistance
      );
    }
  }

  setMode(enabled, {
    lockLevel = false,
    restoreMacroPivot = true,
    smoothLeveling = false,
    delta = 0
  } = {}) {
    const nextEnabled = Boolean(enabled);
    const modeChanged = nextEnabled !== this.enabled;
    this.enabled = nextEnabled;
    this.lockLevel = Boolean(lockLevel && nextEnabled);

    if (this.controls) {
      this.controls.enableRotate = nextEnabled ? false : this.defaultEnableRotate;
      this.controls.minDistance = nextEnabled
        ? STREET_CAMERA_PIVOT_DISTANCE
        : this.defaultMinDistance;
    }

    if (nextEnabled) {
      this.syncLocalPivot({ smoothLeveling, delta });
    } else {
      this.activePointerId = null;
      if (restoreMacroPivot) this.restoreMacroPivotDistance();
    }

    if (modeChanged) this.onModeChange(nextEnabled);
    return modeChanged;
  }

  dispose() {
    if (!this.element?.removeEventListener) return;
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('pointercancel', this._onPointerUp);
    this.element.removeEventListener('lostpointercapture', this._onLostPointerCapture);
  }
}
