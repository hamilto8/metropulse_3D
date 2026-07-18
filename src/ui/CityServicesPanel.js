import { createTextElement } from './dom.js';

const HEALTH_LABELS = Object.freeze({
  HEALTHY: 'Healthy',
  STRAINED: 'Strained',
  CRITICAL: 'Critical'
});

function serviceSummary(name, reading) {
  return `${name} ${Math.round(reading.coveragePercent)}% · ${HEALTH_LABELS[reading.health] || reading.health}`;
}

/** Accessible DOM projection for the renderer-free city service owners. */
export class CityServicesPanel {
  constructor({ cityServiceModel, incidentResponseService, root, onFeedback = () => {} } = {}) {
    if (!cityServiceModel?.subscribe || !cityServiceModel?.snapshot) {
      throw new TypeError('CityServicesPanel requires CityServiceModel');
    }
    if (!incidentResponseService?.getIncidentSummaries || !incidentResponseService?.scheduleResponse) {
      throw new TypeError('CityServicesPanel requires IncidentResponseService');
    }
    if (!root?.querySelector) throw new TypeError('CityServicesPanel requires a root element');
    this.model = cityServiceModel;
    this.response = incidentResponseService;
    this.root = root;
    this.onFeedback = onFeedback;
    this.energy = root.querySelector('#service-energy-summary');
    this.safety = root.querySelector('#service-safety-summary');
    this.workList = root.querySelector('#service-work-orders');
    this.status = root.querySelector('#service-response-status');
    this.boundClick = event => this.handleClick(event);
    root.addEventListener('click', this.boundClick);
    this.unsubscribe = cityServiceModel.subscribe(event => this.render(event.current), { emitCurrent: true });
  }

  render(snapshot = this.model.snapshot()) {
    if (this.energy) {
      this.energy.textContent = serviceSummary('Energy', snapshot.energy);
      this.energy.dataset.health = snapshot.energy.health.toLowerCase();
      this.energy.title = snapshot.energy.explanation;
    }
    if (this.safety) {
      this.safety.textContent = serviceSummary('Safety', snapshot.safety);
      this.safety.dataset.health = snapshot.safety.health.toLowerCase();
      this.safety.title = snapshot.safety.explanation;
    }
    if (!this.workList) return;
    const incidents = this.response.getIncidentSummaries();
    if (incidents.length === 0) {
      this.workList.replaceChildren(createTextElement('p', 'service-empty', 'No local incidents require a response.'));
      return;
    }
    this.workList.replaceChildren(...incidents.map(incident => this.#incidentCard(incident)));
  }

  handleClick(event) {
    const button = event.target.closest?.('[data-schedule-incident]');
    if (!button || !this.root.contains(button)) return;
    const incidentId = button.dataset.scheduleIncident;
    button.disabled = true;
    try {
      const result = this.response.scheduleResponse(incidentId);
      const message = result.duplicate
        ? 'Response is already funded.'
        : 'Response funded. Enter Street Mode and follow the service waypoint.';
      this.#announce(message);
      this.onFeedback(message, true);
    } catch (error) {
      this.#announce(error.message);
      this.onFeedback(error.message, false);
    } finally {
      this.render();
    }
  }

  destroy() {
    this.unsubscribe?.();
    this.root.removeEventListener('click', this.boundClick);
  }

  #incidentCard(incident) {
    const card = createTextElement('article', 'service-incident-card');
    card.dataset.incidentId = incident.id;
    const heading = createTextElement('div', 'service-incident-heading');
    heading.append(
      createTextElement('strong', '', incident.title),
      createTextElement('span', 'service-severity', `Severity ${incident.severity}/10`)
    );
    card.append(
      heading,
      createTextElement('p', 'service-incident-cause', incident.cause || 'Local infrastructure requires attention.')
    );
    const tasks = createTextElement('ul', 'service-task-list');
    for (const order of incident.workOrders) {
      const item = createTextElement('li', 'service-task-row');
      item.dataset.workStatus = order.status.toLowerCase();
      item.append(
        createTextElement('span', '', order.label || order.id),
        createTextElement('strong', '', order.status === 'COMPLETE' ? 'Done' : `${Math.round(order.progress * 100)}%`)
      );
      tasks.appendChild(item);
    }
    card.appendChild(tasks);
    if (!incident.responseScheduled) {
      const button = createTextElement('button', 'service-response-button', `Fund response · $${incident.responseCost.toLocaleString()}`);
      button.type = 'button';
      button.dataset.scheduleIncident = incident.id;
      button.setAttribute('aria-label', `Fund response to ${incident.title} for $${incident.responseCost.toLocaleString()}`);
      card.appendChild(button);
    } else {
      card.appendChild(createTextElement('p', 'service-response-ready', 'Street objective ready · clear first, then repair'));
    }
    return card;
  }

  #announce(message) {
    if (!this.status) return;
    this.status.textContent = '';
    requestAnimationFrame(() => { this.status.textContent = message; });
  }
}

export default CityServicesPanel;
