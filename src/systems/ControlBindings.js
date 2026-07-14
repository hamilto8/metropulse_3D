export const INPUT_INTERFACES = Object.freeze({
  KEYBOARD: 'KEYBOARD',
  GAMEPAD: 'GAMEPAD'
});

export const CONTROL_CONTEXTS = Object.freeze({
  MANAGEMENT: 'MANAGEMENT',
  BUILDER: 'BUILDER',
  VEHICLE: 'VEHICLE',
  AIRCRAFT: 'AIRCRAFT',
  PEDESTRIAN: 'PEDESTRIAN',
  DIALOGUE: 'DIALOGUE'
});

const key = label => Object.freeze({ label, kind: 'key' });
const mouse = label => Object.freeze({ label, kind: 'mouse' });
const xbox = (label, tone = 'neutral') => Object.freeze({ label, kind: 'xbox', tone });
const stick = label => Object.freeze({ label, kind: 'stick' });

const ACTION_BINDINGS = Object.freeze({
  NAVIGATE: Object.freeze({
    action: 'NAVIGATE', label: 'Navigate',
    keyboard: Object.freeze([key('Tab')]),
    gamepad: Object.freeze([stick('D-Pad')])
  }),
  SELECT: Object.freeze({
    action: 'SELECT', label: 'Select',
    keyboard: Object.freeze([mouse('Click')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  }),
  ORBIT: Object.freeze({
    action: 'ORBIT', label: 'Orbit camera',
    keyboard: Object.freeze([mouse('Drag')]),
    gamepad: Object.freeze([stick('RS')])
  }),
  BUILD: Object.freeze({
    action: 'BUILD', label: 'City builder',
    keyboard: Object.freeze([key('F')]),
    gamepad: Object.freeze([xbox('View')])
  }),
  MODE: Object.freeze({
    action: 'MODE', label: 'Change mode',
    keyboard: Object.freeze([key('M')]),
    gamepad: Object.freeze([xbox('Menu')])
  }),
  MOVE: Object.freeze({
    action: 'MOVE', label: 'Move',
    keyboard: Object.freeze([key('WASD')]),
    gamepad: Object.freeze([stick('LS')])
  }),
  AIM: Object.freeze({
    action: 'AIM', label: 'Aim placement',
    keyboard: Object.freeze([mouse('Move')]),
    gamepad: Object.freeze([stick('LS')])
  }),
  PLACE: Object.freeze({
    action: 'PLACE', label: 'Place / apply',
    keyboard: Object.freeze([mouse('Click')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  }),
  ROTATE: Object.freeze({
    action: 'ROTATE', label: 'Rotate',
    keyboard: Object.freeze([key('R')]),
    gamepad: Object.freeze([xbox('Y', 'yellow')])
  }),
  DELETE: Object.freeze({
    action: 'DELETE', label: 'Delete tool',
    keyboard: Object.freeze([key('Delete')]),
    gamepad: Object.freeze([xbox('X', 'blue')])
  }),
  BACK: Object.freeze({
    action: 'BACK', label: 'Back',
    keyboard: Object.freeze([key('Esc')]),
    gamepad: Object.freeze([xbox('B', 'red')])
  }),
  DRIVE: Object.freeze({
    action: 'DRIVE', label: 'Steer',
    keyboard: Object.freeze([key('A / D')]),
    gamepad: Object.freeze([stick('LS')])
  }),
  THROTTLE: Object.freeze({
    action: 'THROTTLE', label: 'Accelerate',
    keyboard: Object.freeze([key('W')]),
    gamepad: Object.freeze([xbox('RT')])
  }),
  BRAKE: Object.freeze({
    action: 'BRAKE', label: 'Brake / reverse',
    keyboard: Object.freeze([key('S')]),
    gamepad: Object.freeze([xbox('LT')])
  }),
  HANDBRAKE: Object.freeze({
    action: 'HANDBRAKE', label: 'Handbrake',
    keyboard: Object.freeze([key('Space')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  }),
  INTERACT: Object.freeze({
    action: 'INTERACT', label: 'Interact / exit',
    keyboard: Object.freeze([key('E')]),
    gamepad: Object.freeze([xbox('Y', 'yellow')])
  }),
  HORN: Object.freeze({
    action: 'HORN', label: 'Horn / siren',
    keyboard: Object.freeze([key('Shift')]),
    gamepad: Object.freeze([xbox('LB')])
  }),
  CAMERA: Object.freeze({
    action: 'CAMERA', label: 'Look',
    keyboard: Object.freeze([mouse('Right drag')]),
    gamepad: Object.freeze([stick('RS')])
  }),
  AIR_ROLL: Object.freeze({
    action: 'AIR_ROLL', label: 'Bank / steer',
    keyboard: Object.freeze([key('A / D')]),
    gamepad: Object.freeze([stick('LS ↔')])
  }),
  AIR_PITCH: Object.freeze({
    action: 'AIR_PITCH', label: 'Pitch',
    keyboard: Object.freeze([key('↑ / ↓')]),
    gamepad: Object.freeze([stick('LS ↕')])
  }),
  AIR_THROTTLE: Object.freeze({
    action: 'AIR_THROTTLE', label: 'Throttle',
    keyboard: Object.freeze([key('W / S')]),
    gamepad: Object.freeze([xbox('RT / LT')])
  }),
  AIR_BRAKE: Object.freeze({
    action: 'AIR_BRAKE', label: 'Wheel brake',
    keyboard: Object.freeze([key('Space')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  }),
  AIR_RESET: Object.freeze({
    action: 'AIR_RESET', label: 'Runway recovery',
    keyboard: Object.freeze([key('R')]),
    gamepad: Object.freeze([xbox('X', 'blue')])
  }),
  JUMP: Object.freeze({
    action: 'JUMP', label: 'Jump',
    keyboard: Object.freeze([key('Space')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  }),
  ATTACK: Object.freeze({
    action: 'ATTACK', label: 'Attack',
    keyboard: Object.freeze([mouse('Click')]),
    gamepad: Object.freeze([xbox('X', 'blue')])
  }),
  CONFIRM: Object.freeze({
    action: 'CONFIRM', label: 'Confirm',
    keyboard: Object.freeze([key('Enter')]),
    gamepad: Object.freeze([xbox('A', 'green')])
  })
});

const CONTEXT_ACTIONS = Object.freeze({
  [CONTROL_CONTEXTS.MANAGEMENT]: Object.freeze(['ORBIT', 'SELECT', 'NAVIGATE', 'BUILD', 'MODE']),
  [CONTROL_CONTEXTS.BUILDER]: Object.freeze(['AIM', 'PLACE', 'ROTATE', 'DELETE', 'NAVIGATE', 'BACK']),
  [CONTROL_CONTEXTS.VEHICLE]: Object.freeze(['DRIVE', 'THROTTLE', 'BRAKE', 'INTERACT', 'HANDBRAKE', 'CAMERA', 'HORN', 'MODE']),
  [CONTROL_CONTEXTS.AIRCRAFT]: Object.freeze(['AIR_ROLL', 'AIR_PITCH', 'AIR_THROTTLE', 'AIR_BRAKE', 'CAMERA', 'INTERACT', 'AIR_RESET']),
  [CONTROL_CONTEXTS.PEDESTRIAN]: Object.freeze(['MOVE', 'JUMP', 'INTERACT', 'ATTACK', 'CAMERA', 'MODE']),
  [CONTROL_CONTEXTS.DIALOGUE]: Object.freeze(['NAVIGATE', 'CONFIRM', 'BACK'])
});

export function getControlBindings(context) {
  const actions = CONTEXT_ACTIONS[context] || CONTEXT_ACTIONS[CONTROL_CONTEXTS.MANAGEMENT];
  return actions.map(action => ACTION_BINDINGS[action]);
}

export function getActionTokens(action, inputInterface = INPUT_INTERFACES.KEYBOARD) {
  const binding = ACTION_BINDINGS[action];
  if (!binding) return Object.freeze([]);
  return inputInterface === INPUT_INTERFACES.GAMEPAD ? binding.gamepad : binding.keyboard;
}

export function getActionLabel(action, inputInterface = INPUT_INTERFACES.KEYBOARD) {
  return getActionTokens(action, inputInterface).map(token => token.label).join(' + ');
}

export function isKnownInputInterface(value) {
  return value === INPUT_INTERFACES.KEYBOARD || value === INPUT_INTERFACES.GAMEPAD;
}
