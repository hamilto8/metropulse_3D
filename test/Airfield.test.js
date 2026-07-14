import test from 'node:test';
import assert from 'node:assert/strict';

import { AIRFIELD_LAYOUT, createAirfield } from '../src/world/Airfield.js';

test('airfield occupies the northwest development parcel and keeps its runway in bounds', () => {
  const { bounds, centerX, centerZ, runwayLength, runwayWidth, aircraftStart } = AIRFIELD_LAYOUT;
  assert.ok(centerX < 0 && centerZ < -100);
  assert.ok(centerX - runwayWidth / 2 >= bounds.minX);
  assert.ok(centerX + runwayWidth / 2 <= bounds.maxX);
  assert.ok(centerZ - runwayLength / 2 >= bounds.minZ);
  assert.ok(centerZ + runwayLength / 2 <= bounds.maxZ);
  assert.ok(aircraftStart.z >= centerZ - runwayLength / 2);
  assert.ok(aircraftStart.z <= centerZ + runwayLength / 2);
});

test('airfield exposes named scenery and immutable obstacle metadata', () => {
  const airfield = createAirfield();
  assert.equal(airfield.name, 'NorthwindMunicipalAirfield');
  assert.ok(airfield.getObjectByName('NorthwindHangar'));
  assert.ok(airfield.getObjectByName('NorthwindControlTower'));
  assert.equal(airfield.userData.staticColliders.length, 3);
  assert.equal(Object.isFrozen(airfield.userData.staticColliders), true);
});
