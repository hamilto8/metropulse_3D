import test from 'node:test';
import assert from 'node:assert/strict';

import { InputManager } from '../src/systems/InputManager.js';
import {
  CONTROL_CONTEXTS,
  INPUT_INTERFACES,
  getActionLabel,
  getControlBindings
} from '../src/systems/ControlBindings.js';

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

test('adaptive bindings expose context-specific keyboard and Xbox prompts', () => {
  const driving = getControlBindings(CONTROL_CONTEXTS.VEHICLE);
  const walking = getControlBindings(CONTROL_CONTEXTS.PEDESTRIAN);
  const builder = getControlBindings(CONTROL_CONTEXTS.BUILDER);

  assert.equal(driving.find(binding => binding.action === 'THROTTLE').gamepad[0].label, 'RT');
  assert.equal(driving.find(binding => binding.action === 'BRAKE').gamepad[0].label, 'LT');
  assert.equal(walking.find(binding => binding.action === 'ATTACK').gamepad[0].label, 'X');
  assert.equal(builder.find(binding => binding.action === 'AIM').gamepad[0].label, 'LS');
  assert.equal(getActionLabel('INTERACT', INPUT_INTERFACES.KEYBOARD), 'E');
  assert.equal(getActionLabel('INTERACT', INPUT_INTERFACES.GAMEPAD), 'Y');
});

test('control context follows modal, builder, vehicle, pedestrian, then management priority', () => {
  const app = {
    dialogueOverlay: { currentMission: null },
    uiManager: { cityEditorUI: { isVisible: false } },
    cityEditorSystem: { isActive: false },
    trafficSystem: { controlledVehicle: null },
    pedestrianSystem: { controlledPedestrian: null }
  };
  const manager = managerWith(app);
  assert.equal(manager.getControlContext(), CONTROL_CONTEXTS.MANAGEMENT);
  app.pedestrianSystem.controlledPedestrian = {};
  assert.equal(manager.getControlContext(), CONTROL_CONTEXTS.PEDESTRIAN);
  app.trafficSystem.controlledVehicle = {};
  assert.equal(manager.getControlContext(), CONTROL_CONTEXTS.VEHICLE);
  app.uiManager.cityEditorUI.isVisible = true;
  assert.equal(manager.getControlContext(), CONTROL_CONTEXTS.BUILDER);
  app.dialogueOverlay.currentMission = {};
  assert.equal(manager.getControlContext(), CONTROL_CONTEXTS.DIALOGUE);
});

test('gamepad activity ignores ordinary stick drift and recognizes intentional input', () => {
  const manager = managerWith({});
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  assert.equal(manager.isGamepadActive({ axes: [0.12, -0.18, 0, 0], buttons }), false);
  assert.equal(manager.isGamepadActive({ axes: [0.45, 0, 0, 0], buttons }), true);
  buttons[0] = { pressed: true, value: 1 };
  assert.equal(manager.isGamepadActive({ axes: [0, 0, 0, 0], buttons }), true);
});

test('gamepad edge state resets on release so repeated Y presses remain reliable', () => {
  let actions = 0;
  const app = {
    missionSystem: {
      handleActionKey() { actions += 1; return true; },
      openPendingMissionDetails: () => false
    }
  };
  const manager = managerWith(app);
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));

  buttons[3] = { pressed: true, value: 1 };
  manager.handleGamepadActions({ buttons, axes: [0, 0, 0, 0] });
  buttons[3] = { pressed: false, value: 0 };
  manager.handleGamepadActions({ buttons, axes: [0, 0, 0, 0] });
  buttons[3] = { pressed: true, value: 1 };
  manager.handleGamepadActions({ buttons, axes: [0, 0, 0, 0] });

  assert.equal(actions, 2);
});
