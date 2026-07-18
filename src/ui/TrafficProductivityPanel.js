import { BRIDGE_POLICIES } from '../systems/TrafficProductivityModel.js';

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

/** Accessible management readout for the aggregate traffic decision loop. */
export class TrafficProductivityPanel {
  constructor({ model, root, policyButton, onPolicyChange, onFeedback = null } = {}) {
    if (!model?.subscribe || !model?.snapshot) throw new TypeError('model must expose subscribe() and snapshot()');
    this.model = model;
    this.root = root;
    this.policyButton = policyButton;
    this.onPolicyChange = onPolicyChange || (enabled => model.toggleBridgePriority(enabled));
    this.onFeedback = onFeedback;
    this.elements = {
      congestion: root?.querySelector?.('[data-mobility="congestion"]'),
      bridge: root?.querySelector?.('[data-mobility="bridge"]'),
      productivity: root?.querySelector?.('[data-mobility="productivity"]'),
      jobs: root?.querySelector?.('[data-mobility="jobs"]'),
      deliveries: root?.querySelector?.('[data-mobility="deliveries"]'),
      satisfaction: root?.querySelector?.('[data-mobility="satisfaction"]'),
      policy: root?.querySelector?.('[data-mobility="policy"]'),
      tradeoff: root?.querySelector?.('[data-mobility="tradeoff"]'),
      status: root?.querySelector?.('[data-mobility="status"]')
    };
    this.onClick = () => {
      const enable = this.model.bridgePolicy !== BRIDGE_POLICIES.FREIGHT_PRIORITY;
      const changed = this.onPolicyChange(enable);
      if (changed === false) return;
      this.onFeedback?.(enable
        ? 'Freight priority active: delivery flow improves for $120/min and −2 satisfaction.'
        : 'Balanced bridge access restored: operating cost and commuter penalty removed.');
    };
    this.policyButton?.addEventListener?.('click', this.onClick);
    this.unsubscribe = model.subscribe(event => this.render(event.current), { emitCurrent: true });
  }

  render(snapshot) {
    if (!snapshot) return false;
    if (this.elements.congestion) this.elements.congestion.textContent = `${percent(snapshot.network.congestion)} · ${snapshot.network.rating}`;
    if (this.elements.bridge) this.elements.bridge.textContent = `${percent(snapshot.bridge.congestion)} · ${snapshot.bridge.access}`;
    if (this.elements.productivity) this.elements.productivity.textContent = `${snapshot.productivity.percent}%`;
    if (this.elements.jobs) this.elements.jobs.textContent = `${snapshot.jobs.accessibleJobs.toLocaleString()} reachable`;
    if (this.elements.deliveries) this.elements.deliveries.textContent = `${snapshot.deliveries.onTimePercent}% on time`;
    if (this.elements.satisfaction) this.elements.satisfaction.textContent = `${snapshot.satisfaction.roundedModifier > 0 ? '+' : ''}${snapshot.satisfaction.roundedModifier}`;
    if (this.elements.policy) this.elements.policy.textContent = snapshot.policy.label;
    if (this.elements.tradeoff) this.elements.tradeoff.textContent = snapshot.policy.tradeoff;
    if (this.elements.status) this.elements.status.textContent = snapshot.explanation.join(' ');
    if (this.policyButton) {
      const priority = snapshot.policy.id === BRIDGE_POLICIES.FREIGHT_PRIORITY;
      this.policyButton.classList.toggle('active', priority);
      this.policyButton.setAttribute('aria-pressed', String(priority));
      this.policyButton.textContent = priority
        ? '🌉 Restore Balanced Bridge Access'
        : '🚚 Enable Freight Priority';
      this.policyButton.title = priority
        ? 'Remove the $120/min cost and 2-point satisfaction penalty; delivery advantage ends.'
        : 'Improve bridge capacity and delivery reliability; costs $120/min and 2 satisfaction.';
    }
    return true;
  }

  dispose() {
    this.unsubscribe?.();
    this.policyButton?.removeEventListener?.('click', this.onClick);
  }
}

export default TrafficProductivityPanel;
