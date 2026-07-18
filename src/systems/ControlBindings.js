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
  DIALOGUE: 'DIALOGUE',
  PAUSE: 'PAUSE'
});

const key = label => Object.freeze({ label, kind: 'key' });
const mouse = label => Object.freeze({ label, kind: 'mouse' });
const xbox = (label, tone = 'neutral') => Object.freeze({ label, kind: 'xbox', tone });
const stick = label => Object.freeze({ label, kind: 'stick' });
const keyboardMouseToken = input => (
  input.startsWith('Mouse') || input === 'PointerMove'
    ? mouse(formatKeyboardMouseInput(input))
    : key(formatKeyboardMouseInput(input))
);

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
  PAN: Object.freeze({
    action: 'PAN', label: 'Move camera',
    keyboard: Object.freeze([key('WASD / Q / E')]),
    gamepad: Object.freeze([stick('LS')])
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
  PAUSE_MENU: Object.freeze({
    action: 'PAUSE_MENU', label: 'Pause menu',
    keyboard: Object.freeze([key('Esc')]),
    gamepad: Object.freeze([xbox('Menu')])
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
  VEHICLE_RESET: Object.freeze({
    action: 'VEHICLE_RESET', label: 'Recover vehicle',
    keyboard: Object.freeze([key('R')]),
    gamepad: Object.freeze([xbox('View')])
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
  SPRINT: Object.freeze({
    action: 'SPRINT', label: 'Sprint',
    keyboard: Object.freeze([key('Shift')]),
    gamepad: Object.freeze([xbox('LS')])
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
  [CONTROL_CONTEXTS.MANAGEMENT]: Object.freeze(['ORBIT', 'PAN', 'SELECT', 'NAVIGATE', 'BUILD', 'MODE', 'PAUSE_MENU']),
  [CONTROL_CONTEXTS.BUILDER]: Object.freeze(['AIM', 'PLACE', 'ROTATE', 'DELETE', 'NAVIGATE', 'BACK']),
  [CONTROL_CONTEXTS.VEHICLE]: Object.freeze(['DRIVE', 'THROTTLE', 'BRAKE', 'INTERACT', 'HANDBRAKE', 'VEHICLE_RESET', 'CAMERA', 'HORN', 'MODE', 'PAUSE_MENU']),
  [CONTROL_CONTEXTS.AIRCRAFT]: Object.freeze(['AIR_ROLL', 'AIR_PITCH', 'AIR_THROTTLE', 'AIR_BRAKE', 'CAMERA', 'INTERACT', 'AIR_RESET', 'PAUSE_MENU']),
  [CONTROL_CONTEXTS.PEDESTRIAN]: Object.freeze(['MOVE', 'SPRINT', 'JUMP', 'INTERACT', 'ATTACK', 'CAMERA', 'MODE', 'PAUSE_MENU']),
  [CONTROL_CONTEXTS.DIALOGUE]: Object.freeze(['NAVIGATE', 'CONFIRM', 'BACK']),
  [CONTROL_CONTEXTS.PAUSE]: Object.freeze(['NAVIGATE', 'CONFIRM', 'BACK'])
});

export const KEYBOARD_MOUSE_INPUTS = Object.freeze({
  TAB: 'Tab',
  ENTER: 'Enter',
  ESCAPE: 'Escape',
  SPACE: 'Space',
  DELETE: 'Delete',
  SHIFT_LEFT: 'ShiftLeft',
  KEY_A: 'KeyA',
  KEY_D: 'KeyD',
  KEY_E: 'KeyE',
  KEY_F: 'KeyF',
  KEY_M: 'KeyM',
  KEY_Q: 'KeyQ',
  KEY_R: 'KeyR',
  KEY_S: 'KeyS',
  KEY_W: 'KeyW',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  MOUSE_PRIMARY: 'Mouse0',
  MOUSE_SECONDARY: 'Mouse2',
  POINTER_MOVE: 'PointerMove'
});

const I = KEYBOARD_MOUSE_INPUTS;

/**
 * Keyboard/mouse inputs are contextual. Sharing an input across contexts is
 * intentional; sharing it between two actions in one context is a conflict.
 * Arrays also encode directional action groups in the documented order.
 */
export const DEFAULT_KEYBOARD_MOUSE_BINDINGS = Object.freeze({
  [CONTROL_CONTEXTS.MANAGEMENT]: Object.freeze({
    ORBIT: Object.freeze([I.MOUSE_PRIMARY]),
    PAN: Object.freeze([I.KEY_W, I.KEY_S, I.KEY_A, I.KEY_D, I.KEY_Q, I.KEY_E, I.SHIFT_LEFT]),
    SELECT: Object.freeze([I.MOUSE_PRIMARY]),
    NAVIGATE: Object.freeze([I.TAB]),
    BUILD: Object.freeze([I.KEY_F]),
    MODE: Object.freeze([I.KEY_M]),
    PAUSE_MENU: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.BUILDER]: Object.freeze({
    AIM: Object.freeze([I.POINTER_MOVE]),
    PLACE: Object.freeze([I.MOUSE_PRIMARY]),
    ROTATE: Object.freeze([I.KEY_R]),
    DELETE: Object.freeze([I.DELETE]),
    NAVIGATE: Object.freeze([I.TAB]),
    BACK: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.VEHICLE]: Object.freeze({
    DRIVE: Object.freeze([I.KEY_A, I.KEY_D, I.ARROW_LEFT, I.ARROW_RIGHT]),
    THROTTLE: Object.freeze([I.KEY_W, I.ARROW_UP]),
    BRAKE: Object.freeze([I.KEY_S, I.ARROW_DOWN]),
    INTERACT: Object.freeze([I.KEY_E]),
    HANDBRAKE: Object.freeze([I.SPACE]),
    VEHICLE_RESET: Object.freeze([I.KEY_R]),
    CAMERA: Object.freeze([I.MOUSE_SECONDARY]),
    HORN: Object.freeze([I.SHIFT_LEFT]),
    MODE: Object.freeze([I.KEY_M]),
    PAUSE_MENU: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.AIRCRAFT]: Object.freeze({
    AIR_ROLL: Object.freeze([I.KEY_A, I.KEY_D]),
    AIR_PITCH: Object.freeze([I.ARROW_UP, I.ARROW_DOWN]),
    AIR_THROTTLE: Object.freeze([I.KEY_W, I.KEY_S]),
    AIR_BRAKE: Object.freeze([I.SPACE]),
    CAMERA: Object.freeze([I.MOUSE_SECONDARY]),
    INTERACT: Object.freeze([I.KEY_E]),
    AIR_RESET: Object.freeze([I.KEY_R]),
    PAUSE_MENU: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.PEDESTRIAN]: Object.freeze({
    MOVE: Object.freeze([
      I.KEY_W, I.KEY_S, I.KEY_A, I.KEY_D,
      I.ARROW_UP, I.ARROW_DOWN, I.ARROW_LEFT, I.ARROW_RIGHT
    ]),
    SPRINT: Object.freeze([I.SHIFT_LEFT]),
    JUMP: Object.freeze([I.SPACE]),
    INTERACT: Object.freeze([I.KEY_E]),
    ATTACK: Object.freeze([I.MOUSE_PRIMARY]),
    CAMERA: Object.freeze([I.MOUSE_SECONDARY]),
    MODE: Object.freeze([I.KEY_M]),
    PAUSE_MENU: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.DIALOGUE]: Object.freeze({
    NAVIGATE: Object.freeze([I.TAB]),
    CONFIRM: Object.freeze([I.ENTER]),
    BACK: Object.freeze([I.ESCAPE])
  }),
  [CONTROL_CONTEXTS.PAUSE]: Object.freeze({
    NAVIGATE: Object.freeze([I.TAB]),
    CONFIRM: Object.freeze([I.ENTER]),
    BACK: Object.freeze([I.ESCAPE])
  })
});

export const RESERVED_BROWSER_INPUTS = Object.freeze(['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12']);

const INPUT_LABELS = Object.freeze({
  Space: 'Space',
  ShiftLeft: 'Shift',
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  PointerMove: 'Mouse move'
});

export function isKnownControlContext(context) {
  return Object.hasOwn(DEFAULT_KEYBOARD_MOUSE_BINDINGS, context);
}

export function isKnownControlAction(context, action) {
  return Boolean(DEFAULT_KEYBOARD_MOUSE_BINDINGS[context]?.[action]);
}

export function isKeyboardMouseInput(value) {
  return typeof value === 'string' && (
    /^Key[A-Z]$/.test(value)
    || /^Digit[0-9]$/.test(value)
    || /^F(?:[1-9]|1[0-2])$/.test(value)
    || /^Arrow(?:Up|Down|Left|Right)$/.test(value)
    || ['Tab', 'Enter', 'Escape', 'Space', 'Delete', 'Backspace', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Mouse0', 'Mouse1', 'Mouse2', 'PointerMove'].includes(value)
  );
}

export function formatKeyboardMouseInput(input) {
  if (INPUT_LABELS[input]) return INPUT_LABELS[input];
  if (/^Key[A-Z]$/.test(input)) return input.slice(3);
  if (/^Digit[0-9]$/.test(input)) return input.slice(5);
  return String(input).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function effectiveInputs(context, action, overrides = {}) {
  const configured = overrides?.[context]?.[action];
  return configured || DEFAULT_KEYBOARD_MOUSE_BINDINGS[context]?.[action] || Object.freeze([]);
}

export function getKeyboardMouseBindings(context, action, overrides = {}) {
  return Object.freeze([...effectiveInputs(context, action, overrides)]);
}

export function getBindingConflicts(context, overrides = {}) {
  if (!isKnownControlContext(context)) return Object.freeze([]);
  const owners = new Map();
  const conflicts = [];
  for (const action of CONTEXT_ACTIONS[context]) {
    for (const input of effectiveInputs(context, action, overrides)) {
      // Management click intentionally means both orbit-drag and select-click;
      // PointerMove is an analog source rather than an exclusive command.
      if (input === I.POINTER_MOVE) continue;
      const previous = owners.get(input);
      if (previous && !(context === CONTROL_CONTEXTS.MANAGEMENT && input === I.MOUSE_PRIMARY)) {
        conflicts.push(Object.freeze({ context, input, actions: Object.freeze([previous, action]) }));
      } else {
        owners.set(input, action);
      }
    }
  }
  return Object.freeze(conflicts);
}

export function getReservedBindingIssues(overrides = {}) {
  const issues = [];
  for (const context of Object.values(CONTROL_CONTEXTS)) {
    for (const action of CONTEXT_ACTIONS[context]) {
      for (const input of effectiveInputs(context, action, overrides)) {
        if (RESERVED_BROWSER_INPUTS.includes(input)) {
          issues.push(Object.freeze({ context, action, input }));
        }
      }
    }
  }
  return Object.freeze(issues);
}

export function validateBindingOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Binding overrides must be an object.');
  }
  const normalized = {};
  for (const [context, actions] of Object.entries(overrides)) {
    if (!isKnownControlContext(context) || !actions || typeof actions !== 'object' || Array.isArray(actions)) {
      throw new TypeError(`Unknown binding context: ${context}.`);
    }
    for (const [action, inputs] of Object.entries(actions)) {
      if (!isKnownControlAction(context, action)) throw new TypeError(`Unknown ${context} action: ${action}.`);
      if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 8 || new Set(inputs).size !== inputs.length) {
        throw new TypeError(`${context}.${action} must contain 1-8 unique inputs.`);
      }
      if (!inputs.every(isKeyboardMouseInput)) throw new TypeError(`${context}.${action} contains an unsupported input.`);
      const mouseOnly = ['ORBIT', 'CAMERA', 'SELECT', 'PLACE', 'ATTACK'].includes(action);
      if (mouseOnly && !inputs.every(input => /^Mouse[0-2]$/.test(input))) {
        throw new TypeError(`${context}.${action} requires a mouse-button binding.`);
      }
      if (action === 'AIM' && (inputs.length !== 1 || inputs[0] !== I.POINTER_MOVE)) {
        throw new TypeError(`${context}.AIM uses fixed pointer movement.`);
      }
      if (!mouseOnly && action !== 'AIM' && inputs.some(input => input.startsWith('Mouse') || input === I.POINTER_MOVE)) {
        throw new TypeError(`${context}.${action} requires a keyboard binding.`);
      }
      normalized[context] ||= {};
      normalized[context][action] = [...inputs];
    }
  }
  for (const context of Object.values(CONTROL_CONTEXTS)) {
    const conflicts = getBindingConflicts(context, normalized);
    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      throw new RangeError(`${formatKeyboardMouseInput(conflict.input)} conflicts between ${conflict.actions.join(' and ')} in ${context}.`);
    }
  }
  const reserved = getReservedBindingIssues(normalized)[0];
  if (reserved) throw new RangeError(`${reserved.input} is reserved by the browser and cannot be bound.`);
  return normalized;
}

export function getControlBindings(context, overrides = {}) {
  const actions = CONTEXT_ACTIONS[context] || CONTEXT_ACTIONS[CONTROL_CONTEXTS.MANAGEMENT];
  const resolvedContext = CONTEXT_ACTIONS[context] ? context : CONTROL_CONTEXTS.MANAGEMENT;
  return actions.map(action => {
    const binding = ACTION_BINDINGS[action];
    const keyboard = effectiveInputs(resolvedContext, action, overrides)
      .map(keyboardMouseToken);
    return Object.freeze({ ...binding, keyboard: Object.freeze(keyboard) });
  });
}

export function getActionTokens(action, inputInterface = INPUT_INTERFACES.KEYBOARD, context = CONTROL_CONTEXTS.MANAGEMENT, overrides = {}) {
  const binding = ACTION_BINDINGS[action];
  if (!binding) return Object.freeze([]);
  if (inputInterface === INPUT_INTERFACES.GAMEPAD) return binding.gamepad;
  const inputs = effectiveInputs(context, action, overrides);
  if (inputs.length === 0) return binding.keyboard;
  return Object.freeze(inputs.map(keyboardMouseToken));
}

export function getActionLabel(action, inputInterface = INPUT_INTERFACES.KEYBOARD, context = CONTROL_CONTEXTS.MANAGEMENT, overrides = {}) {
  return getActionTokens(action, inputInterface, context, overrides).map(token => token.label).join(' / ');
}

export function isKnownInputInterface(value) {
  return value === INPUT_INTERFACES.KEYBOARD || value === INPUT_INTERFACES.GAMEPAD;
}
