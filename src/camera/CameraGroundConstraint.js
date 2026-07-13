import * as THREE from 'three';

// Keep the perspective camera's near plane comfortably above the rendered
// surface. This is low enough to read as a camera resting at ground level,
// while avoiding floor z-fighting and near-plane clipping.
export const CAMERA_GROUND_CLEARANCE = 0.75;
export const CAMERA_MIN_HORIZONTAL_LOOK_DISTANCE = 5;

const CONTACT_EPSILON = 0.001;
const DIRECTION_EPSILON = 1e-6;

function getHorizontalLookDirection(camera, target) {
  const direction = new THREE.Vector3(
    target.x - camera.position.x,
    0,
    target.z - camera.position.z
  );

  if (direction.lengthSq() <= DIRECTION_EPSILON) {
    camera.getWorldDirection(direction);
    direction.y = 0;
  }

  if (direction.lengthSq() <= DIRECTION_EPSILON) {
    direction.set(0, 0, -1);
  }

  return direction.normalize();
}

/**
 * Constrains a camera to a terrain surface and levels its view on contact.
 *
 * @param {THREE.Camera} camera
 * @param {THREE.Vector3} target Orbit/chase look target, mutated in place.
 * @param {number} terrainHeight Height of the solid surface beneath the camera.
 * @param {number} clearance Minimum camera-center clearance above that surface.
 * @returns {{ constrained: boolean, minimumY: number }}
 */
export function constrainCameraToGround(
  camera,
  target,
  terrainHeight = 0,
  clearance = CAMERA_GROUND_CLEARANCE
) {
  if (!camera?.position || !target) {
    return { constrained: false, minimumY: 0 };
  }

  const safeTerrainHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
  const safeClearance = Number.isFinite(clearance) && clearance >= 0
    ? clearance
    : CAMERA_GROUND_CLEARANCE;
  const minimumY = safeTerrainHeight + safeClearance;

  if (camera.position.y > minimumY + CONTACT_EPSILON) {
    return { constrained: false, minimumY };
  }

  const horizontalDistance = Math.hypot(
    target.x - camera.position.x,
    target.z - camera.position.z
  );
  const lookDistance = Math.max(
    Number.isFinite(horizontalDistance) ? horizontalDistance : 0,
    CAMERA_MIN_HORIZONTAL_LOOK_DISTANCE
  );
  const direction = getHorizontalLookDirection(camera, target);

  camera.position.y = minimumY;
  target.set(
    camera.position.x + direction.x * lookDistance,
    minimumY,
    camera.position.z + direction.z * lookDistance
  );
  camera.lookAt?.(target);

  return { constrained: true, minimumY };
}
