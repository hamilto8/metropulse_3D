import {
  CONTROL_CONTEXTS,
  DEFAULT_KEYBOARD_MOUSE_BINDINGS,
  validateBindingOverrides
} from '../systems/ControlBindings.js';

export const SETTINGS_STORAGE_KEY = 'metropulse3d:settings:v1';
export const SETTINGS_SCHEMA_VERSION = 2;

export const SETTING_ENUMS = Object.freeze({
  reducedMotion: Object.freeze(['SYSTEM', 'REDUCE', 'FULL']),
  contrastMode: Object.freeze(['STANDARD', 'HIGH', 'DARK']),
  flashIntensity: Object.freeze(['FULL', 'REDUCED', 'OFF']),
  bloom: Object.freeze(['FULL', 'REDUCED', 'OFF']),
  toggleHold: Object.freeze(['HOLD', 'TOGGLE']),
  drivingSteering: Object.freeze(['STANDARD', 'ASSISTED']),
  difficulty: Object.freeze(['RELAXED', 'STANDARD', 'EXPERT'])
});

const DEFAULT_SETTINGS_VALUES = {
  mouseSensitivity: 1,
  cameraSensitivity: {
    orbit: 1,
    onFoot: 1,
    vehicle: 1
  },
  audio: {
    master: 0.5,
    music: 0.7,
    effects: 1,
    ambience: 0.8,
    dialogue: 1
  },
  subtitles: {
    enabled: true,
    speakerLabels: true,
    closedCaptions: true
  },
  textScale: 1,
  contrastMode: 'STANDARD',
  colorSafePatterns: true,
  motion: {
    reducedMotion: 'SYSTEM',
    cameraShake: 1,
    flashIntensity: 'FULL',
    bloom: 'FULL'
  },
  toggleHold: {
    sprint: 'HOLD',
    braking: 'HOLD',
    repeatedActions: 'HOLD'
  },
  drivingAssists: {
    steering: 'STANDARD',
    autoRecovery: true,
    brakingAssist: false
  },
  difficulty: 'STANDARD',
  timerLeniency: 1
};

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

export const DEFAULT_SETTINGS = deepFreeze(clone(DEFAULT_SETTINGS_VALUES));
export const DEFAULT_SETTINGS_DOCUMENT = deepFreeze({
  version: SETTINGS_SCHEMA_VERSION,
  settings: clone(DEFAULT_SETTINGS_VALUES),
  bindings: {}
});

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value;
}

function finiteRange(value, minimum, maximum, path) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be boolean.`);
  return value;
}

function enumeration(value, allowed, path) {
  if (!allowed.includes(value)) throw new RangeError(`${path} must be one of ${allowed.join(', ')}.`);
  return value;
}

function normalizedSettings(value) {
  const settings = record(value, 'settings');
  const camera = record(settings.cameraSensitivity, 'settings.cameraSensitivity');
  const audio = record(settings.audio, 'settings.audio');
  const subtitles = record(settings.subtitles, 'settings.subtitles');
  const motion = record(settings.motion, 'settings.motion');
  const toggleHold = record(settings.toggleHold, 'settings.toggleHold');
  const drivingAssists = record(settings.drivingAssists, 'settings.drivingAssists');
  return {
    mouseSensitivity: finiteRange(settings.mouseSensitivity, 0.2, 3, 'settings.mouseSensitivity'),
    cameraSensitivity: {
      orbit: finiteRange(camera.orbit, 0.2, 3, 'settings.cameraSensitivity.orbit'),
      onFoot: finiteRange(camera.onFoot, 0.2, 3, 'settings.cameraSensitivity.onFoot'),
      vehicle: finiteRange(camera.vehicle, 0.2, 3, 'settings.cameraSensitivity.vehicle')
    },
    audio: {
      master: finiteRange(audio.master, 0, 1, 'settings.audio.master'),
      music: finiteRange(audio.music, 0, 1, 'settings.audio.music'),
      effects: finiteRange(audio.effects, 0, 1, 'settings.audio.effects'),
      ambience: finiteRange(audio.ambience, 0, 1, 'settings.audio.ambience'),
      dialogue: finiteRange(audio.dialogue, 0, 1, 'settings.audio.dialogue')
    },
    subtitles: {
      enabled: boolean(subtitles.enabled, 'settings.subtitles.enabled'),
      speakerLabels: boolean(subtitles.speakerLabels, 'settings.subtitles.speakerLabels'),
      closedCaptions: boolean(subtitles.closedCaptions, 'settings.subtitles.closedCaptions')
    },
    textScale: finiteRange(settings.textScale, 0.8, 1.5, 'settings.textScale'),
    contrastMode: enumeration(settings.contrastMode, SETTING_ENUMS.contrastMode, 'settings.contrastMode'),
    colorSafePatterns: boolean(settings.colorSafePatterns, 'settings.colorSafePatterns'),
    motion: {
      reducedMotion: enumeration(motion.reducedMotion, SETTING_ENUMS.reducedMotion, 'settings.motion.reducedMotion'),
      cameraShake: finiteRange(motion.cameraShake, 0, 1, 'settings.motion.cameraShake'),
      flashIntensity: enumeration(motion.flashIntensity, SETTING_ENUMS.flashIntensity, 'settings.motion.flashIntensity'),
      bloom: enumeration(motion.bloom, SETTING_ENUMS.bloom, 'settings.motion.bloom')
    },
    toggleHold: {
      sprint: enumeration(toggleHold.sprint, SETTING_ENUMS.toggleHold, 'settings.toggleHold.sprint'),
      braking: enumeration(toggleHold.braking, SETTING_ENUMS.toggleHold, 'settings.toggleHold.braking'),
      repeatedActions: enumeration(toggleHold.repeatedActions, SETTING_ENUMS.toggleHold, 'settings.toggleHold.repeatedActions')
    },
    drivingAssists: {
      steering: enumeration(drivingAssists.steering, SETTING_ENUMS.drivingSteering, 'settings.drivingAssists.steering'),
      autoRecovery: boolean(drivingAssists.autoRecovery, 'settings.drivingAssists.autoRecovery'),
      brakingAssist: boolean(drivingAssists.brakingAssist, 'settings.drivingAssists.brakingAssist')
    },
    difficulty: enumeration(settings.difficulty, SETTING_ENUMS.difficulty, 'settings.difficulty'),
    timerLeniency: finiteRange(settings.timerLeniency, 1, 2, 'settings.timerLeniency')
  };
}

function migrateVersion1(value) {
  const settings = clone(DEFAULT_SETTINGS_VALUES);
  if (Number.isFinite(value?.textScale)) settings.textScale = Math.min(1.5, Math.max(0.8, value.textScale));
  if (SETTING_ENUMS.reducedMotion.includes(value?.reducedMotion)) {
    settings.motion.reducedMotion = value.reducedMotion;
  }
  return {
    version: SETTINGS_SCHEMA_VERSION,
    settings,
    bindings: {}
  };
}

export function validateSettingsDocument(value, { allowMigration = true } = {}) {
  record(value, 'settings document');
  const candidate = value.version === 1 && allowMigration ? migrateVersion1(value) : value;
  if (candidate.version !== SETTINGS_SCHEMA_VERSION) {
    throw new RangeError(`Unsupported settings version: ${candidate.version ?? '<missing>'}.`);
  }
  return deepFreeze({
    version: SETTINGS_SCHEMA_VERSION,
    settings: normalizedSettings(candidate.settings),
    bindings: validateBindingOverrides(candidate.bindings || {})
  });
}

export function createDefaultSettingsDocument() {
  return validateSettingsDocument(clone(DEFAULT_SETTINGS_DOCUMENT), { allowMigration: false });
}

export function getDefaultContextBindings(context) {
  if (!Object.values(CONTROL_CONTEXTS).includes(context)) throw new TypeError(`Unknown binding context: ${context}.`);
  return clone(DEFAULT_KEYBOARD_MOUSE_BINDINGS[context]);
}

