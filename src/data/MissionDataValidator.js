import { WORLD_BOUNDS } from './ContentDefinitions.js';
import {
  DataValidationError,
  assertEnum,
  assertFinite,
  assertKnownReference,
  assertRecord,
  assertString,
  failData
} from './DataValidation.js';

export const SUPPORTED_MISSION_OBJECTIVES = Object.freeze([
  'TAXI', 'COURIER', 'RACE', 'DELIVERY', 'SABOTAGE', 'SURVIVAL'
]);

const OBJECTIVES = new Set(SUPPORTED_MISSION_OBJECTIVES);
const DIALOGUE_ACTIONS = new Set(['START_MISSION', 'DECLINE']);

function missionDetails(missionId, field = null) {
  return { source: 'missions', recordId: missionId, field };
}

function validateLocation(location, missionId, field, {
  districtIndex = null,
  worldBounds = WORLD_BOUNDS
} = {}) {
  assertRecord(location, missionDetails(missionId, field));
  assertFinite(location.x, missionDetails(missionId, `${field}.x`), {
    min: worldBounds.minX,
    max: worldBounds.maxX
  });
  assertFinite(location.z, missionDetails(missionId, `${field}.z`), {
    min: worldBounds.minZ,
    max: worldBounds.maxZ
  });
  assertString(location.district, missionDetails(missionId, `${field}.district`));
  if (districtIndex) {
    assertKnownReference(
      location.districtId,
      districtIndex,
      missionDetails(missionId, `${field}.districtId`),
      'districts'
    );
  } else {
    assertString(location.districtId, missionDetails(missionId, `${field}.districtId`), {
      stableId: true
    });
  }
}

function validateDialogueTree(tree, missionId) {
  assertRecord(tree, missionDetails(missionId, 'dialogueTree'));
  if (!tree.start) {
    failData('is missing dialogueTree.start.', missionDetails(missionId, 'dialogueTree.start'));
  }

  const nodes = new Map();
  for (const [nodeId, node] of Object.entries(tree)) {
    assertString(nodeId, missionDetails(missionId, `dialogueTree.${nodeId}`), { stableId: true });
    assertRecord(node, missionDetails(missionId, `dialogueTree.${nodeId}`));
    assertString(node.text, missionDetails(missionId, `dialogueTree.${nodeId}.text`));
    if (node.action != null) {
      assertEnum(node.action, DIALOGUE_ACTIONS, missionDetails(missionId, `dialogueTree.${nodeId}.action`));
    }
    if (node.rushBonus != null) {
      assertFinite(node.rushBonus, missionDetails(missionId, `dialogueTree.${nodeId}.rushBonus`), { min: 0 });
    }
    if (node.timeLimitOverride != null) {
      assertFinite(node.timeLimitOverride, missionDetails(missionId, `dialogueTree.${nodeId}.timeLimitOverride`), { min: 1 });
    }
    if (node.choices != null && !Array.isArray(node.choices)) {
      failData('choices must be an array.', missionDetails(missionId, `dialogueTree.${nodeId}.choices`));
    }
    nodes.set(nodeId, node);
  }

  const edges = new Map();
  for (const [nodeId, node] of nodes) {
    const targets = [];
    for (const [choiceIndex, choice] of (node.choices || []).entries()) {
      const prefix = `dialogueTree.${nodeId}.choices[${choiceIndex}]`;
      assertRecord(choice, missionDetails(missionId, prefix));
      assertString(choice.label, missionDetails(missionId, `${prefix}.label`));
      const next = assertString(choice.next, missionDetails(missionId, `${prefix}.next`), { stableId: true });
      if (!nodes.has(next)) {
        failData(`contains a broken dialogue choice to missing node ${next}.`, {
          ...missionDetails(missionId, `${prefix}.next`),
          code: 'MISSING_REFERENCE'
        });
      }
      targets.push(next);
    }
    edges.set(nodeId, targets);
  }

  const reachable = new Set();
  const pending = ['start'];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    pending.push(...(edges.get(nodeId) || []));
  }

  for (const nodeId of nodes.keys()) {
    if (!reachable.has(nodeId)) {
      failData('is unreachable from dialogueTree.start.', {
        ...missionDetails(missionId, `dialogueTree.${nodeId}`),
        code: 'UNREACHABLE_RECORD'
      });
    }
  }
  return nodes;
}

export function validateMissionData(missions, {
  districtIndex = null,
  vehicleIds = null,
  worldBounds = WORLD_BOUNDS
} = {}) {
  if (!Array.isArray(missions) || missions.length === 0) {
    throw new DataValidationError('must be a non-empty array.', { source: 'missions' });
  }

  const ids = new Set();
  for (const [index, mission] of missions.entries()) {
    assertRecord(mission, { source: 'missions', recordId: index });
    const missionId = typeof mission.id === 'string' && mission.id.trim()
      ? mission.id.trim()
      : '<missing>';
    if (missionId === '<missing>' || ids.has(missionId)) {
      failData(`Mission id is missing or duplicated: ${missionId}`, {
        source: 'missions',
        recordId: missionId,
        field: 'id',
        code: 'DUPLICATE_ID'
      });
    }
    assertString(missionId, missionDetails(missionId, 'id'), { stableId: true });
    ids.add(missionId);

    assertString(mission.title, missionDetails(missionId, 'title'));
    assertString(mission.passengerName, missionDetails(missionId, 'passengerName'));
    assertString(mission.passengerRole, missionDetails(missionId, 'passengerRole'));
    const vehicleType = assertString(mission.vehicleType, missionDetails(missionId, 'vehicleType'), {
      stableId: true
    });
    if (vehicleIds) assertEnum(vehicleType, vehicleIds, missionDetails(missionId, 'vehicleType'));

    validateLocation(mission.pickup, missionId, 'pickup', { districtIndex, worldBounds });
    const objective = mission.missionType || mission.objectiveType || 'DELIVERY';
    if (!OBJECTIVES.has(objective)) {
      failData(`uses unsupported objective ${objective}.`, {
        ...missionDetails(missionId, 'missionType'),
        code: 'INVALID_ENUM'
      });
    }
    if (objective !== 'SURVIVAL') {
      validateLocation(mission.dropoff, missionId, 'dropoff', { districtIndex, worldBounds });
    } else if (mission.dropoff != null) {
      validateLocation(mission.dropoff, missionId, 'dropoff', { districtIndex, worldBounds });
    }

    if (objective === 'RACE') {
      if (!Array.isArray(mission.checkpoints) || mission.checkpoints.length < 2) {
        failData('requires at least two valid checkpoints.', missionDetails(missionId, 'checkpoints'));
      }
      mission.checkpoints.forEach((point, pointIndex) => validateLocation(
        point,
        missionId,
        `checkpoints[${pointIndex}]`,
        { districtIndex, worldBounds }
      ));
      if (!Array.isArray(mission.rivals) || mission.rivals.length === 0) {
        failData('requires an authored rival roster.', missionDetails(missionId, 'rivals'));
      }
      mission.rivals.forEach((rival, rivalIndex) => {
        assertRecord(rival, missionDetails(missionId, `rivals[${rivalIndex}]`));
        assertString(rival.name, missionDetails(missionId, `rivals[${rivalIndex}].name`));
        assertFinite(rival.finishTime, missionDetails(missionId, `rivals[${rivalIndex}].finishTime`), { min: 0.001 });
      });
    }
    if (objective === 'SABOTAGE') {
      if (typeof mission.sabotageAction !== 'string' || !mission.sabotageAction.trim()
        || !Number.isFinite(mission.sabotageDuration) || mission.sabotageDuration <= 0) {
        failData('requires a valid sabotage action and duration.', missionDetails(missionId, 'sabotageAction'));
      }
    }

    assertFinite(mission.timeLimit, missionDetails(missionId, 'timeLimit'), { min: 0.001 });
    assertFinite(mission.baseReward, missionDetails(missionId, 'baseReward'), { min: 0 });
    if (mission.rewardScale != null) {
      assertFinite(mission.rewardScale, missionDetails(missionId, 'rewardScale'), { min: 0.001 });
    }
    if (mission.chronologyChapter != null) {
      assertFinite(mission.chronologyChapter, missionDetails(missionId, 'chronologyChapter'), { min: 0 });
    }
    if (mission.requiresMayhem != null && typeof mission.requiresMayhem !== 'boolean') {
      failData('must be boolean.', missionDetails(missionId, 'requiresMayhem'));
    }
    validateDialogueTree(mission.dialogueTree, missionId);
  }
  return true;
}

export default validateMissionData;
