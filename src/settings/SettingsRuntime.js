import { CONTROL_CONTEXTS } from '../systems/ControlBindings.js';

/** Applies renderer-independent settings snapshots to their live consumers. */
export class SettingsRuntime {
  constructor({ store, app, documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
    if (!store?.subscribe) throw new TypeError('SettingsRuntime requires a settings store.');
    this.store = store;
    this.app = app;
    this.document = documentRef;
    this.window = windowRef;
    this.unsubscribe = store.subscribe(event => this.apply(event.current), { emitCurrent: true });
  }

  prefersReducedMotion(setting) {
    if (setting === 'REDUCE') return true;
    if (setting === 'FULL') return false;
    return Boolean(this.window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }

  apply(snapshot = this.store.snapshot()) {
    const settings = snapshot.settings;
    const root = this.document?.documentElement;
    if (root) {
      root.style.setProperty('--ui-text-scale', String(settings.textScale));
      root.dataset.contrastMode = settings.contrastMode.toLowerCase();
      root.dataset.colorSafePatterns = settings.colorSafePatterns ? 'on' : 'off';
      root.dataset.reducedMotion = this.prefersReducedMotion(settings.motion.reducedMotion) ? 'on' : 'off';
      root.dataset.flashIntensity = settings.motion.flashIntensity.toLowerCase();
      root.dataset.subtitles = settings.subtitles.enabled ? 'on' : 'off';
      root.dataset.closedCaptions = settings.subtitles.closedCaptions ? 'on' : 'off';
      root.dataset.difficulty = settings.difficulty.toLowerCase();
    }

    this.app.settings = structuredClone(settings);
    this.app.audioSystem?.applySettings?.(settings.audio);
    if (this.app.sceneManager?.controls) {
      const controls = this.app.sceneManager.controls;
      controls.rotateSpeed = settings.mouseSensitivity
        * settings.cameraSensitivity.orbit;
      const orbitInput = this.store.getBindings(CONTROL_CONTEXTS.MANAGEMENT, 'ORBIT')[0];
      if (controls.mouseButtons) {
        controls.mouseButtons.LEFT = orbitInput === 'Mouse0' ? 0 : null;
        controls.mouseButtons.MIDDLE = orbitInput === 'Mouse1' ? 0 : 1;
        controls.mouseButtons.RIGHT = orbitInput === 'Mouse2' ? 0 : 2;
      }
    }
    if (this.app.sceneManager?.bloomPass) {
      this.app.sceneManager.bloomPass.enabled = settings.motion.bloom !== 'OFF';
      this.app.sceneManager.bloomPreference = settings.motion.bloom;
    }
    this.app.uiManager?.updateAdaptiveControls?.(true);
    this.app.interactionPrompt?.update?.();
    return settings;
  }

  destroy() {
    this.unsubscribe?.();
  }
}

export default SettingsRuntime;
