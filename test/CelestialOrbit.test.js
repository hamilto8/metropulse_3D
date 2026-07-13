import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELESTIAL_ORBIT,
  getCelestialAngles,
  getCelestialOrbitPosition,
  isCelestialBodyVisible
} from '../src/world/CelestialOrbit.js';

test('sunrise and sunset place celestial bodies beyond the playable terrain', () => {
  const center = { x: 120, z: 40 };
  const sunriseSun = getCelestialOrbitPosition(6, 'sun', center);
  const sunriseMoon = getCelestialOrbitPosition(6, 'moon', center);
  const sunsetSun = getCelestialOrbitPosition(18, 'sun', center);

  assert.equal(sunriseSun.x, center.x + CELESTIAL_ORBIT.radius);
  assert.ok(Math.abs(sunriseSun.y) < 1e-9);
  assert.equal(sunriseMoon.x, center.x - CELESTIAL_ORBIT.radius);
  assert.equal(sunsetSun.x, center.x - CELESTIAL_ORBIT.radius);
  assert.ok(CELESTIAL_ORBIT.radius > 900);
  assert.ok(
    CELESTIAL_ORBIT.cameraFarPlane
      > CELESTIAL_ORBIT.radius + CELESTIAL_ORBIT.sunBodyRadius
  );
});

test('sun and moon remain opposite and orbit helpers sanitize malformed input', () => {
  const target = {};
  const angles = getCelestialAngles(12, target);
  assert.equal(angles, target);
  assert.ok(Math.abs((angles.moon - angles.sun) - Math.PI) < 1e-9);

  const malformed = getCelestialOrbitPosition(Number.NaN, 'sun', { x: 'bad', z: null });
  assert.ok(Number.isFinite(malformed.x));
  assert.ok(Number.isFinite(malformed.y));
  assert.ok(Number.isFinite(malformed.z));
});

test('celestial visibility follows the top edge crossing the horizon', () => {
  assert.equal(isCelestialBodyVisible(-111, CELESTIAL_ORBIT.sunBodyRadius), false);
  assert.equal(isCelestialBodyVisible(-109, CELESTIAL_ORBIT.sunBodyRadius), true);
  assert.equal(isCelestialBodyVisible(Number.NaN, CELESTIAL_ORBIT.sunBodyRadius), false);
});
