import test from 'node:test';
import assert from 'node:assert/strict';

import { PersistenceSystem } from '../src/systems/PersistenceSystem.js';

function createPersistenceHarness({ valid = true } = {}) {
  const calls = [];
  const app = {
    economySystem: {
      removeBuilding(id) { calls.push(['economy-remove', id]); }
    },
    cityBuilder: {
      getHillHeight() { return 2; },
      removeCountrysideSceneryOverlapping(rect) {
        calls.push(['clear-scenery', rect]);
        return [{ kind: 'HOUSE' }];
      }
    },
    cityEditorSystem: {
      getPlacementRect(x, z) { return { minX: x - 22, maxX: x + 22, minZ: z - 22, maxZ: z + 22 }; },
      isPlacementValid() { return valid; },
      restoreZoneParcels() {}
    },
    buildingFactory: {
      placeUserBuilding(plot, spec, rotationY) {
        calls.push(['place', plot, spec.id, rotationY]);
        return { plot: { ...plot }, group: { rotation: { y: rotationY } } };
      }
    }
  };
  const persistence = Object.create(PersistenceSystem.prototype);
  persistence.app = app;
  persistence.lastRestoreReport = null;
  return { persistence, calls };
}

const savedWorld = {
  version: 1,
  buildings: [{
    economyId: 'saved-tower-1',
    specId: 'NEOTECH_HQ',
    plot: { x: 500, z: 25 },
    rotationY: 0
  }],
  zones: []
};

test('restore preserves a valid saved building and clears regenerated scenery after placement succeeds', () => {
  const { persistence, calls } = createPersistenceHarness();

  assert.equal(persistence.restoreWorld(savedWorld), true);
  assert.deepEqual(calls.map(call => call[0]), ['place', 'clear-scenery']);
  assert.deepEqual(persistence.lastRestoreReport, {
    restoredBuildings: 1,
    skippedBuildings: 0,
    clearedScenery: 1
  });
});

test('restore rejects invalid legacy overlaps and removes their orphan economy record', () => {
  const { persistence, calls } = createPersistenceHarness({ valid: false });

  assert.equal(persistence.restoreWorld(savedWorld), true);
  assert.deepEqual(calls, [['economy-remove', 'saved-tower-1']]);
  assert.deepEqual(persistence.lastRestoreReport, {
    restoredBuildings: 0,
    skippedBuildings: 1,
    clearedScenery: 0
  });
});

test('restore always starts dynamic weather even when a legacy save disabled it', () => {
  const calls = [];
  const persistence = Object.create(PersistenceSystem.prototype);
  persistence.app = {
    timeManager: {
      setTime(value) { calls.push(['time', value]); },
      setPlaying(value) { calls.push(['playing', value]); },
      setSpeed(value) { calls.push(['speed', value]); }
    },
    environment: {
      setWeather(value) { calls.push(['weather', value]); },
      setDynamicWeather(value) { calls.push(['dynamic-weather', value]); }
    }
  };

  persistence.restoreSettings({
    time: 9,
    timePlaying: true,
    timeSpeed: 15,
    weather: 'rain',
    dynamicWeather: false
  });

  assert.deepEqual(calls, [
    ['time', 9],
    ['playing', true],
    ['speed', 15],
    ['weather', 'rain'],
    ['dynamic-weather', true]
  ]);
});
