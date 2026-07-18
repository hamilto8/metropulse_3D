import test from 'node:test';
import assert from 'node:assert/strict';

import { SettingsStore } from '../src/settings/SettingsStore.js';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  validateSettingsDocument
} from '../src/settings/SettingsSchema.js';
import { CONTROL_CONTEXTS } from '../src/systems/ControlBindings.js';
import { SettingsRuntime } from '../src/settings/SettingsRuntime.js';
import { InputManager } from '../src/systems/InputManager.js';

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test('settings store migrates the boot schema and persists the complete versioned document', () => {
  const storage = new MemoryStorage({
    'metropulse3d:settings:v1': JSON.stringify({ version: 1, reducedMotion: 'REDUCE', textScale: 1.4 })
  });
  const store = new SettingsStore({ storage });
  const loaded = store.load();

  assert.equal(loaded.settings.motion.reducedMotion, 'REDUCE');
  assert.equal(loaded.settings.textScale, 1.4);
  assert.deepEqual(loaded.settings.audio, DEFAULT_SETTINGS.audio);
  assert.equal(JSON.parse(storage.getItem('metropulse3d:settings:v1')).version, SETTINGS_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(store.snapshot().settings.cameraSensitivity), true);
});

test('settings validation rejects partial, future, and out-of-range documents', () => {
  assert.throws(() => validateSettingsDocument({ version: 99 }), /Unsupported settings version/);
  assert.throws(() => validateSettingsDocument({ version: 2, settings: {}, bindings: {} }), /cameraSensitivity/);
  const store = new SettingsStore({ storage: new MemoryStorage() });
  store.load();
  assert.throws(() => store.set('textScale', 4), /between 0.8 and 1.5/);
  assert.throws(() => store.set('unknown.option', true), /Unknown settings path/);
});

test('setting updates are atomic, observable, persistent, and reloadable', () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore({ storage });
  store.load();
  const events = [];
  const unsubscribe = store.subscribe(event => events.push(event));

  store.set('audio.master', 0.25);
  store.set('cameraSensitivity.vehicle', 1.7);
  unsubscribe();
  store.set('difficulty', 'RELAXED');

  assert.equal(events.length, 2);
  assert.equal(events[0].path, 'audio.master');
  assert.equal(events[0].previous.settings.audio.master, 0.5);
  assert.equal(events[0].current.settings.audio.master, 0.25);
  const reloaded = new SettingsStore({ storage }).load();
  assert.equal(reloaded.settings.audio.master, 0.25);
  assert.equal(reloaded.settings.cameraSensitivity.vehicle, 1.7);
  assert.equal(reloaded.settings.difficulty, 'RELAXED');
});

test('storage failures do not mutate live state and listener failures are isolated', () => {
  const storage = new MemoryStorage();
  const listenerErrors = [];
  const store = new SettingsStore({ storage, onListenerError: error => listenerErrors.push(error.message) });
  store.load();
  let healthyListenerCalls = 0;
  store.subscribe(() => { throw new Error('observer failed'); });
  store.subscribe(() => { healthyListenerCalls += 1; });
  store.set('textScale', 1.1);
  assert.deepEqual(listenerErrors, ['observer failed']);
  assert.equal(healthyListenerCalls, 1);

  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => store.set('textScale', 1.2), /quota exceeded/);
  assert.equal(store.get('textScale'), 1.1);
  assert.equal(healthyListenerCalls, 1);
});

test('binding edits reject contextual conflicts, reserved keys, and incompatible devices', () => {
  const store = new SettingsStore({ storage: new MemoryStorage() });
  store.load();

  assert.throws(
    () => store.setBinding(CONTROL_CONTEXTS.VEHICLE, 'INTERACT', 'KeyM'),
    /conflicts between INTERACT and MODE/
  );
  assert.throws(
    () => store.setBinding(CONTROL_CONTEXTS.VEHICLE, 'INTERACT', 'F5'),
    /reserved by the browser/
  );
  assert.throws(
    () => store.setBinding(CONTROL_CONTEXTS.VEHICLE, 'CAMERA', 'KeyC'),
    /mouse-button binding/
  );
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.VEHICLE, 'INTERACT'), 'E');
});

test('bindings update prompts, reset by context, and reset globally', () => {
  const storage = new MemoryStorage();
  const store = new SettingsStore({ storage });
  store.load();

  store.setBinding(CONTROL_CONTEXTS.VEHICLE, 'INTERACT', 'KeyG');
  store.setBinding(CONTROL_CONTEXTS.PEDESTRIAN, 'INTERACT', 'KeyI');
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.VEHICLE, 'INTERACT'), 'G');
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.PEDESTRIAN, 'INTERACT'), 'I');
  store.resetContext(CONTROL_CONTEXTS.VEHICLE);
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.VEHICLE, 'INTERACT'), 'E');
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.PEDESTRIAN, 'INTERACT'), 'I');
  store.resetBindings();
  assert.equal(store.getActionLabel(CONTROL_CONTEXTS.PEDESTRIAN, 'INTERACT'), 'E');
  assert.deepEqual(JSON.parse(storage.getItem('metropulse3d:settings:v1')).bindings, {});
});

test('remapped directional slots drive the canonical legacy compatibility state', () => {
  const store = new SettingsStore({ storage: new MemoryStorage() });
  store.load();
  store.setBinding(CONTROL_CONTEXTS.PEDESTRIAN, 'MOVE', 'KeyI', 0);
  const manager = Object.create(InputManager.prototype);
  manager.app = {};
  manager.settingsStore = store;
  manager.keys = {};
  manager.pressedInputs = new Set(['KeyI']);
  manager.toggleStates = { sprint: false, braking: false, repeatedActions: false };

  manager.syncLegacyKeys(CONTROL_CONTEXTS.PEDESTRIAN);
  assert.equal(manager.keys.w, true);
  assert.equal(manager.keys.s, false);
  assert.equal(manager.isActionPressed('MOVE', CONTROL_CONTEXTS.PEDESTRIAN), true);
});

test('settings runtime applies preferences immediately to DOM, audio, camera, and prompts', () => {
  const styleValues = new Map();
  const documentElement = {
    dataset: {},
    style: { setProperty(name, value) { styleValues.set(name, value); } }
  };
  const calls = [];
  const app = {
    audioSystem: { applySettings(value) { calls.push(['audio', value.master]); } },
    sceneManager: { controls: { mouseButtons: {} }, bloomPass: { enabled: true } },
    uiManager: { updateAdaptiveControls(force) { calls.push(['controls', force]); } },
    interactionPrompt: { update() { calls.push(['prompt']); } }
  };
  const store = new SettingsStore({ storage: new MemoryStorage() });
  store.load();
  const runtime = new SettingsRuntime({
    store,
    app,
    documentRef: { documentElement },
    windowRef: { matchMedia: () => ({ matches: true }) }
  });
  store.set('textScale', 1.25);
  store.set('motion.bloom', 'OFF');
  store.setBinding(CONTROL_CONTEXTS.MANAGEMENT, 'ORBIT', 'Mouse2');

  assert.equal(styleValues.get('--ui-text-scale'), '1.25');
  assert.equal(documentElement.dataset.reducedMotion, 'on');
  assert.equal(app.sceneManager.bloomPass.enabled, false);
  assert.equal(app.sceneManager.controls.mouseButtons.LEFT, null);
  assert.equal(app.sceneManager.controls.mouseButtons.RIGHT, 0);
  assert.ok(calls.some(call => call[0] === 'prompt'));
  runtime.destroy();
});
