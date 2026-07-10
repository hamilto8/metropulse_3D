import { BUILDING_CATALOG, BUILDING_CATEGORIES, getCatalogByCategory } from '../world/BuildingCatalog.js';

export class CityEditorUI {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.currentCategory = 'ALL';
    this.selectedSpecId = BUILDING_CATALOG[0].id;
    this.isVisible = false;

    this.initDOM();
  }

  initDOM() {
    this.container = document.createElement('div');
    this.container.className = 'city-editor-ui';
    this.container.style.display = 'none';
    this.container.innerHTML = `
      <div class="city-editor-header">
        <div class="city-editor-title">
          <span>🏗️ CITY EDITOR & MAP EXPANSION</span>
          <span class="city-editor-subtitle">Select buildings, residences, or roads and place them to expand Metro Pulse</span>
        </div>
        <div class="city-editor-actions">
          <button class="editor-btn" id="btn-editor-rotate" title="Rotate Structure [R]">🔄 Rotate (90°)</button>
          <button class="editor-btn active" id="btn-editor-snap" title="Toggle Grid Snap [G]">📐 Snap Grid: ON</button>
          <button class="editor-btn" id="btn-editor-delete" title="Demolish User Buildings">🗑️ Demolish Tool</button>
          <button class="editor-btn close-btn" id="btn-editor-close" title="Exit City Editor [ESC]">❌ Close Editor</button>
        </div>
      </div>
      <div class="city-editor-tabs" id="city-editor-tabs">
        <button class="editor-tab active" data-category="ALL">All Structures</button>
        <button class="editor-tab" data-category="COMMERCIAL">Commercial Towers</button>
        <button class="editor-tab" data-category="RESIDENTIAL">Residential Complexes</button>
        <button class="editor-tab" data-category="CIVIC">Civic & Medical</button>
        <button class="editor-tab" data-category="INFRASTRUCTURE">Roads & Power</button>
      </div>
      <div class="city-editor-catalog" id="city-editor-catalog"></div>
    `;

    document.body.appendChild(this.container);
    this.bindEvents();
    this.renderCatalog();
  }

  bindEvents() {
    const tabs = this.container.querySelectorAll('.editor-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentCategory = tab.dataset.category;
        this.renderCatalog();
      });
    });

    const rotateBtn = this.container.querySelector('#btn-editor-rotate');
    rotateBtn.addEventListener('click', () => {
      if (this.app.cityEditorSystem) {
        this.app.cityEditorSystem.rotateSelection();
      }
    });

    const snapBtn = this.container.querySelector('#btn-editor-snap');
    snapBtn.addEventListener('click', () => {
      if (this.app.cityEditorSystem) {
        const state = this.app.cityEditorSystem.toggleGridSnap();
        snapBtn.classList.toggle('active', state);
        snapBtn.textContent = state ? '📐 Snap Grid: ON' : '📐 Snap Grid: OFF';
      }
    });

    const deleteBtn = this.container.querySelector('#btn-editor-delete');
    deleteBtn.addEventListener('click', () => {
      if (this.app.cityEditorSystem) {
        const state = this.app.cityEditorSystem.toggleDeleteMode();
        deleteBtn.classList.toggle('active-delete', state);
        deleteBtn.textContent = state ? '🗑️ Demolish Mode ACTIVE' : '🗑️ Demolish Tool';
      }
    });

    const closeBtn = this.container.querySelector('#btn-editor-close');
    closeBtn.addEventListener('click', () => {
      this.hide();
    });
  }

  renderCatalog() {
    const grid = this.container.querySelector('#city-editor-catalog');
    grid.innerHTML = '';

    const items = getCatalogByCategory(this.currentCategory);
    items.forEach(spec => {
      const card = document.createElement('div');
      card.className = `catalog-card ${spec.id === this.selectedSpecId ? 'selected' : ''}`;
      card.dataset.id = spec.id;
      card.innerHTML = `
        <div class="catalog-card-icon">${spec.icon}</div>
        <div class="catalog-card-info">
          <div class="catalog-card-name">${spec.name}</div>
          <div class="catalog-card-meta">${spec.footprint.width}m x ${spec.footprint.depth}m | Height: ${spec.height}m</div>
          <div class="catalog-card-desc">${spec.description}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        const allCards = grid.querySelectorAll('.catalog-card');
        allCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedSpecId = spec.id;

        if (this.app.cityEditorSystem) {
          this.app.cityEditorSystem.selectBuilding(spec.id);
        }
      });

      grid.appendChild(card);
    });
  }

  show() {
    this.isVisible = true;
    this.container.style.display = 'flex';
    if (this.app.cityEditorSystem) {
      this.app.cityEditorSystem.activate();
    }
  }

  hide() {
    this.isVisible = false;
    this.container.style.display = 'none';
    if (this.app.cityEditorSystem) {
      this.app.cityEditorSystem.deactivate();
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}
