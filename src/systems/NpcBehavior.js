export const NPC_BEHAVIOR = Object.freeze({
  aggressionRadius: 20,
  attackRange: 1.65,
  chaseDuration: 7,
  attackCooldown: 1.2,
  postFightCooldownMin: 12,
  postFightCooldownMax: 22,
  initialAggressionDelayMin: 5,
  initialAggressionDelayMax: 14,
  touristWalkMin: 5,
  touristWalkMax: 10,
  touristPhotoMin: 2,
  touristPhotoMax: 4
});

function boundedRandom(random) {
  try {
    const value = Number(random?.());
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
  } catch {
    return 0.5;
  }
}

function randomRange(minimum, maximum, random) {
  return minimum + (maximum - minimum) * boundedRandom(random);
}

export function createNpcBehaviorState(archetype, random = Math.random) {
  if (archetype === 'CAFE_READER') return { mode: 'SITTING_READING', timer: Infinity };
  if (archetype === 'TOURIST') {
    return {
      mode: 'WALKING',
      timer: randomRange(NPC_BEHAVIOR.touristWalkMin, NPC_BEHAVIOR.touristWalkMax, random)
    };
  }
  if (archetype === 'CRIMINAL') {
    return {
      mode: 'LOITERING',
      timer: randomRange(
        NPC_BEHAVIOR.initialAggressionDelayMin,
        NPC_BEHAVIOR.initialAggressionDelayMax,
        random
      ),
      target: null,
      chaseElapsed: 0,
      attackCooldown: 0
    };
  }
  return { mode: archetype === 'JOGGER' ? 'JOGGING' : 'WALKING', timer: Infinity };
}

export function advanceTouristBehavior(state, delta, random = Math.random) {
  if (!state || !['WALKING', 'TAKING_PHOTO'].includes(state.mode)) return state?.mode;
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.25)) : 0;
  state.timer -= safeDelta;
  if (state.timer > 0) return state.mode;
  if (state.mode === 'WALKING') {
    state.mode = 'TAKING_PHOTO';
    state.timer = randomRange(NPC_BEHAVIOR.touristPhotoMin, NPC_BEHAVIOR.touristPhotoMax, random);
  } else {
    state.mode = 'WALKING';
    state.timer = randomRange(NPC_BEHAVIOR.touristWalkMin, NPC_BEHAVIOR.touristWalkMax, random);
  }
  return state.mode;
}

export function selectAggressionTarget(criminal, candidates, controlledPedestrian, config = NPC_BEHAVIOR) {
  if (!criminal?.mesh?.position || !Array.isArray(candidates)) return null;
  const radius = Number.isFinite(config.aggressionRadius) ? Math.max(0, config.aggressionRadius) : NPC_BEHAVIOR.aggressionRadius;
  const available = candidates.filter(candidate => (
    candidate
    && candidate !== criminal
    && candidate.mesh?.position
    && !candidate.knockedDown
    && !candidate.isHijacking
    && (candidate.archetype !== 'CRIMINAL' || candidate === controlledPedestrian)
    && (!candidate.attackedBy || candidate.attackedBy === criminal)
    && criminal.mesh.position.distanceTo(candidate.mesh.position) <= radius
  ));
  if (available.length === 0) return null;
  if (controlledPedestrian && available.includes(controlledPedestrian)) return controlledPedestrian;
  return available.reduce((closest, candidate) => (
    criminal.mesh.position.distanceToSquared(candidate.mesh.position)
      < criminal.mesh.position.distanceToSquared(closest.mesh.position)
      ? candidate
      : closest
  ));
}

export function beginAggression(criminal, state, target) {
  if (!criminal || !state || !target || (target.attackedBy && target.attackedBy !== criminal)) return false;
  state.mode = 'CHASING';
  state.target = target;
  state.chaseElapsed = 0;
  state.attackCooldown = 0;
  target.attackedBy = criminal;
  return true;
}

export function finishAggression(criminal, state, random = Math.random) {
  if (!state) return;
  if (state.target?.attackedBy === criminal) state.target.attackedBy = null;
  state.target = null;
  state.mode = 'LOITERING';
  state.chaseElapsed = 0;
  state.attackCooldown = 0;
  state.timer = randomRange(
    NPC_BEHAVIOR.postFightCooldownMin,
    NPC_BEHAVIOR.postFightCooldownMax,
    random
  );
}
