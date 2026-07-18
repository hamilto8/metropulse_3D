import {
  CONTROL_CONTEXTS,
  DEFAULT_KEYBOARD_MOUSE_BINDINGS,
  getActionLabel,
  getBindingConflicts,
  getKeyboardMouseBindings,
  INPUT_INTERFACES,
  isKeyboardMouseInput,
  isKnownControlAction,
  RESERVED_BROWSER_INPUTS,
  validateBindingOverrides
} from '../systems/ControlBindings.js';
import {
  createDefaultSettingsDocument,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  validateSettingsDocument
} from './SettingsSchema.js';

function getDefaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableSnapshot(document) {
  return deepFreeze({
    version: document.version,
    settings: clone(document.settings),
    bindings: clone(document.bindings)
  });
}

/** Renderer-independent authority for global preferences and input bindings. */
export class SettingsStore {
  constructor({ storage = getDefaultStorage(), storageKey = SETTINGS_STORAGE_KEY, onListenerError = null } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.onListenerError = onListenerError;
    this.listeners = new Set();
    this.document = createDefaultSettingsDocument();
    this.loaded = false;
  }

  load() {
    const warnings = [];
    let document = createDefaultSettingsDocument();
    try {
      const raw = this.storage?.getItem?.(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        document = validateSettingsDocument(parsed);
        if (parsed.version !== SETTINGS_SCHEMA_VERSION) {
          this.storage?.setItem?.(this.storageKey, JSON.stringify(document));
        }
      }
    } catch (error) {
      warnings.push(`Saved settings were ignored: ${error?.message || String(error)}`);
    }
    this.document = document;
    this.loaded = true;
    return Object.freeze({
      store: this,
      settings: this.getSettings(),
      bindings: this.getBindingOverrides(),
      warnings: Object.freeze(warnings)
    });
  }

  snapshot() {
    return immutableSnapshot(this.document);
  }

  getSettings() {
    return clone(this.document.settings);
  }

  get(path, fallback = undefined) {
    const segments = Array.isArray(path) ? path : String(path).split('.');
    let value = this.document.settings;
    for (const segment of segments) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return fallback;
      value = value[segment];
    }
    return value && typeof value === 'object' ? clone(value) : value;
  }

  getBindingOverrides() {
    return clone(this.document.bindings);
  }

  getBindings(context, action) {
    return getKeyboardMouseBindings(context, action, this.document.bindings);
  }

  getActionLabel(context, action, inputInterface = INPUT_INTERFACES.KEYBOARD) {
    return getActionLabel(action, inputInterface, context, this.document.bindings);
  }

  subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('Settings listener must be a function.');
    this.listeners.add(listener);
    if (emitCurrent) listener(Object.freeze({ type: 'CURRENT', current: this.snapshot(), previous: null }));
    return () => this.listeners.delete(listener);
  }

  emit(type, previous, metadata = {}) {
    const event = Object.freeze({ type, previous, current: this.snapshot(), ...metadata });
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError?.(error);
      }
    }
  }

  commit(candidate, type, metadata = {}) {
    const validated = validateSettingsDocument(candidate, { allowMigration: false });
    const serialized = JSON.stringify(validated);
    this.storage?.setItem?.(this.storageKey, serialized);
    const previous = this.snapshot();
    this.document = validated;
    this.emit(type, previous, metadata);
    return this.snapshot();
  }

  set(path, value) {
    const segments = Array.isArray(path) ? path : String(path).split('.');
    if (segments.length === 0 || segments.some(segment => !segment)) throw new TypeError('A settings path is required.');
    const candidate = clone(this.document);
    let owner = candidate.settings;
    for (const segment of segments.slice(0, -1)) {
      if (!owner?.[segment] || typeof owner[segment] !== 'object') throw new TypeError(`Unknown settings path: ${segments.join('.')}.`);
      owner = owner[segment];
    }
    const key = segments.at(-1);
    if (!Object.hasOwn(owner, key)) throw new TypeError(`Unknown settings path: ${segments.join('.')}.`);
    owner[key] = value;
    return this.commit(candidate, 'SETTING_CHANGED', { path: segments.join('.') });
  }

  replace({ settings, bindings = {} }, { persist = true, source = 'replace' } = {}) {
    const candidate = { version: SETTINGS_SCHEMA_VERSION, settings: clone(settings), bindings: clone(bindings) };
    if (persist) return this.commit(candidate, 'REPLACED', { source });
    const previous = this.snapshot();
    this.document = validateSettingsDocument(candidate, { allowMigration: false });
    this.emit('REPLACED', previous, { source });
    return this.snapshot();
  }

  setBinding(context, action, input, index = 0) {
    if (!isKnownControlAction(context, action)) throw new TypeError(`Unknown ${context} action: ${action}.`);
    if (!isKeyboardMouseInput(input)) throw new TypeError(`Unsupported input: ${input}.`);
    if (RESERVED_BROWSER_INPUTS.includes(input)) throw new RangeError(`${input} is reserved by the browser.`);
    const candidate = clone(this.document);
    const effective = [...getKeyboardMouseBindings(context, action, candidate.bindings)];
    if (!Number.isInteger(index) || index < 0 || index >= effective.length) throw new RangeError('Binding index is out of range.');
    effective[index] = input;
    if (new Set(effective).size !== effective.length) throw new RangeError(`${input} is already assigned to ${action}.`);
    candidate.bindings[context] ||= {};
    candidate.bindings[context][action] = effective;
    validateBindingOverrides(candidate.bindings);
    return this.commit(candidate, 'BINDING_CHANGED', { context, action, input, index });
  }

  getConflicts(context, bindings = this.document.bindings) {
    return getBindingConflicts(context, bindings);
  }

  resetContext(context) {
    if (!Object.values(CONTROL_CONTEXTS).includes(context)) throw new TypeError(`Unknown binding context: ${context}.`);
    const candidate = clone(this.document);
    delete candidate.bindings[context];
    return this.commit(candidate, 'BINDINGS_RESET', { context });
  }

  resetBindings() {
    const candidate = clone(this.document);
    candidate.bindings = {};
    return this.commit(candidate, 'BINDINGS_RESET', { context: null });
  }

  resetAll() {
    return this.commit(createDefaultSettingsDocument(), 'SETTINGS_RESET');
  }

  getDefaultBindings(context) {
    return clone(DEFAULT_KEYBOARD_MOUSE_BINDINGS[context] || {});
  }
}

export default SettingsStore;
