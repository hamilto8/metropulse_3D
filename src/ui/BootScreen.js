import { BOOT_ACTIONS } from '../boot/SaveDiscovery.js';

const ACTION_BUTTON_IDS = Object.freeze({
  [BOOT_ACTIONS.NEW_GAME]: 'btn-boot-new-game',
  [BOOT_ACTIONS.CONTINUE]: 'btn-boot-continue',
  [BOOT_ACTIONS.RECOVER]: 'btn-boot-recover'
});

function formatSaveDate(savedAt) {
  if (!savedAt) return 'Saved city available';
  try {
    return `Saved ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(savedAt))}`;
  } catch {
    return 'Saved city available';
  }
}

export class BootScreen {
  constructor({ root = globalThis.document, heroUrl = null } = {}) {
    this.root = root;
    this.element = root?.getElementById?.('boot-screen');
    this.appElement = root?.getElementById?.('app');
    this.status = root?.getElementById?.('boot-status');
    this.progress = root?.getElementById?.('boot-progress');
    this.progressLabel = root?.getElementById?.('boot-progress-label');
    this.steps = new Map(
      [...(root?.querySelectorAll?.('[data-boot-stage]') || [])]
        .map(element => [element.dataset.bootStage, element])
    );
    this.actions = root?.getElementById?.('boot-actions');
    this.errorPanel = root?.getElementById?.('boot-error');
    this.errorTitle = root?.getElementById?.('boot-error-title');
    this.errorMessage = root?.getElementById?.('boot-error-message');
    this.errorActions = root?.getElementById?.('boot-error-actions');
    this.retryButton = root?.getElementById?.('btn-boot-retry');
    this.warning = root?.getElementById?.('boot-warning');
    this.buttons = new Map(
      Object.entries(ACTION_BUTTON_IDS).map(([action, id]) => [action, root?.getElementById?.(id)])
    );
    this.actionHandler = null;
    this.retryHandler = null;
    this.busy = false;

    if (!this.element || !this.appElement) throw new Error('Boot screen markup is incomplete.');
    if (heroUrl) this.element.style.setProperty('--boot-hero-image', `url("${heroUrl}")`);
    this.setAppInteractive(false);
    this.bindActions();
    this.retryButton?.addEventListener?.('click', () => this.retryHandler?.());
  }

  bindActions() {
    for (const [action, button] of this.buttons) {
      button?.addEventListener?.('click', () => this.actionHandler?.(action));
    }
  }

  onAction(handler) {
    this.actionHandler = handler;
  }

  onRetry(handler) {
    this.retryHandler = handler;
  }

  setAppInteractive(interactive) {
    this.appElement.inert = !interactive;
    this.appElement.setAttribute('aria-hidden', String(!interactive));
  }

  reset() {
    this.busy = false;
    this.actions.hidden = true;
    this.errorPanel.hidden = true;
    this.warning.hidden = true;
    this.warning.textContent = '';
    this.progress.value = 0;
    this.progressLabel.textContent = '0%';
    this.status.textContent = 'Starting secure city systems…';
    this.retryHandler = null;
    for (const element of this.steps.values()) {
      element.dataset.status = 'PENDING';
    }
    for (const button of this.buttons.values()) {
      button.hidden = true;
      button.disabled = true;
    }
  }

  renderProgress(event) {
    const percent = Math.round(event.progress * 86);
    this.progress.value = percent;
    this.progressLabel.textContent = `${percent}%`;
    this.status.textContent = event.status === 'FAILED'
      ? `${event.label} needs attention.`
      : event.status === 'COMPLETE'
        ? `${event.label} complete.`
        : event.label;
    const element = this.steps.get(event.stageId);
    if (element) element.dataset.status = event.status;
  }

  renderReady(results) {
    const discovery = results.saves;
    this.progress.value = 90;
    this.progressLabel.textContent = '90%';
    this.status.textContent = 'Choose how to enter MetroPulse.';
    this.actions.hidden = false;
    const warnings = [
      ...(results.settings?.warnings || []),
      discovery.current.present && !discovery.current.valid
        ? `Continue is unavailable: ${discovery.current.reason}`
        : null
    ].filter(Boolean);
    if (warnings.length > 0) {
      this.warning.textContent = warnings.join(' ');
      this.warning.hidden = false;
    }

    for (const [action, button] of this.buttons) {
      const available = Boolean(discovery.actions[action]);
      button.hidden = !available;
      button.disabled = !available;
    }
    const continueMeta = this.root.getElementById('boot-continue-meta');
    const recoveryMeta = this.root.getElementById('boot-recovery-meta');
    if (continueMeta) continueMeta.textContent = formatSaveDate(discovery.current.savedAt);
    if (recoveryMeta) recoveryMeta.textContent = formatSaveDate(discovery.recovery.savedAt);
    [...this.buttons.values()].find(button => button && !button.hidden)?.focus?.();
  }

  renderLaunching(action) {
    if (this.busy) return false;
    this.busy = true;
    for (const button of this.buttons.values()) button.disabled = true;
    const labels = {
      [BOOT_ACTIONS.NEW_GAME]: 'Creating a new city…',
      [BOOT_ACTIONS.CONTINUE]: 'Restoring your city…',
      [BOOT_ACTIONS.RECOVER]: 'Recovering the previous city…'
    };
    this.status.textContent = labels[action] || 'Preparing MetroPulse…';
    this.progress.value = 94;
    this.progressLabel.textContent = '94%';
    return true;
  }

  renderError(error) {
    this.busy = false;
    this.actions.hidden = true;
    this.errorPanel.hidden = false;
    this.errorTitle.textContent = error?.code === 'INCOMPATIBLE_BROWSER'
      ? 'Browser setup required'
      : 'MetroPulse could not finish startup';
    this.errorMessage.textContent = error?.userMessage || error?.message || 'An unexpected startup error occurred.';
    this.errorActions.replaceChildren();
    const actions = [...new Set(error?.actions || [])];
    for (const guidance of actions) {
      const item = this.root.createElement('li');
      item.textContent = guidance;
      this.errorActions.appendChild(item);
    }
    this.retryButton.focus?.();
  }

  complete() {
    this.progress.value = 100;
    this.progressLabel.textContent = '100%';
    this.setAppInteractive(true);
    this.element.hidden = true;
  }
}

export default BootScreen;
