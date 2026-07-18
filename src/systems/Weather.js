export const DEFAULT_WEATHER_MODE = 'clear';

/**
 * Canonical weather metadata shared by simulation, rendering, physics, and UI.
 * Add new modes here; the automatic cycle follows declaration order.
 */
export const WEATHER_DEFINITIONS = Object.freeze({
  clear: Object.freeze({
    id: 'clear',
    durationSeconds: 45,
    fogDensity: 0.0035,
    rainOpacity: 0,
    wetness: 0,
    groundFriction: 0.85,
    gripMultiplier: 1,
    statusText: '☀️ CLEAR'
  }),
  mist: Object.freeze({
    id: 'mist',
    durationSeconds: 30,
    fogDensity: 0.015,
    rainOpacity: 0,
    wetness: 0.12,
    groundFriction: 0.55,
    gripMultiplier: 0.72,
    statusText: '🌫️ MIST'
  }),
  rain: Object.freeze({
    id: 'rain',
    durationSeconds: 40,
    fogDensity: 0.008,
    rainOpacity: 0.6,
    wetness: 0.72,
    groundFriction: 0.28,
    gripMultiplier: 0.48,
    statusText: '🌧️ RAIN'
  }),
  thunderstorm: Object.freeze({
    id: 'thunderstorm',
    durationSeconds: 28,
    fogDensity: 0.012,
    rainOpacity: 0.85,
    wetness: 1,
    groundFriction: 0.22,
    gripMultiplier: 0.38,
    statusText: '⛈️ STORM'
  })
});

export const WEATHER_SEQUENCE = Object.freeze(Object.keys(WEATHER_DEFINITIONS));

const TOTAL_CYCLE_DURATION = WEATHER_SEQUENCE.reduce(
  (total, mode) => total + WEATHER_DEFINITIONS[mode].durationSeconds,
  0
);

export function normalizeWeatherMode(mode) {
  return Object.hasOwn(WEATHER_DEFINITIONS, mode) ? mode : DEFAULT_WEATHER_MODE;
}

export function getWeatherDefinition(mode) {
  return WEATHER_DEFINITIONS[normalizeWeatherMode(mode)];
}

export function getNextWeatherMode(mode) {
  const currentIndex = WEATHER_SEQUENCE.indexOf(normalizeWeatherMode(mode));
  return WEATHER_SEQUENCE[(currentIndex + 1) % WEATHER_SEQUENCE.length];
}

/**
 * Advances the renderer-independent weather clock. Large deltas are folded
 * across complete cycles so suspended or slow frames remain deterministic.
 */
export function stepWeatherCycle(mode, remainingSeconds, deltaSeconds, enabled = true) {
  let currentMode = normalizeWeatherMode(mode);
  let remaining = Number.isFinite(remainingSeconds) && remainingSeconds > 0
    ? remainingSeconds
    : getWeatherDefinition(currentMode).durationSeconds;

  if (!enabled) {
    return { mode: currentMode, remainingSeconds: 0, transitions: 0 };
  }

  let elapsed = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  if (elapsed < remaining) {
    return {
      mode: currentMode,
      remainingSeconds: remaining - elapsed,
      transitions: 0
    };
  }

  elapsed -= remaining;
  currentMode = getNextWeatherMode(currentMode);
  remaining = getWeatherDefinition(currentMode).durationSeconds;
  let transitions = 1;

  if (elapsed >= TOTAL_CYCLE_DURATION) {
    const completeCycles = Math.floor(elapsed / TOTAL_CYCLE_DURATION);
    elapsed %= TOTAL_CYCLE_DURATION;
    transitions += completeCycles * WEATHER_SEQUENCE.length;
  }

  while (elapsed >= remaining) {
    elapsed -= remaining;
    currentMode = getNextWeatherMode(currentMode);
    remaining = getWeatherDefinition(currentMode).durationSeconds;
    transitions += 1;
  }

  return {
    mode: currentMode,
    remainingSeconds: remaining - elapsed,
    transitions
  };
}
