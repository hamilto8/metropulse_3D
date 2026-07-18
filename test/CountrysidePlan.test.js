import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  canPlaceCountrysideStructure,
  COUNTRYSIDE_GRID,
  COUNTRYSIDE_RESERVATIONS,
  createSuburbanParcels,
  footprintsOverlap,
  getFootprintEnvelope,
  SUBURBAN_HOME_RULES
} from '../src/world/CountrysidePlan.js';
import { CityBuilder } from '../src/world/CityBuilder.js';
import { CityEditorSystem } from '../src/world/CityEditorSystem.js';

test('suburban parcels follow the authored grid and never overlap reserved land', () => {
  const parcels = createSuburbanParcels();

  assert.equal(parcels.length, 17);
  assert.equal(parcels.some(parcel => parcel.x === 700 && parcel.z === -125), false);

  for (const parcel of parcels) {
    assert.ok(COUNTRYSIDE_GRID.residentialColumnCenters.includes(parcel.x));
    assert.ok(COUNTRYSIDE_GRID.residentialRowCenters.includes(parcel.z));
    assert.ok([0, Math.PI].includes(parcel.rotationY));

    const envelope = getFootprintEnvelope(
      parcel,
      SUBURBAN_HOME_RULES.footprint,
      { rotationY: parcel.rotationY, setback: SUBURBAN_HOME_RULES.roadSetback }
    );
    assert.ok(envelope, `missing envelope for ${parcel.id}`);
    assert.equal(
      COUNTRYSIDE_RESERVATIONS.some(reservation => footprintsOverlap(envelope, reservation)),
      false,
      `${parcel.id} overlaps reserved land`
    );
  }
});

test('placement rules reject the rocket access road and malformed footprints', () => {
  const footprint = SUBURBAN_HOME_RULES.footprint;

  assert.equal(canPlaceCountrysideStructure({ x: 700, z: -125 }, footprint), false);
  assert.equal(canPlaceCountrysideStructure({ x: 500, z: -125 }, footprint), true);
  assert.equal(canPlaceCountrysideStructure({ x: Number.NaN, z: -125 }, footprint), false);
  assert.equal(canPlaceCountrysideStructure({ x: 500, z: -125 }, { width: -1, depth: 8 }), false);
});

test('generated suburban homes occupy valid unique parcels without road overlap', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const scene = new THREE.Scene();
    const builder = new CityBuilder(scene, null, null);
    builder.createCountrysideSuburb();

    const homes = scene.children.filter(child => child.userData.landUse === 'SUBURBAN_RESIDENTIAL');
    assert.equal(homes.length, 17);
    assert.equal(new Set(homes.map(home => home.userData.parcelId)).size, homes.length);
    assert.equal(homes.some(home => home.position.x === 700 && home.position.z === -125), false);
    assert.equal(builder.sceneryColliders.filter(collider => collider.kind === 'suburban-house').length, 17);

    for (const home of homes) {
      const envelope = getFootprintEnvelope(
        home.position,
        SUBURBAN_HOME_RULES.footprint,
        { rotationY: home.rotation.y, setback: SUBURBAN_HOME_RULES.roadSetback }
      );
      assert.equal(
        COUNTRYSIDE_RESERVATIONS.some(reservation => footprintsOverlap(envelope, reservation)),
        false,
        `${home.userData.parcelId} was generated on reserved land`
      );
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('occupied parcel envelopes prevent duplicate construction', () => {
  const builder = new CityBuilder(new THREE.Scene(), null, null);

  assert.ok(builder.createSuburbanHouse(500, 25));
  assert.equal(builder.createSuburbanHouse(500, 25), null);
  assert.equal(builder.createSuburbanHouse(700, -125), null);
  assert.equal(builder.sceneryColliders.length, 1);
});

test('city-editor placement treats authored countryside scenery as occupied land', () => {
  const builder = new CityBuilder(new THREE.Scene(), null, null);
  builder.createSuburbanHouse(500, 25);
  const editor = Object.create(CityEditorSystem.prototype);
  editor.app = {
    cityBuilder: builder,
    buildingFactory: { buildings: [] }
  };
  editor.selectedSpec = { id: 'TEST_STRUCTURE', footprint: { width: 12, depth: 12 } };
  editor.rotationY = 0;

  const terrainY = builder.getHillHeight(500, 25);
  assert.equal(editor.checkPlacementValidity(500, 25, terrainY), false);
  assert.equal(editor.isPlacementValid({
    spec: editor.selectedSpec,
    x: 500,
    z: 25,
    y: terrainY,
    allowCountrysideReplacement: true,
    ignorePlayer: true
  }), true);
});

test('legacy structure restore can clear only overlapping procedural scenery', () => {
  const scene = new THREE.Scene();
  const builder = new CityBuilder(scene, null, null);
  const house = builder.createSuburbanHouse(500, 25);
  const untouchedHouse = builder.createSuburbanHouse(600, 25);
  const conflicts = builder.getCountrysideOccupancyConflicts({
    minX: 480,
    maxX: 520,
    minZ: 5,
    maxZ: 45
  });

  assert.equal(conflicts.length, 1);
  const removed = builder.removeCountrysideSceneryOverlapping(conflicts[0]);
  assert.equal(removed.length, 1);
  assert.equal(scene.children.includes(house), false);
  assert.equal(scene.children.includes(untouchedHouse), true);
  assert.equal(builder.countrysideOccupancy.some(envelope => envelope.id === 'suburban-500-25'), false);
  assert.equal(builder.countrysideOccupancy.some(envelope => envelope.id === 'suburban-600-25'), true);
});

test('zoning overlays stay editor-only and conform to rolling terrain', () => {
  const scene = new THREE.Scene();
  const editor = new CityEditorSystem({
    sceneManager: {
      scene,
      camera: new THREE.PerspectiveCamera(),
      renderer: { domElement: {} }
    },
    cityBuilder: {
      getHillHeight(x, z) {
        return x * 0.01 + Math.sin(z * 0.1);
      }
    }
  });

  assert.equal(editor.zoneOverlayGroup.visible, false);
  editor.isActive = true;
  editor.zoningMode = 'COMMERCIAL';
  assert.equal(editor.syncZoneOverlayVisibility(), true);

  const mesh = editor.createZoneOverlayMesh(500, 25, {
    id: 'COMMERCIAL',
    color: 0xd946ef
  });
  const heights = [];
  const positions = mesh.geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) heights.push(positions.getY(index));

  assert.equal(mesh.userData.zoneType, 'COMMERCIAL');
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.5);
  editor.isActive = false;
  assert.equal(editor.syncZoneOverlayVisibility(), false);
});
