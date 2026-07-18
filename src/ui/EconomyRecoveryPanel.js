import { FISCAL_STATES } from '../systems/EconomyBalance.js';

const STATUS_CLASSES = Object.freeze({
  [FISCAL_STATES.STABLE]: 'stable',
  [FISCAL_STATES.DEFICIT]: 'deficit',
  [FISCAL_STATES.INSOLVENT]: 'insolvent',
  [FISCAL_STATES.RECOVERY]: 'recovery'
});

/** Accessible projection of the authoritative fiscal and recovery contract. */
export class EconomyRecoveryPanel {
  constructor({ economySystem, root, onFeedback = null, onRecoveryStarted = null } = {}) {
    if (!economySystem?.subscribe || !economySystem?.requestEmergencyAssistance) {
      throw new TypeError('EconomyRecoveryPanel requires an observable EconomySystem');
    }
    this.economy = economySystem;
    this.root = root;
    this.onFeedback = onFeedback;
    this.onRecoveryStarted = onRecoveryStarted;
    this.elements = {
      status: root?.querySelector?.('[data-fiscal="status"]'),
      explanation: root?.querySelector?.('[data-fiscal="explanation"]'),
      runway: root?.querySelector?.('[data-fiscal="runway"]'),
      actions: root?.querySelector?.('[data-fiscal="actions"]'),
      assistance: root?.querySelector?.('[data-fiscal="assistance"]'),
      live: root?.querySelector?.('[data-fiscal="live"]')
    };
    this.onAssistance = () => {
      const result = this.economy.requestEmergencyAssistance();
      this.onFeedback?.(result.reason);
      if (result.granted) this.onRecoveryStarted?.(result);
    };
    this.elements.assistance?.addEventListener?.('click', this.onAssistance);
    this.unsubscribe = economySystem.subscribe(event => this.render(event.current), { emitCurrent: true });
  }

  render(snapshot) {
    const fiscal = snapshot?.fiscal;
    if (!fiscal) return false;
    const statusClass = STATUS_CLASSES[fiscal.status] || 'stable';
    if (this.root) {
      this.root.dataset.fiscalStatus = fiscal.status;
      this.root.className = `economy-recovery-card fiscal-${statusClass}`;
    }
    if (this.elements.status) this.elements.status.textContent = fiscal.label;
    if (this.elements.explanation) this.elements.explanation.textContent = fiscal.explanation;
    if (this.elements.runway) {
      this.elements.runway.textContent = fiscal.runwayMinutes == null
        ? `Reserve target $${fiscal.reserveFloor.toLocaleString()}`
        : `${Math.max(1, Math.ceil(fiscal.runwayMinutes))} min runway · reserve target $${fiscal.reserveFloor.toLocaleString()}`;
    }
    if (this.elements.actions) {
      this.elements.actions.replaceChildren(...fiscal.actions.map(action => {
        const item = document.createElement('li');
        item.textContent = action;
        return item;
      }));
    }
    if (this.elements.assistance) {
      this.elements.assistance.hidden = !fiscal.assistanceEligible;
      this.elements.assistance.disabled = !fiscal.assistanceEligible;
      this.elements.assistance.textContent = `Claim $${fiscal.emergencyGrant.toLocaleString()} stabilization grant`;
    }
    if (this.elements.live) {
      this.elements.live.textContent = `${fiscal.label}. ${fiscal.explanation}`;
    }
    return true;
  }

  dispose() {
    this.unsubscribe?.();
    this.elements.assistance?.removeEventListener?.('click', this.onAssistance);
  }
}

export default EconomyRecoveryPanel;
