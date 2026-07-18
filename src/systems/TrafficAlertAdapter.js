import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_TYPES
} from '../alerts/AlertService.js';

function bridgeFocus() {
  return {
    type: ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA,
    position: { x: 155, y: 0, z: 0 }
  };
}

/** Publishes structured alerts from aggregate mobility state changes. */
export class TrafficAlertAdapter {
  constructor({ model, alertService } = {}) {
    if (!model?.subscribe) throw new TypeError('model must expose subscribe()');
    if (!alertService?.publish || !alertService?.resolve) {
      throw new TypeError('alertService must expose publish() and resolve()');
    }
    this.model = model;
    this.alertService = alertService;
    this.unsubscribe = model.subscribe(event => this.sync(event.current), { emitCurrent: true });
  }

  sync(snapshot) {
    if (!snapshot) return false;
    const congestionKey = 'traffic:network-congestion';
    if (snapshot.network.congestion >= 0.5) {
      const hotspot = snapshot.network.hotspots[0];
      this.alertService.publish({
        dedupeKey: congestionKey,
        type: ALERT_TYPES.TRAFFIC,
        severity: snapshot.network.congestion >= 0.75
          ? ALERT_SEVERITIES.CRITICAL
          : ALERT_SEVERITIES.WARNING,
        title: 'Road congestion is reducing city productivity',
        cause: `${Math.round(snapshot.network.congestion * 100)}% aggregate congestion leaves productivity at ${snapshot.productivity.percent}% and ${snapshot.jobs.jobsDelayedByCommute.toLocaleString()} jobs commute-limited.`,
        location: hotspot
          ? { label: hotspot.label, position: { x: hotspot.x, y: 0, z: hotspot.z } }
          : 'City road network',
        duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
        recommendation: 'Clear incidents, connect road segments, or review bridge priority and its disclosed tradeoff.',
        relatedEntityIds: hotspot ? [hotspot.id] : [],
        focusAction: hotspot
          ? { type: ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA, position: { x: hotspot.x, y: 0, z: hotspot.z } }
          : { type: ALERT_FOCUS_ACTIONS.NONE }
      });
    } else {
      this.alertService.resolve(congestionKey, 'Aggregate congestion returned below the disruption threshold');
    }

    const bridgeKey = 'traffic:bridge-disruption';
    if (snapshot.bridge.outageActive || snapshot.bridge.access !== 'OPEN') {
      this.alertService.publish({
        dedupeKey: bridgeKey,
        type: ALERT_TYPES.TRAFFIC,
        severity: snapshot.bridge.access === 'CLOSED'
          ? ALERT_SEVERITIES.CRITICAL
          : ALERT_SEVERITIES.WARNING,
        title: snapshot.bridge.access === 'CLOSED' ? 'Primary bridge closed' : 'Primary bridge flow restricted',
        cause: `${snapshot.bridge.streetStatus}; on-time deliveries are ${snapshot.deliveries.onTimePercent}%.`,
        location: { label: 'Primary bridge corridor', position: { x: 155, y: 0, z: 0 } },
        duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
        recommendation: snapshot.bridge.outageActive
          ? 'Fund and complete the linked street repair work before relying on bridge priority.'
          : 'Inspect the bridge restriction and restore access.',
        relatedEntityIds: ['primary-bridge', ...snapshot.bridge.outageIds],
        focusAction: bridgeFocus()
      });
    } else {
      this.alertService.resolve(bridgeKey, 'Primary bridge access and service returned to normal');
    }

    const deliveryKey = 'traffic:delivery-reliability';
    if (snapshot.deliveries.reliability < 0.72) {
      this.alertService.publish({
        dedupeKey: deliveryKey,
        type: ALERT_TYPES.ECONOMY,
        severity: ALERT_SEVERITIES.WARNING,
        title: 'Delivery backlog is creating contract demand',
        cause: `${snapshot.deliveries.delayedPercent}% of aggregate deliveries are delayed by road and bridge conditions.`,
        location: 'Citywide logistics network',
        duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
        recommendation: 'Freight contracts now pay a disruption premium; freight priority improves reliability but costs $120/min and 2 satisfaction.',
        relatedEntityIds: [],
        focusAction: bridgeFocus()
      });
    } else {
      this.alertService.resolve(deliveryKey, 'Delivery reliability recovered above the backlog threshold');
    }
    return true;
  }

  dispose() {
    this.unsubscribe?.();
  }
}

export default TrafficAlertAdapter;
