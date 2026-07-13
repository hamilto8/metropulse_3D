import * as THREE from 'three';
import { getVehicleProfile } from '../entities/VehicleProfiles.js';
import { getActiveBoxColliders, getBoxProjectedRadius } from './SpatialObstacles.js';

export const TRAFFIC_NAVIGATION = Object.freeze({
  maxLaneCenterDeviation: 1.5,
  roadHalfWidth: 7,
  laneCenterOffset: 3.5,
  roadEdgeClearance: 0.35,
  turnLookAheadDistance: 18,
  minimumTurnSpeed: 5.5,
  obstacleLookAheadMin: 7,
  obstacleLookAheadMax: 22,
  obstacleClearance: 0.45
});

function horizontalForward(vehicle) {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  return forward.normalize();
}

export function projectToNavigationSegment(position, currentNode, targetNode) {
  if (!position || !currentNode?.pos || !targetNode?.pos) return null;
  const startX = currentNode.pos.x;
  const startZ = currentNode.pos.z;
  const segmentX = targetNode.pos.x - startX;
  const segmentZ = targetNode.pos.z - startZ;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (lengthSquared < 1e-6) return null;
  const progress = THREE.MathUtils.clamp(
    ((position.x - startX) * segmentX + (position.z - startZ) * segmentZ) / lengthSquared,
    0,
    1
  );
  const x = startX + segmentX * progress;
  const z = startZ + segmentZ * progress;
  return {
    x,
    z,
    progress,
    deviation: Math.hypot(position.x - x, position.z - z)
  };
}

export function hasReachedNavigationTarget(vehicle, threshold = 4.5) {
  if (!vehicle?.mesh?.position || !vehicle.targetNode?.pos) return false;
  const position = vehicle.mesh.position;
  const target = vehicle.targetNode.pos;
  if (Math.hypot(position.x - target.x, position.z - target.z) <= Math.max(1, threshold)) return true;
  if (!vehicle.currentNode?.pos) return false;
  const segmentX = target.x - vehicle.currentNode.pos.x;
  const segmentZ = target.z - vehicle.currentNode.pos.z;
  const fromTargetX = position.x - target.x;
  const fromTargetZ = position.z - target.z;
  return segmentX * fromTargetX + segmentZ * fromTargetZ >= 0;
}

/** Hard guardrail used only once an AI vehicle has left its safe lane corridor. */
export function enforceLaneCorridor(vehicle, config = TRAFFIC_NAVIGATION) {
  if (!vehicle?.mesh || vehicle.userControlled || vehicle.isParked || vehicle.crashed) return false;
  const projection = projectToNavigationSegment(vehicle.mesh.position, vehicle.currentNode, vehicle.targetNode);
  if (!projection) return false;
  const configuredMaximum = Number.isFinite(config.maxLaneCenterDeviation)
    ? Math.max(1, config.maxLaneCenterDeviation)
    : TRAFFIC_NAVIGATION.maxLaneCenterDeviation;
  const profile = getVehicleProfile(vehicle.vType);
  const geometricMaximum = Math.max(
    0.5,
    (Number.isFinite(config.roadHalfWidth) ? config.roadHalfWidth : TRAFFIC_NAVIGATION.roadHalfWidth)
      - (Number.isFinite(config.laneCenterOffset) ? config.laneCenterOffset : TRAFFIC_NAVIGATION.laneCenterOffset)
      - profile.width * 0.5
      - (Number.isFinite(config.roadEdgeClearance) ? config.roadEdgeClearance : TRAFFIC_NAVIGATION.roadEdgeClearance)
  );
  const maximum = Math.min(configuredMaximum, geometricMaximum);
  // A freshly released player vehicle may be away from the authored lane
  // graph. Let its AI steer back onto the selected route instead of snapping
  // it across the city on the first ambient-traffic frame.
  if (vehicle.isRejoiningTraffic) {
    if (projection.deviation > maximum) return false;
    vehicle.isRejoiningTraffic = false;
  }
  if (projection.deviation <= maximum) return false;
  const offsetX = vehicle.mesh.position.x - projection.x;
  const offsetZ = vehicle.mesh.position.z - projection.z;
  const scale = maximum / projection.deviation;
  vehicle.mesh.position.x = projection.x + offsetX * scale;
  vehicle.mesh.position.z = projection.z + offsetZ * scale;
  if (vehicle.physicsBody) {
    vehicle.physicsBody.position.x = vehicle.mesh.position.x;
    vehicle.physicsBody.position.z = vehicle.mesh.position.z;
    vehicle.physicsBody.aabbNeedsUpdate = true;
  }
  return true;
}

export function getNavigationSpeedLimit(vehicle, config = TRAFFIC_NAVIGATION) {
  if (!vehicle?.mesh || !vehicle.targetNode?.pos) return Infinity;
  const dx = vehicle.targetNode.pos.x - vehicle.mesh.position.x;
  const dz = vehicle.targetNode.pos.z - vehicle.mesh.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return config.minimumTurnSpeed;
  const desiredAngle = Math.atan2(dx, dz);
  let difference = desiredAngle - vehicle.mesh.rotation.y;
  while (difference < -Math.PI) difference += Math.PI * 2;
  while (difference > Math.PI) difference -= Math.PI * 2;
  const severity = Math.min(1, Math.abs(difference) / (Math.PI * 0.5));
  if (severity < 0.12 || distance > config.turnLookAheadDistance) return Infinity;
  const maximumSpeed = Number.isFinite(vehicle.maxSpeed) ? Math.max(0, vehicle.maxSpeed) : 20;
  return Math.max(config.minimumTurnSpeed, maximumSpeed * (1 - severity * 0.72));
}

export function getTrafficObstacleSnapshot(physicsWorld) {
  return getActiveBoxColliders(physicsWorld, { includeStatic: true, includeKinematic: false });
}

export function findTrafficObstacleAhead(
  vehicle,
  physicsWorld,
  config = TRAFFIC_NAVIGATION,
  obstacleBoxes = null
) {
  if (!vehicle?.mesh || !physicsWorld) return null;
  const profile = getVehicleProfile(vehicle.vType);
  const forward = horizontalForward(vehicle);
  const rightX = forward.z;
  const rightZ = -forward.x;
  const speed = Math.max(0, Number.isFinite(vehicle.speed) ? Math.abs(vehicle.speed) : 0);
  const lookAhead = THREE.MathUtils.clamp(
    config.obstacleLookAheadMin + speed * 0.45,
    config.obstacleLookAheadMin,
    config.obstacleLookAheadMax
  );
  let closest = null;
  let closestDistance = lookAhead;

  const boxes = Array.isArray(obstacleBoxes) ? obstacleBoxes : getTrafficObstacleSnapshot(physicsWorld);
  for (const box of boxes) {
    if (box.y + box.halfY < vehicle.mesh.position.y + 0.15) continue;
    const offsetX = box.x - vehicle.mesh.position.x;
    const offsetZ = box.z - vehicle.mesh.position.z;
    const centerForward = offsetX * forward.x + offsetZ * forward.z;
    const forwardRadius = getBoxProjectedRadius(box, forward.x, forward.z);
    const nearDistance = centerForward - forwardRadius - profile.length * 0.5;
    if (nearDistance < -0.6 || nearDistance > closestDistance) continue;
    const centerLateral = Math.abs(offsetX * rightX + offsetZ * rightZ);
    const lateralRadius = getBoxProjectedRadius(box, rightX, rightZ);
    const lateralClearance = centerLateral - lateralRadius - profile.width * 0.5;
    if (lateralClearance > config.obstacleClearance) continue;
    closest = { box, distance: Math.max(0, nearDistance), lateralClearance };
    closestDistance = nearDistance;
  }
  return closest;
}
