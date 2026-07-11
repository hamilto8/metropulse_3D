import test from 'node:test';
import assert from 'node:assert/strict';

import { InputManager } from '../src/systems/InputManager.js';

function managerWith(app) {
  const manager = Object.create(InputManager.prototype);
  manager.app = app;
  manager.previousGamepadButtons = {};
  return manager;
}

test('primary action routing prioritizes mission interaction over vehicle exit', () => {
  const calls = [];
  const app = {
    missionSystem: {
      handleActionKey() { calls.push('mission'); return true; },
      openPendingMissionDetails() { calls.push('pending'); return true; }
    },
    trafficSystem: {
      controlledVehicle: {},
      exitControlledVehicle() { calls.push('exit'); }
    }
  };

  assert.equal(managerWith(app).handlePrimaryAction(), true);
  assert.deepEqual(calls, ['mission']);
});

test('primary action falls through from mission prompt to vehicle and pedestrian actions', () => {
  const calls = [];
  const app = {
    missionSystem: {
      handleActionKey: () => false,
      openPendingMissionDetails: () => false
    },
    trafficSystem: {
      controlledVehicle: {},
      exitControlledVehicle() { calls.push('exit'); }
    }
  };
  const manager = managerWith(app);
  manager.handlePrimaryAction();
  assert.deepEqual(calls, ['exit']);

  app.trafficSystem.controlledVehicle = null;
  app.pedestrianSystem = {
    controlledPedestrian: {},
    handlePedestrianActionKey() { calls.push('pedestrian'); }
  };
  manager.handlePrimaryAction();
  assert.deepEqual(calls, ['exit', 'pedestrian']);
});

test('gamepad Y uses the canonical mission-first primary action route', () => {
  const calls = [];
  const app = {
    missionSystem: {
      handleActionKey() { calls.push('mission'); return true; },
      openPendingMissionDetails() { calls.push('pending'); return true; }
    },
    trafficSystem: {
      controlledVehicle: {},
      exitControlledVehicle() { calls.push('exit'); }
    }
  };
  const manager = managerWith(app);
  const buttons = Array.from({ length: 13 }, () => ({ pressed: false, value: 0 }));
  buttons[3] = { pressed: true, value: 1 };

  manager.handleGamepadActions({ buttons, axes: [0, 0, 0, 0] });
  assert.deepEqual(calls, ['mission']);
});
