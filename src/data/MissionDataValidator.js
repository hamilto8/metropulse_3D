const SUPPORTED_OBJECTIVES = new Set(['TAXI', 'COURIER', 'RACE', 'DELIVERY', 'SABOTAGE', 'SURVIVAL']);

export function validateMissionData(missions) {
  if (!Array.isArray(missions) || missions.length === 0) {
    throw new Error('Mission data must be a non-empty array.');
  }

  const ids = new Set();
  for (const mission of missions) {
    if (!mission || typeof mission !== 'object') throw new Error('Every mission must be an object.');
    if (!mission.id || ids.has(mission.id)) throw new Error(`Mission id is missing or duplicated: ${mission.id || '<missing>'}`);
    ids.add(mission.id);
    if (!mission.vehicleType) throw new Error(`Mission ${mission.id} is missing vehicleType.`);
    if (!mission.pickup || !Number.isFinite(mission.pickup.x) || !Number.isFinite(mission.pickup.z)) {
      throw new Error(`Mission ${mission.id} has an invalid pickup.`);
    }
    const objective = mission.missionType || mission.objectiveType || 'DELIVERY';
    if (!SUPPORTED_OBJECTIVES.has(objective)) throw new Error(`Mission ${mission.id} uses unsupported objective ${objective}.`);
    if (objective !== 'SURVIVAL' && (!mission.dropoff || !Number.isFinite(mission.dropoff.x) || !Number.isFinite(mission.dropoff.z))) {
      throw new Error(`Mission ${mission.id} has an invalid dropoff.`);
    }
    if (objective === 'RACE') {
      if (!Array.isArray(mission.checkpoints) || mission.checkpoints.length < 2 || mission.checkpoints.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.z))) {
        throw new Error(`Race mission ${mission.id} requires at least two valid checkpoints.`);
      }
      if (!Array.isArray(mission.rivals) || mission.rivals.length === 0 || mission.rivals.some(rival => !rival?.name || !Number.isFinite(rival.finishTime) || rival.finishTime <= 0)) {
        throw new Error(`Race mission ${mission.id} requires an authored rival roster.`);
      }
    }
    if (objective === 'SABOTAGE' && (!mission.sabotageAction || !Number.isFinite(mission.sabotageDuration) || mission.sabotageDuration <= 0)) {
      throw new Error(`Sabotage mission ${mission.id} requires a valid sabotage action and duration.`);
    }
    if (!Number.isFinite(mission.timeLimit) || mission.timeLimit <= 0) throw new Error(`Mission ${mission.id} has an invalid timeLimit.`);
    if (!mission.dialogueTree?.start) throw new Error(`Mission ${mission.id} is missing dialogueTree.start.`);

    for (const [nodeId, node] of Object.entries(mission.dialogueTree)) {
      if (node.choices && !Array.isArray(node.choices)) throw new Error(`Mission ${mission.id}/${nodeId} choices must be an array.`);
      for (const choice of node.choices || []) {
        if (!choice.label || !choice.next || !mission.dialogueTree[choice.next]) {
          throw new Error(`Mission ${mission.id}/${nodeId} contains a broken dialogue choice.`);
        }
      }
    }
  }
  return true;
}

export default validateMissionData;
