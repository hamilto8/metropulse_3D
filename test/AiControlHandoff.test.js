import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Pedestrian } from '../src/entities/Pedestrian.js';
import { Vehicle } from '../src/entities/Vehicle.js';
import { PedestrianSystem } from '../src/systems/PedestrianSystem.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';
import { enforceLaneCorridor } from '../src/systems/TrafficNavigation.js';

function navigationFixture(position) {
  const origin = { id: 'origin', pos: position.clone(), nextNodes: [] };
  const east = { id: 'east', pos: position.clone().add(new THREE.Vector3(50, 0, 0)), nextNodes: [] };
  const west = { id: 'west', pos: position.clone().add(new THREE.Vector3(-50, 0, 0)), nextNodes: [] };
  const north = { id: 'north', pos: position.clone().add(new THREE.Vector3(0, 0, 50)), nextNodes: [] };
  origin.nextNodes.push(east, west, north);
  return { origin, east, west, north, nodes: new Map([[origin.id, origin]]) };
}

test('vehicle release preserves its final pose and repairs AI/render membership', () => {
  const scene = new THREE.Group();
  const route = navigationFixture(new THREE.Vector3(102, 0, 101));
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Handoff Sedan');
  vehicle.userControlled = true;
  vehicle.mesh.position.set(102.25, 0.35, 101.5);
  vehicle.mesh.rotation.set(0.08, Math.PI / 2, -0.04);
  vehicle.mesh.visible = false;
  const detachedContainer = new THREE.Group();
  detachedContainer.add(vehicle.mesh);
  vehicle.speed = 3;
  const finalPosition = vehicle.mesh.position.clone();
  const finalQuaternion = vehicle.mesh.quaternion.clone();
  let destroyed = 0;
  vehicle.physicsVehicle = {
    destroy() {
      destroyed += 1;
      // Teardown order must not be able to corrupt the authoritative pose.
      vehicle.mesh.position.set(0, 0, 0);
      vehicle.mesh.quaternion.identity();
    }
  };

  const traffic = Object.create(TrafficSystem.prototype);
  Object.assign(traffic, {
    app: {
      sceneManager: { scene },
      pedestrianSystem: { controlledPedestrian: null },
      gameManager: { setState() {} }
    },
    nodes: route.nodes,
    vehicles: [],
    controlledVehicle: vehicle,
    controlSession: { source: 'camera', pedestrian: null }
  });

  assert.equal(traffic.releaseControl(vehicle), true);
  assert.equal(destroyed, 1);
  assert.equal(vehicle.userControlled, false);
  assert.equal(traffic.controlledVehicle, null);
  assert.deepEqual(vehicle.mesh.position.toArray(), finalPosition.toArray());
  assert.deepEqual(vehicle.mesh.quaternion.toArray(), finalQuaternion.toArray());
  assert.equal(vehicle.mesh.visible, true);
  assert.equal(vehicle.mesh.parent, scene);
  assert.deepEqual(traffic.vehicles, [vehicle]);
  assert.equal(vehicle.currentNode, route.origin);
  assert.equal(vehicle.targetNode, route.east);
  assert.equal(vehicle.isRejoiningTraffic, true);
  assert.equal(vehicle.physicsVehicle, null);
});

test('pedestrian release preserves its final pose and repairs AI/render membership', () => {
  const scene = new THREE.Group();
  const route = navigationFixture(new THREE.Vector3(40, 0.4, 80));
  const pedestrian = new Pedestrian('CASUAL', 0x16a34a, 'Handoff Citizen');
  pedestrian.userControlled = true;
  pedestrian.mesh.position.set(39.75, 0.65, 80.5);
  pedestrian.mesh.rotation.set(0, -Math.PI / 2, 0);
  pedestrian.mesh.visible = false;
  const finalPosition = pedestrian.mesh.position.clone();
  const finalQuaternion = pedestrian.mesh.quaternion.clone();

  const pedestrians = Object.create(PedestrianSystem.prototype);
  Object.assign(pedestrians, {
    app: {
      sceneManager: { scene },
      trafficSystem: { controlledVehicle: null },
      gameManager: { setState() {} }
    },
    nodes: route.nodes,
    pedestrians: [],
    controlledPedestrian: pedestrian
  });

  assert.equal(pedestrians.releaseControl(pedestrian), true);
  assert.equal(pedestrian.userControlled, false);
  assert.equal(pedestrians.controlledPedestrian, null);
  assert.deepEqual(pedestrian.mesh.position.toArray(), finalPosition.toArray());
  assert.deepEqual(pedestrian.mesh.quaternion.toArray(), finalQuaternion.toArray());
  assert.equal(pedestrian.mesh.visible, true);
  assert.equal(pedestrian.mesh.parent, scene);
  assert.deepEqual(pedestrians.pedestrians, [pedestrian]);
  assert.equal(pedestrian.currentNode, route.origin);
  assert.equal(pedestrian.targetNode, route.west);
});

test('released cafe readers walk from the handoff point instead of teleporting to their seat', () => {
  const scene = new THREE.Group();
  const route = navigationFixture(new THREE.Vector3(300, 0.4, -120));
  const pedestrian = new Pedestrian('CAFE_READER', 0x7c3aed, 'Traveling Reader', {
    archetype: 'CAFE_READER',
    behaviorState: { mode: 'SITTING_READING', timer: Infinity }
  });
  pedestrian.cafeSeat = { x: -75, y: 0.4, z: -75, rotation: Math.PI };
  pedestrian.userControlled = true;
  pedestrian.mesh.position.set(302, 0.4, -118);
  pedestrian.mesh.rotation.y = 0.65;
  const releasedPosition = pedestrian.mesh.position.clone();
  const releasedQuaternion = pedestrian.mesh.quaternion.clone();

  const pedestrians = Object.create(PedestrianSystem.prototype);
  Object.assign(pedestrians, {
    app: {
      sceneManager: { scene },
      trafficSystem: { controlledVehicle: null },
      gameManager: { setState() {} }
    },
    nodes: route.nodes,
    pedestrians: [pedestrian],
    controlledPedestrian: pedestrian
  });

  assert.equal(pedestrians.releaseControl(pedestrian), true);
  assert.equal(pedestrian.behaviorState.mode, 'WALKING');
  assert.equal(pedestrians.updateNpcSpecialBehavior(pedestrian, 1 / 60, false, 0), false);
  assert.deepEqual(pedestrian.mesh.position.toArray(), releasedPosition.toArray());
  assert.deepEqual(pedestrian.mesh.quaternion.toArray(), releasedQuaternion.toArray());
});

test('vehicle AI rejoins its route without a first-frame position snap', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Rejoining Sedan');
  vehicle.userControlled = false;
  vehicle.isRejoiningTraffic = true;
  vehicle.mesh.position.set(100, 0, 25);
  vehicle.currentNode = { pos: new THREE.Vector3(0, 0, 0) };
  vehicle.targetNode = { pos: new THREE.Vector3(0, 0, 50) };
  const releasedPosition = vehicle.mesh.position.clone();

  assert.equal(enforceLaneCorridor(vehicle), false);
  assert.deepEqual(vehicle.mesh.position.toArray(), releasedPosition.toArray());
  assert.equal(vehicle.isRejoiningTraffic, true);

  vehicle.mesh.position.x = 0.5;
  assert.equal(enforceLaneCorridor(vehicle), false);
  assert.equal(vehicle.isRejoiningTraffic, false);

  vehicle.mesh.position.x = 10;
  assert.equal(enforceLaneCorridor(vehicle), true);
  assert.ok(vehicle.mesh.position.x < 2);
});

test('release rejects a corrupt transform without dropping player ownership', () => {
  const vehicle = new Vehicle('SEDAN', 0x3366cc, 'Invalid Pose Sedan');
  vehicle.userControlled = true;
  vehicle.mesh.position.x = Number.NaN;
  const traffic = Object.create(TrafficSystem.prototype);
  traffic.controlledVehicle = vehicle;

  assert.equal(traffic.releaseControl(vehicle), false);
  assert.equal(vehicle.userControlled, true);
  assert.equal(traffic.controlledVehicle, vehicle);
});
