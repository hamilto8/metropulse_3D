import * as THREE from 'three';
import { getVehicleProfile } from '../entities/VehicleProfiles.js';

const WORLD_UP = Object.freeze(new THREE.Vector3(0, 1, 0));

function horizontalAxes(vehicle) {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(WORLD_UP, forward).normalize();
  return { forward, right };
}

function projectedRadius(box, axis) {
  return Math.abs(axis.dot(box.forward)) * box.halfLength
    + Math.abs(axis.dot(box.right)) * box.halfWidth;
}

export function getVehicleFootprint(vehicle) {
  const profile = getVehicleProfile(vehicle?.vType);
  const axes = horizontalAxes(vehicle);
  return {
    center: vehicle.mesh.position,
    forward: axes.forward,
    right: axes.right,
    halfLength: profile.length * 0.5,
    halfWidth: profile.width * 0.5
  };
}

/** Returns the minimum horizontal translation that moves A away from B. */
export function getVehicleSeparation(vehicleA, vehicleB, clearance = 0.06) {
  if (!vehicleA?.mesh || !vehicleB?.mesh || vehicleA === vehicleB) return null;
  const boxA = getVehicleFootprint(vehicleA);
  const boxB = getVehicleFootprint(vehicleB);
  const centerDelta = new THREE.Vector3().subVectors(boxA.center, boxB.center);
  centerDelta.y = 0;
  let minimumDepth = Infinity;
  let minimumAxis = null;

  for (const sourceAxis of [boxA.forward, boxA.right, boxB.forward, boxB.right]) {
    const axis = sourceAxis.clone();
    const centerDistance = Math.abs(centerDelta.dot(axis));
    const overlap = projectedRadius(boxA, axis) + projectedRadius(boxB, axis) - centerDistance;
    if (overlap <= 0) return null;
    if (overlap < minimumDepth) {
      if (centerDelta.dot(axis) < 0) axis.negate();
      minimumDepth = overlap;
      minimumAxis = axis;
    }
  }

  return {
    normal: minimumAxis,
    depth: minimumDepth + Math.max(0, clearance)
  };
}

