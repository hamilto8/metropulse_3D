function quaternionYaw(quaternion) {
  if (!quaternion) return 0;
  const sinYaw = 2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z);
  const cosYaw = 1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z);
  return Math.atan2(sinYaw, cosYaw);
}

function appendBoxBodies(boxes, bodies, activeBodies, source) {
  for (const body of bodies || []) {
    if (!body || !activeBodies.has(body) || !body.position) continue;
    const shape = body.shapes?.[0];
    const half = shape?.halfExtents;
    if (!half || ![half.x, half.y, half.z].every(Number.isFinite)) continue;
    if (![body.position.x, body.position.y, body.position.z].every(Number.isFinite)) continue;
    const yaw = quaternionYaw(body.quaternion);
    boxes.push({
      body,
      source,
      x: body.position.x,
      y: body.position.y,
      z: body.position.z,
      halfX: Math.abs(half.x),
      halfY: Math.abs(half.y),
      halfZ: Math.abs(half.z),
      cos: Math.cos(yaw),
      sin: Math.sin(yaw)
    });
  }
}

/** Returns active oriented box colliders from the shared physics registry. */
export function getActiveBoxColliders(
  physicsWorld,
  { includeStatic = true, includeKinematic = true } = {}
) {
  if (!physicsWorld?.world) return [];
  const activeBodies = new Set(physicsWorld.world.bodies || []);
  const boxes = [];
  if (includeStatic) appendBoxBodies(boxes, physicsWorld.staticBodies, activeBodies, 'STATIC');
  if (includeKinematic) appendBoxBodies(boxes, physicsWorld.kinematicBodies, activeBodies, 'KINEMATIC');
  return boxes;
}

export function getBoxProjectedRadius(box, axisX, axisZ) {
  const localXAxisX = box.cos;
  const localXAxisZ = -box.sin;
  const localZAxisX = box.sin;
  const localZAxisZ = box.cos;
  return Math.abs(axisX * localXAxisX + axisZ * localXAxisZ) * box.halfX
    + Math.abs(axisX * localZAxisX + axisZ * localZAxisZ) * box.halfZ;
}
