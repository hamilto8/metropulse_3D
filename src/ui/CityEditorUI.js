import {
  getCatalogAccess,
  getCatalogByCategory,
  getBuildingSpec,
  getDefaultBuildingSpec
} from '../world/BuildingCatalog.js';
import { GAME_STATES } from '../core/GameManager.js';
import { createPlacementPreview } from '../world/PlacementIntelligence.js';
import { createTextElement } from './dom.js';

export class CityEditorUI {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.currentCategory = 'ALL';
    this.searchQuery = '';
    this.currentPage = 0;
    this.pageSize = 4;
    this.selectedSpecId = getDefaultBuildingSpec()?.id || null;
    this.includeAdvanced = false;
    this.isVisible = false;
    this.activeTool = 'PLACE'; // PLACE, MOVE, ROTATE, DELETE
    this.previousTimeBarDisplay = '';
    this.affordabilityRefreshTimer = null;

    this.initDOM();
    this.unsubscribePlacement = this.app.cityEditorSystem?.subscribePlacementValidation?.(
      validation => this.updatePlacementDecision(validation),
      { emitCurrent: true }
    ) || null;
    this.unsubscribeEconomy = this.app.economySystem?.subscribe?.(() => {
      if (!this.isVisible || this.affordabilityRefreshTimer) return;
      this.affordabilityRefreshTimer = setTimeout(() => {
        this.affordabilityRefreshTimer = null;
        if (!this.isVisible) return;
        this.app.cityEditorSystem?.refreshCurrentPlacementValidation?.();
        this.renderCatalog();
        this.refreshAffordability();
      }, 250);
    }) || null;
    this.unsubscribeProgression = this.app.missionOutcomeService?.subscribe?.(() => {
      if (!this.isVisible) return;
      this.ensureValidSelection();
      this.renderCatalog();
      this.updateBlueprintPreview(getBuildingSpec(this.selectedSpecId));
    }) || null;
  }

  initDOM() {
    this.container = document.createElement('div');
    this.container.className = 'city-editor-wrapper';
    this.container.style.display = 'none';
    this.container.innerHTML = `
      <!-- BUILDINGS Palette Tray -->
      <div class="buildings-palette-tray">
        <!-- Tray Header Bar -->
        <div class="tray-header-row">
          <div class="tray-title-group">
            <div class="tray-cube-icon">📦</div>
            <span>CONSTRUCTION</span>
          </div>
          <div class="tray-search-bar">
            <span>🔍</span>
            <input type="text" id="editor-search-input" placeholder="Search buildings...">
            <span class="tray-filter-status" title="Catalog search" aria-hidden="true">⌕</span>
          </div>
          <button class="tray-close-btn" id="btn-editor-close">✕ Exit Editor</button>
        </div>

        <!-- Category Tabs Row -->
        <div class="tray-tabs-row" id="editor-category-tabs">
          <button class="tray-tab-pill active" data-category="ALL">All</button>
          <button class="tray-tab-pill" data-category="RESIDENTIAL">Residential</button>
          <button class="tray-tab-pill" data-category="COMMERCIAL">Commercial</button>
          <button class="tray-tab-pill" data-category="OPERATIONS">Operations</button>
          <button class="tray-tab-pill" data-category="FACILITIES">Facilities</button>
          <button class="tray-tab-pill" data-category="INFRASTRUCTURE">Infrastructure</button>
          <label class="catalog-advanced-filter">
            <input type="checkbox" id="editor-advanced-filter">
            <span>Show advanced</span>
          </label>
        </div>

        <!-- Main Tray Body Grid -->
        <div class="tray-body-grid">
          <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
            <div class="tray-carousel-wrapper">
              <button class="carousel-nav-btn" id="btn-carousel-prev" title="Previous Page">&lt;</button>
              <div class="tray-cards-container" id="editor-cards-grid"></div>
              <button class="carousel-nav-btn" id="btn-carousel-next" title="Next Page">&gt;</button>
            </div>
            <div class="tray-dots-row" id="editor-carousel-dots"></div>
          </div>

          <!-- Right Side Blueprint Preview Box -->
          <div class="blueprint-preview-panel">
            <div class="blueprint-hologram-box">
              <div class="blueprint-hologram-icon" id="blueprint-icon">🏢</div>
              <div class="blueprint-hologram-label" id="blueprint-name">NeoTech Quantum Tower</div>
              <div class="blueprint-hologram-label" id="blueprint-price" aria-live="polite"></div>
              <div class="blueprint-impact" id="blueprint-impact"></div>
            </div>
            <dl class="placement-forecast" aria-label="Placement forecast">
              <div><dt>Operating</dt><dd id="placement-operating">—</dd></div>
              <div><dt>Net cashflow</dt><dd id="placement-cashflow">—</dd></div>
              <div><dt>Payback</dt><dd id="placement-payback">—</dd></div>
              <div><dt>Capacity</dt><dd id="placement-capacity">—</dd></div>
              <div><dt>Demand</dt><dd id="placement-demand">—</dd></div>
              <div><dt>Services</dt><dd id="placement-services">—</dd></div>
              <div><dt>Community</dt><dd id="placement-community">—</dd></div>
              <div><dt>Risk</dt><dd id="placement-risk">—</dd></div>
            </dl>
            <div class="placement-decision is-pending" id="placement-decision" role="status" aria-live="polite">
              <strong id="placement-decision-title">Move over the map</strong>
              <span id="placement-decision-message">Choose a parcel to validate access and construction requirements.</span>
              <span class="placement-remedy" id="placement-decision-remedy"></span>
            </div>
            <button class="place-building-btn" id="btn-place-building">
              <span>📦</span>
              <span id="btn-place-building-label">Place Building</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Transform / Placement Toolbar (Bottom-Right) -->
      <div class="editor-transform-toolbar">
        <button class="transform-tool-btn active" id="btn-tool-select" title="Place selected structure">
          <span class="transform-icon">↗</span>
          <span>Place</span>
        </button>
        <button class="transform-tool-btn" id="btn-tool-move" title="Select and move a user-built structure">
          <span class="transform-icon">✥</span>
          <span>Move</span>
        </button>
        <button class="transform-tool-btn" id="btn-tool-rotate" title="Rotate Structure 90° [R]">
          <span class="transform-icon">↻</span>
          <span>Rotate</span>
        </button>
        <button class="transform-tool-btn" id="btn-tool-delete" title="Demolish Structure Tool">
          <span class="transform-icon">🗑️</span>
          <span>Delete</span>
        </button>
      </div>

      <div class="controller-builder-cursor" id="controller-builder-cursor" aria-hidden="true">
        <span></span>
      </div>
    `;

    document.body.appendChild(this.container);
    this.controllerCursorEl = this.container.querySelector('#controller-builder-cursor');
    this.bindEvents();
    this.renderCatalog();
    this.updateBlueprintPreview(getBuildingSpec(this.selectedSpecId));
  }

  bindEvents() {
    // Search input
    const searchInput = this.container.querySelector('#editor-search-input');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.currentPage = 0;
      this.ensureValidSelection();
      this.renderCatalog();
      this.updateBlueprintPreview(getBuildingSpec(this.selectedSpecId));
    });

    const advancedFilter = this.container.querySelector('#editor-advanced-filter');
    advancedFilter.addEventListener('change', () => {
      this.includeAdvanced = advancedFilter.checked;
      this.currentPage = 0;
      this.ensureValidSelection();
      this.renderCatalog();
      this.updateBlueprintPreview(getBuildingSpec(this.selectedSpecId));
    });

    // Category tabs
    const tabButtons = this.container.querySelectorAll('.tray-tab-pill');
    tabButtons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.classList.contains('active'))));
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        this.currentCategory = btn.dataset.category;
        this.currentPage = 0;
        this.ensureValidSelection();
        this.renderCatalog();
        this.updateBlueprintPreview(getBuildingSpec(this.selectedSpecId));
      });
    });

    // Carousel Navigation
    const prevBtn = this.container.querySelector('#btn-carousel-prev');
    const nextBtn = this.container.querySelector('#btn-carousel-next');

    prevBtn.addEventListener('click', () => {
      const items = this.getFilteredCatalog();
      const maxPage = Math.max(0, Math.ceil(items.length / this.pageSize) - 1);
      this.currentPage = (this.currentPage - 1 + (maxPage + 1)) % (maxPage + 1);
      this.renderCatalog();
    });

    nextBtn.addEventListener('click', () => {
      const items = this.getFilteredCatalog();
      const maxPage = Math.max(0, Math.ceil(items.length / this.pageSize) - 1);
      this.currentPage = (this.currentPage + 1) % (maxPage + 1);
      this.renderCatalog();
    });

    // Place Building button
    const placeBtn = this.container.querySelector('#btn-place-building');
    placeBtn.addEventListener('click', () => {
      const editor = this.app.cityEditorSystem;
      const spec = getBuildingSpec(this.selectedSpecId);
      if (!editor || !spec) return;
      const access = this.getSpecAccess(spec);
      if (!access.unlocked) {
        this.app.uiManager?.showToast(`🔒 ${spec.name}: ${access.reason}`);
        return;
      }
      if (!editor.canAfford(spec)) {
        this.app.uiManager?.showToast(`💳 Insufficient credits for ${spec.name}`);
        this.refreshAffordability();
        return;
      }
      editor.selectBuilding(this.selectedSpecId);
      if (this.app.uiManager && this.app.uiManager.addAlert) {
        this.app.uiManager.addAlert(`🏗️ Ready to place: ${spec.name}. Click street or parcel to build.`, 'info');
      }
    });

    // Transform tools
    const selectTool = this.container.querySelector('#btn-tool-select');
    const moveTool = this.container.querySelector('#btn-tool-move');
    const rotateTool = this.container.querySelector('#btn-tool-rotate');
    const deleteTool = this.container.querySelector('#btn-tool-delete');

    selectTool.addEventListener('click', () => {
      this.setActiveTool('PLACE');
      this.app.cityEditorSystem?.setTool?.('PLACE');
    });

    moveTool.addEventListener('click', () => {
      this.setActiveTool('MOVE');
      this.app.cityEditorSystem?.setTool?.('MOVE');
      this.app.uiManager?.showToast('✥ Move tool: select a user-built structure, then click a valid destination.');
    });

    rotateTool.addEventListener('click', () => {
      if (this.app.cityEditorSystem) {
        const hasSelection = Boolean(this.app.cityEditorSystem.selectedStructure);
        this.setActiveTool(hasSelection ? 'ROTATE' : 'PLACE');
        this.app.cityEditorSystem.setTool?.(hasSelection ? 'ROTATE' : 'PLACE');
        this.app.cityEditorSystem.rotateSelection();
      }
    });

    deleteTool.addEventListener('click', () => {
      if (this.app.cityEditorSystem) {
        const isDel = this.app.cityEditorSystem.toggleDeleteMode();
        this.setActiveTool(isDel ? 'DELETE' : 'PLACE');
      }
    });

    // Close Button
    const closeBtn = this.container.querySelector('#btn-editor-close');
    closeBtn.addEventListener('click', () => {
      this.hide();
    });
  }

  setActiveTool(toolName) {
    this.activeTool = toolName;
    const selectTool = this.container.querySelector('#btn-tool-select');
    const moveTool = this.container.querySelector('#btn-tool-move');
    const deleteTool = this.container.querySelector('#btn-tool-delete');

    selectTool.classList.toggle('active', toolName === 'PLACE');
    moveTool.classList.toggle('active', toolName === 'MOVE');
    const rotateTool = this.container.querySelector('#btn-tool-rotate');
    rotateTool.classList.toggle('active', toolName === 'ROTATE');
    deleteTool.classList.toggle('active-danger', toolName === 'DELETE');
  }

  getFilteredCatalog() {
    let items = getCatalogByCategory(this.currentCategory, {
      includeAdvanced: this.includeAdvanced,
      progression: this.getProgressionValues(),
      includeLocked: true
    });
    if (this.searchQuery) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(this.searchQuery) ||
        (item.description && item.description.toLowerCase().includes(this.searchQuery))
      );
    }
    return items;
  }

  getProgressionValues() {
    return this.app.progressionSystem?.snapshot?.()?.values
      || this.app.missionOutcomeService?.snapshot?.()?.progression
      || this.app.progression
      || {};
  }

  getSpecAccess(spec) {
    return getCatalogAccess(spec, this.getProgressionValues());
  }

  ensureValidSelection() {
    const visible = this.getFilteredCatalog();
    const selected = visible.find(spec => spec.id === this.selectedSpecId && this.getSpecAccess(spec).unlocked);
    const replacement = selected || visible.find(spec => this.getSpecAccess(spec).unlocked) || getDefaultBuildingSpec();
    if (replacement) this.selectedSpecId = replacement.id;
    return replacement || null;
  }

  renderCatalog() {
    const grid = this.container.querySelector('#editor-cards-grid');
    const dotsContainer = this.container.querySelector('#editor-carousel-dots');
    grid.innerHTML = '';
    dotsContainer.innerHTML = '';

    const items = this.getFilteredCatalog();
    const totalPages = Math.max(1, Math.ceil(items.length / this.pageSize));
    if (this.currentPage >= totalPages) this.currentPage = totalPages - 1;

    // Render Dots
    for (let i = 0; i < totalPages; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `tray-dot ${i === this.currentPage ? 'active' : ''}`;
      dot.setAttribute('aria-label', `Catalog page ${i + 1} of ${totalPages}`);
      dot.setAttribute('aria-pressed', String(i === this.currentPage));
      dot.addEventListener('click', () => {
        this.currentPage = i;
        this.renderCatalog();
      });
      dotsContainer.appendChild(dot);
    }

    const startIdx = this.currentPage * this.pageSize;
    const pageItems = items.slice(startIdx, startIdx + this.pageSize);

    if (pageItems.length === 0) {
      grid.innerHTML = `<div style="grid-column: span 4; color: #64748b; text-align: center; padding: 24px;">No buildings match your filter</div>`;
      return;
    }

    pageItems.forEach(spec => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `building-card ${spec.id === this.selectedSpecId ? 'selected' : ''}`;
      card.dataset.id = spec.id;
      card.setAttribute('aria-pressed', String(spec.id === this.selectedSpecId));

      const formattedPrice = spec.cost
        ? `$${Number(spec.cost).toLocaleString()}`
        : `$350,000`;
      const access = this.getSpecAccess(spec);
      const affordable = access.unlocked && (this.app.cityEditorSystem?.canAfford(spec) ?? true);

      card.classList.toggle('unaffordable', !affordable);
      card.classList.toggle('catalog-locked', !access.unlocked);
      card.setAttribute('aria-disabled', String(!affordable));
      if (!access.unlocked) card.style.opacity = '0.72';
      else if (!affordable) card.style.opacity = '0.62';

      const preview = createTextElement('span', 'building-card-preview', spec.icon || '🏢');
      preview.setAttribute('aria-hidden', 'true');
      const title = createTextElement('span', 'building-card-title', spec.name);
      title.title = spec.name;
      const stats = document.createElement('span');
      stats.className = 'building-card-stats';
      const price = createTextElement('span', 'building-card-price', formattedPrice);
      price.style.color = affordable ? '#00ff88' : access.unlocked ? '#f87171' : '#fbbf24';
      const netPerMinute = Number(spec.incomePerMinute || 0);
      const impact = netPerMinute === 0
        ? `${spec.footprint.width}m x ${spec.footprint.depth}m`
        : `${netPerMinute > 0 ? '+' : '−'}$${Math.abs(netPerMinute).toLocaleString()}/min`;
      const availability = access.unlocked ? impact : `🔒 ${access.requiredTier}`;
      stats.append(price, createTextElement('span', 'building-card-dim', availability));
      const description = [
        spec.description,
        spec.residents ? `${spec.residents.toLocaleString()} residents` : null,
        spec.employees ? `${spec.employees.toLocaleString()} jobs` : null,
        spec.happiness ? `${spec.happiness > 0 ? '+' : ''}${spec.happiness} happiness` : null
      ].filter(Boolean).join(' · ');
      card.title = !access.unlocked
        ? `${spec.name}: ${access.reason}`
        : !affordable ? `Insufficient credits for ${spec.name}` : description;
      card.append(preview, title, stats);

      card.addEventListener('click', () => {
        if (!access.unlocked) {
          this.app.uiManager?.showToast(`🔒 ${spec.name}: ${access.reason}`);
          return;
        }
        if (!affordable) {
          this.app.uiManager?.showToast(`💳 Insufficient credits for ${spec.name}`);
          return;
        }
        const allCards = grid.querySelectorAll('.building-card');
        allCards.forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        card.classList.add('selected');
        card.setAttribute('aria-pressed', 'true');
        this.selectedSpecId = spec.id;

        this.updateBlueprintPreview(spec);

        if (this.app.cityEditorSystem) {
          this.app.cityEditorSystem.selectBuilding(spec.id);
        }
      });

      grid.appendChild(card);
    });
  }

  updateBlueprintPreview(spec) {
    if (!spec) return;
    const iconEl = this.container.querySelector('#blueprint-icon');
    const nameEl = this.container.querySelector('#blueprint-name');
    const impactEl = this.container.querySelector('#blueprint-impact');
    if (iconEl) iconEl.textContent = spec.icon || '🏢';
    if (nameEl) nameEl.textContent = spec.name;
    if (impactEl) {
      const impacts = [];
      if (spec.residents) impacts.push(`👥 ${Number(spec.residents).toLocaleString()} homes`);
      if (spec.employees) impacts.push(`💼 ${Number(spec.employees).toLocaleString()} jobs`);
      if (spec.happiness) impacts.push(`😊 ${spec.happiness > 0 ? '+' : ''}${spec.happiness}`);
      if (spec.powerSupply) impacts.push(`⚡ +${spec.powerSupply}`);
      if (spec.powerDemand) impacts.push(`⚡ −${spec.powerDemand}`);
      if (spec.waterSupply) impacts.push(`💧 +${spec.waterSupply}`);
      if (spec.waterDemand) impacts.push(`💧 −${spec.waterDemand}`);
      const cashflow = Number(spec.incomePerMinute || 0);
      impacts.push(`${cashflow >= 0 ? '📈 +' : '📉 −'}$${Math.abs(cashflow).toLocaleString()}/min`);
      impactEl.textContent = impacts.join(' · ');
    }
    const economySnapshot = this.app.economySystem?.snapshot?.() || {};
    const preview = createPlacementPreview(spec, economySnapshot, {
      availableCredits: this.app.cityEditorSystem?.getAvailableCredits?.() ?? null
    });
    this.updatePlacementForecast(preview);
    const currentValidation = this.app.cityEditorSystem?.currentHit?.validation;
    this.updatePlacementDecision(currentValidation?.preview?.specId === spec.id ? currentValidation : null);
    this.refreshAffordability(spec);
  }

  updatePlacementForecast(preview) {
    if (!preview || !this.container) return;
    const signedMoney = value => `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString('en-US')}/min`;
    const capacity = [
      preview.capacity.residents ? `${preview.capacity.residents.toLocaleString('en-US')} residents` : null,
      preview.capacity.jobs ? `${preview.capacity.jobs.toLocaleString('en-US')} jobs` : null,
      preview.capacity.traffic ? `${preview.capacity.traffic.toLocaleString('en-US')} traffic` : null
    ].filter(Boolean).join(' · ') || 'No direct capacity';
    const services = Object.entries(preview.serviceEffect)
      .filter(([, state]) => state.capacityDelta || state.demandDelta)
      .map(([service, state]) => {
        const delta = state.capacityDelta - state.demandDelta;
        return `${service} ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`;
      }).join(' · ') || 'No service load';
    const community = `Happiness ${preview.happiness >= 0 ? '+' : ''}${preview.happiness} · Land ${preview.landValue >= 0 ? '+' : ''}${preview.landValue.toFixed(1)}`;
    const values = {
      '#placement-operating': `$${preview.operatingCost.toLocaleString('en-US')}/min`,
      '#placement-cashflow': signedMoney(preview.netCashflow),
      '#placement-payback': preview.payback.label,
      '#placement-capacity': capacity,
      '#placement-demand': preview.demandEffect.label,
      '#placement-services': services,
      '#placement-community': community,
      '#placement-risk': preview.risks.map(risk => `${risk.level}: ${risk.label}`).join(' · ')
    };
    for (const [selector, text] of Object.entries(values)) {
      const element = this.container.querySelector(selector);
      if (element) element.textContent = text;
    }
  }

  updatePlacementDecision(validation) {
    if (!this.container) return;
    if (validation?.preview) this.updatePlacementForecast(validation.preview);
    const decision = this.container.querySelector('#placement-decision');
    const title = this.container.querySelector('#placement-decision-title');
    const message = this.container.querySelector('#placement-decision-message');
    const remedy = this.container.querySelector('#placement-decision-remedy');
    if (!decision || !title || !message || !remedy) return;
    decision.classList.toggle('is-valid', Boolean(validation?.valid));
    decision.classList.toggle('is-blocked', Boolean(validation && !validation.valid));
    decision.classList.toggle('is-pending', !validation);
    if (!validation) {
      title.textContent = 'Move over the map';
      message.textContent = 'Choose a parcel to validate access and construction requirements.';
      remedy.textContent = '';
      return;
    }
    if (validation.valid) {
      title.textContent = 'Ready to construct';
      message.textContent = `All placement checks pass at ${Math.round(validation.position.x)}, ${Math.round(validation.position.z)}.`;
      remedy.textContent = 'Click the highlighted footprint to commit this world edit.';
      return;
    }
    title.textContent = `Blocked · ${validation.primaryBlocker.code.replaceAll('_', ' ')}`;
    message.textContent = validation.primaryBlocker.message;
    remedy.textContent = validation.primaryBlocker.remedy;
  }

  refreshAffordability(spec = getBuildingSpec(this.selectedSpecId)) {
    if (!spec || !this.container) return;
    const editor = this.app.cityEditorSystem;
    const priceEl = this.container.querySelector('#blueprint-price');
    const placeBtn = this.container.querySelector('#btn-place-building');
    const placeLabel = this.container.querySelector('#btn-place-building-label');
    const cost = editor?.getPlacementCost(spec) ?? Number(spec.cost || 0);
    const access = this.getSpecAccess(spec);
    const affordable = access.unlocked && (editor?.canAfford(spec) ?? true);
    const credits = editor?.getAvailableCredits?.() ?? null;

    if (priceEl) {
      const costText = `$${Number(cost).toLocaleString()}`;
      const balanceText = credits == null ? '' : ` • Treasury $${Number(credits).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      priceEl.textContent = `${costText}${balanceText}`;
      priceEl.style.color = affordable ? '#00ff88' : access.unlocked ? '#f87171' : '#fbbf24';
    }
    if (placeBtn) {
      placeBtn.disabled = !affordable;
      placeBtn.setAttribute('aria-disabled', String(!affordable));
      placeBtn.title = affordable
        ? `Place ${spec.name}`
        : access.unlocked ? `Insufficient credits for ${spec.name}` : access.reason;
      placeBtn.style.opacity = affordable ? '1' : '0.55';
      placeBtn.style.cursor = affordable ? 'pointer' : 'not-allowed';
    }
    if (placeLabel) {
      placeLabel.textContent = affordable
        ? 'Place Building'
        : access.unlocked ? 'Insufficient Credits' : access.reason;
    }
  }

  show({ preserveMode = false } = {}) {
    if (this.isVisible) {
      this.refreshAffordability();
      return false;
    }
    if (!preserveMode && this.app.transitionCoordinator) {
      const result = this.app.transitionCoordinator.tryTransitionTo(GAME_STATES.BUILDER, {
        reason: 'city-editor-ui',
        source: 'CityEditorUI'
      });
      if (!result.ok) this.app.uiManager?.showToast?.(`⚠️ ${result.error?.message || 'City Editor unavailable.'}`);
      return result.ok;
    }
    const eligibility = preserveMode
      ? null
      : this.app.gameManager?.evaluateTransition?.(GAME_STATES.BUILDER);
    if (eligibility && !eligibility.allowed) {
      this.app.uiManager?.showToast(`⚠️ ${eligibility.reason}`);
      return false;
    }
    this.isVisible = true;
    this.container.style.display = 'flex';

    // Hide bottom time bar while editor is open to prevent overlap
    const timeBar = document.querySelector('.bottom-time-bar');
    if (timeBar) {
      this.previousTimeBarDisplay = timeBar.style.display;
      timeBar.style.display = 'none';
    }

    // Ensure left sidebar is visible so CITY TOOLS is accessible
    const leftSidebar = document.getElementById('left-sidebar');
    if (leftSidebar) {
      leftSidebar.classList.remove('hidden', 'collapsed');
      const toggle = document.getElementById('btn-toggle-sidebar');
      if (toggle) {
        toggle.textContent = '◀';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Collapse city tools sidebar');
        toggle.title = 'Collapse City Tools';
      }
    }

    if (this.app.cityEditorSystem) {
      this.app.cityEditorSystem.activate();
    }
    if (!preserveMode) this.setGameMode(GAME_STATES.BUILDER);
    this.syncEditorChrome(true);
    this.ensureValidSelection();
    this.renderCatalog();
    this.refreshAffordability();
    return true;
  }

  hide({ preserveMode = false } = {}) {
    if (!this.isVisible) return false;
    if (!preserveMode && this.app.transitionCoordinator) {
      const result = this.app.transitionCoordinator.tryTransitionTo(GAME_STATES.MANAGEMENT, {
        reason: 'city-editor-ui',
        source: 'CityEditorUI'
      });
      if (!result.ok) this.app.uiManager?.showToast?.(`⚠️ ${result.error?.message || 'Could not leave City Editor.'}`);
      return result.ok;
    }
    this.isVisible = false;
    this.container.style.display = 'none';

    const timeBar = document.querySelector('.bottom-time-bar');
    if (timeBar) timeBar.style.display = this.previousTimeBarDisplay;

    if (this.app.cityEditorSystem) {
      this.app.cityEditorSystem.deactivate();
    }
    if (!preserveMode) this.setGameMode(GAME_STATES.MANAGEMENT);
    this.syncEditorChrome(false);
    return true;
  }

  toggle() {
    if (this.isVisible) {
      return this.hide();
    }
    return this.show();
  }

  updateControllerCursor(position = { x: 0, y: 0 }) {
    const cursor = this.controllerCursorEl;
    if (!cursor) return;
    cursor.style.left = `${((position.x + 1) * 0.5) * window.innerWidth}px`;
    cursor.style.top = `${((1 - position.y) * 0.5) * window.innerHeight}px`;
  }

  setGameMode(mode) {
    const coordinator = this.app.transitionCoordinator;
    if (coordinator) {
      coordinator.transitionTo(mode, { reason: 'city-editor-ui', source: 'CityEditorUI' });
    } else {
      const gameManager = this.app.gameManager;
      const transitionMethods = ['requestMode', 'setMode', 'transitionTo', 'setState'];
      for (const methodName of transitionMethods) {
        if (typeof gameManager[methodName] === 'function') {
          gameManager[methodName](mode, { reason: 'city-editor-ui', source: 'CityEditorUI' });
          break;
        }
      }
    }

    const modeLabel = document.getElementById('current-mode-label');
    if (modeLabel) modeLabel.textContent = mode === GAME_STATES.BUILDER ? 'CITY EDITOR' : 'MANAGEMENT';
  }

  syncEditorChrome(active) {
    const uiManager = this.app.uiManager;
    if (uiManager?.btnExpandCity) uiManager.btnExpandCity.classList.toggle('active', active);
    if (uiManager?.expandCityLabel) {
      uiManager.expandCityLabel.textContent = active ? 'Expand City: ACTIVE 🏗️' : 'Expand City Mode [F]';
    }
  }

  destroy() {
    if (this.affordabilityRefreshTimer) clearTimeout(this.affordabilityRefreshTimer);
    this.unsubscribeEconomy?.();
    this.unsubscribeProgression?.();
    this.unsubscribePlacement?.();
    this.container?.remove();
    this.container = null;
  }
}
