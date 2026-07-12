import * as THREE from 'three';

export const MOTORBIKE_RIDER_EJECTION = Object.freeze({
  minimumImpactorSpeed: 10,
  minimumClosingSpeed: 10,
  riderSpawnOffset: 1.15,
  bikeCrashDuration: 6
});

function getPlanarVelocity(vehicle) {
  const physicsVelocity = vehicle?.physicsVehicle?.chassisBody?.velocity;
  if (
    physicsVelocity
    && Number.isFinite(physicsVelocity.x)
    && Number.isFinite(physicsVelocity.z)
  ) {
    return new THREE.Vector3(physicsVelocity.x, 0, physicsVelocity.z);
  }

  const speed = Number(vehicle?.speed);
  if (!vehicle?.mesh || !Number.isFinite(speed)) return new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) return new THREE.Vector3();
  return forward.normalize().multiplyScalar(speed);
}

function getImpactDirection(impactor, motorbike, separationNormal) {
  const direction = motorbike.mesh.position.clone().sub(impactor.mesh.position);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6 && separationNormal?.isVector3) {
    direction.copy(separationNormal);
    direction.y = 0;
  }
  if (direction.lengthSq() < 1e-6) direction.set(1, 0, 0);
  return direction.normalize();
}

/**
 * Returns impact data only when another vehicle is closing on a ridden
 * motorbike quickly enough to eject its rider.
 */
export function getRiderEjectionImpact(
  impactor,
  motorbike,
  separationNormal = null,
  config = MOTORBIKE_RIDER_EJECTION
) {
  if (
    !impactor?.mesh
    || !motorbike?.mesh
    || impactor === motorbike
    || motorbike.vType !== 'MOTORBIKE'
    || !motorbike.mountedRider?.mesh
    || motorbike.isDestroyed
  ) return null;

  const direction = getImpactDirection(impactor, motorbike, separationNormal);
  const impactorVelocity = getPlanarVelocity(impactor);
  const impactorSpeed = impactorVelocity.length();
  const relativeVelocity = impactorVelocity.clone().sub(getPlanarVelocity(motorbike));
  const closingSpeed = relativeVelocity.dot(direction);
  const minimumImpactor = Number.isFinite(config?.minimumImpactorSpeed)
    ? Math.max(0, config.minimumImpactorSpeed)
    : MOTORBIKE_RIDER_EJECTION.minimumImpactorSpeed;
  const minimumClosing = Number.isFinite(config?.minimumClosingSpeed)
    ? Math.max(0, config.minimumClosingSpeed)
    : MOTORBIKE_RIDER_EJECTION.minimumClosingSpeed;
  if (
    !Number.isFinite(impactorSpeed)
    || impactorSpeed < minimumImpactor
    || !Number.isFinite(closingSpeed)
    || closingSpeed < minimumClosing
  ) return null;

  return { impactor, motorbike, direction, closingSpeed, impactorSpeed };
}
