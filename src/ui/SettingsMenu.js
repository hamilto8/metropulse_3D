import {
  CONTROL_CONTEXTS,
  formatKeyboardMouseInput,
  getControlBindings
} from '../systems/ControlBindings.js';
import { SETTING_ENUMS } from '../settings/SettingsSchema.js';

const FIELD_GROUPS = Object.freeze([
  Object.freeze({
    title: 'Camera & mouse',
    fields: Object.freeze([
      { path: 'mouseSensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.1 },
      { path: 'cameraSensitivity.orbit', label: 'Orbit camera', type: 'range', min: 0.2, max: 3, step: 0.1 },
      { path: 'cameraSensitivity.onFoot', label: 'On-foot camera', type: 'range', min: 0.2, max: 3, step: 0.1 },
      { path: 'cameraSensitivity.vehicle', label: 'Vehicle camera', type: 'range', min: 0.2, max: 3, step: 0.1 }
    ])
  }),
  Object.freeze({
    title: 'Audio & subtitles',
    fields: Object.freeze([
      ...['master', 'music', 'effects', 'ambience', 'dialogue'].map(channel => ({
        path: `audio.${channel}`, label: `${channel[0].toUpperCase()}${channel.slice(1)} volume`, type: 'range', min: 0, max: 1, step: 0.05
      })),
      { path: 'subtitles.enabled', label: 'Subtitles', type: 'checkbox' },
      { path: 'subtitles.speakerLabels', label: 'Speaker labels', type: 'checkbox' },
      { path: 'subtitles.closedCaptions', label: 'Sound captions', type: 'checkbox' }
    ])
  }),
  Object.freeze({
    title: 'Display & motion',
    fields: Object.freeze([
      { path: 'textScale', label: 'Text scale', type: 'range', min: 0.8, max: 1.5, step: 0.05 },
      { path: 'contrastMode', label: 'Contrast', type: 'select', options: SETTING_ENUMS.contrastMode },
      { path: 'colorSafePatterns', label: 'Color-safe patterns', type: 'checkbox' },
      { path: 'motion.reducedMotion', label: 'Motion preference', type: 'select', options: SETTING_ENUMS.reducedMotion },
      { path: 'motion.cameraShake', label: 'Camera shake', type: 'range', min: 0, max: 1, step: 0.1 },
      { path: 'motion.flashIntensity', label: 'Flashes', type: 'select', options: SETTING_ENUMS.flashIntensity },
      { path: 'motion.bloom', label: 'Bloom', type: 'select', options: SETTING_ENUMS.bloom }
    ])
  }),
  Object.freeze({
    title: 'Play style & assists',
    fields: Object.freeze([
      { path: 'toggleHold.sprint', label: 'Sprint input', type: 'select', options: SETTING_ENUMS.toggleHold },
      { path: 'toggleHold.braking', label: 'Brake input', type: 'select', options: SETTING_ENUMS.toggleHold },
      { path: 'toggleHold.repeatedActions', label: 'Repeated actions', type: 'select', options: SETTING_ENUMS.toggleHold },
      { path: 'drivingAssists.steering', label: 'Steering', type: 'select', options: SETTING_ENUMS.drivingSteering },
      { path: 'drivingAssists.autoRecovery', label: 'Automatic vehicle recovery', type: 'checkbox' },
      { path: 'drivingAssists.brakingAssist', label: 'Braking assist', type: 'checkbox' },
      { path: 'difficulty', label: 'Action difficulty', type: 'select', options: SETTING_ENUMS.difficulty },
      { path: 'timerLeniency', label: 'Mission timer leniency', type: 'range', min: 1, max: 2, step: 0.1 }
    ])
  })
]);

function titleCase(value) {
  return String(value).toLowerCase().replaceAll('_', ' ').replace(/^.|\s./g, match => match.toUpperCase());
}

/** Accessible pause-menu editor for SettingsStore. Contains presentation only. */
export class SettingsMenu {
  constructor({ store, root = document } = {}) {
    if (!store?.subscribe) throw new TypeError('SettingsMenu requires a settings store.');
    this.store = store;
    this.root = root;
    this.openButton = root.getElementById('btn-open-settings');
    this.backButton = root.getElementById('btn-settings-back');
    this.mainPanel = root.getElementById('pause-main-panel');
    this.panel = root.getElementById('settings-panel');
    this.fieldsRoot = root.getElementById('settings-fields');
    this.contextSelect = root.getElementById('settings-binding-context');
    this.bindingsRoot = root.getElementById('settings-bindings-list');
    this.status = root.getElementById('settings-status');
    this.resetContextButton = root.getElementById('btn-reset-context-bindings');
    this.resetBindingsButton = root.getElementById('btn-reset-all-bindings');
    this.resetAllButton = root.getElementById('btn-reset-all-settings');
    this.captureCleanup = null;

    this.buildContextOptions();
    this.buildFields();
    this.openButton?.addEventListener('click', () => this.open());
    this.backButton?.addEventListener('click', () => this.close());
    this.contextSelect?.addEventListener('change', () => this.renderBindings());
    this.resetContextButton?.addEventListener('click', () => {
      this.store.resetContext(this.contextSelect.value);
      this.announce(`${titleCase(this.contextSelect.value)} bindings reset.`);
    });
    this.resetBindingsButton?.addEventListener('click', () => {
      this.store.resetBindings();
      this.announce('All keyboard and mouse bindings reset.');
    });
    this.resetAllButton?.addEventListener('click', () => {
      this.store.resetAll();
      this.announce('All settings and bindings reset.');
    });
    this.unsubscribe = this.store.subscribe(() => this.render(), { emitCurrent: true });
  }

  buildContextOptions() {
    if (!this.contextSelect || this.contextSelect.options.length > 0) return;
    for (const context of Object.values(CONTROL_CONTEXTS)) {
      const option = document.createElement('option');
      option.value = context;
      option.textContent = titleCase(context);
      this.contextSelect.appendChild(option);
    }
  }

  buildFields() {
    if (!this.fieldsRoot || this.fieldsRoot.childElementCount > 0) return;
    for (const group of FIELD_GROUPS) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = group.title;
      fieldset.appendChild(legend);
      for (const field of group.fields) fieldset.appendChild(this.createField(field));
      this.fieldsRoot.appendChild(fieldset);
    }
  }

  createField(field) {
    const label = document.createElement('label');
    label.className = 'settings-field';
    const text = document.createElement('span');
    text.textContent = field.label;
    const control = document.createElement(field.type === 'select' ? 'select' : 'input');
    control.dataset.settingPath = field.path;
    control.setAttribute('aria-label', field.label);
    if (field.type === 'select') {
      for (const value of field.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = titleCase(value);
        control.appendChild(option);
      }
    } else {
      control.type = field.type;
      if (field.type === 'range') {
        control.min = String(field.min);
        control.max = String(field.max);
        control.step = String(field.step);
        const output = document.createElement('output');
        output.dataset.outputFor = field.path;
        label.append(text, control, output);
      }
    }
    if (!label.contains(control)) label.append(text, control);
    const eventName = field.type === 'range' ? 'input' : 'change';
    control.addEventListener(eventName, () => {
      const value = field.type === 'checkbox'
        ? control.checked
        : field.type === 'range'
          ? Number(control.value)
          : control.value;
      try {
        this.store.set(field.path, value);
        this.announce(`${field.label} updated.`);
      } catch (error) {
        this.announce(error.message, true);
        this.renderFields();
      }
    });
    return label;
  }

  render() {
    this.renderFields();
    this.renderBindings();
  }

  renderFields() {
    for (const control of this.fieldsRoot?.querySelectorAll?.('[data-setting-path]') || []) {
      const value = this.store.get(control.dataset.settingPath);
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      const output = this.fieldsRoot.querySelector(`[data-output-for="${control.dataset.settingPath}"]`);
      if (output) output.value = Number(value).toFixed(control.step < 0.1 ? 2 : 1).replace(/\.0$/, '');
    }
  }

  renderBindings() {
    if (!this.bindingsRoot || !this.contextSelect) return;
    const context = this.contextSelect.value || CONTROL_CONTEXTS.MANAGEMENT;
    this.bindingsRoot.replaceChildren();
    const descriptions = new Map(getControlBindings(context).map(binding => [binding.action, binding.label]));
    for (const action of Object.keys(this.store.getDefaultBindings(context))) {
      const row = document.createElement('div');
      row.className = 'settings-binding-row';
      const label = document.createElement('span');
      label.textContent = descriptions.get(action) || titleCase(action);
      const controls = document.createElement('div');
      controls.className = 'settings-binding-buttons';
      this.store.getBindings(context, action).forEach((input, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = formatKeyboardMouseInput(input);
        button.disabled = input === 'PointerMove';
        button.title = button.disabled ? 'Pointer movement is a fixed analog input.' : `Rebind ${label.textContent}`;
        button.addEventListener('click', () => this.captureBinding({ context, action, index, button }));
        controls.appendChild(button);
      });
      row.append(label, controls);
      this.bindingsRoot.appendChild(row);
    }
  }

  captureBinding({ context, action, index, button }) {
    this.captureCleanup?.();
    button.textContent = 'Press a key or mouse button…';
    button.dataset.capturing = 'true';
    const finish = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      this.captureCleanup = null;
      this.renderBindings();
    };
    const apply = input => {
      try {
        this.store.setBinding(context, action, input, index);
        this.announce(`${titleCase(action)} is now ${formatKeyboardMouseInput(input)}.`);
      } catch (error) {
        this.announce(error.message, true);
      } finally {
        finish();
      }
    };
    const onKey = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code === 'Escape') return finish();
      apply(event.code || event.key);
    };
    const onPointer = event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      apply(`Mouse${event.button}`);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    this.captureCleanup = finish;
  }

  announce(message, error = false) {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.dataset.error = error ? 'true' : 'false';
  }

  open() {
    this.mainPanel?.setAttribute('hidden', '');
    this.panel?.removeAttribute('hidden');
    this.panel?.classList.remove('hidden');
    queueMicrotask(() => this.backButton?.focus?.({ preventScroll: true }));
  }

  close() {
    this.captureCleanup?.();
    this.panel?.setAttribute('hidden', '');
    this.panel?.classList.add('hidden');
    this.mainPanel?.removeAttribute('hidden');
    queueMicrotask(() => this.openButton?.focus?.({ preventScroll: true }));
  }

  resetView() {
    this.close();
    this.status.textContent = '';
  }

  destroy() {
    this.captureCleanup?.();
    this.unsubscribe?.();
  }
}

export default SettingsMenu;
