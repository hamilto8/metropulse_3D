import * as THREE from 'three';
import { createBridgeBarrierColliders } from './BridgeSafety.js';

export const COMPACT_BRIDGE_THEMES = Object.freeze({
  CYAN: Object.freeze({ tower: 0x176b87, towerDark: 0x0f3e56, cable: 0xa5f3fc, accent: 0x22d3ee }),
  AMBER: Object.freeze({ tower: 0x8a4b2a, towerDark: 0x4b2b22, cable: 0xffe4b5, accent: 0xf59e0b }),
  VIOLET: Object.freeze({ tower: 0x5b4c9f, towerDark: 0x312e61, cable: 0xe9d5ff, accent: 0xd946ef })
});

const MATERIAL_CACHE = new Map();

function getMaterials(themeName) {
  const normalizedName = Object.hasOwn(COMPACT_BRIDGE_THEMES, themeName) ? themeName : 'CYAN';
  if (MATERIAL_CACHE.has(normalizedName)) return MATERIAL_CACHE.get(normalizedName);
  const theme = COMPACT_BRIDGE_THEMES[normalizedName];
  const materials = Object.freeze({
    deck: new THREE.MeshStandardMaterial({ color: 0x23293a, roughness: 0.82 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0x48556b, roughness: 0.72 }),
    line: new THREE.MeshBasicMaterial({ color: 0xffd84d }),
    tower: new THREE.MeshStandardMaterial({ color: theme.tower, metalness: 0.45, roughness: 0.38 }),
    towerDark: new THREE.MeshStandardMaterial({ color: theme.towerDark, metalness: 0.35, roughness: 0.48 }),
    cable: new THREE.MeshStandardMaterial({ color: theme.cable, metalness: 0.78, roughness: 0.25 }),
    accent: new THREE.MeshBasicMaterial({ color: theme.accent })
  });
  MATERIAL_CACHE.set(normalizedName, materials);
  return materials;
}

function verticalMember(radius, bottomY, topY, x, z, material, name) {
  const height = Math.max(0.05, topY - bottomY);
  const member = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 8),
    material
  );
  member.name = name;
  member.position.set(x, bottomY + height * 0.5, z);
  member.castShadow = true;
  return member;
}

export function getCompactCableHeight(x, layout) {
  const halfLength = layout.length * 0.5;
  const safeX = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0, -halfLength, halfLength);
  const absoluteX = Math.abs(safeX);
  if (absoluteX <= layout.towerOffset) {
    const ratio = absoluteX / layout.towerOffset;
    return layout.centerCableHeight
      + (layout.towerHeight - layout.centerCableHeight) * ratio * ratio;
  }

  const sideSpan = halfLength - layout.towerOffset;
  const ratio = (absoluteX - layout.towerOffset) / sideSpan;
  const chord = THREE.MathUtils.lerp(layout.towerHeight, layout.anchorHeight, ratio);
  return chord - layout.sideSpanSag * 4 * ratio * (1 - ratio);
}

function addTower(group, x, layout, materials) {
  const cableZ = layout.width * 0.5 - 0.45;
  const tower = new THREE.Group();
  tower.name = 'compact-suspension-tower';
  for (const z of [-cableZ, cableZ]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(layout.towerLegWidth, layout.towerHeight, layout.towerLegWidth),
      materials.tower
    );
    leg.name = 'compact-tower-leg';
    leg.position.set(x, layout.deckHeight + layout.towerHeight * 0.5, z);
    leg.castShadow = true;
    tower.add(leg);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), materials.accent);
    beacon.name = 'compact-tower-beacon';
    beacon.position.set(x, layout.deckHeight + layout.towerHeight + 0.25, z);
    tower.add(beacon);
  }

  const crossbeam = new THREE.Mesh(
    new THREE.BoxGeometry(layout.towerLegWidth * 1.25, 0.42, layout.width - 0.9),
    materials.towerDark
  );
  crossbeam.name = 'compact-tower-crossbeam';
  crossbeam.position.set(x, layout.deckHeight + layout.towerHeight - 0.65, 0);
  crossbeam.castShadow = true;
  tower.add(crossbeam);
  group.add(tower);
}

function addGuardrail(group, side, layout, materials) {
  const z = side * (layout.width * 0.5 - 0.3);
  const railHeight = layout.deckHeight + layout.barrierHeight - 0.12;
  const railLevels = [
    { height: layout.deckHeight + 0.42, thickness: 0.28, material: materials.towerDark },
    { height: railHeight, thickness: 0.18, material: materials.tower }
  ];
  for (const { height, thickness, material } of railLevels) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(layout.length, thickness, 0.24),
      material
    );
    rail.name = 'compact-bridge-guardrail';
    rail.position.set(0, height, z);
    rail.castShadow = true;
    group.add(rail);
  }

  const postSpacing = Math.max(3.5, layout.length / Math.ceil(layout.length / 5));
  for (let x = -layout.length * 0.5; x <= layout.length * 0.5 + 0.01; x += postSpacing) {
    group.add(verticalMember(
      0.1,
      layout.deckHeight + 0.35,
      railHeight,
      x,
      z,
      materials.tower,
      'compact-guardrail-post'
    ));
  }
}

function addCableSystem(group, side, layout, materials) {
  const z = side * (layout.width * 0.5 - 0.45);
  const points = [];
  const segments = Math.max(40, Math.round(layout.length));
  for (let index = 0; index <= segments; index += 1) {
    const x = THREE.MathUtils.lerp(-layout.length * 0.5, layout.length * 0.5, index / segments);
    points.push(new THREE.Vector3(x, layout.deckHeight + getCompactCableHeight(x, layout), z));
  }
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), segments, 0.12, 7, false),
    materials.cable
  );
  cable.name = side < 0 ? 'compact-main-cable-north' : 'compact-main-cable-south';
  cable.userData.controlPoints = points;
  cable.castShadow = true;
  group.add(cable);

  const hangerBottom = layout.deckHeight + layout.barrierHeight;
  for (
    let x = -layout.towerOffset + layout.hangerSpacing;
    x < layout.towerOffset;
    x += layout.hangerSpacing
  ) {
    const cableHeight = layout.deckHeight + getCompactCableHeight(x, layout);
    if (cableHeight <= hangerBottom + 0.1) continue;
    group.add(verticalMember(
      0.055,
      hangerBottom,
      cableHeight,
      x,
      z,
      materials.cable,
      'compact-vertical-hanger'
    ));
  }
}

export function createCompactSuspensionBridge(options = {}) {
  const length = Number.isFinite(options.length) ? Math.max(24, options.length) : 40;
  const width = Number.isFinite(options.width) ? Math.max(10, options.width) : 16;
  const deckHeight = Number.isFinite(options.deckHeight) ? options.deckHeight : 0;
  const profile = options.profile === 'SELF_ANCHORED' ? 'SELF_ANCHORED' : 'CLASSIC';
  const towerHeight = Number.isFinite(options.towerHeight)
    ? Math.max(4.8, options.towerHeight)
    : (profile === 'SELF_ANCHORED' ? 6.5 : 8.5);
  const layout = Object.freeze({
    id: String(options.id || 'compact-bridge'),
    centerX: Number.isFinite(options.centerX) ? options.centerX : 0,
    centerZ: Number.isFinite(options.centerZ) ? options.centerZ : 0,
    length,
    width,
    drivableWidth: Number.isFinite(options.drivableWidth)
      ? Math.min(width, Math.max(6, options.drivableWidth))
      : width - 2,
    deckHeight,
    profile,
    towerHeight,
    towerOffset: length * (profile === 'SELF_ANCHORED' ? 0.3 : 0.27),
    towerLegWidth: profile === 'SELF_ANCHORED' ? 0.75 : 0.95,
    centerCableHeight: profile === 'SELF_ANCHORED' ? 2.35 : 2.7,
    anchorHeight: 1.65,
    sideSpanSag: profile === 'SELF_ANCHORED' ? 0.7 : 1.15,
    hangerSpacing: length > 60 ? 5 : 3.5,
    barrierHeight: Number.isFinite(options.barrierHeight)
      ? Math.max(1.8, options.barrierHeight)
      : 2.2
  });
  const materials = getMaterials(String(options.theme || 'CYAN').toUpperCase());
  const group = new THREE.Group();
  group.name = `compact-suspension-bridge-${layout.id}`;
  group.position.set(layout.centerX, 0, layout.centerZ);
  group.userData.layout = layout;
  group.userData.barrierColliders = createBridgeBarrierColliders({
    centerX: layout.centerX,
    centerZ: layout.centerZ,
    length: layout.length,
    width: layout.width,
    deckHeight: layout.deckHeight,
    barrierHeight: layout.barrierHeight,
    bridgeId: layout.id
  });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, 1, width), materials.deck);
  deck.name = 'compact-suspension-deck';
  deck.position.y = deckHeight - 0.5;
  deck.receiveShadow = true;
  group.add(deck);

  const line = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.38), materials.line);
  line.name = 'compact-bridge-centerline';
  line.rotation.x = -Math.PI / 2;
  line.position.y = deckHeight + 0.012;
  group.add(line);

  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.22, 1.4),
      materials.sidewalk
    );
    sidewalk.name = 'compact-bridge-sidewalk';
    sidewalk.position.set(0, deckHeight + 0.11, side * (width * 0.5 - 1.05));
    sidewalk.receiveShadow = true;
    group.add(sidewalk);
    addGuardrail(group, side, layout, materials);
    addCableSystem(group, side, layout, materials);
  }
  addTower(group, -layout.towerOffset, layout, materials);
  addTower(group, layout.towerOffset, layout, materials);
  return group;
}
