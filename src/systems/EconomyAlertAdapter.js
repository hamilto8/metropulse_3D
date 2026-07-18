import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_TYPES
} from '../alerts/AlertService.js';
import { FISCAL_STATES } from './EconomyBalance.js';

/** Publishes one deduplicated, structured warning for authoritative fiscal stress. */
export class EconomyAlertAdapter {
  constructor({ economySystem, alertService } = {}) {
    if (!economySystem?.subscribe) throw new TypeError('economySystem must expose subscribe()');
    if (!alertService?.publish || !alertService?.resolve) {
      throw new TypeError('alertService must expose publish() and resolve()');
    }
    this.economy = economySystem;
    this.alerts = alertService;
    this.unsubscribe = economySystem.subscribe(event => this.sync(event.current), { emitCurrent: true });
  }

  sync(snapshot) {
    const fiscal = snapshot?.fiscal;
    if (!fiscal) return false;
    const key = 'economy:fiscal-recovery';
    if (fiscal.status === FISCAL_STATES.STABLE) {
      this.alerts.resolve(key, 'Recurring cashflow and emergency reserves are stable');
      return true;
    }
    const insolvent = fiscal.status === FISCAL_STATES.INSOLVENT;
    const recovering = fiscal.status === FISCAL_STATES.RECOVERY;
    this.alerts.publish({
      dedupeKey: key,
      type: ALERT_TYPES.ECONOMY,
      severity: insolvent ? ALERT_SEVERITIES.CRITICAL : ALERT_SEVERITIES.WARNING,
      title: insolvent
        ? 'City Capital exhausted — recovery available'
        : recovering ? 'Fiscal recovery restrictions active' : 'City budget is running a deficit',
      cause: `${fiscal.explanation} Net cashflow is ${snapshot.budgetBreakdown.netRate >= 0 ? '+' : '−'}$${Math.abs(Math.round(snapshot.budgetBreakdown.netRate * 60)).toLocaleString()}/min.`,
      location: 'Citywide treasury',
      duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
      recommendation: fiscal.assistanceEligible
        ? `Claim the $${fiscal.emergencyGrant.toLocaleString()} stabilization grant, then complete contracts or remove optional upkeep.`
        : fiscal.actions.join(' '),
      relatedEntityIds: [],
      focusAction: { type: ALERT_FOCUS_ACTIONS.NONE }
    });
    return true;
  }

  dispose() {
    this.unsubscribe?.();
  }
}

export default EconomyAlertAdapter;
