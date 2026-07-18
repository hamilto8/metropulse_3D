/**
 * DOM presenter for the one primary interaction selected by InteractionService.
 * Game rules and ranking remain renderer-independent in the service.
 */
export class InteractionPrompt {
  constructor({ service, getActionLabel = () => 'E', documentRef = globalThis.document } = {}) {
    if (!service?.refresh) throw new TypeError('InteractionPrompt requires an interaction service');
    if (typeof getActionLabel !== 'function') throw new TypeError('getActionLabel must be a function');
    this.service = service;
    this.getActionLabel = getActionLabel;
    this.document = documentRef || null;
    this.element = null;
    this.renderedSignature = null;
  }

  update() {
    return this.render(this.service.refresh().primary);
  }

  render(interaction) {
    const element = this.getOrCreateElement();
    if (!element) return false;
    if (!interaction) {
      this.renderedSignature = null;
      element.classList.add('hidden');
      element.removeAttribute('data-interaction-id');
      element.removeAttribute('data-interaction-kind');
      element.removeAttribute('data-interaction-eligible');
      element.removeAttribute('aria-label');
      return false;
    }

    const actionLabel = this.getActionLabel('INTERACT') || 'E';
    const signature = [
      interaction.id,
      interaction.eligibility.allowed,
      interaction.prompt,
      interaction.failureReason,
      actionLabel
    ].join('|');
    if (signature !== this.renderedSignature) {
      const prefix = this.document.createTextNode('Press ');
      const key = this.document.createElement('span');
      key.className = 'prompt-key';
      key.textContent = actionLabel;
      const prompt = this.document.createTextNode(` to ${interaction.prompt}`);
      const children = [prefix, key, prompt];
      if (!interaction.eligibility.allowed) {
        const reason = this.document.createElement('span');
        reason.className = 'interaction-failure-reason';
        reason.textContent = ` — ${interaction.failureReason}`;
        children.push(reason);
      }
      element.replaceChildren(...children);
      this.renderedSignature = signature;
    }

    element.dataset.interactionId = interaction.id;
    element.dataset.interactionKind = interaction.kind;
    element.dataset.interactionEligible = String(interaction.eligibility.allowed);
    const unavailable = interaction.eligibility.allowed ? '' : ` Unavailable: ${interaction.failureReason}`;
    element.setAttribute(
      'aria-label',
      `${actionLabel}: ${interaction.accessibilityLabel}.${unavailable}`.trim()
    );
    element.classList.remove('hidden');
    return true;
  }

  getOrCreateElement() {
    if (this.element && this.element.isConnected !== false) return this.element;
    if (!this.document?.body) return null;
    this.element = this.document.getElementById('primary-interaction-prompt');
    if (this.element) return this.element;

    this.element = this.document.createElement('div');
    this.element.id = 'primary-interaction-prompt';
    this.element.className = 'primary-interaction-prompt hidden';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.setAttribute('aria-atomic', 'true');
    this.document.body.appendChild(this.element);
    return this.element;
  }
}

export default InteractionPrompt;
