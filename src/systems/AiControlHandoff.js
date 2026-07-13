import * as THREE from 'three';

const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

function isFiniteVector3(vector) {
  return vector
    && Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z);
}

function isFiniteQuaternion(quaternion) {
  return quaternion
    && Number.isFinite(quaternion.x)
    && Number.isFinite(quaternion.y)
    && Number.isFinite(quaternion.z)
    && Number.isFinite(quaternion.w);
}

/** Captures the authoritative rendered pose before player-only state is torn down. */
export function captureAiHandoffPose(entity) {
  const mesh = entity?.mesh;
  if (!mesh || !isFiniteVector3(mesh.position) || !isFiniteQuaternion(mesh.quaternion)) return null;
  return {
    position: mesh.position.clone(),
    quaternion: mesh.quaternion.clone()
  };
}

function chooseForwardContinuation(node, position, quaternion) {
  const candidates = (node?.nextNodes || []).filter(candidate => isFiniteVector3(candidate?.pos));
  if (candidates.length === 0) return node;

  const forward = FORWARD_AXIS.clone().applyQuaternion(quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.copy(FORWARD_AXIS);
  forward.normalize();

  return candidates.reduce((best, candidate) => {
    const direction = candidate.pos.clone().sub(position);
    direction.y = 0;
    const distance = direction.length();
    const alignment = distance > 1e-6 ? direction.multiplyScalar(1 / distance).dot(forward) : -1;
    const score = alignment - Math.min(distance, 1000) * 1e-5;
    return score > best.score ? { candidate, score } : best;
  }, { candidate: candidates[0], score: -Infinity }).candidate;
}

function assignNavigationFromPose(entity, nodes, pose) {
  const candidates = Array.from(nodes || []).filter(node => isFiniteVector3(node?.pos));
  if (candidates.length === 0) {
    entity.currentNode = null;
    entity.targetNode = null;
    return false;
  }

  const closestNode = candidates.reduce((closest, node) => (
    pose.position.distanceToSquared(node.pos) < pose.position.distanceToSquared(closest.pos)
      ? node
      : closest
  ), candidates[0]);
  entity.currentNode = closestNode;
  entity.targetNode = chooseForwardContinuation(closestNode, pose.position, pose.quaternion);
  return true;
}

/**
 * Completes a player-to-AI ownership transfer without changing the visible
 * pose. It also repairs collection/scene membership so a valid released entity
 * cannot become orphaned from rendering or simulation.
 */
export function completeAiHandoff(entity, {
  pose,
  nodes,
  entities,
  scene
} = {}) {
  if (
    !entity?.mesh
    || !isFiniteVector3(pose?.position)
    || !isFiniteQuaternion(pose?.quaternion)
  ) return false;

  entity.mesh.position.copy(pose.position);
  entity.mesh.quaternion.copy(pose.quaternion);
  entity.mesh.visible = true;

  if (Array.isArray(entities) && !entities.includes(entity)) entities.push(entity);
  const belongsToScene = scene === entity.mesh
    || Boolean(scene?.getObjectById?.(entity.mesh.id));
  if (!belongsToScene && scene?.add) scene.add(entity.mesh);

  assignNavigationFromPose(entity, nodes, pose);
  return true;
}
