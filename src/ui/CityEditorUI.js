import { BUILDING_CATALOG, getCatalogByCategory, getBuildingSpec } from '../world/BuildingCatalog.js';
import { createTextElement } from './dom.js';

export class CityEditorUI {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.currentCategory = 'ALL';
    this.searchQuery = '';
    this.currentPage = 0;
    this.pageSize = 4;
    this.selectedSpecId = BUILDING_CATALOG[0].id;
    this.isVisible = false;
    this.activeTool = 'PLACE'; // PLACE, MOVE, ROTATE, DELETE
    this.previousTimeBarDisplay = '';
    this.affordabilityRefreshTimer = null;

    this.initDOM();
    this.unsubscribeEconomy = this.app.economySystem?.subscribe?.(() => {
      if (!this.isVisible || this.affordabilityRefreshTimer) return;
      this.affordabilityRefreshTimer = setTimeout(() => {
        this.affordabilityRefreshTimer = null;
        if (!this.isVisible) return;
        this.renderCatalog();
        this.refreshAffordability();
      }, 250);
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
            <span>BUILDINGS</span>
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
          <button class="tray-tab-pill" data-category="INDUSTRIAL">Industrial</button>
          <button class="tray-tab-pill" data-category="CIVIC">Civic</button>
          <button class="tray-tab-pill" data-category="UTILITIES">Utilities</button>
          <button class="tray-tab-pill" data-category="INFRASTRUCTURE">Infrastructure</button>
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
    `;

    document.body.appendChild(this.container);
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
      this.renderCatalog();
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
        this.renderCatalog();
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
    let items = getCatalogByCategory(this.currentCategory);
    if (this.searchQuery) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(this.searchQuery) ||
        (item.description && item.description.toLowerCase().includes(this.searchQuery))
      );
    }
    return items;
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
      const affordable = this.app.cityEditorSystem?.canAfford(spec) ?? true;

      card.classList.toggle('unaffordable', !affordable);
      card.setAttribute('aria-disabled', String(!affordable));
      if (!affordable) {
        card.style.opacity = '0.62';
        card.title = `Insufficient credits for ${spec.name}`;
      }

      const preview = createTextElement('span', 'building-card-preview', spec.icon || '🏢');
      preview.setAttribute('aria-hidden', 'true');
      const title = createTextElement('span', 'building-card-title', spec.name);
      title.title = spec.name;
      const stats = document.createElement('span');
      stats.className = 'building-card-stats';
      const price = createTextElement('span', 'building-card-price', formattedPrice);
      price.style.color = affordable ? '#00ff88' : '#f87171';
      stats.append(price, createTextElement('span', 'building-card-dim', `${spec.footprint.width}m x ${spec.footprint.depth}m`));
      card.append(preview, title, stats);

      card.addEventListener('click', () => {
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
    if (iconEl) iconEl.textContent = spec.icon || '🏢';
    if (nameEl) nameEl.textContent = spec.name;
    this.refreshAffordability(spec);
  }

  refreshAffordability(spec = getBuildingSpec(this.selectedSpecId)) {
    if (!spec || !this.container) return;
    const editor = this.app.cityEditorSystem;
    const priceEl = this.container.querySelector('#blueprint-price');
    const placeBtn = this.container.querySelector('#btn-place-building');
    const placeLabel = this.container.querySelector('#btn-place-building-label');
    const cost = editor?.getPlacementCost(spec) ?? Number(spec.cost || 0);
    const affordable = editor?.canAfford(spec) ?? true;
    const credits = editor?.getAvailableCredits?.() ?? null;

    if (priceEl) {
      const costText = `$${Number(cost).toLocaleString()}`;
      const balanceText = credits == null ? '' : ` • Treasury $${Number(credits).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      priceEl.textContent = `${costText}${balanceText}`;
      priceEl.style.color = affordable ? '#00ff88' : '#f87171';
    }
    if (placeBtn) {
      placeBtn.disabled = !affordable;
      placeBtn.setAttribute('aria-disabled', String(!affordable));
      placeBtn.title = affordable ? `Place ${spec.name}` : `Insufficient credits for ${spec.name}`;
      placeBtn.style.opacity = affordable ? '1' : '0.55';
      placeBtn.style.cursor = affordable ? 'pointer' : 'not-allowed';
    }
    if (placeLabel) {
      placeLabel.textContent = affordable ? 'Place Building' : 'Insufficient Credits';
    }
  }

  show() {
    if (this.isVisible) {
      this.refreshAffordability();
      return false;
    }
    if (
      this.app.trafficSystem?.controlledVehicle
      || this.app.pedestrianSystem?.controlledPedestrian
      || this.app.missionSystem?.activeMission
    ) {
      this.app.uiManager?.showToast('⚠️ Return to Management with [M] before opening the City Editor.');
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
    this.setGameMode('BUILDER');
    this.syncEditorChrome(true);
    this.renderCatalog();
    this.refreshAffordability();
    return true;
  }

  hide({ preserveMode = false } = {}) {
    if (!this.isVisible) return false;
    this.isVisible = false;
    this.container.style.display = 'none';

    const timeBar = document.querySelector('.bottom-time-bar');
    if (timeBar) timeBar.style.display = this.previousTimeBarDisplay;

    if (this.app.cityEditorSystem) {
      this.app.cityEditorSystem.deactivate();
    }
    if (!preserveMode) this.setGameMode('MANAGEMENT');
    this.syncEditorChrome(false);
    return true;
  }

  toggle() {
    if (this.isVisible) {
      return this.hide();
    }
    return this.show();
  }

  setGameMode(mode) {
    const gameManager = this.app.gameManager;
    if (gameManager) {
      const transitionMethods = ['requestMode', 'setMode', 'transitionTo', 'setState'];
      for (const methodName of transitionMethods) {
        if (typeof gameManager[methodName] === 'function') {
          gameManager[methodName](mode, { reason: 'city-editor-ui', source: 'CityEditorUI' });
          break;
        }
      }
    }

    const modeLabel = document.getElementById('current-mode-label');
    if (modeLabel) modeLabel.textContent = mode === 'BUILDER' ? 'CITY EDITOR' : 'MANAGEMENT';
  }

  syncEditorChrome(active) {
    const uiManager = this.app.uiManager;
    if (uiManager?.btnExpandCity) uiManager.btnExpandCity.classList.toggle('active', active);
    if (uiManager?.expandCityLabel) {
      uiManager.expandCityLabel.textContent = active ? 'Expand City: ACTIVE 🏗️' : 'Expand City Mode [F]';
    }
  }
}
