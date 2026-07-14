const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/**
 * Converts flight telemetry into a stable procedural-audio mix. Keeping this
 * renderer-agnostic makes the sound response deterministic and testable.
 */
export function getPropellerAudioProfile(state = {}, maxSpeed = 64) {
  const throttle = clamp(finite(state.throttle), 0, 1);
  const speedRatio = clamp(Math.abs(finite(state.speed)) / Math.max(1, finite(maxSpeed, 64)), 0, 1);
  const crashed = Boolean(state.crashed);
  const grounded = state.grounded !== false;
  const rpmRatio = crashed ? 0 : clamp(0.18 + throttle * 0.72 + speedRatio * 0.1, 0.18, 1);
  const airflow = grounded ? speedRatio * 0.38 : speedRatio;

  return Object.freeze({
    rpmRatio,
    engineFrequency: 38 + rpmRatio * 76,
    harmonicFrequency: 76 + rpmRatio * 152,
    bladeFrequency: 54 + rpmRatio * 142,
    filterFrequency: 320 + rpmRatio * 1080 + speedRatio * 240,
    engineGain: crashed ? 0.001 : 0.035 + rpmRatio * 0.085,
    propellerGain: crashed ? 0.001 : 0.018 + rpmRatio * 0.09,
    airflowGain: crashed ? 0.001 : 0.004 + airflow * 0.075
  });
}
