import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Pedestrian } from '../src/entities/Pedestrian.js';
import {
  createPedestrianDescriptor,
  PEDESTRIAN_ARCHETYPE_SEQUENCE
} from '../src/entities/PedestrianArchetypes.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import {
  advanceTouristBehavior,
  createNpcBehaviorState,
  selectAggressionTarget
} from '../src/systems/NpcBehavior.js';

test('pedestrian archetype mix is explicit, stable, and includes every authored behavior', () => {
  const counts = new Map();
  for (let serial = 0; serial < PEDESTRIAN_ARCHETYPE_SEQUENCE.length; serial += 1) {
    const descriptor = createPedestrianDescriptor(serial, () => 0.5);
    counts.set(descriptor.archetype, (counts.get(descriptor.archetype) || 0) + 1);
    assert.ok(Number.isFinite(descriptor.appearance.heightScale));
    assert.ok(Number.isInteger(descriptor.appearance.skinTone));
  }
  assert.deepEqual(Object.fromEntries(counts), {
    CASUAL: 6,
    BUSINESS: 4,
    JOGGER: 3,
    TOURIST: 3,
    CAFE_READER: 2,
    CRIMINAL: 2
  });

  const sanitized = createPedestrianDescriptor(Number.NaN, () => { throw new Error('bad rng'); });
  assert.equal(sanitized.archetype, 'CASUAL');
});

test('cafe readers hold a visible book in a stable seated pose', () => {
  const descriptor = createPedestrianDescriptor(6, () => 0.5);
  const behaviorState = createNpcBehaviorState(descriptor.archetype, () => 0.5);
  const pedestrian = new Pedestrian(descriptor.archetype, descriptor.color, 'Reader', {
    ...descriptor,
    behaviorState
  });

  pedestrian.update(1 / 60, false);
  assert.equal(pedestrian.bookMesh.visible, true);
  assert.equal(pedestrian.speed, 0);
  assert.equal(pedestrian.legL.rotation.x, -1.45);
  assert.equal(pedestrian.armR.rotation.x, -1.05);
});

test('tourists alternate between walking and taking photographs', () => {
  const state = createNpcBehaviorState('TOURIST', () => 0);
  state.timer = 0;
  assert.equal(advanceTouristBehavior(state, 0.1, () => 0), 'TAKING_PHOTO');
  assert.ok(state.timer >= 2);
  state.timer = 0;
  assert.equal(advanceTouristBehavior(state, 0.1, () => 0), 'WALKING');
  assert.ok(state.timer >= 5);
});

test('criminal targeting prioritizes a controlled pedestrian and respects target reservations', () => {
  const criminal = { archetype: 'CRIMINAL', mesh: new THREE.Group() };
  const citizen = { archetype: 'CASUAL', mesh: new THREE.Group(), knockedDown: false };
  const player = { archetype: 'CASUAL', mesh: new THREE.Group(), knockedDown: false, userControlled: true };
  citizen.mesh.position.set(2, 0, 0);
  player.mesh.position.set(5, 0, 0);

  assert.equal(selectAggressionTarget(criminal, [criminal, citizen, player], player), player);
  player.attackedBy = {};
  assert.equal(selectAggressionTarget(criminal, [criminal, citizen, player], player), citizen);

  const controlledTroublemaker = {
    archetype: 'CRIMINAL', mesh: new THREE.Group(), knockedDown: false, userControlled: true
  };
  controlledTroublemaker.mesh.position.set(4, 0, 0);
  assert.equal(
    selectAggressionTarget(criminal, [criminal, controlledTroublemaker], controlledTroublemaker),
    controlledTroublemaker
  );
});

test('criminal attack can knock down the user-controlled pedestrian and releases its target', () => {
  const criminal = new Pedestrian('CRIMINAL', 0x27272a, 'Troublemaker', {
    archetype: 'CRIMINAL',
    behaviorState: createNpcBehaviorState('CRIMINAL', () => 0.5)
  });
  const player = new Pedestrian('CASUAL', 0x2563eb, 'Player');
  criminal.mesh.position.set(0, 0, 0);
  player.mesh.position.set(1, 0, 0);
  player.userControlled = true;
  criminal.behaviorState.mode = 'CHASING';
  criminal.behaviorState.target = player;
  player.attackedBy = criminal;

  const alerts = [];
  const system = Object.create(PedestrianSystem.prototype);
  system.pedestrians = [criminal, player];
  system.controlledPedestrian = player;
  system.random = () => 0.5;
  system.app = {
    audioSystem: { playBump() {} },
    uiManager: { addAlert(message, level) { alerts.push({ message, level }); } },
    cityBuilder: { getTerrainHeight() { return 0; } }
  };

  assert.equal(system.updateCriminalBehavior(criminal, criminal.behaviorState, 0.1, false, 0), true);
  assert.equal(player.knockedDown, true);
  assert.equal(player.attackedBy, null);
  assert.equal(criminal.behaviorState.mode, 'LOITERING');
  assert.equal(alerts.at(-1).level, 'danger');
});
