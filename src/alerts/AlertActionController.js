import { ALERT_FOCUS_ACTIONS, ALERT_STATES } from './AlertService.js';

function freezeClone(value) {
  const copy = structuredClone(value);
  Object.freeze(copy);
  Object.values(copy).forEach(item => {
    if (item && typeof item === 'object') Object.freeze(item);
  });
  return copy;
}

export class AlertActionController {
  constructor({ alertService, sceneManager, getGameState = () => 'MANAGEMENT', onFeedback = () => {} } = {}) {
    if (!alertService?.find) throw new TypeError('AlertActionController requires an alert service');
    if (!sceneManager?.focusWorldPosition) throw new TypeError('AlertActionController requires a focus-capable scene manager');
    this.alertService = alertService;
    this.sceneManager = sceneManager;
    this.getGameState = getGameState;
    this.onFeedback = onFeedback;
    this.waypoint = null;
    this.unsubscribe = alertService.subscribe(event => this.#syncLifecycle(event.current));
  }

  execute(alertOrId) {
    const alertId = typeof alertOrId === 'string' ? alertOrId : alertOrId?.id;
    const alert = this.alertService.find(alertId);
    if (!alert) return this.#result(false, 'Alert is no longer available.');
    if (alert.state !== ALERT_STATES.ACTIVE) return this.#result(false, 'This alert is no longer active.');

    const action = alert.focusAction;
    if (action.type === ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA) {
      const state = this.getGameState();
      if (!['MANAGEMENT', 'BUILDER'].includes(state)) {
        return this.#result(false, 'Return to Management to focus the city camera.');
      }
      const focused = this.sceneManager.focusWorldPosition(action.position);
      return this.#result(Boolean(focused), focused ? `Camera focused on ${alert.location.label}.` : 'Camera focus is unavailable.');
    }

    if (action.type === ALERT_FOCUS_ACTIONS.STREET_WAYPOINT) {
      this.waypoint = freezeClone({
        alertId: alert.id,
        label: alert.location.label,
        position: action.position
      });
      return this.#result(true, `Waypoint set for ${alert.location.label}.`);
    }

    return this.#result(false, 'This alert has no focus action.');
  }

  getWaypoint() {
    return this.waypoint;
  }

  clearWaypoint() {
    const hadWaypoint = Boolean(this.waypoint);
    this.waypoint = null;
    return hadWaypoint;
  }

  destroy() {
    this.unsubscribe?.();
    this.waypoint = null;
  }

  #syncLifecycle(snapshot) {
    if (!this.waypoint) return;
    const owner = snapshot.items.find(alert => alert.id === this.waypoint.alertId);
    if (!owner || owner.state !== ALERT_STATES.ACTIVE) this.waypoint = null;
  }

  #result(ok, message) {
    this.onFeedback(message, ok);
    return Object.freeze({ ok, message, waypoint: this.waypoint });
  }
}
