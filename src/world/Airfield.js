import * as THREE from 'three';

export const AIRFIELD_LAYOUT = Object.freeze({
  centerX: -105,
  centerZ: -260,
  runwayWidth: 28,
  runwayLength: 210,
  runwayHeading: Math.PI,
  aircraftStart: Object.freeze({ x: -105, y: 1.15, z: -190, heading: Math.PI }),
  bounds: Object.freeze({ minX: -196, maxX: -18, minZ: -382, maxZ: -138 })
});

function mesh(geometry, material, { x = 0, y = 0, z = 0 } = {}) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function createRunwayMarkings(group, layout) {
  const markingMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x9bdcff });
  const runwayNorth = layout.centerZ - layout.runwayLength * 0.5;
  const runwaySouth = layout.centerZ + layout.runwayLength * 0.5;

  for (let z = runwayNorth + 22; z < runwaySouth - 16; z += 20) {
    group.add(mesh(new THREE.BoxGeometry(0.8, 0.04, 8), markingMaterial, {
      x: layout.centerX, y: 0.29, z
    }));
  }

  for (const z of [runwayNorth + 10, runwaySouth - 10]) {
    for (let index = -3; index <= 3; index += 1) {
      group.add(mesh(new THREE.BoxGeometry(2.1, 0.04, 7), markingMaterial, {
        x: layout.centerX + index * 3.1, y: 0.29, z
      }));
    }
  }

  for (const side of [-1, 1]) {
    for (let z = runwayNorth + 5; z <= runwaySouth - 5; z += 10) {
      const light = mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        edgeMaterial,
        { x: layout.centerX + side * (layout.runwayWidth * 0.5 + 1.1), y: 0.48, z }
      );
      light.material = light.material.clone();
      light.material.color.setHex(side < 0 ? 0x64d8ff : 0xffd166);
      group.add(light);
    }
  }
}

function createHangar() {
  const group = new THREE.Group();
  group.name = 'NorthwindHangar';
  const wall = new THREE.MeshStandardMaterial({ color: 0x33465e, metalness: 0.55, roughness: 0.42 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x91a8c2, metalness: 0.72, roughness: 0.3 });
  const door = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.45, roughness: 0.48 });

  group.add(mesh(new THREE.BoxGeometry(38, 12, 28), wall, { y: 6 }));
  const roof = mesh(new THREE.CylinderGeometry(19, 19, 28, 24, 1, false, 0, Math.PI), trim, { y: 12 });
  roof.rotation.x = Math.PI / 2;
  roof.rotation.z = Math.PI / 2;
  group.add(roof);
  group.add(mesh(new THREE.BoxGeometry(28, 9, 0.5), door, { y: 4.6, z: 14.2 }));
  for (const x of [-10.5, -3.5, 3.5, 10.5]) {
    group.add(mesh(new THREE.BoxGeometry(0.18, 8.6, 0.12), trim, { x, y: 4.6, z: 14.5 }));
  }
  group.add(mesh(new THREE.BoxGeometry(16, 1.2, 0.45), trim, { y: 10.2, z: 14.45 }));
  group.position.set(-165, 0.05, -277);
  return group;
}

function createControlTower() {
  const group = new THREE.Group();
  group.name = 'NorthwindControlTower';
  const concrete = new THREE.MeshStandardMaterial({ color: 0x56677d, roughness: 0.72 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1cc8e8,
    emissive: 0x063d52,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.78,
    metalness: 0.25,
    roughness: 0.18
  });
  group.add(mesh(new THREE.CylinderGeometry(3.4, 4.5, 18, 8), concrete, { y: 9 }));
  group.add(mesh(new THREE.CylinderGeometry(7, 5, 5, 8), glass, { y: 20 }));
  group.add(mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.7, 8), concrete, { y: 22.8 }));
  group.position.set(-48, 0, -300);
  return group;
}

function createWindsock() {
  const group = new THREE.Group();
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x8594a8, metalness: 0.8, roughness: 0.25 });
  const sockMaterial = new THREE.MeshBasicMaterial({ color: 0xff5a36, side: THREE.DoubleSide });
  group.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 8), poleMaterial, { y: 4 }));
  const sock = mesh(new THREE.ConeGeometry(0.8, 3.8, 12, 1, true), sockMaterial, { x: 1.8, y: 7.3 });
  sock.rotation.z = -Math.PI / 2;
  group.add(sock);
  group.position.set(-55, 0, -190);
  return group;
}

function createFuelDepot() {
  const group = new THREE.Group();
  group.name = 'NorthwindFuelDepot';
  const tankMaterial = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.72,
    roughness: 0.3
  });
  const hazardMaterial = new THREE.MeshBasicMaterial({ color: 0xf97316 });
  for (const x of [-4.2, 4.2]) {
    const tank = mesh(new THREE.CylinderGeometry(2.4, 2.4, 7, 16), tankMaterial, { x, y: 3.5 });
    tank.rotation.z = Math.PI / 2;
    group.add(tank);
    group.add(mesh(new THREE.BoxGeometry(0.35, 5.2, 0.15), hazardMaterial, { x, y: 3.5, z: 2.42 }));
  }
  group.position.set(-48, 0.1, -350);
  return group;
}

export function createAirfield(layout = AIRFIELD_LAYOUT) {
  const group = new THREE.Group();
  group.name = 'NorthwindMunicipalAirfield';

  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x29483d, roughness: 1 });
  const apronMaterial = new THREE.MeshStandardMaterial({ color: 0x46566a, roughness: 0.93 });
  const runwayMaterial = new THREE.MeshStandardMaterial({ color: 0x171c26, roughness: 0.88 });
  const taxiMaterial = new THREE.MeshStandardMaterial({ color: 0x252d3a, roughness: 0.9 });
  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf5c542 });

  group.add(mesh(new THREE.BoxGeometry(178, 0.08, 244), grassMaterial, {
    x: layout.centerX - 2, y: 0.02, z: layout.centerZ
  }));
  group.add(mesh(new THREE.BoxGeometry(60, 0.16, 80), apronMaterial, {
    x: -160, y: 0.1, z: -270
  }));
  group.add(mesh(new THREE.BoxGeometry(layout.runwayWidth, 0.28, layout.runwayLength), runwayMaterial, {
    x: layout.centerX, y: 0.14, z: layout.centerZ
  }));
  group.add(mesh(new THREE.BoxGeometry(56, 0.18, 12), taxiMaterial, {
    x: -139, y: 0.18, z: -238
  }));
  group.add(mesh(new THREE.BoxGeometry(54, 0.035, 0.5), lineMaterial, {
    x: -139, y: 0.3, z: -238
  }));
  createRunwayMarkings(group, layout);

  const hangar = createHangar();
  const tower = createControlTower();
  group.add(hangar, tower, createWindsock(), createFuelDepot());

  const beacon = new THREE.PointLight(0x34d9ff, 18, 70, 2);
  beacon.position.set(-48, 25, -300);
  group.add(beacon);

  group.userData.layout = layout;
  group.userData.staticColliders = Object.freeze([
    Object.freeze({ position: Object.freeze({ x: -165, y: 6.05, z: -277 }), size: Object.freeze({ x: 38, y: 12, z: 28 }), kind: 'airfield-hangar' }),
    Object.freeze({ position: Object.freeze({ x: -48, y: 11.5, z: -300 }), size: Object.freeze({ x: 14, y: 23, z: 14 }), kind: 'airfield-tower' }),
    Object.freeze({ position: Object.freeze({ x: -48, y: 3.6, z: -350 }), size: Object.freeze({ x: 14, y: 7, z: 5 }), kind: 'airfield-fuel-depot' })
  ]);
  return group;
}
