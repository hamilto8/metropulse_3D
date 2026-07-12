import * as THREE from 'three';

export const TIME_OF_DAY_VISUALS = Object.freeze({
  nightStart: 17,
  fullNightStart: 19,
  fullNightEnd: 5,
  nightEnd: 7,
  dayExposure: 1.35,
  nightExposure: 1.46,
  dayBloomStrength: 0.34,
  nightBloomStrength: 0.38,
  dayBloomThreshold: 0.88,
  nightBloomThreshold: 0.86
});

export function normalizeHour(time) {
  const numeric = Number(time);
  if (!Number.isFinite(numeric)) return 12;
  return ((numeric % 24) + 24) % 24;
}

export function getNightFactor(time, config = TIME_OF_DAY_VISUALS) {
  const hour = normalizeHour(time);
  if (hour >= config.fullNightStart || hour < config.fullNightEnd) return 1;
  if (hour >= config.nightStart && hour < config.fullNightStart) {
    return THREE.MathUtils.smoothstep(hour, config.nightStart, config.fullNightStart);
  }
  if (hour >= config.fullNightEnd && hour < config.nightEnd) {
    return 1 - THREE.MathUtils.smoothstep(hour, config.fullNightEnd, config.nightEnd);
  }
  return 0;
}

export function getSkyPalette(time) {
  const hour = normalizeHour(time);
  const nightTop = new THREE.Color(0x080b20);
  const nightHorizon = new THREE.Color(0x1a2850);
  const dayTop = new THREE.Color(0x2f72d8);
  const dayHorizon = new THREE.Color(0x72b8ef);
  const dawnTop = new THREE.Color(0x5969a8);
  const dawnHorizon = new THREE.Color(0xf2a066);
  const duskTop = new THREE.Color(0x3b315f);
  const duskHorizon = new THREE.Color(0xd96879);

  if (hour >= 5 && hour < 7) {
    const progress = (hour - 5) / 2;
    const top = nightTop.clone().lerp(dawnTop, Math.min(1, progress * 2));
    const horizon = nightHorizon.clone().lerp(dawnHorizon, Math.min(1, progress * 2));
    if (progress > 0.5) {
      top.lerp(dayTop, (progress - 0.5) * 2);
      horizon.lerp(dayHorizon, (progress - 0.5) * 2);
    }
    return { top, horizon };
  }
  if (hour >= 7 && hour < 17) return { top: dayTop, horizon: dayHorizon };
  if (hour >= 17 && hour < 19) {
    const progress = (hour - 17) / 2;
    const top = dayTop.clone().lerp(duskTop, Math.min(1, progress * 2));
    const horizon = dayHorizon.clone().lerp(duskHorizon, Math.min(1, progress * 2));
    if (progress > 0.5) {
      top.lerp(nightTop, (progress - 0.5) * 2);
      horizon.lerp(nightHorizon, (progress - 0.5) * 2);
    }
    return { top, horizon };
  }
  return { top: nightTop, horizon: nightHorizon };
}

export function applyWeatherToSky(palette, weatherMode) {
  const top = palette.top.clone();
  const horizon = palette.horizon.clone();
  if (weatherMode === 'mist') {
    top.lerp(new THREE.Color(0x23324b), 0.38);
    horizon.lerp(new THREE.Color(0x53647a), 0.46);
  } else if (weatherMode === 'rain') {
    top.lerp(new THREE.Color(0x18263a), 0.48);
    horizon.lerp(new THREE.Color(0x354a62), 0.52);
  } else if (weatherMode === 'thunderstorm') {
    top.lerp(new THREE.Color(0x101827), 0.62);
    horizon.lerp(new THREE.Color(0x26354a), 0.6);
  }
  return { top, horizon };
}
