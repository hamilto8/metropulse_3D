import { GAME_STATES } from '../core/GameManager.js';
import { INTERACTION_PRIORITIES } from './InteractionService.js';

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

/** Adapts renderer-free work orders into the canonical interaction pipeline. */
export class ServiceWorkInteractionProvider {
  constructor({
    incidentResponseService,
    getPlayerPosition,
    isMissionCritical = () => false,
    discoveryRadius = 28
  } = {}) {
    if (!incidentResponseService?.getWorkOrders || !incidentResponseService?.performStreetWork) {
      throw new TypeError('ServiceWorkInteractionProvider requires IncidentResponseService');
    }
    if (typeof getPlayerPosition !== 'function') throw new TypeError('getPlayerPosition must be a function');
    if (typeof isMissionCritical !== 'function') throw new TypeError('isMissionCritical must be a function');
    if (!Number.isFinite(discoveryRadius) || discoveryRadius <= 0) throw new RangeError('discoveryRadius must be positive');
    this.response = incidentResponseService;
    this.getPlayerPosition = getPlayerPosition;
    this.isMissionCritical = isMissionCritical;
    this.discoveryRadius = discoveryRadius;
  }

  getInteractionCandidates(context = {}) {
    const player = this.getPlayerPosition();
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.z)) return [];
    if (this.isMissionCritical()) return [];
    return this.response.getWorkOrders()
      .filter(order => order.position && ['SCHEDULED', 'IN_PROGRESS'].includes(order.status))
      .map(order => ({ order, distance: distanceBetween(player, order.position) }))
      .filter(({ distance }) => distance <= this.discoveryRadius)
      .map(({ order, distance }) => {
        const onFoot = context.gameState === GAME_STATES.STREET_ON_FOOT;
        const closeEnough = distance <= (order.interactionRadius || 7);
        const allowed = onFoot && closeEnough && order.prerequisiteMet;
        const reason = !onFoot
          ? 'Exit the vehicle and approach the marked work site on foot.'
          : !order.prerequisiteMet
            ? 'Complete the cleanup objective before beginning repairs.'
            : !closeEnough
              ? `Move within ${Math.round(order.interactionRadius || 7)} metres of the work site.`
              : null;
        return {
          id: `service-work:${order.id}`,
          kind: order.workType === 'CLEANUP' ? 'SERVICE_CLEANUP' : 'SERVICE_REPAIR',
          priority: INTERACTION_PRIORITIES.SERVICE_OBJECTIVE,
          prompt: `${order.label || 'Complete service work'} (${Math.round(order.progress * 100)}%)`,
          accessibilityLabel: `${order.label || 'Service work'}, ${Math.round(order.progress * 100)} percent complete`,
          distance,
          eligibility: { allowed, reason },
          failureReason: reason,
          metadata: {
            workOrderId: order.id,
            incidentId: order.incidentId,
            progress: order.progress
          },
          action: () => this.response.performStreetWork(order.id)
        };
      });
  }
}

export default ServiceWorkInteractionProvider;
