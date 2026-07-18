import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { AircraftSystem } from '../src/systems/AircraftSystem.js';
import { MissionSystem } from '../src/systems/MissionSystem.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { INTERACTION_PRIORITIES } from '../src/systems/InteractionService.js';

function entity(name, x, z, extra = {}) {
  const mesh = new THREE.Group();
  mesh.position.set(x, 0, z);
  return { name, mesh, ...extra };
}

test('pedestrian publisher exposes every nearby vehicle and NPC without choosing a winner', () => {
  const player = entity('Player', 0, 0);
  const vehicleA = entity('Coupe A', 2, 0, { vType: 'SPORTS' });
  const vehicleB = entity('Coupe B', -2, 0, { vType: 'SPORTS' });
  const npc = entity('Alex V.', 1, 0, { archetype: 'BUSINESS' });
  const system = Object.create(PedestrianSystem.prototype);
  system.controlledPedestrian = player;
  system.hijackTransition = null;
  system.pedestrians = [player, npc];
  system.app = { trafficSystem: { vehicles: [vehicleB, vehicleA] } };

  const candidates = system.getInteractionCandidates();
  assert.equal(candidates.length, 3);
  assert.equal(candidates.filter(value => value.kind === 'VEHICLE').length, 2);
  assert.equal(candidates.filter(value => value.kind === 'NPC').length, 1);
  assert.ok(candidates.every(value => Number.isFinite(value.distance)));
  assert.ok(candidates.every(value => typeof value.action === 'function'));
  assert.ok(candidates.every(value => value.accessibilityLabel));
});

test('aircraft publisher reports boarding failure and cockpit-exit eligibility explicitly', () => {
  const pedestrian = entity('Pilot', 0, 0);
  const aircraft = entity('Northwind Sparrow', 1, 0, {
    isAirborne: true,
    isCrashed: false,
    state: { speed: 12 }
  });
  const system = Object.create(AircraftSystem.prototype);
  system.aircraft = aircraft;
  system.controlledAircraft = null;
  system.app = { pedestrianSystem: { controlledPedestrian: pedestrian } };

  let [boarding] = system.getInteractionCandidates();
  assert.equal(boarding.priority, INTERACTION_PRIORITIES.AIRCRAFT_BOARD);
  assert.equal(boarding.eligibility.allowed, false);
  assert.match(boarding.failureReason, /safely stopped/i);
  assert.equal(boarding.distance, 1);

  aircraft.isAirborne = false;
  aircraft.state.speed = 0;
  system.controlledAircraft = aircraft;
  const [exit] = system.getInteractionCandidates();
  assert.equal(exit.kind, 'AIRCRAFT_EXIT');
  assert.equal(exit.eligibility.allowed, true);
});

test('traffic publisher exposes one controlled-vehicle exit and no ambient exits', () => {
  const system = Object.create(TrafficSystem.prototype);
  system.app = {};
  system.controlledVehicle = null;
  assert.deepEqual(system.getInteractionCandidates(), []);

  system.controlledVehicle = entity('Metro Cab', 0, 0, { vType: 'TAXI' });
  const [exit] = system.getInteractionCandidates();
  assert.equal(exit.kind, 'VEHICLE_EXIT');
  assert.equal(exit.priority, INTERACTION_PRIORITIES.CONTROLLED_ENTITY_EXIT);
  assert.equal(exit.eligibility.allowed, true);
  assert.equal(exit.distance, 0);

  system.app.missionSystem = { state: 'IN_PROGRESS', activeMission: { id: 'delivery' } };
  const [blockedExit] = system.getInteractionCandidates();
  assert.equal(blockedExit.eligibility.allowed, false);
  assert.match(blockedExit.failureReason, /active mission/i);
});

test('mission publisher emits overlapping pickups and a blocking sabotage failure', () => {
  const vehicle = entity('Mission Cab', 0, 0, { vType: 'TAXI', userControlled: true, speed: 0 });
  const missionA = { id: 'a', vehicleType: 'TAXI', pickup: { x: 1, z: 0 }, passengerName: 'A' };
  const missionB = { id: 'b', vehicleType: 'TAXI', pickup: { x: -1, z: 0 }, passengerName: 'B' };
  const system = Object.create(MissionSystem.prototype);
  system.app = { trafficSystem: { controlledVehicle: vehicle } };
  system.lifecycle = {
    phase: 'IDLE',
    evaluateAvailability: mission => ({ missionId: mission.id, available: true, reasons: [] })
  };
  system.triggerCooldown = 0;
  system.activeMission = null;
  system.pickupRings = [missionB, missionA].map(mission => ({
    mission,
    group: { visible: true, position: new THREE.Vector3(mission.pickup.x, 0, mission.pickup.z) }
  }));

  const pickups = system.getInteractionCandidates();
  assert.deepEqual(pickups.map(value => value.id), ['mission-pickup:b', 'mission-pickup:a']);
  assert.ok(pickups.every(value => value.priority === INTERACTION_PRIORITIES.MISSION_PICKUP));

  system.lifecycle.phase = 'ACTIVE';
  system.activeMission = {
    id: 'sabotage',
    title: 'Signal Jam',
    missionType: 'SABOTAGE',
    sabotageAction: 'Deploy jammer'
  };
  system._dropoffPos = new THREE.Vector3(30, 0, 0);
  const [objective] = system.getInteractionCandidates();
  assert.equal(objective.priority, INTERACTION_PRIORITIES.MISSION_OBJECTIVE);
  assert.equal(objective.eligibility.allowed, false);
  assert.match(objective.failureReason, /reach/i);
});
