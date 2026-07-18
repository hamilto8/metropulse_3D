export const BOOT_SETTINGS_KEY = 'metropulse3d:settings:v1';
export const BOOT_SETTINGS_VERSION = 1;

export const DEFAULT_BOOT_SETTINGS = Object.freeze({
  version: BOOT_SETTINGS_VERSION,
  reducedMotion: 'SYSTEM',
  textScale: 1
});

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Settings must be an object.');
  }
  if (value.version !== BOOT_SETTINGS_VERSION) {
    throw new RangeError(`Unsupported settings version: ${value.version ?? '<missing>'}`);
  }

  return Object.freeze({
    ...DEFAULT_BOOT_SETTINGS,
    reducedMotion: ['SYSTEM', 'REDUCE', 'FULL'].includes(value.reducedMotion)
      ? value.reducedMotion
      : DEFAULT_BOOT_SETTINGS.reducedMotion,
    textScale: Number.isFinite(value.textScale)
      ? Math.min(1.5, Math.max(0.8, value.textScale))
      : DEFAULT_BOOT_SETTINGS.textScale
  });
}

/**
 * Phase 2.1 bootstrap reader only. P2.3 will replace this narrow schema with
 * the complete settings/bindings store without changing the boot contract.
 */
export class SettingsBootstrap {
  constructor({ storage = getDefaultStorage() } = {}) {
    this.storage = storage;
  }

  load() {
    const warnings = [];
    let settings = DEFAULT_BOOT_SETTINGS;
    try {
      const raw = this.storage?.getItem?.(BOOT_SETTINGS_KEY);
      if (raw) settings = normalizeSettings(JSON.parse(raw));
    } catch (error) {
      warnings.push(`Saved settings were ignored: ${error?.message || String(error)}`);
    }
    return Object.freeze({ settings, warnings: Object.freeze(warnings) });
  }
}

export { normalizeSettings as validateBootSettings };

export default SettingsBootstrap;
