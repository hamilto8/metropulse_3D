import * as THREE from 'three';

export const PEDESTRIAN_KNOCKDOWN = Object.freeze({
  duration: 4,
  standDuration: 0.65,
  gravity: 18,
  horizontalDamping: 3.5,
  minThrowSpeed: 3.25,
  maxThrowSpeed: 7.5,
  minLiftSpeed: 2.5,
  maxLiftSpeed: 5
});

function smoothstep(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function setLimbPose(pedestrian, amount) {
  const pose = THREE.MathUtils.clamp(amount, 0, 1);
  if (pedestrian.legL && pedestrian.legR) {
    pedestrian.legL.rotation.x = -1.15 * pose;
    pedestrian.legR.rotation.x = -1.15 * pose;
  }
  if (pedestrian.armL && pedestrian.armR) {
    pedestrian.armL.rotation.x = -0.85 * pose;
    pedestrian.armR.rotation.x = -0.85 * pose;
  }
}

export function startPedestrianKnockdown(pedestrian, knockDirection, impactSpeed = 8) {
  if (!pedestrian?.mesh || pedestrian.knockedDown) return false;
  const direction = knockDirection?.isVector3
    ? knockDirection.clone()
    : new THREE.Vector3(0, 0, 1);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
  direction.normalize();

  const numericImpact = Number(impactSpeed);
  const safeImpact = Number.isFinite(numericImpact) ? Math.abs(numericImpact) : 8;
  const throwSpeed = THREE.MathUtils.clamp(
    safeImpact * 0.22,
    PEDESTRIAN_KNOCKDOWN.minThrowSpeed,
    PEDESTRIAN_KNOCKDOWN.maxThrowSpeed
  );
  const liftSpeed = THREE.MathUtils.clamp(
    2.3 + safeImpact * 0.12,
    PEDESTRIAN_KNOCKDOWN.minLiftSpeed,
    PEDESTRIAN_KNOCKDOWN.maxLiftSpeed
  );
  const fallSide = Math.random() < 0.5 ? -1 : 1;
  pedestrian.mesh.position.addScaledVector(direction, 0.2);
  const velocity = direction.clone().multiplyScalar(throwSpeed);
  velocity.y = liftSpeed;

  pedestrian.knockedDown = true;
  pedestrian.knockdownTimer = PEDESTRIAN_KNOCKDOWN.duration;
  pedestrian.knockdownState = {
    elapsed: 0,
    velocity,
    grounded: false,
    restRoll: fallSide * 1.42,
    tumbleRate: fallSide * (3.5 + Math.random() * 2)
  };
  pedestrian.speed = 0;
  pedestrian.targetSpeed = 0;
  setLimbPose(pedestrian, 1);
  return true;
}

export function resetPedestrianKnockdown(pedestrian) {
  if (!pedestrian?.mesh) return;
  pedestrian.knockedDown = false;
  pedestrian.knockdownTimer = 0;
  pedestrian.knockdownState = null;
  pedestrian.mesh.rotation.x = 0;
  pedestrian.mesh.rotation.z = 0;
  setLimbPose(pedestrian, 0);
}

export function updatePedestrianKnockdown(pedestrian, delta, getTerrainHeight) {
  const state = pedestrian?.knockdownState;
  if (!pedestrian?.mesh || !pedestrian.knockedDown || !state) {
    resetPedestrianKnockdown(pedestrian);
    return false;
  }
  const safeDelta = THREE.MathUtils.clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1);
  state.elapsed += safeDelta;
  pedestrian.knockdownTimer = Math.max(0, PEDESTRIAN_KNOCKDOWN.duration - state.elapsed);

  state.velocity.y -= PEDESTRIAN_KNOCKDOWN.gravity * safeDelta;
  pedestrian.mesh.position.addScaledVector(state.velocity, safeDelta);
  const damping = Math.exp(-PEDESTRIAN_KNOCKDOWN.horizontalDamping * safeDelta);
  state.velocity.x *= damping;
  state.velocity.z *= damping;

  const terrainHeight = Number(getTerrainHeight?.(
    pedestrian.mesh.position.x,
    pedestrian.mesh.position.z
  ));
  const ground = Number.isFinite(terrainHeight) ? terrainHeight : 0;
  if (pedestrian.mesh.position.y <= ground) {
    pedestrian.mesh.position.y = ground;
    state.velocity.y = 0;
    state.grounded = true;
  }

  if (state.grounded) {
    pedestrian.mesh.rotation.x = THREE.MathUtils.lerp(pedestrian.mesh.rotation.x, -0.18, 0.25);
    pedestrian.mesh.rotation.z = THREE.MathUtils.lerp(pedestrian.mesh.rotation.z, state.restRoll, 0.25);
  } else {
    pedestrian.mesh.rotation.x = THREE.MathUtils.lerp(pedestrian.mesh.rotation.x, -0.35, 0.18);
    pedestrian.mesh.rotation.z += state.tumbleRate * safeDelta;
  }

  const standStart = PEDESTRIAN_KNOCKDOWN.duration - PEDESTRIAN_KNOCKDOWN.standDuration;
  if (state.elapsed >= standStart) {
    const standProgress = smoothstep((state.elapsed - standStart) / PEDESTRIAN_KNOCKDOWN.standDuration);
    pedestrian.mesh.rotation.x = THREE.MathUtils.lerp(-0.18, 0, standProgress);
    pedestrian.mesh.rotation.z = THREE.MathUtils.lerp(state.restRoll, 0, standProgress);
    setLimbPose(pedestrian, 1 - standProgress);
  }

  if (state.elapsed < PEDESTRIAN_KNOCKDOWN.duration) return true;
  pedestrian.mesh.position.y = ground;
  resetPedestrianKnockdown(pedestrian);
  return false;
}
