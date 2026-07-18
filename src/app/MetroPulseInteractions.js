import { CONTROL_CONTEXTS } from '../systems/ControlBindings.js';
import { InteractionService } from '../systems/InteractionService.js';

const BLOCKED_CONTEXTS = new Set([
  CONTROL_CONTEXTS.BUILDER,
  CONTROL_CONTEXTS.DIALOGUE,
  CONTROL_CONTEXTS.PAUSE
]);

/**
 * Production composition root for interaction publishers. Adding a new
 * interactable requires one provider registration, not another input branch.
 */
export function createMetroPulseInteractionService(app) {
  if (!app) throw new TypeError('app is required');
  const service = new InteractionService({
    contextProvider: () => ({
      controlContext: app.inputManager?.getControlContext?.() || CONTROL_CONTEXTS.MANAGEMENT,
      gameState: app.gameManager?.state || null,
      inputInterface: app.inputManager?.activeInterface || null
    }),
    onFailure: reason => app.uiManager?.showToast?.(`⚠️ ${reason}`),
    onError: (error, source) => {
      console.error(`Interaction provider failed (${source}).`, error);
    }
  });

  const register = (id, owner) => service.registerProvider({
    id,
    getCandidates: context => {
      if (BLOCKED_CONTEXTS.has(context.controlContext)) return [];
      return owner?.getInteractionCandidates?.(context) || [];
    }
  });

  register('missions', app.missionSystem);
  register('service-work', app.serviceWorkInteractionProvider);
  register('aircraft', app.aircraftSystem);
  register('traffic', app.trafficSystem);
  register('pedestrians', app.pedestrianSystem);
  register('selected-entity', app.uiManager);
  return service;
}

export default createMetroPulseInteractionService;
