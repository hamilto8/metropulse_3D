import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_TYPES
} from '../alerts/AlertService.js';
import {
  MISSION_OUTCOME_COMMANDS as COMMANDS,
  REPAIR_STATUSES,
  WORK_ORDER_TYPES
} from '../missions/MissionOutcomeService.js';

const REPAIR_STATUS_NAMES = new Set(REPAIR_STATUSES);
const WORK_TYPE_NAMES = new Set(WORK_ORDER_TYPES);

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function position(value, label = 'position') {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.z)) {
    throw new TypeError(`${label} requires finite x and z`);
  }
  return { x: value.x, z: value.z };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function activeStatus(status) {
  return status === 'SCHEDULED' || status === 'IN_PROGRESS';
}

/**
 * Coordinates management funding and street work through the existing atomic
 * outcome contract. It owns no parallel incident state: work orders, outages,
 * and damage are always derived from MissionOutcomeService.
 */
export class IncidentResponseService {
  constructor({ outcomeService, economySystem, alertService = null } = {}) {
    if (!outcomeService?.apply || !outcomeService?.snapshot) {
      throw new TypeError('IncidentResponseService requires MissionOutcomeService');
    }
    if (!economySystem?.snapshot || !economySystem?.canAfford) {
      throw new TypeError('IncidentResponseService requires EconomySystem');
    }
    if (alertService !== null && !alertService?.publish) {
      throw new TypeError('alertService must be an AlertService or null');
    }
    this.outcomes = outcomeService;
    this.economy = economySystem;
    this.alerts = alertService;
  }

  reportIncident(definition) {
    const incident = this.#normalizeIncident(definition);
    const current = this.outcomes.snapshot().incidents?.[incident.id];
    if (current) {
      if (current.active) return freeze({ duplicate: true, incident: { id: incident.id, ...clone(current) } });
      throw new Error(`Incident ID cannot be reused after resolution: ${incident.id}`);
    }

    const outageId = incident.service ? `outage:${incident.id}` : null;
    const cleanupId = incident.cleanupRequired ? `work:${incident.id}:cleanup` : null;
    const repairId = incident.repairRequired ? `work:${incident.id}:repair` : null;
    const commands = [{
      type: COMMANDS.INCIDENT_RECORDED,
      incidentId: incident.id,
      incidentType: incident.type,
      title: incident.title,
      cause: incident.cause,
      targetId: incident.targetId,
      service: incident.service,
      districtId: incident.districtId,
      severity: incident.severity,
      cleanupRequired: incident.cleanupRequired,
      repairRequired: incident.repairRequired,
      happinessModifier: incident.happinessModifier,
      landValueModifier: incident.landValueModifier,
      position: incident.position,
      influenceRadius: incident.influenceRadius,
      reason: incident.cause
    }];

    if (incident.infrastructureId) {
      commands.push({
        type: COMMANDS.INFRASTRUCTURE_STATE_SET,
        infrastructureId: incident.infrastructureId,
        districtId: incident.districtId,
        state: 'DAMAGED',
        access: incident.access,
        condition: clamp(1 - incident.severity / 10, 0.1, 0.9),
        safety: clamp(1 - incident.severity / 8, 0.05, 0.9),
        reason: `${incident.title} damaged this asset.`
      });
    }
    if (outageId) {
      commands.push({
        type: COMMANDS.SERVICE_OUTAGE_SET,
        outageId,
        service: incident.service,
        targetId: incident.targetId,
        cause: incident.cause,
        districtId: incident.districtId,
        position: incident.position,
        influenceRadius: incident.influenceRadius,
        active: true,
        severity: clamp(incident.severity / 10, 0, 1),
        coverageMultiplier: incident.coverageMultiplier,
        reason: incident.cause
      });
    }
    if (cleanupId) {
      commands.push(this.#newWorkOrderCommand({
        id: cleanupId,
        workType: 'CLEANUP',
        label: `Clear ${incident.title.toLowerCase()} debris`,
        incident,
        estimatedCost: incident.cleanupCost,
        outageId,
        resolvesIncident: !incident.repairRequired
      }));
    }
    if (repairId) {
      commands.push(this.#newWorkOrderCommand({
        id: repairId,
        workType: 'REPAIR',
        label: `Repair ${incident.title.toLowerCase()}`,
        incident,
        estimatedCost: incident.repairCost,
        prerequisiteTargetId: cleanupId,
        outageId,
        resolvesIncident: true
      }));
    }

    const receipt = this.outcomes.apply({
      transactionId: `incident:${incident.id}:reported`,
      source: {
        kind: 'SYSTEM', contentId: incident.id, outcome: 'REPORTED', reason: incident.cause
      },
      summary: {
        title: incident.title,
        description: `${incident.cause} A funded response can create street work objectives.`
      },
      commands
    });
    this.#publishIncidentAlert(incident, { scheduled: false });
    return freeze({ receipt, incident: this.getIncident(incident.id) });
  }

  scheduleResponse(incidentId) {
    const id = nonEmpty(incidentId, 'incidentId');
    const incident = this.getIncident(id);
    if (!incident?.active) throw new Error(`Active incident not found: ${id}`);
    const orders = this.getWorkOrders().filter(order => order.incidentId === id);
    if (orders.length === 0) throw new Error(`Incident ${id} has no response work orders`);
    const unscheduled = orders.filter(order => order.status === 'NOT_STARTED' || order.status === 'CANCELLED');
    if (unscheduled.length === 0) return freeze({ duplicate: true, incident, workOrders: orders });
    const cost = unscheduled.reduce((total, order) => total + order.estimatedCost, 0);
    if (!this.economy.canAfford(cost)) {
      throw new Error(`Response requires $${cost.toLocaleString()} Capital; only $${Math.floor(this.economy.treasury).toLocaleString()} is available.`);
    }
    const commands = [
      ...(cost > 0 ? [{
        type: COMMANDS.CAPITAL_ADJUSTED,
        amount: -cost,
        reason: `Funded cleanup and repair response for ${incident.title || id}.`
      }] : []),
      ...unscheduled.map(order => this.#workOrderCommand(order, {
        status: 'SCHEDULED', progress: 0,
        reason: 'Management funded this street work order.'
      }))
    ];
    const receipt = this.outcomes.apply({
      transactionId: `management:incident:${id}:response-funded`,
      source: {
        kind: 'MANAGEMENT', contentId: id, outcome: 'FUNDED',
        reason: `Management committed $${cost.toLocaleString()} to the response.`
      },
      summary: {
        title: `${incident.title || 'Incident'} response funded`,
        description: 'Cleanup and repair tasks are now available as street objectives.'
      },
      commands
    });
    this.#publishIncidentAlert(incident, { scheduled: true });
    return freeze({ receipt, incident: this.getIncident(id), workOrders: this.getWorkOrders().filter(order => order.incidentId === id) });
  }

  performStreetWork(workOrderId, { progress = 0.5 } = {}) {
    const id = nonEmpty(workOrderId, 'workOrderId');
    const order = this.getWorkOrder(id);
    if (!order) throw new Error(`Work order not found: ${id}`);
    if (!activeStatus(order.status)) throw new Error(`Work order ${id} must be scheduled before street work begins`);
    if (!order.position) throw new Error(`Work order ${id} has no street location`);
    const prerequisite = order.prerequisiteTargetId ? this.getWorkOrder(order.prerequisiteTargetId) : null;
    if (order.prerequisiteTargetId && prerequisite?.status !== 'COMPLETE') {
      throw new Error(`${prerequisite?.label || 'Required cleanup'} must be completed first`);
    }
    const increment = clamp(finite(progress, 'progress'), 0.01, 1);
    const nextProgress = clamp(order.progress + increment, 0, 1);
    const complete = nextProgress >= 1;
    const commands = [this.#workOrderCommand(order, {
      status: complete ? 'COMPLETE' : 'IN_PROGRESS',
      progress: nextProgress,
      reason: complete ? `${order.label || id} completed on site.` : `${order.label || id} advanced on site.`
    })];
    const state = this.outcomes.snapshot();
    const incident = order.incidentId ? state.incidents?.[order.incidentId] : null;
    const outage = order.outageId ? state.serviceOutages?.[order.outageId] : null;
    const infrastructure = order.infrastructureId ? state.infrastructure?.[order.infrastructureId] : null;
    if (complete && order.resolvesIncident) {
      if (outage?.active) {
        commands.push({
          type: COMMANDS.SERVICE_OUTAGE_SET,
          outageId: order.outageId,
          service: outage.service,
          targetId: outage.targetId,
          cause: outage.cause,
          districtId: outage.districtId,
          position: outage.position,
          influenceRadius: outage.influenceRadius,
          active: false,
          severity: outage.severity,
          coverageMultiplier: outage.coverageMultiplier,
          reason: 'Field work restored local service.'
        });
      }
      if (infrastructure) {
        commands.push({
          type: COMMANDS.INFRASTRUCTURE_STATE_SET,
          infrastructureId: order.infrastructureId,
          districtId: infrastructure.districtId,
          state: 'ACTIVE', access: 'OPEN', condition: 1, safety: 1,
          reason: 'Field work restored the damaged asset.'
        });
      }
      if (incident?.active) {
        commands.push({
          type: COMMANDS.INCIDENT_RESOLVED,
          incidentId: order.incidentId,
          reason: 'All required cleanup and repair work is complete.'
        });
      }
    }
    const step = Math.round(nextProgress * 1000);
    const receipt = this.outcomes.apply({
      transactionId: `street-work:${id}:${step}`,
      source: {
        kind: 'SYSTEM', contentId: id, outcome: complete ? 'COMPLETE' : 'PROGRESSED',
        actorId: 'player', reason: complete ? 'The player completed the field objective.' : 'The player advanced the field objective.'
      },
      summary: {
        title: complete ? `${order.label || 'Street work'} complete` : `${order.label || 'Street work'} in progress`,
        description: complete && order.resolvesIncident
          ? 'Local service and infrastructure consequences were resolved.'
          : `${Math.round(nextProgress * 100)}% of the required field work is complete.`
      },
      commands
    });
    if (complete && order.resolvesIncident) this.#publishResolution(order, incident);
    return freeze({ receipt, workOrder: this.getWorkOrder(id), incident: order.incidentId ? this.getIncident(order.incidentId) : null });
  }

  getIncident(id) {
    const record = this.outcomes.snapshot().incidents?.[nonEmpty(id, 'incidentId')];
    return record ? freeze({ id, ...clone(record) }) : null;
  }

  getWorkOrder(id) {
    return this.getWorkOrders().find(order => order.id === id) ?? null;
  }

  getWorkOrders() {
    const repairs = this.outcomes.snapshot().repairs || {};
    const orders = Object.entries(repairs).map(([id, record]) => {
      const workType = WORK_TYPE_NAMES.has(record.workType) ? record.workType : 'REPAIR';
      const status = REPAIR_STATUS_NAMES.has(record.status) ? record.status : 'NOT_STARTED';
      const prerequisite = record.prerequisiteTargetId ? repairs[record.prerequisiteTargetId] : null;
      const prerequisiteMet = !record.prerequisiteTargetId || prerequisite?.status === 'COMPLETE';
      return {
        id,
        ...clone(record),
        workType,
        status,
        prerequisiteMet,
        actionable: activeStatus(status) && prerequisiteMet && Boolean(record.position)
      };
    });
    return freeze(orders.sort((left, right) => left.id.localeCompare(right.id)));
  }

  getIncidentSummaries() {
    const state = this.outcomes.snapshot();
    const orders = this.getWorkOrders();
    return freeze(Object.entries(state.incidents || {})
      .filter(([, incident]) => incident.active)
      .map(([id, incident]) => {
        const workOrders = orders.filter(order => order.incidentId === id);
        return {
          id,
          ...clone(incident),
          title: incident.title || `${String(incident.type || 'Service').replaceAll('_', ' ')} incident`,
          workOrders,
          responseCost: workOrders
            .filter(order => order.status === 'NOT_STARTED' || order.status === 'CANCELLED')
            .reduce((total, order) => total + order.estimatedCost, 0),
          responseScheduled: workOrders.length > 0 && workOrders.every(order => !['NOT_STARTED', 'CANCELLED'].includes(order.status))
        };
      }));
  }

  #normalizeIncident(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('incident definition must be an object');
    const severity = clamp(finite(value.severity ?? 4, 'incident.severity'), 0, 10);
    const service = value.service == null ? null : nonEmpty(value.service, 'incident.service').toLowerCase();
    if (service !== null && !['power', 'water', 'fire'].includes(service)) {
      throw new RangeError('incident.service must be power, water, or fire');
    }
    const cleanupRequired = value.cleanupRequired ?? true;
    const repairRequired = value.repairRequired ?? true;
    if (typeof cleanupRequired !== 'boolean' || typeof repairRequired !== 'boolean') {
      throw new TypeError('incident cleanupRequired and repairRequired must be booleans');
    }
    if (!cleanupRequired && !repairRequired) throw new RangeError('an incident response requires cleanup or repair work');
    const id = nonEmpty(value.id, 'incident.id');
    return {
      id,
      type: nonEmpty(value.type || (service ? 'SERVICE_OUTAGE' : 'INFRASTRUCTURE_DAMAGE'), 'incident.type').toUpperCase(),
      title: nonEmpty(value.title || 'Infrastructure incident', 'incident.title'),
      cause: nonEmpty(value.cause || 'A local asset failed and requires a field response.', 'incident.cause'),
      targetId: nonEmpty(value.targetId || id, 'incident.targetId'),
      infrastructureId: value.infrastructureId == null ? null : nonEmpty(value.infrastructureId, 'incident.infrastructureId'),
      districtId: value.districtId == null ? null : nonEmpty(value.districtId, 'incident.districtId'),
      service,
      severity,
      cleanupRequired,
      repairRequired,
      cleanupCost: Math.max(0, finite(value.cleanupCost ?? severity * 350, 'incident.cleanupCost')),
      repairCost: Math.max(0, finite(value.repairCost ?? severity * 850, 'incident.repairCost')),
      coverageMultiplier: clamp(finite(value.coverageMultiplier ?? Math.max(0.2, 1 - severity / 10), 'incident.coverageMultiplier'), 0, 1),
      happinessModifier: finite(value.happinessModifier ?? -(severity * 0.5), 'incident.happinessModifier'),
      landValueModifier: finite(value.landValueModifier ?? -severity, 'incident.landValueModifier'),
      position: position(value.position, 'incident.position'),
      influenceRadius: Math.max(1, finite(value.influenceRadius ?? 75, 'incident.influenceRadius')),
      interactionRadius: clamp(finite(value.interactionRadius ?? 7, 'incident.interactionRadius'), 1, 25),
      access: ['OPEN', 'RESTRICTED', 'CLOSED'].includes(value.access) ? value.access : 'RESTRICTED'
    };
  }

  #newWorkOrderCommand({
    id, workType, label, incident, estimatedCost,
    prerequisiteTargetId = null, outageId = null, resolvesIncident = false
  }) {
    return {
      type: COMMANDS.REPAIR_SET,
      targetId: id,
      workType,
      label,
      incidentId: incident.id,
      prerequisiteTargetId,
      outageId,
      infrastructureId: incident.infrastructureId,
      service: incident.service,
      districtId: incident.districtId,
      position: incident.position,
      interactionRadius: incident.interactionRadius,
      resolvesIncident,
      status: 'NOT_STARTED',
      progress: 0,
      estimatedCost,
      reason: `${label} is required before the incident can be resolved.`
    };
  }

  #workOrderCommand(order, changes = {}) {
    return {
      type: COMMANDS.REPAIR_SET,
      targetId: order.id,
      workType: order.workType,
      label: order.label,
      incidentId: order.incidentId,
      prerequisiteTargetId: order.prerequisiteTargetId,
      outageId: order.outageId,
      infrastructureId: order.infrastructureId,
      service: order.service,
      districtId: order.districtId,
      position: order.position,
      interactionRadius: order.interactionRadius,
      resolvesIncident: order.resolvesIncident,
      status: changes.status ?? order.status,
      progress: changes.progress ?? order.progress,
      estimatedCost: order.estimatedCost,
      reason: changes.reason
    };
  }

  #publishIncidentAlert(incident, { scheduled }) {
    this.alerts?.publish({
      dedupeKey: `service-incident:${incident.id}`,
      type: ALERT_TYPES.INFRASTRUCTURE,
      severity: incident.severity >= 7 ? ALERT_SEVERITIES.CRITICAL : ALERT_SEVERITIES.WARNING,
      title: scheduled ? `${incident.title} response ready` : incident.title,
      cause: scheduled
        ? 'Management funded the response; cleanup and repair now require street work.'
        : incident.cause,
      location: {
        label: incident.districtId ? incident.districtId.replaceAll('_', ' ').toLowerCase() : 'Service response site',
        districtId: incident.districtId,
        position: { ...incident.position, y: 0 }
      },
      duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
      recommendation: scheduled
        ? 'Enter Street Mode, set the waypoint, and complete cleanup before repair.'
        : 'Inspect the site and fund its response from City Services.',
      relatedEntityIds: [incident.id, incident.targetId].filter(Boolean),
      focusAction: {
        type: scheduled ? ALERT_FOCUS_ACTIONS.STREET_WAYPOINT : ALERT_FOCUS_ACTIONS.MANAGEMENT_CAMERA,
        position: { ...incident.position, y: 0 }
      }
    });
  }

  #publishResolution(order, incident) {
    const key = `service-incident:${order.incidentId}`;
    this.alerts?.resolve(key, 'Cleanup and repair objectives completed');
    this.alerts?.publish({
      dedupeKey: `${key}:resolved`,
      type: ALERT_TYPES.INFRASTRUCTURE,
      severity: ALERT_SEVERITIES.SUCCESS,
      title: `${incident?.title || order.label || 'Service incident'} resolved`,
      cause: 'Field work restored the asset and cleared the local service impact.',
      location: { label: 'Response site', position: { ...order.position, y: 0 } },
      duration: { kind: ALERT_DURATION_KINDS.TIMED, seconds: 120 },
      recommendation: 'No further action is required. Review City Services for the restored aggregate metric.',
      relatedEntityIds: [order.incidentId, order.id].filter(Boolean),
      focusAction: { type: ALERT_FOCUS_ACTIONS.NONE }
    });
  }
}

export default IncidentResponseService;
