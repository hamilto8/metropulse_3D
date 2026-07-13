import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Pedestrian } from '../src/entities/Pedestrian.js';
import { MOTORBIKE_RIDER_POSE, Vehicle } from '../src/entities/Vehicle.js';
import {
  getRiderEjectionImpact,
  MOTORBIKE_RIDER_EJECTION
} from '../src/systems/MotorbikeImpact.js';
import { TrafficSystem } from '../src/systems/TrafficSystem.js';

function createRiddenMotorbike(z = 2) {
  const motorbike = new Vehicle('MOTORBIKE', 0xea580c, 'Test Motorbike');
  const rider = new Pedestrian('CASUAL', 0x2563eb, 'Test Rider');
  motorbike.mesh.position.set(0, 0, z);
  motorbike.speed = 0;
  motorbike.mountRider(rider);
  return { motorbike, rider };
}

function createTrafficHarness() {
  const traffic = Object.create(TrafficSystem.prototype);
  const pedestrians = [];
  let knockdown = null;
  traffic.nodes = new Map();
  traffic.app = {
    sceneManager: { scene: new THREE.Group() },
    pedestrianSystem: {
      pedestrians,
      nodes: new Map(),
      knockDownPedestrian(pedestrian, direction, speed) {
        knockdown = { pedestrian, direction: direction.clone(), speed };
        pedestrian.knockedDown = true;
        return true;
      }
    },
    inspectorHud: { registerObject() {} },
    uiManager: { addAlert() {}, hideInspector() {} }
  };
  return { traffic, pedestrians, getKnockdown: () => knockdown };
}

test('mounted motorbike rider sits on the saddle and reaches toward the handlebars', () => {
  const { motorbike, rider } = createRiddenMotorbike();
  const handlebars = motorbike.mesh.getObjectByName('motorbike-handlebars');
  assert.ok(handlebars);
  assert.deepEqual(rider.mesh.position.toArray(), MOTORBIKE_RIDER_POSE.position);
  assert.ok(rider.armL.rotation.x < 0);
  assert.ok(rider.armR.rotation.x < 0);

  motorbike.mesh.updateMatrixWorld(true);
  const handlebarCenter = handlebars.getWorldPosition(new THREE.Vector3());
  const leftHand = rider.armL.localToWorld(new THREE.Vector3(0, -0.8, 0));
  const rightHand = rider.armR.localToWorld(new THREE.Vector3(0, -0.8, 0));
  assert.ok(leftHand.z > rider.armL.getWorldPosition(new THREE.Vector3()).z);
  assert.ok(rightHand.z > rider.armR.getWorldPosition(new THREE.Vector3()).z);
  assert.ok(leftHand.distanceTo(handlebarCenter) < 0.5);
  assert.ok(rightHand.distanceTo(handlebarCenter) < 0.5);
});

test('rider ejection requires a high closing speed rather than raw proximity', () => {
  const impactor = new Vehicle('SEDAN', 0x3366cc, 'Approaching Sedan');
  const { motorbike } = createRiddenMotorbike();
  impactor.mesh.position.set(0, 0, 0);
  impactor.speed = MOTORBIKE_RIDER_EJECTION.minimumClosingSpeed - 0.1;

  assert.equal(getRiderEjectionImpact(impactor, motorbike), null);
  impactor.speed = MOTORBIKE_RIDER_EJECTION.minimumClosingSpeed + 0.1;
  const impact = getRiderEjectionImpact(impactor, motorbike);
  assert.ok(impact);
  assert.ok(impact.closingSpeed >= MOTORBIKE_RIDER_EJECTION.minimumClosingSpeed);
  assert.ok(impact.direction.z > 0.99);

  impactor.speed = 1;
  motorbike.speed = -20;
  assert.equal(
    getRiderEjectionImpact(impactor, motorbike),
    null,
    'a slow impactor must not eject a rider solely because the bike approaches quickly'
  );
});

test('motorbike LOD always renders either the full rider or a rider silhouette', () => {
  const { motorbike, rider } = createRiddenMotorbike();

  motorbike.setDetailLevel('LOW');
  assert.equal(rider.mesh.visible, false);
  assert.equal(motorbike.riderLowDetailProxy.visible, true);

  motorbike.setDetailLevel('HIGH');
  assert.equal(rider.mesh.visible, true);
  assert.equal(motorbike.riderLowDetailProxy.visible, false);

  motorbike.unmountRider();
  motorbike.setDetailLevel('LOW');
  assert.equal(motorbike.riderLowDetailProxy.visible, false);
});

test('ambient rider repair never remounts an ejected pedestrian', () => {
  const { traffic, pedestrians } = createTrafficHarness();
  const motorbike = new Vehicle('MOTORBIKE', 0xea580c, 'Recovered Motorbike');
  const ejectedRider = new Pedestrian('CASUAL', 0x2563eb, 'Ejected Rider');
  motorbike.driverPedestrian = ejectedRider;
  pedestrians.push(ejectedRider);

  assert.equal(traffic.ensureAmbientMotorbikeRider(motorbike, 7), true);
  assert.ok(motorbike.mountedRider);
  assert.notEqual(motorbike.mountedRider, ejectedRider);
  assert.equal(motorbike.mountedRider.mesh.parent, motorbike.mesh);
  assert.equal(pedestrians.includes(ejectedRider), true);
});

test('failed rider world registration rolls back the ejection atomically', () => {
  const { traffic } = createTrafficHarness();
  const impactor = new Vehicle('SEDAN', 0x3366cc, 'Impactor');
  const { motorbike, rider } = createRiddenMotorbike();
  traffic.registerPedestrianInWorld = () => false;

  assert.equal(traffic.ejectMotorbikeRider({
    motorbike,
    impactor,
    direction: new THREE.Vector3(0, 0, 1),
    closingSpeed: 18
  }), false);
  assert.equal(motorbike.mountedRider, rider);
  assert.equal(rider.mesh.parent, motorbike.mesh);
});

test('all spawned moving motorbikes have attached riders', () => {
  const traffic = new TrafficSystem({
    funMode: false,
    sceneManager: { scene: new THREE.Group() },
    inspectorHud: null,
    physicsWorld: null
  });
  const motorbikes = traffic.vehicles.filter(vehicle => (
    vehicle.vType === 'MOTORBIKE' && !vehicle.isParked
  ));

  assert.ok(motorbikes.length > 0);
  for (const motorbike of motorbikes) {
    assert.ok(motorbike.mountedRider, `${motorbike.name} has no rider`);
    assert.equal(motorbike.mountedRider.mesh.parent, motorbike.mesh);
  }
});

test('high-speed NPC vehicle contact ejects and knocks down a motorbike rider', () => {
  const { traffic, pedestrians, getKnockdown } = createTrafficHarness();
  const impactor = new Vehicle('SEDAN', 0x3366cc, 'NPC Sedan');
  const { motorbike, rider } = createRiddenMotorbike();
  impactor.mesh.position.set(0, 0, 0);
  impactor.speed = 18;

  assert.equal(traffic.resolveVehicleOverlap(impactor, motorbike), true);
  assert.equal(motorbike.mountedRider, null);
  assert.equal(motorbike.crashed, true);
  assert.equal(motorbike.speed, 0);
  assert.deepEqual(pedestrians, [rider]);
  assert.equal(rider.mesh.parent, traffic.app.sceneManager.scene);
  assert.equal(rider.knockedDown, true);
  assert.equal(getKnockdown().pedestrian, rider);
  assert.ok(getKnockdown().speed >= 18);
});

test('user-driven physics vehicle can eject an NPC motorbike rider', () => {
  const { traffic, pedestrians } = createTrafficHarness();
  const impactor = new Vehicle('SPORTS', 0xdf0054, 'Player Sports Car');
  const { motorbike, rider } = createRiddenMotorbike();
  impactor.userControlled = true;
  impactor.mesh.position.set(0, 0, 0);
  impactor.speed = 20;
  impactor.physicsVehicle = {
    chassisBody: {
      position: new THREE.Vector3(0, 1, 0),
      velocity: new THREE.Vector3(0, 0, 20),
      angularVelocity: new THREE.Vector3(),
      aabbNeedsUpdate: false
    }
  };

  assert.equal(traffic.resolveUserVehicleContact(impactor, motorbike), true);
  assert.equal(motorbike.mountedRider, null);
  assert.deepEqual(pedestrians, [rider]);
  assert.equal(rider.knockedDown, true);
});

test('an ejected user rider regains pedestrian and camera control', () => {
  const { traffic, pedestrians } = createTrafficHarness();
  const impactor = new Vehicle('TRUCK', 0x777777, 'NPC Truck');
  const { motorbike, rider } = createRiddenMotorbike();
  impactor.mesh.position.set(0, 0, 0);
  impactor.speed = 18;
  motorbike.userControlled = true;
  traffic.controlledVehicle = motorbike;
  traffic.controlSession = { source: 'pedestrian', pedestrian: rider };
  traffic.releaseControl = vehicle => {
    vehicle.userControlled = false;
    traffic.controlledVehicle = null;
    traffic.controlSession = null;
  };
  traffic.app.pedestrianSystem.toggleUserControl = pedestrian => {
    pedestrian.userControlled = true;
    traffic.app.pedestrianSystem.controlledPedestrian = pedestrian;
    return true;
  };
  let followed = null;
  traffic.app.sceneManager.startFollowTarget = pedestrian => { followed = pedestrian; };

  assert.equal(traffic.resolveVehicleOverlap(impactor, motorbike), true);
  assert.equal(motorbike.userControlled, false);
  assert.equal(rider.userControlled, true);
  assert.equal(followed, rider);
  assert.deepEqual(pedestrians, [rider]);
});
