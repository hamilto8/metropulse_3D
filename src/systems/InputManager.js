export class InputManager {
  constructor(app) {
    this.app = app;
    this.activeInterface = 'KEYBOARD'; // 'KEYBOARD' | 'GAMEPAD'
    this.keys = {};
    this.previousGamepadButtons = {};
    this.deadzone = 0.15;

    this.state = {
      throttle: 0,
      brake: 0,
      steer: 0,
      cameraPanX: 0,
      cameraPanY: 0,
      handbrake: false,
      isGamepadConnected: false
    };

    this.initKeyboardListeners();
    this.initGamepadEvents();
  }

  initKeyboardListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      // Prevent spacebar button activation in free/orbit camera mode or pedestrian control mode
      if (e.key === ' ' || e.key === 'Spacebar') {
        const ts = this.app ? this.app.trafficSystem : null;
        const ps = this.app ? this.app.pedestrianSystem : null;
        const isVehControlled = ts && ts.controlledVehicle != null;
        const isPedControlled = ps && ps.controlledPedestrian != null;
        if (!isVehControlled) {
          e.preventDefault();
          if (isPedControlled) {
            ps.triggerPedestrianJump();
          }
        }
      }

      this.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') {
        this.keys[' '] = true;
        this.keys['space'] = true;
      }
      this.setInterface('KEYBOARD');

      if ((e.key === 'e' || e.key === 'E') && !e.repeat) {
        this.handlePrimaryAction();
      }
      if (e.key === 'Shift' && !e.repeat) {
        const vehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
        if (vehicle && (vehicle.vType === 'AMBULANCE' || vehicle.isPolice) && vehicle.toggleAmbulanceSiren) {
          vehicle.toggleAmbulanceSiren(this.app.audioSystem);
        } else if (vehicle && this.app.audioSystem) {
          this.app.audioSystem.playHonk();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      if (e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') {
        this.keys[' '] = false;
        this.keys['space'] = false;
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('header, aside, footer, button, input')) return;
      this.setInterface('KEYBOARD');
    });
  }

  /**
   * Routes the contextual action key through one priority-ordered owner.
   * Mission interactions must win over vehicle exit, otherwise pressing E at
   * a sabotage target would accidentally abandon the required vehicle.
   */
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
    return false;
  }

  initGamepadEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log('🎮 Gamepad connected:', e.gamepad.id);
      this.state.isGamepadConnected = true;
      this.setInterface('GAMEPAD');
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log('🎮 Gamepad disconnected:', e.gamepad.id);
      this.state.isGamepadConnected = false;
      this.setInterface('KEYBOARD');
    });
  }

  setInterface(newInterface) {
    if (this.activeInterface !== newInterface) {
      this.activeInterface = newInterface;
      if (this.app && this.app.uiManager) {
        this.app.uiManager.updateControlDeviceBadge(newInterface);
      }
    }
  }

  applyDeadzone(val, deadzone = 0.15) {
    if (Math.abs(val) < deadzone) return 0;
    return (val - Math.sign(val) * deadzone) / (1 - deadzone);
  }

  getGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  isButtonPressed(gp, index) {
    if (!gp || !gp.buttons || !gp.buttons[index]) return false;
    const btn = gp.buttons[index];
    return typeof btn === 'object' ? btn.pressed : btn === 1.0;
  }

  getButtonValue(gp, index) {
    if (!gp || !gp.buttons || !gp.buttons[index]) return 0;
    const btn = gp.buttons[index];
    return typeof btn === 'object' ? btn.value : (btn === 1.0 ? 1.0 : 0);
  }

  justPressed(buttonId, isPressed) {
    const prev = !!this.previousGamepadButtons[buttonId];
    this.previousGamepadButtons[buttonId] = isPressed;
    return isPressed && !prev;
  }

  update(delta) {
    const gp = this.getGamepad();

    // 1. Check if gamepad is actively being used this frame
    let usingGamepadThisFrame = false;
    if (gp) {
      this.state.isGamepadConnected = true;

      // Check thumbsticks or buttons
      const lsX = this.applyDeadzone(gp.axes[0] || 0, this.deadzone);
      const lsY = this.applyDeadzone(gp.axes[1] || 0, this.deadzone);
      const rsX = this.applyDeadzone(gp.axes[2] || 0, this.deadzone);
      const rsY = this.applyDeadzone(gp.axes[3] || 0, this.deadzone);

      const rtVal = this.getButtonValue(gp, 7);
      const ltVal = this.getButtonValue(gp, 6);

      if (Math.abs(lsX) > 0.05 || Math.abs(lsY) > 0.05 || Math.abs(rsX) > 0.05 || Math.abs(rsY) > 0.05 || rtVal > 0.05 || ltVal > 0.05) {
        usingGamepadThisFrame = true;
      }
      for (let i = 0; i < gp.buttons.length; i++) {
        if (this.isButtonPressed(gp, i)) {
          usingGamepadThisFrame = true;
          break;
        }
      }

      if (usingGamepadThisFrame) {
        this.setInterface('GAMEPAD');
      }
    } else {
      this.state.isGamepadConnected = false;
    }

    // 2. Compute unified analog values combining active interface
    let throttle = 0;
    let brake = 0;
    let steer = 0;
    let cameraPanX = 0;
    let cameraPanY = 0;
    let handbrake = false;

    // Keyboard inputs
    const kForward = this.keys['w'] || this.keys['arrowup'];
    const kReverse = this.keys['s'] || this.keys['arrowdown'];
    const kLeft = this.keys['a'] || this.keys['arrowleft'];
    const kRight = this.keys['d'] || this.keys['arrowright'];
    const kHandbrake = this.keys[' '];

    if (kForward) throttle = 1.0;
    if (kReverse) brake = 1.0;
    if (kLeft) steer = 1.0;   // Left is +steer angle
    if (kRight) steer = -1.0; // Right is -steer angle
    if (kHandbrake) handbrake = true;

    // Gamepad analog override if active or connected
    if (gp && (this.activeInterface === 'GAMEPAD' || usingGamepadThisFrame)) {
      const gpThrottle = this.getButtonValue(gp, 7); // RT
      const gpBrake = this.getButtonValue(gp, 6);    // LT
      const lsX = this.applyDeadzone(gp.axes[0] || 0, this.deadzone);
      const rsX = this.applyDeadzone(gp.axes[2] || 0, this.deadzone);
      const rsY = this.applyDeadzone(gp.axes[3] || 0, this.deadzone);

      if (gpThrottle > 0.05) throttle = Math.max(throttle, gpThrottle);
      if (gpBrake > 0.05) brake = Math.max(brake, gpBrake);
      if (Math.abs(lsX) > 0.05) steer = -lsX; // Negative X axis is left (+steer)

      cameraPanX = rsX;
      cameraPanY = rsY;

      const btnA = this.isButtonPressed(gp, 0); // A Button
      if (btnA) handbrake = true;

      // Handle single-press Gamepad action buttons
      this.handleGamepadActions(gp);
    }

    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.steer = steer;
    this.state.cameraPanX = cameraPanX;
    this.state.cameraPanY = cameraPanY;
    this.state.handbrake = handbrake;
  }

  handleGamepadActions(gp) {
    // B Button (Btn 1): Exit vehicle / close dialog / close editor
    if (this.justPressed('btn1', this.isButtonPressed(gp, 1))) {
      if (this.app.uiManager && this.app.uiManager.cityEditorUI && this.app.uiManager.cityEditorUI.isVisible) {
        this.app.uiManager.toggleCityEditor();
      } else if (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle) {
        this.app.trafficSystem.exitControlledVehicle();
      }
    }

    // X Button (Btn 2): Toggle Fun Mode (Mayhem)
    if (this.justPressed('btn2', this.isButtonPressed(gp, 2))) {
      if (this.app.uiManager && this.app.uiManager.btnFunMode) {
        this.app.uiManager.btnFunMode.click();
      }
    }

    // Y Button (Btn 3): Action / Enter vehicle / Interact
    if (this.justPressed('btn3', this.isButtonPressed(gp, 3))) {
      if (this.app.pedestrianSystem && this.app.pedestrianSystem.controlledPedestrian) {
        this.app.pedestrianSystem.handlePedestrianActionKey();
      }
    }

    // Left Bumper (Btn 4): Honk Horn / Emergency Siren Toggle
    if (this.justPressed('btn4', this.isButtonPressed(gp, 4))) {
      const vehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
      if (vehicle && (vehicle.vType === 'AMBULANCE' || vehicle.isPolice) && vehicle.toggleAmbulanceSiren) {
        vehicle.toggleAmbulanceSiren(this.app.audioSystem);
      } else if (this.app.audioSystem) {
        if (vehicle && vehicle.isPolice) {
          this.app.audioSystem.playSiren(1.5);
        } else {
          this.app.audioSystem.playHonk();
        }
      }
    }

    // Right Bumper (Btn 5): Cycle Camera Presets
    if (this.justPressed('btn5', this.isButtonPressed(gp, 5))) {
      const presets = ['street', 'birdseye', 'downtown', 'bridge', 'park'];
      const current = this.app.sceneManager.activePreset || 'street';
      const nextIdx = (presets.indexOf(current) + 1) % presets.length;
      this.app.sceneManager.setCameraPreset(presets[nextIdx]);
      if (this.app.uiManager) {
        this.app.uiManager.showToast(`📹 Camera View: ${presets[nextIdx].toUpperCase()}`);
      }
    }

    // View / Back Button (Btn 8): Reset Vehicle
    if (this.justPressed('btn8', this.isButtonPressed(gp, 8))) {
      const vehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
      const physicsVehicle = vehicle ? vehicle.physicsVehicle : null;
      if (physicsVehicle && typeof physicsVehicle.resetPosition === 'function') {
        physicsVehicle.resetPosition();
        if (this.app.uiManager) {
          this.app.uiManager.showToast('🔄 Vehicle Orientation Reset');
        }
      }
    }

    // D-Pad Up (Btn 12): Toggle City Editor Mode
    if (this.justPressed('btn12', this.isButtonPressed(gp, 12))) {
      if (this.app.uiManager) {
        this.app.uiManager.toggleCityEditor();
      }
    }
  }
}
