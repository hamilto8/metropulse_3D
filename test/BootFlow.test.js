import test from 'node:test';
import assert from 'node:assert/strict';

import { BootPipeline, BootStageError } from '../src/boot/BootPipeline.js';
import {
  CAPABILITY_IDS,
  checkLocalStorage,
  checkWebGL2
} from '../src/boot/CapabilityChecker.js';
import {
  DEFAULT_BOOT_SETTINGS,
  SettingsBootstrap,
  validateBootSettings
} from '../src/boot/SettingsBootstrap.js';
import {
  BOOT_ACTIONS,
  RECOVERY_SAVE_KEY,
  SAVE_KEY,
  SaveDiscovery,
  inspectLegacySave
} from '../src/boot/SaveDiscovery.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class MemorySaveRepository {
  constructor({ current = null, recovery = null } = {}) {
    this.current = current;
    this.recovery = recovery;
  }

  async readSlots() { return { current: this.current, recovery: this.recovery }; }
  async putCurrent(value) { this.current = structuredClone(value); return value; }
  async putRecovery(value) { this.recovery = structuredClone(value); return value; }
  async commitCurrent(value) {
    if (this.current != null) this.recovery = structuredClone(this.current);
    this.current = structuredClone(value);
    return value;
  }
  async promoteRecovery() {
    if (this.recovery == null) throw new Error('No recovery save is available.');
    this.current = structuredClone(this.recovery);
    return this.current;
  }
  async clearCurrent({ preserveAsRecovery = true } = {}) {
    if (preserveAsRecovery && this.current != null) this.recovery = structuredClone(this.current);
    this.current = null;
    return true;
  }
}

function saveFixture(savedAt = '2026-07-18T12:00:00.000Z') {
  return JSON.stringify({
    version: 1,
    savedAt,
    economy: { version: 1 },
    world: { version: 1, buildings: [] },
    mission: {},
    settings: {}
  });
}

test('boot pipeline runs stages once in order and exposes immutable prior results', async () => {
  const calls = [];
  const progress = [];
  const pipeline = new BootPipeline({
    onProgress: event => progress.push(event),
    stages: [
      {
        id: 'first',
        label: 'First stage',
        run(results) {
          calls.push(['first', results]);
          return 10;
        }
      },
      {
        id: 'second',
        label: 'Second stage',
        run(results) {
          calls.push(['second', results]);
          return results.first + 5;
        }
      }
    ]
  });

  const result = await pipeline.run();
  assert.deepEqual(result, { first: 10, second: 15 });
  assert.deepEqual(calls, [['first', {}], ['second', { first: 10 }]]);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(progress.map(event => event.status), [
    'RUNNING', 'COMPLETE', 'RUNNING', 'COMPLETE'
  ]);
  assert.equal(progress.at(-1).progress, 1);
});

test('boot pipeline fails closed at the responsible stage and never starts later work', async () => {
  let reachedUnsafeStage = false;
  const pipeline = new BootPipeline({
    stages: [
      { id: 'data', label: 'Validate data', run: () => { throw new Error('duplicate mission id'); } },
      { id: 'runtime', label: 'Start runtime', run: () => { reachedUnsafeStage = true; } }
    ]
  });

  await assert.rejects(
    () => pipeline.run(),
    error => error instanceof BootStageError
      && error.stageId === 'data'
      && /duplicate mission id/.test(error.message)
  );
  assert.equal(reachedUnsafeStage, false);
});

test('capability probes verify actual WebGL2 and local-storage round trips', () => {
  let contextLost = false;
  const documentRef = {
    createElement() {
      return {
        getContext(kind) {
          if (kind !== 'webgl2') return null;
          return {
            getExtension() {
              return { loseContext() { contextLost = true; } };
            }
          };
        }
      };
    }
  };
  const storage = new MemoryStorage();

  assert.deepEqual(checkWebGL2(documentRef), {
    id: CAPABILITY_IDS.WEBGL2,
    available: true,
    detail: 'Hardware-accelerated WebGL 2 is available.',
    guidance: null
  });
  assert.equal(contextLost, true);
  assert.equal(checkLocalStorage(storage).available, true);
  assert.equal(storage.values.size, 0);
  assert.equal(checkWebGL2({ createElement: () => ({ getContext: () => null }) }).available, false);
  assert.equal(checkLocalStorage(null).available, false);
});

test('settings bootstrap validates supported values and safely falls back from corrupt data', () => {
  const storage = new MemoryStorage({
    'metropulse3d:settings:v1': JSON.stringify({
      version: 1,
      reducedMotion: 'REDUCE',
      textScale: 9
    })
  });
  const loaded = new SettingsBootstrap({ storage }).load();
  assert.equal(loaded.settings.motion.reducedMotion, 'REDUCE');
  assert.equal(loaded.settings.textScale, 1.5);
  assert.equal(loaded.settings.cameraSensitivity.onFoot, 1);
  assert.equal(JSON.parse(storage.getItem('metropulse3d:settings:v1')).version, 2);
  assert.deepEqual(loaded.warnings, []);
  assert.throws(() => validateBootSettings({ version: 99 }), /Unsupported settings version/);

  storage.setItem('metropulse3d:settings:v1', '{bad json');
  const recovered = new SettingsBootstrap({ storage }).load();
  assert.deepEqual(recovered.settings, DEFAULT_BOOT_SETTINGS);
  assert.match(recovered.warnings[0], /Saved settings were ignored/);
});

test('save discovery offers only valid actions and explains a corrupt current slot', async () => {
  const storage = new MemoryStorage({
    [SAVE_KEY]: '{not json',
    [RECOVERY_SAVE_KEY]: saveFixture('2026-07-17T09:30:00.000Z')
  });
  const discovery = await new SaveDiscovery({ storage, repository: new MemorySaveRepository() }).discover();

  assert.deepEqual(discovery.actions, {
    [BOOT_ACTIONS.NEW_GAME]: true,
    [BOOT_ACTIONS.CONTINUE]: false,
    [BOOT_ACTIONS.RECOVER]: true
  });
  assert.equal(discovery.current.present, true);
  assert.equal(discovery.current.valid, false);
  assert.match(discovery.current.reason, /JSON/);
  assert.equal(discovery.recovery.savedAt, '2026-07-17T09:30:00.000Z');
  assert.equal(inspectLegacySave(null).present, false);
});

test('new game migrates LocalStorage once, preserves recovery, and promotes it transactionally', async () => {
  const current = saveFixture('2026-07-18T12:00:00.000Z');
  const older = saveFixture('2026-07-16T12:00:00.000Z');
  const storage = new MemoryStorage({ [SAVE_KEY]: current, [RECOVERY_SAVE_KEY]: older });
  const repository = new MemorySaveRepository();
  const service = new SaveDiscovery({ storage, repository });

  const newGame = await service.prepare(BOOT_ACTIONS.NEW_GAME, await service.discover());
  assert.equal(newGame.action, BOOT_ACTIONS.NEW_GAME);
  assert.equal(newGame.restore, false);
  assert.equal(storage.getItem(SAVE_KEY), null);
  assert.equal(storage.getItem(RECOVERY_SAVE_KEY), null);
  assert.equal(repository.current, null);
  assert.equal(repository.recovery.metadata.migratedFrom, 'localStorage-v1');

  const afterNewGame = await service.discover();
  const recovered = await service.prepare(BOOT_ACTIONS.RECOVER, afterNewGame);
  assert.equal(recovered.action, BOOT_ACTIONS.RECOVER);
  assert.equal(recovered.restore, true);
  assert.deepEqual(repository.current, repository.recovery);
  await assert.rejects(
    () => service.prepare(BOOT_ACTIONS.CONTINUE, { actions: { [BOOT_ACTIONS.CONTINUE]: false } }),
    /not available/
  );
});
