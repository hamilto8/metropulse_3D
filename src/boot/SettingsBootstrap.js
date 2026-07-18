import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  validateSettingsDocument
} from '../settings/SettingsSchema.js';
import { SettingsStore } from '../settings/SettingsStore.js';

// Compatibility names retained for boot consumers while the implementation is
// now the complete P2.3 store rather than a second, narrow settings schema.
export const BOOT_SETTINGS_KEY = SETTINGS_STORAGE_KEY;
export const BOOT_SETTINGS_VERSION = SETTINGS_SCHEMA_VERSION;
export const DEFAULT_BOOT_SETTINGS = DEFAULT_SETTINGS;

export class SettingsBootstrap extends SettingsStore {}

export function validateBootSettings(value) {
  return validateSettingsDocument(value).settings;
}

export default SettingsBootstrap;
