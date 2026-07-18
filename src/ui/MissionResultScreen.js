import { createTextElement } from './dom.js';
import {
  RESULT_SECTION_IDS,
  buildMissionResultHistory,
  buildMissionResultViewModel
} from './MissionResultViewModel.js';

const SECTION_ICONS = Object.freeze({
  [RESULT_SECTION_IDS.REWARD]: '◇',
  [RESULT_SECTION_IDS.CITY]: '⌂',
  [RESULT_SECTION_IDS.FACTION]: '◎',
  [RESULT_SECTION_IDS.PROGRESSION]: '↑'
});

function focusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.offsetParent !== null);
}

export class MissionResultScreen {
  constructor({ lifecycle, outcomeService, missions = [], onRetry, onContinue, documentRef = document } = {}) {
    if (!lifecycle?.subscribe || !outcomeService?.subscribe) {
      throw new TypeError('MissionResultScreen requires lifecycle and outcome services');
    }
    this.lifecycle = lifecycle;
    this.outcomeService = outcomeService;
    this.missions = missions;
    this.onRetry = onRetry;
    this.onContinue = onContinue;
    this.document = documentRef;
    this.root = documentRef.getElementById('mission-result-screen');
    this.card = documentRef.getElementById('mission-result-card');
    this.resultPanel = documentRef.getElementById('mission-result-current');
    this.historyPanel = documentRef.getElementById('mission-result-history');
    this.badge = documentRef.getElementById('mission-result-badge');
    this.title = documentRef.getElementById('mission-result-title');
    this.description = documentRef.getElementById('mission-result-description');
    this.whyList = documentRef.getElementById('mission-result-why-list');
    this.sections = documentRef.getElementById('mission-result-sections');
    this.nextTitle = documentRef.getElementById('mission-result-next-title');
    this.nextDescription = documentRef.getElementById('mission-result-next-description');
    this.retryButton = documentRef.getElementById('btn-result-retry');
    this.continueButton = documentRef.getElementById('btn-result-continue');
    this.historyButton = documentRef.getElementById('btn-result-history');
    this.historyCloseButton = documentRef.getElementById('btn-result-history-close');
    this.historyList = documentRef.getElementById('mission-result-history-list');
    this.historyEmpty = documentRef.getElementById('mission-result-history-empty');
    this.logButton = documentRef.getElementById('btn-outcome-log');
    this.logCount = documentRef.getElementById('outcome-log-count');
    this.liveRegion = documentRef.getElementById('mission-result-announcement');
    if (!this.root || !this.card) throw new Error('Mission result screen markup is unavailable');

    this.currentSnapshot = lifecycle.snapshot?.() || null;
    this.currentViewModel = null;
    this.mode = null;
    this.previouslyFocused = null;
    this.lastAnnouncedTransactionId = null;
    this.boundKeydown = event => this.handleKeydown(event);

    this.retryButton?.addEventListener('click', () => this.onRetry?.());
    this.continueButton?.addEventListener('click', () => this.onContinue?.());
    this.historyButton?.addEventListener('click', () => this.openHistory());
    this.historyCloseButton?.addEventListener('click', () => this.closeHistory());
    this.logButton?.addEventListener('click', () => this.openHistory());
    this.root.addEventListener('keydown', this.boundKeydown);

    this.unsubscribeOutcome = outcomeService.subscribe(() => this.syncHistory(), { emitCurrent: true });
    this.unsubscribeLifecycle = lifecycle.subscribe(event => this.syncLifecycle(event?.current || event), { emitCurrent: true });
  }

  syncLifecycle(snapshot) {
    this.currentSnapshot = snapshot;
    if (snapshot?.phase !== 'RESULT' || !snapshot.run?.transactionId) {
      this.currentViewModel = null;
      if (this.mode === 'result') this.hide();
      return;
    }
    const explanation = this.outcomeService.explain(snapshot.run.transactionId);
    if (!explanation) return;
    const mission = this.missions.find(candidate => candidate.id === snapshot.selectedMissionId) || null;
    const receipt = this.outcomeService.getReceipt?.(snapshot.run.transactionId);
    this.currentViewModel = buildMissionResultViewModel({
      lifecycleSnapshot: snapshot,
      explanation,
      mission,
      retryDecision: this.lifecycle.getRetryDecision?.() || null,
      sequence: receipt?.sequence ?? null
    });
    this.renderCurrent(this.currentViewModel);
    if (this.mode !== 'history') this.show('result');
  }

  syncHistory() {
    const receipts = this.outcomeService.snapshot?.().transactions || [];
    const entries = buildMissionResultHistory({
      receipts,
      lifecycleSnapshot: this.currentSnapshot,
      missions: this.missions
    });
    this.historyEntries = entries;
    if (this.logCount) this.logCount.textContent = String(entries.length);
    if (this.logButton) {
      this.logButton.disabled = entries.length === 0;
      this.logButton.setAttribute('aria-label', `Review outcome log, ${entries.length} recorded result${entries.length === 1 ? '' : 's'}`);
    }
    if (this.mode === 'history') this.renderHistory(entries);
  }

  renderCurrent(viewModel) {
    this.root.dataset.resultTone = viewModel.tone;
    if (this.badge) this.badge.textContent = viewModel.outcomeLabel;
    if (this.title) this.title.textContent = viewModel.title;
    if (this.description) this.description.textContent = viewModel.description;
    this.renderWhy(this.whyList, viewModel.why);
    this.renderSections(this.sections, viewModel.sections);
    if (this.nextTitle) this.nextTitle.textContent = viewModel.nextAction.title;
    if (this.nextDescription) this.nextDescription.textContent = viewModel.nextAction.description;
    if (this.retryButton) {
      this.retryButton.hidden = !viewModel.nextAction.canRetry;
      this.retryButton.disabled = !viewModel.nextAction.canRetry;
      this.retryButton.textContent = viewModel.nextAction.retryLabel;
    }
    if (this.continueButton) this.continueButton.textContent = viewModel.nextAction.continueLabel;
    if (viewModel.transactionId !== this.lastAnnouncedTransactionId) {
      this.lastAnnouncedTransactionId = viewModel.transactionId;
      this.announce(viewModel.announcement);
    }
  }

  renderWhy(container, reasons) {
    if (!container) return;
    container.replaceChildren(...reasons.map(reason => createTextElement('li', 'mission-result-why-item', reason)));
  }

  renderSections(container, sections) {
    if (!container) return;
    const cards = sections.map(section => {
      const card = createTextElement('section', 'mission-result-section');
      card.dataset.section = section.id.toLowerCase();
      const header = createTextElement('div', 'mission-result-section-header');
      header.append(
        createTextElement('span', 'mission-result-section-icon', SECTION_ICONS[section.id] || '•'),
        createTextElement('h3', '', section.title)
      );
      card.appendChild(header);
      if (section.items.length === 0) {
        card.appendChild(createTextElement('p', 'mission-result-empty', section.empty));
        return card;
      }
      const list = createTextElement('ul', 'mission-result-effect-list');
      for (const item of section.items) {
        const row = createTextElement('li', 'mission-result-effect');
        const summary = createTextElement('div', 'mission-result-effect-summary');
        summary.append(
          createTextElement('span', 'mission-result-effect-label', item.label),
          createTextElement('strong', 'mission-result-effect-value', item.value)
        );
        row.append(summary, createTextElement('p', 'mission-result-effect-explanation', item.explanation));
        list.appendChild(row);
      }
      card.appendChild(list);
      return card;
    });
    container.replaceChildren(...cards);
  }

  renderHistory(entries = this.historyEntries || []) {
    if (!this.historyList) return;
    this.historyEmpty?.classList.toggle('hidden', entries.length > 0);
    const records = entries.map(entry => {
      const details = createTextElement('details', 'mission-result-log-entry');
      if (entry.transactionId === this.currentViewModel?.transactionId) details.open = true;
      const summary = createTextElement('summary', 'mission-result-log-summary');
      const identity = createTextElement('span', 'mission-result-log-identity');
      identity.append(
        createTextElement('span', 'mission-result-log-sequence', entry.sequence == null ? 'Recorded outcome' : `Outcome ${entry.sequence}`),
        createTextElement('strong', '', entry.title)
      );
      const badge = createTextElement('span', 'mission-result-log-badge', entry.outcomeLabel);
      badge.dataset.tone = entry.tone;
      summary.append(identity, badge);
      const body = createTextElement('div', 'mission-result-log-body');
      body.append(
        createTextElement('p', 'mission-result-log-description', entry.description),
        createTextElement('h4', '', 'Why it happened')
      );
      const why = createTextElement('ul', 'mission-result-why-list');
      this.renderWhy(why, entry.why);
      const sections = createTextElement('div', 'mission-result-sections mission-result-log-sections');
      this.renderSections(sections, entry.sections);
      body.append(why, sections);
      details.append(summary, body);
      return details;
    });
    this.historyList.replaceChildren(...records);
  }

  openHistory() {
    this.syncHistory();
    this.renderHistory();
    this.show('history');
  }

  closeHistory() {
    if (this.currentViewModel && this.currentSnapshot?.phase === 'RESULT') {
      this.show('result');
      return;
    }
    this.hide();
  }

  show(mode) {
    const wasHidden = this.root.classList.contains('hidden');
    if (wasHidden) this.previouslyFocused = this.document.activeElement;
    this.mode = mode;
    this.resultPanel.hidden = mode !== 'result';
    this.historyPanel.hidden = mode !== 'history';
    this.root.setAttribute('aria-labelledby', mode === 'history' ? 'mission-result-history-title' : 'mission-result-title');
    if (mode === 'history') this.root.removeAttribute('aria-describedby');
    else this.root.setAttribute('aria-describedby', 'mission-result-description');
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    const focusTarget = mode === 'history' ? this.historyCloseButton : this.card;
    if (wasHidden || this.document.activeElement === this.document.body) {
      requestAnimationFrame(() => focusTarget?.focus());
    }
  }

  hide() {
    this.mode = null;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus();
    this.previouslyFocused = null;
  }

  announce(message) {
    if (!this.liveRegion) return;
    this.liveRegion.textContent = '';
    requestAnimationFrame(() => { this.liveRegion.textContent = message; });
  }

  handleKeydown(event) {
    event.stopPropagation();
    if (event.key === 'Escape' && this.mode === 'history') {
      event.preventDefault();
      this.closeHistory();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(this.root);
    if (focusable.length === 0) {
      event.preventDefault();
      this.card.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  destroy() {
    this.unsubscribeLifecycle?.();
    this.unsubscribeOutcome?.();
    this.root.removeEventListener('keydown', this.boundKeydown);
  }
}

export default MissionResultScreen;
