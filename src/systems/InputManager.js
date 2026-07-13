import {
  CONTROL_CONTEXTS,
  INPUT_INTERFACES,
  getActionLabel,
  getControlBindings,
  isKnownInputInterface
} from './ControlBindings.js';

const GAMEPAD_ACTIVITY_THRESHOLD = 0.32;
const GAMEPAD_INPUT_THRESHOLD = 0.05;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export class InputManager {
  constructor(app) {
    this.app = app;
    this.activeInterface = INPUT_INTERFACES.KEYBOARD;
    this.keys = {};
    this.previousGamepadButtons = {};
    this.deadzone = 0.15;
    this.controllerCursor = { x: 0, y: -0.05 };
    this.lastContext = null;

    this.state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      moveX: 0,
      moveY: 0,
      cameraPanX: 0,
      cameraPanY: 0,
      handbrake: false,
      isGamepadConnected: false
    };

    this.initKeyboardListeners();
    this.initGamepadEvents();
  }

  initKeyboardListeners() {
    window.addEventListener('keydown', (event) => {
      this.setInterface(INPUT_INTERFACES.KEYBOARD);
      const target = event.target;
      const isEditing = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable;
      const isUiControl = target?.closest?.('button, input, textarea, select, a, [role="button"]');
      if (isEditing || isUiControl) return;

      const normalizedKey = event.key.toLowerCase();
      this.keys[normalizedKey] = true;
      if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
        this.keys[' '] = true;
        this.keys.space = true;
        const hasVehicle = Boolean(this.app?.trafficSystem?.controlledVehicle);
        const pedestrian = this.app?.pedestrianSystem?.controlledPedestrian;
        if (!hasVehicle) {
          event.preventDefault();
          if (pedestrian && !event.repeat) this.app.pedestrianSystem.triggerPedestrianJump();
        }
      }

      if (event.repeat) return;
      if (normalizedKey === 'e') this.handlePrimaryAction();
      else if (normalizedKey === 'f') this.app?.uiManager?.toggleCityEditor?.();
      else if (normalizedKey === 'm') this.app?.uiManager?.handleModeToggle?.();
      else if (normalizedKey === 'x') this.handleSecondaryAction();
      else if (normalizedKey === 'r' && this.getControlContext() === CONTROL_CONTEXTS.BUILDER) {
        this.app?.cityEditorSystem?.rotateSelection?.();
      } else if (event.key === 'Delete' && this.getControlContext() === CONTROL_CONTEXTS.BUILDER) {
        this.app?.cityEditorUI?.container?.querySelector?.('#btn-tool-delete')?.click?.();
      } else if (event.key === 'Escape') {
        this.handleBackAction();
      } else if (event.key === 'Shift') {
        this.handleHornAction();
      }
    });

    window.addEventListener('keyup', (event) => {
      this.keys[event.key.toLowerCase()] = false;
      if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') {
        this.keys[' '] = false;
        this.keys.space = false;
      }
    });

    // Browsers do not dispatch keyup when focus leaves the window. Clearing
    // transient input prevents a lost Space release from permanently applying
    // the handbrake (and likewise prevents stuck throttle/steering keys).
    window.addEventListener('blur', () => this.clearTransientInputState());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.clearTransientInputState();
      });
    }

    window.addEventListener('pointerdown', () => this.setInterface(INPUT_INTERFACES.KEYBOARD), { passive: true });
    window.addEventListener('wheel', () => this.setInterface(INPUT_INTERFACES.KEYBOARD), { passive: true });
    window.addEventListener('pointermove', (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0) < 3) return;
      this.setInterface(INPUT_INTERFACES.KEYBOARD);
    }, { passive: true });
  }

  clearTransientInputState() {
    for (const key of Object.keys(this.keys || {})) this.keys[key] = false;
    if (this.state) {
      this.state.throttle = 0;
      this.state.brake = 0;
      this.state.steer = 0;
      this.state.moveX = 0;
      this.state.moveY = 0;
      this.state.cameraPanX = 0;
      this.state.cameraPanY = 0;
      this.state.handbrake = false;
    }
  }

  handlePrimaryAction() {
    const missionSystem = this.app?.missionSystem;
    if (missionSystem?.handleActionKey?.()) return true;
    if (missionSystem?.openPendingMissionDetails?.()) return true;

    const trafficSystem = this.app?.trafficSystem;
    if (trafficSystem?.controlledVehicle) {
      trafficSystem.exitControlledVehicle();
      return true;
    }

    const pedestrianSystem = this.app?.pedestrianSystem;
    if (pedestrianSystem?.controlledPedestrian) {
      pedestrianSystem.handlePedestrianActionKey();
      return true;
    }

    return this.app?.uiManager?.activateSelectedEntity?.() || false;
  }

  handleSecondaryAction() {
    const pedestrianSystem = this.app?.pedestrianSystem;
    if (pedestrianSystem?.controlledPedestrian) {
      if (!pedestrianSystem.controlledPedestrian.hasBaseballBat) {
        this.app?.uiManager?.showToast?.('🏏 Find a glowing baseball bat before attacking.');
        return false;
      }
      pedestrianSystem.swingBaseballBat();
      return true;
    }
    if (this.app?.uiManager?.btnFunMode) {
      this.app.uiManager.btnFunMode.click();
      return true;
    }
    return false;
  }

  handleHornAction() {
    const vehicle = this.app?.trafficSystem?.controlledVehicle;
    if (!vehicle) return false;
    if ((vehicle.vType === 'AMBULANCE' || vehicle.isPolice) && vehicle.toggleAmbulanceSiren) {
      vehicle.toggleAmbulanceSiren(this.app.audioSystem);
    } else {
      this.app?.audioSystem?.playHonk?.();
    }
    return true;
  }

  handleBackAction() {
    if (this.app?.dialogueOverlay?.currentMission) {
      this.app.dialogueOverlay.hide();
      return true;
    }
    if (this.app?.uiManager?.cityEditorUI?.isVisible) {
      this.app.uiManager.toggleCityEditor();
      return true;
    }
    if (this.app?.uiManager?.inspectorHud && !this.app.uiManager.inspectorHud.classList.contains('hidden')) {
      this.app.uiManager.hideInspector();
      return true;
    }
    if (this.getControlContext() === CONTROL_CONTEXTS.VEHICLE || this.getControlContext() === CONTROL_CONTEXTS.PEDESTRIAN) {
      this.app?.uiManager?.handleModeToggle?.();
      return true;
    }
    return false;
  }

  initGamepadEvents() {
    window.addEventListener('gamepadconnected', (event) => {
      this.state.isGamepadConnected = true;
      this.app?.uiManager?.updateGamepadConnection?.(true, event.gamepad?.id);
    });

    window.addEventListener('gamepaddisconnected', () => {
      this.state.isGamepadConnected = Boolean(this.getGamepad());
      this.previousGamepadButtons = {};
      if (!this.state.isGamepadConnected && this.activeInterface === INPUT_INTERFACES.GAMEPAD) {
        this.setInterface(INPUT_INTERFACES.KEYBOARD);
      }
      this.app?.uiManager?.updateGamepadConnection?.(this.state.isGamepadConnected);
    });
  }

  setInterface(newInterface) {
    if (!isKnownInputInterface(newInterface)) return false;
    if (this.activeInterface === newInterface) return false;
    this.activeInterface = newInterface;
    if (typeof document !== 'undefined') document.body.dataset.inputMethod = newInterface.toLowerCase();
    this.app?.uiManager?.updateControlDeviceBadge?.(newInterface);
    this.app?.uiManager?.updateAdaptiveControls?.(true);
    return true;
  }

  getControlContext() {
    if (this.app?.dialogueOverlay?.currentMission) return CONTROL_CONTEXTS.DIALOGUE;
    if (this.app?.uiManager?.cityEditorUI?.isVisible || this.app?.cityEditorSystem?.isActive) return CONTROL_CONTEXTS.BUILDER;
    if (this.app?.trafficSystem?.controlledVehicle) return CONTROL_CONTEXTS.VEHICLE;
    if (this.app?.pedestrianSystem?.controlledPedestrian) return CONTROL_CONTEXTS.PEDESTRIAN;
    return CONTROL_CONTEXTS.MANAGEMENT;
  }

  getActiveBindings() {
    return getControlBindings(this.getControlContext());
  }

  getActionLabel(action) {
    return getActionLabel(action, this.activeInterface);
  }

  applyDeadzone(value, deadzone = this.deadzone) {
    if (Math.abs(value) < deadzone) return 0;
    return (value - Math.sign(value) * deadzone) / (1 - deadzone);
  }

  getGamepad() {
    const gamepads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gamepad of gamepads) {
      if (gamepad?.connected) return gamepad;
    }
    return null;
  }

  isButtonPressed(gamepad, index) {
    if (!gamepad?.buttons?.[index]) return false;
    const button = gamepad.buttons[index];
    return typeof button === 'object' ? button.pressed || button.value > 0.5 : button === 1;
  }

  getButtonValue(gamepad, index) {
    if (!gamepad?.buttons?.[index]) return 0;
    const button = gamepad.buttons[index];
    return typeof button === 'object' ? Number(button.value || 0) : (button === 1 ? 1 : 0);
  }

  justPressed(buttonId, isPressed) {
    const previous = Boolean(this.previousGamepadButtons[buttonId]);
    this.previousGamepadButtons[buttonId] = isPressed;
    return isPressed && !previous;
  }

  isGamepadActive(gamepad) {
    if (!gamepad) return false;
    const activeAxis = (gamepad.axes || []).some(value => Math.abs(value || 0) >= GAMEPAD_ACTIVITY_THRESHOLD);
    const activeButton = (gamepad.buttons || []).some(button => {
      if (typeof button === 'object') return button.pressed || button.value >= GAMEPAD_ACTIVITY_THRESHOLD;
      return button === 1;
    });
    return activeAxis || activeButton;
  }

  update(delta) {
    const gamepad = this.getGamepad();
    this.state.isGamepadConnected = Boolean(gamepad);
    if (gamepad && this.isGamepadActive(gamepad)) this.setInterface(INPUT_INTERFACES.GAMEPAD);

    const keyboardForward = Boolean(this.keys.w || this.keys.arrowup);
    const keyboardReverse = Boolean(this.keys.s || this.keys.arrowdown);
    const keyboardLeft = Boolean(this.keys.a || this.keys.arrowleft);
    const keyboardRight = Boolean(this.keys.d || this.keys.arrowright);

    let throttle = keyboardForward ? 1 : 0;
    let brake = keyboardReverse ? 1 : 0;
    let steer = (keyboardLeft ? 1 : 0) - (keyboardRight ? 1 : 0);
    let moveX = (keyboardRight ? 1 : 0) - (keyboardLeft ? 1 : 0);
    let moveY = (keyboardForward ? 1 : 0) - (keyboardReverse ? 1 : 0);
    let cameraPanX = 0;
    let cameraPanY = 0;
    let handbrake = Boolean(this.keys[' ']);

    if (gamepad) {
      const leftX = this.applyDeadzone(gamepad.axes?.[0] || 0);
      const leftY = this.applyDeadzone(gamepad.axes?.[1] || 0);
      const rightX = this.applyDeadzone(gamepad.axes?.[2] || 0);
      const rightY = this.applyDeadzone(gamepad.axes?.[3] || 0);

      if (this.activeInterface === INPUT_INTERFACES.GAMEPAD) {
        throttle = this.getButtonValue(gamepad, 7);
        brake = this.getButtonValue(gamepad, 6);
        steer = -leftX;
        moveX = leftX;
        moveY = -leftY;
        cameraPanX = rightX;
        cameraPanY = rightY;
        handbrake = this.getControlContext() === CONTROL_CONTEXTS.VEHICLE && this.isButtonPressed(gamepad, 0);
      }

      if (this.getControlContext() === CONTROL_CONTEXTS.BUILDER && this.activeInterface === INPUT_INTERFACES.GAMEPAD) {
        this.updateBuilderCursor(leftX, leftY, delta);
      }
      this.handleGamepadActions(gamepad);
    }

    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.steer = steer;
    this.state.moveX = moveX;
    this.state.moveY = moveY;
    this.state.cameraPanX = cameraPanX;
    this.state.cameraPanY = cameraPanY;
    this.state.handbrake = handbrake;

    const context = this.getControlContext();
    if (context !== this.lastContext) {
      this.lastContext = context;
      this.app?.uiManager?.updateAdaptiveControls?.(true);
    }
  }

  updateBuilderCursor(leftX, leftY, delta) {
    if (Math.abs(leftX) <= GAMEPAD_INPUT_THRESHOLD && Math.abs(leftY) <= GAMEPAD_INPUT_THRESHOLD) return;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active?.closest?.('.city-editor-wrapper')) active.blur?.();
    this.controllerCursor.x = Math.max(-0.88, Math.min(0.88, this.controllerCursor.x + leftX * delta * 0.85));
    this.controllerCursor.y = Math.max(-0.72, Math.min(0.68, this.controllerCursor.y - leftY * delta * 0.85));
    this.app?.cityEditorSystem?.updateControllerCursor?.(this.controllerCursor.x, this.controllerCursor.y);
    this.app?.uiManager?.cityEditorUI?.updateControllerCursor?.(this.controllerCursor);
  }

  handleGamepadActions(gamepad) {
    const context = this.getControlContext();
    const pressed = index => this.isButtonPressed(gamepad, index);

    const dpadDirections = [
      ['up', 12], ['down', 13], ['left', 14], ['right', 15]
    ];
    for (const [direction, index] of dpadDirections) {
      if (this.justPressed(`btn${index}`, pressed(index)) && context !== CONTROL_CONTEXTS.VEHICLE && context !== CONTROL_CONTEXTS.PEDESTRIAN) {
        this.moveUiFocus(direction);
      }
    }

    if (this.justPressed('btn0', pressed(0))) {
      if (context === CONTROL_CONTEXTS.DIALOGUE || this.isUiElementFocused()) {
        if (!this.activateFocusedControl()) this.moveUiFocus('down');
      } else if (context === CONTROL_CONTEXTS.BUILDER) {
        this.app?.cityEditorSystem?.performControllerAction?.();
      } else if (context === CONTROL_CONTEXTS.PEDESTRIAN) {
        this.app?.pedestrianSystem?.triggerPedestrianJump?.();
      }
    }

    if (this.justPressed('btn1', pressed(1))) {
      if (context === CONTROL_CONTEXTS.BUILDER && this.isUiElementFocused()) {
        document.activeElement?.blur?.();
      } else {
        this.handleBackAction();
      }
    }

    if (this.justPressed('btn2', pressed(2))) {
      if (context === CONTROL_CONTEXTS.BUILDER) {
        this.app?.uiManager?.cityEditorUI?.container?.querySelector?.('#btn-tool-delete')?.click?.();
      } else {
        this.handleSecondaryAction();
      }
    }

    if (this.justPressed('btn3', pressed(3))) {
      if (context === CONTROL_CONTEXTS.BUILDER) this.app?.cityEditorSystem?.rotateSelection?.();
      else this.handlePrimaryAction();
    }

    if (this.justPressed('btn4', pressed(4))) this.handleHornAction();

    if (this.justPressed('btn5', pressed(5))) {
      const presets = ['ground', 'street', 'birdseye', 'downtown', 'bridge', 'park'];
      const current = this.app?.sceneManager?.activePreset || 'street';
      const nextIndex = (presets.indexOf(current) + 1) % presets.length;
      this.app?.sceneManager?.setCameraPreset?.(presets[nextIndex]);
      this.app?.uiManager?.showToast?.(`📹 ${presets[nextIndex].replace(/^./, value => value.toUpperCase())} camera`);
    }

    if (this.justPressed('btn8', pressed(8))) {
      if (context === CONTROL_CONTEXTS.MANAGEMENT || context === CONTROL_CONTEXTS.BUILDER) {
        this.app?.uiManager?.toggleCityEditor?.();
      } else {
        const physicsVehicle = this.app?.trafficSystem?.controlledVehicle?.physicsVehicle;
        if (typeof physicsVehicle?.resetPosition === 'function') {
          physicsVehicle.resetPosition();
          this.app?.uiManager?.showToast?.('↺ Vehicle reset');
        }
      }
    }

    if (this.justPressed('btn9', pressed(9))) this.app?.uiManager?.handleModeToggle?.();
  }

  getUiRoot() {
    if (typeof document === 'undefined') return null;
    if (this.app?.dialogueOverlay?.currentMission) return document.getElementById('dialogue-overlay');
    if (this.app?.uiManager?.cityEditorUI?.isVisible) return this.app.uiManager.cityEditorUI.container;
    return document.getElementById('app');
  }

  getFocusableElements() {
    const root = this.getUiRoot();
    if (!root) return [];
    return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => {
      if (element.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getClientRects().length > 0;
    });
  }

  isUiElementFocused() {
    if (typeof document === 'undefined') return false;
    const root = this.getUiRoot();
    return Boolean(root && document.activeElement && root.contains(document.activeElement) && document.activeElement.matches(FOCUSABLE_SELECTOR));
  }

  activateFocusedControl() {
    if (!this.isUiElementFocused()) return false;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && (active.type === 'range' || active.type === 'text')) return true;
    active.click?.();
    return true;
  }

  moveUiFocus(direction) {
    const elements = this.getFocusableElements();
    if (elements.length === 0) return false;
    const current = document.activeElement;
    if (
      current instanceof HTMLInputElement
      && current.type === 'range'
      && (direction === 'left' || direction === 'right')
    ) {
      const minimum = Number(current.min || 0);
      const maximum = Number(current.max || 100);
      const step = Number(current.step || 1);
      const next = Math.max(minimum, Math.min(maximum, Number(current.value) + (direction === 'right' ? step : -step)));
      current.value = String(next);
      current.dispatchEvent(new Event('input', { bubbles: true }));
      current.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (!elements.includes(current)) {
      const preferred = elements.find(element => element.getAttribute('aria-pressed') === 'true')
        || elements.find(element => element.classList.contains('active'))
        || elements[0];
      preferred.focus({ preventScroll: true });
      return true;
    }

    const currentRect = current.getBoundingClientRect();
    const originX = currentRect.left + currentRect.width / 2;
    const originY = currentRect.top + currentRect.height / 2;
    const horizontal = direction === 'left' || direction === 'right';
    const directionSign = direction === 'left' || direction === 'up' ? -1 : 1;
    let best = null;
    let bestScore = Infinity;

    for (const candidate of elements) {
      if (candidate === current) continue;
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const primary = horizontal ? x - originX : y - originY;
      if (Math.sign(primary) !== directionSign || Math.abs(primary) < 2) continue;
      const secondary = horizontal ? y - originY : x - originX;
      const score = Math.abs(primary) + Math.abs(secondary) * 2.25;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }
}
