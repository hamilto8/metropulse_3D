const FULL_DAY_HOURS = 24;
const SUNRISE_HOUR = 6;

export const CELESTIAL_ORBIT = Object.freeze({
  radius: 1400,
  lateralDrift: 260,
  sunBodyRadius: 110,
  moonBodyRadius: 68,
  cameraFarPlane: 2200
});

function finiteOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function getCelestialAngles(timeVal, target = {}) {
  const hour = finiteOr(timeVal);
  const sun = ((hour - SUNRISE_HOUR) / FULL_DAY_HOURS) * Math.PI * 2;
  target.sun = sun;
  target.moon = sun + Math.PI;
  return target;
}

export function getCelestialOrbitPosition(
  timeVal,
  body,
  center = {},
  config = CELESTIAL_ORBIT,
  target = {}
) {
  const hour = finiteOr(timeVal);
  const sun = ((hour - SUNRISE_HOUR) / FULL_DAY_HOURS) * Math.PI * 2;
  const moon = sun + Math.PI;
  const isMoon = body === 'moon';
  const angle = isMoon ? moon : sun;
  const radius = Math.max(1, finiteOr(config?.radius, CELESTIAL_ORBIT.radius));
  const lateralDrift = Math.max(
    0,
    finiteOr(config?.lateralDrift, CELESTIAL_ORBIT.lateralDrift)
  );
  const centerX = finiteOr(center?.x);
  const centerZ = finiteOr(center?.z);
  const zDirection = isMoon ? -1 : 1;

  target.x = centerX + Math.cos(angle) * radius;
  target.y = Math.sin(angle) * radius;
  target.z = centerZ + zDirection * Math.sin(sun * 0.5) * lateralDrift;
  return target;
}

export function isCelestialBodyVisible(positionY, bodyRadius) {
  const y = finiteOr(positionY, Number.NEGATIVE_INFINITY);
  const radius = Math.max(0, finiteOr(bodyRadius));
  return y + radius > 0;
}
