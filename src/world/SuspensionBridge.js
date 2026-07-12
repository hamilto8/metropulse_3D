import * as THREE from 'three';

export const SUSPENSION_BRIDGE_LAYOUT = Object.freeze({
  deckStartX: 110,
  deckEndX: 210,
  centerX: 160,
  deckWidth: 18,
  cableZ: 8,
  westTowerX: 138,
  eastTowerX: 182,
  towerCableY: 62,
  centerCableY: 14,
  anchorCableY: 3.2,
  sideSpanSag: 6.5,
  hangerDeckY: 1.15,
  hangerSpacing: 5
});

export function getSuspensionCableHeight(x, layout = SUSPENSION_BRIDGE_LAYOUT) {
  const safeX = THREE.MathUtils.clamp(
    Number.isFinite(x) ? x : layout.centerX,
    layout.deckStartX,
    layout.deckEndX
  );
  if (safeX <= layout.westTowerX) {
    const span = layout.westTowerX - layout.deckStartX;
    const t = (safeX - layout.deckStartX) / span;
    const chord = THREE.MathUtils.lerp(layout.anchorCableY, layout.towerCableY, t);
    return chord - layout.sideSpanSag * 4 * t * (1 - t);
  }
  if (safeX >= layout.eastTowerX) {
    const span = layout.deckEndX - layout.eastTowerX;
    const t = (safeX - layout.eastTowerX) / span;
    const chord = THREE.MathUtils.lerp(layout.towerCableY, layout.anchorCableY, t);
    return chord - layout.sideSpanSag * 4 * t * (1 - t);
  }

  const t = (safeX - layout.westTowerX) / (layout.eastTowerX - layout.westTowerX);
  const centered = t * 2 - 1;
  return layout.centerCableY
    + (layout.towerCableY - layout.centerCableY) * centered * centered;
}

function createVerticalCylinder(radius, startY, endY, x, z, material, name) {
  const height = Math.max(0.05, endY - startY);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 8),
    material
  );
  mesh.name = name;
  mesh.position.set(x, startY + height * 0.5, z);
  mesh.castShadow = true;
  return mesh;
}

function addTower(group, x, materials, layout) {
  const tower = new THREE.Group();
  tower.name = `suspension-tower-${x}`;
  const legGeometry = new THREE.BoxGeometry(2.5, 64, 2.5);
  for (const z of [-layout.cableZ, layout.cableZ]) {
    const leg = new THREE.Mesh(legGeometry, materials.tower);
    leg.position.set(x, 32, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    tower.add(leg);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.1, 1.2, 3.1), materials.towerHighlight);
    cap.position.set(x, 64.4, z);
    tower.add(cap);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), materials.beacon);
    beacon.position.set(x, 65.65, z);
    beacon.name = 'tower-beacon';
    tower.add(beacon);

    const saddle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.58, 3.2, 10),
      materials.saddle
    );
    saddle.rotation.z = Math.PI / 2;
    saddle.position.set(x, layout.towerCableY, z);
    saddle.name = 'cable-saddle';
    tower.add(saddle);
  }

  for (const y of [22, 43.5, 61.2]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 19), materials.tower);
    beam.position.set(x, y, 0);
    beam.castShadow = true;
    tower.add(beam);

    const inset = new THREE.Mesh(new THREE.BoxGeometry(3.08, 0.55, 13.2), materials.towerShadow);
    inset.position.set(x, y, 0);
    tower.add(inset);
  }
  group.add(tower);
}

function addCableSystem(group, z, materials, layout) {
  const points = [];
  for (let x = layout.deckStartX; x <= layout.deckEndX; x += 1) {
    points.push(new THREE.Vector3(x, getSuspensionCableHeight(x, layout), z));
  }
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 160, 0.34, 8, false),
    materials.cable
  );
  cable.name = z < 0 ? 'main-cable-north' : 'main-cable-south';
  cable.castShadow = true;
  cable.userData.controlPoints = points;
  group.add(cable);

  for (
    let x = layout.deckStartX + layout.hangerSpacing;
    x < layout.deckEndX;
    x += layout.hangerSpacing
  ) {
    if (
      Math.abs(x - layout.westTowerX) < 2.6
      || Math.abs(x - layout.eastTowerX) < 2.6
    ) continue;
    const cableY = getSuspensionCableHeight(x, layout);
    const hanger = createVerticalCylinder(
      0.11,
      layout.hangerDeckY,
      cableY,
      x,
      z,
      materials.hanger,
      'vertical-hanger'
    );
    hanger.userData.deckY = layout.hangerDeckY;
    hanger.userData.cableY = cableY;
    group.add(hanger);
  }

  for (const x of [layout.deckStartX, layout.deckEndX]) {
    const anchorage = new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 3.4), materials.anchorage);
    anchorage.position.set(x, 1.2, z);
    anchorage.name = 'cable-anchorage';
    anchorage.castShadow = true;
    anchorage.receiveShadow = true;
    group.add(anchorage);

    const anchorCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), materials.saddle);
    anchorCap.position.set(x, layout.anchorCableY, z);
    anchorCap.name = 'anchor-saddle';
    group.add(anchorCap);
  }
}

export function createSuspensionBridge(layout = SUSPENSION_BRIDGE_LAYOUT) {
  const group = new THREE.Group();
  group.name = 'grand-suspension-bridge';
  group.userData.layout = layout;

  const materials = {
    deck: new THREE.MeshStandardMaterial({ color: 0x222633, roughness: 0.8 }),
    line: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0x3b455a, roughness: 0.75 }),
    edge: new THREE.MeshStandardMaterial({ color: 0x6e1f2d, roughness: 0.45, metalness: 0.45 }),
    tower: new THREE.MeshStandardMaterial({ color: 0xc9334d, roughness: 0.35, metalness: 0.5 }),
    towerHighlight: new THREE.MeshStandardMaterial({ color: 0xe05266, roughness: 0.3, metalness: 0.45 }),
    towerShadow: new THREE.MeshStandardMaterial({ color: 0x781d34, roughness: 0.5, metalness: 0.35 }),
    cable: new THREE.MeshStandardMaterial({ color: 0xc7d5df, metalness: 0.82, roughness: 0.28 }),
    hanger: new THREE.MeshStandardMaterial({ color: 0x899ca9, metalness: 0.72, roughness: 0.35 }),
    saddle: new THREE.MeshStandardMaterial({ color: 0xe5edf2, metalness: 0.9, roughness: 0.22 }),
    anchorage: new THREE.MeshStandardMaterial({ color: 0x586274, roughness: 0.78 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff5a4f })
  };

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(layout.deckEndX - layout.deckStartX, 1, layout.deckWidth),
    materials.deck
  );
  deck.name = 'suspension-bridge-deck';
  deck.position.set(layout.centerX, -0.45, 0);
  deck.receiveShadow = true;
  group.add(deck);

  const centerLine = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.deckEndX - layout.deckStartX, 0.4),
    materials.line
  );
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(layout.centerX, 0.06, 0);
  group.add(centerLine);

  for (const z of [-7.5, 7.5]) {
    const sidewalk = new THREE.Mesh(
      new THREE.BoxGeometry(layout.deckEndX - layout.deckStartX, 0.4, 3),
      materials.sidewalk
    );
    sidewalk.position.set(layout.centerX, 0.15, z);
    sidewalk.receiveShadow = true;
    group.add(sidewalk);

    const edgeGirder = new THREE.Mesh(
      new THREE.BoxGeometry(layout.deckEndX - layout.deckStartX, 1.1, 0.65),
      materials.edge
    );
    edgeGirder.position.set(layout.centerX, 0.35, z < 0 ? -8.8 : 8.8);
    edgeGirder.castShadow = true;
    group.add(edgeGirder);
  }

  addTower(group, layout.westTowerX, materials, layout);
  addTower(group, layout.eastTowerX, materials, layout);
  addCableSystem(group, -layout.cableZ, materials, layout);
  addCableSystem(group, layout.cableZ, materials, layout);
  return group;
}
