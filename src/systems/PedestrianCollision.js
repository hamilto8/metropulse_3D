import * as THREE from 'three';
import { getActiveBoxColliders } from './SpatialObstacles.js';

export const PEDESTRIAN_COLLISION = Object.freeze({
  radius: 0.42,
  height: 2.65,
  maxStep: 0.2,
  maxSubsteps: 64,
  resolveIterations: 3,
  skin: 0.015
});

function verticalRangesOverlap(footY, height, box) {
  const pedestrianTop = footY + height;
  const boxBottom = box.y - box.halfY;
  const boxTop = box.y + box.halfY;
  return pedestrianTop > boxBottom + PEDESTRIAN_COLLISION.skin
    && footY < boxTop - PEDESTRIAN_COLLISION.skin;
}

function circleBoxSeparation(position, radius, box) {
  const dx = position.x - box.x;
  const dz = position.z - box.z;
  const localX = box.cos * dx - box.sin * dz;
  const localZ = box.sin * dx + box.cos * dz;
  const closestX = THREE.MathUtils.clamp(localX, -box.halfX, box.halfX);
  const closestZ = THREE.MathUtils.clamp(localZ, -box.halfZ, box.halfZ);
  const offsetX = localX - closestX;
  const offsetZ = localZ - closestZ;
  const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
  if (distanceSq >= radius * radius) return null;

  let normalX;
  let normalZ;
  let depth;
  if (distanceSq > 1e-10) {
    const distance = Math.sqrt(distanceSq);
    normalX = offsetX / distance;
    normalZ = offsetZ / distance;
    depth = radius - distance;
  } else {
    const exits = [
      { depth: localX + box.halfX + radius, x: -1, z: 0 },
      { depth: box.halfX - localX + radius, x: 1, z: 0 },
      { depth: localZ + box.halfZ + radius, x: 0, z: -1 },
      { depth: box.halfZ - localZ + radius, x: 0, z: 1 }
    ];
    exits.sort((a, b) => a.depth - b.depth);
    ({ x: normalX, z: normalZ, depth } = exits[0]);
  }

  return {
    x: box.cos * normalX + box.sin * normalZ,
    z: -box.sin * normalX + box.cos * normalZ,
    depth: depth + PEDESTRIAN_COLLISION.skin
  };
}

/** Sweeps a pedestrian-sized circle through active static physics boxes and slides along surfaces. */
export function movePedestrianWithCollisions(position, displacement, physicsWorld, options = {}) {
  if (!position || !displacement) return { position: new THREE.Vector3(), collided: false };
  const radius = Number.isFinite(options.radius) ? Math.max(0.1, options.radius) : PEDESTRIAN_COLLISION.radius;
  const height = Number.isFinite(options.height) ? Math.max(0.5, options.height) : PEDESTRIAN_COLLISION.height;
  const boxes = getActiveBoxColliders(physicsWorld);
  const result = new THREE.Vector3(
    Number.isFinite(position.x) ? position.x : 0,
    Number.isFinite(position.y) ? position.y : 0,
    Number.isFinite(position.z) ? position.z : 0
  );
  let moveX = Number.isFinite(displacement.x) ? displacement.x : 0;
  let moveZ = Number.isFinite(displacement.z) ? displacement.z : 0;
  let distance = Math.hypot(moveX, moveZ);
  const maxTravel = PEDESTRIAN_COLLISION.maxStep * PEDESTRIAN_COLLISION.maxSubsteps;
  if (distance > maxTravel) {
    const scale = maxTravel / distance;
    moveX *= scale;
    moveZ *= scale;
    distance = maxTravel;
  }
  const steps = THREE.MathUtils.clamp(
    Math.ceil(distance / PEDESTRIAN_COLLISION.maxStep) || 1,
    1,
    PEDESTRIAN_COLLISION.maxSubsteps
  );
  const stepX = moveX / steps;
  const stepZ = moveZ / steps;
  let collided = false;

  for (let step = 0; step < steps; step += 1) {
    result.x += stepX;
    result.z += stepZ;
    for (let iteration = 0; iteration < PEDESTRIAN_COLLISION.resolveIterations; iteration += 1) {
      let resolved = false;
      for (const box of boxes) {
        if (!verticalRangesOverlap(result.y, height, box)) continue;
        const separation = circleBoxSeparation(result, radius, box);
        if (!separation) continue;
        result.x += separation.x * separation.depth;
        result.z += separation.z * separation.depth;
        collided = true;
        resolved = true;
      }
      if (!resolved) break;
    }
  }
  return { position: result, collided };
}
