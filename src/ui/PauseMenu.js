const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Accessible DOM presentation for PauseManager's menu hold. */
export class PauseMenu {
  constructor({ pauseManager, root = document } = {}) {
    if (!pauseManager?.subscribe) throw new TypeError('pauseManager is required');
    this.pauseManager = pauseManager;
    this.overlay = root?.getElementById?.('pause-menu');
    this.resumeButton = root?.getElementById?.('btn-resume-game');
    this.stateLabel = root?.getElementById?.('pause-resume-state');
    this.previousFocus = null;
    this.onKeyDown = this.onKeyDown.bind(this);

    this.resumeButton?.addEventListener('click', () => {
      this.pauseManager.closeMenu({ source: 'PauseMenu' });
    });
    this.unsubscribe = this.pauseManager.subscribe(
      event => this.render(event.current),
      { emitCurrent: true }
    );
  }

  get isVisible() {
    return Boolean(this.overlay && !this.overlay.classList.contains('hidden'));
  }

  render(snapshot) {
    if (!this.overlay) return;
    if (snapshot.menuOpen) this.show(snapshot);
    else this.hide();
  }

  show(snapshot = this.pauseManager.snapshot()) {
    if (!this.overlay || this.isVisible) return false;
    this.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (this.stateLabel) {
      this.stateLabel.textContent = String(snapshot.resumeState || 'game').replaceAll('_', ' ');
    }
    this.overlay.classList.remove('hidden');
    document.body.classList.add('pause-menu-open');
    document.body.dataset.controlContext = 'pause';
    document.addEventListener('keydown', this.onKeyDown, true);
    queueMicrotask(() => this.resumeButton?.focus?.({ preventScroll: true }));
    return true;
  }

  hide() {
    if (!this.overlay || !this.isVisible) return false;
    this.overlay.classList.add('hidden');
    document.body.classList.remove('pause-menu-open');
    document.removeEventListener('keydown', this.onKeyDown, true);
    const focusTarget = this.previousFocus;
    this.previousFocus = null;
    queueMicrotask(() => focusTarget?.focus?.({ preventScroll: true }));
    return true;
  }

  onKeyDown(event) {
    if (!this.isVisible) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const settingsPanel = this.overlay.querySelector('#settings-panel');
      if (settingsPanel && !settingsPanel.hasAttribute('hidden')) {
        this.overlay.querySelector('#btn-settings-back')?.click?.();
        return;
      }
      this.pauseManager.closeMenu({ source: 'PauseMenu.keyboard' });
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...this.overlay.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(element => !element.closest('[hidden], .hidden'));
    if (focusable.length === 0) {
      event.preventDefault();
      this.overlay.querySelector('[tabindex="-1"]')?.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  destroy() {
    this.unsubscribe?.();
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.overlay?.classList.add('hidden');
  }
}

export default PauseMenu;
