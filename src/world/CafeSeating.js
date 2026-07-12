import * as THREE from 'three';

export const CAFE_SEAT_LAYOUT = Object.freeze([
  Object.freeze({ x: 13, z: 41, rotation: -Math.PI / 2 }),
  Object.freeze({ x: 13, z: 45, rotation: -Math.PI / 2 }),
  Object.freeze({ x: 41, z: 13, rotation: Math.PI }),
  Object.freeze({ x: 45, z: 13, rotation: Math.PI }),
  Object.freeze({ x: 63, z: -41, rotation: Math.PI / 2 }),
  Object.freeze({ x: 63, z: -45, rotation: Math.PI / 2 })
]);

function createCafeSet(seat) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x263449, roughness: 0.45, metalness: 0.65 });
  const tabletop = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x062b36, roughness: 0.4 });

  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 16), tabletop);
  tableTop.position.set(1.15, 1.02, 0);
  tableTop.castShadow = true;
  group.add(tableTop);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.95, 8), metal);
  pedestal.position.set(1.15, 0.5, 0);
  group.add(pedestal);
  const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), accent);
  chairSeat.position.set(0, 0.62, 0);
  chairSeat.castShadow = true;
  group.add(chairSeat);
  const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.1), accent);
  chairBack.position.set(-0.32, 1.03, 0);
  group.add(chairBack);
  for (const z of [-0.25, 0.25]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.08), metal);
    leg.position.set(0, 0.3, z);
    group.add(leg);
  }

  group.position.set(seat.x, 0.4, seat.z);
  group.rotation.y = seat.rotation;
  group.userData.ambientCafeFurniture = true;
  return group;
}

function addCafeColliders(physicsWorld, seat) {
  if (!physicsWorld?.addStaticBoxCollider) return [];
  const tableOffset = new THREE.Vector3(1.15, 0, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    seat.rotation
  );
  return [
    physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(seat.x, 1.05, seat.z),
      new THREE.Vector3(0.82, 1.3, 0.82),
      { rotationY: seat.rotation }
    ),
    physicsWorld.addStaticBoxCollider(
      new THREE.Vector3(seat.x + tableOffset.x, 0.95, seat.z + tableOffset.z),
      new THREE.Vector3(1.5, 1.1, 1.5),
      { rotationY: seat.rotation }
    )
  ];
}

export function createCafeSeating(scene, physicsWorld, layout = CAFE_SEAT_LAYOUT) {
  return layout.map(seat => {
    const group = createCafeSet(seat);
    scene?.add?.(group);
    return {
      ...seat,
      y: 0.12,
      furniture: group,
      colliders: addCafeColliders(physicsWorld, seat)
    };
  });
}
