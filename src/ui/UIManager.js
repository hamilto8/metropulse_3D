import { createTextElement } from './dom.js';
import { getWeatherDefinition } from '../systems/Weather.js';
import { GAME_STATES, isStreetState } from '../core/GameManager.js';
import { INTERACTION_PRIORITIES } from '../systems/InteractionService.js';
import {
  ALERT_DURATION_KINDS,
  ALERT_FOCUS_ACTIONS,
  ALERT_SEVERITIES,
  ALERT_STATES,
  ALERT_TYPES
} from '../alerts/AlertService.js';

const ALERT_SEVERITY_CLASSES = Object.freeze({
  [ALERT_SEVERITIES.INFO]: 'info',
  [ALERT_SEVERITIES.SUCCESS]: 'success',
  [ALERT_SEVERITIES.WARNING]: 'warn',
  [ALERT_SEVERITIES.CRITICAL]: 'danger'
});

const ALERT_SEVERITY_LABELS = Object.freeze({
  [ALERT_SEVERITIES.INFO]: 'Info',
  [ALERT_SEVERITIES.SUCCESS]: 'Positive',
  [ALERT_SEVERITIES.WARNING]: 'Warning',
  [ALERT_SEVERITIES.CRITICAL]: 'Critical'
});

export class UIManager {
  constructor(app) {
    this.app = app;
    
    // Time UI elements
    this.timeSlider = document.getElementById('time-slider');
    this.clockDisplay = document.getElementById('clock-display');
    this.timePhase = document.getElementById('time-phase');
    this.timeIcon = document.getElementById('time-icon');
    this.statSimTime = document.getElementById('stat-sim-time');
    this.btnTimePlay = document.getElementById('btn-time-play');
    this.speedButtons = document.querySelectorAll('.speed-pill');
    
    // Header stat counters
    this.statVehicles = document.getElementById('stat-vehicles');
    this.statPedestrians = document.getElementById('stat-pedestrians');
    this.statFps = document.getElementById('stat-fps');
    this.inspectorVehicleCount = document.getElementById('inspector-vehicle-count');
    this.inspectorPedestrianCount = document.getElementById('inspector-pedestrian-count');
    this.statPopulation = document.getElementById('stat-pop');
    this.statMoney = document.getElementById('stat-money');
    this.statEnergy = document.getElementById('stat-energy');
    this.statWeather = document.getElementById('stat-weather');
    this.statHappiness = document.getElementById('stat-happiness');
    this.pulsePopulation = document.getElementById('pulse-population');
    this.pulseCash = document.getElementById('pulse-cash');
    this.pulseEnergy = document.getElementById('pulse-energy');
    this.pulseHappiness = document.getElementById('pulse-happiness');
    this.pulseEmployment = document.getElementById('pulse-employment');
    this.pulseCashflow = document.getElementById('pulse-cashflow');
    this.pulseDemand = document.getElementById('pulse-demand');
    this.pulseLandValue = document.getElementById('pulse-land-value');
    this.pulseReputation = document.getElementById('pulse-reputation');
    this.pulseServices = document.getElementById('pulse-services');
    
    // Camera and Weather controls
    this.cameraButtons = document.querySelectorAll('[data-camera]');
    this.weatherButtons = document.querySelectorAll('[data-weather]');
    this.btnDynamicWeather = document.getElementById('btn-dynamic-weather');
    this.heatmapToggle = document.getElementById('toggle-heatmap');
    
    // Audio controls
    this.btnMute = document.getElementById('btn-mute');
    this.muteIcon = document.getElementById('mute-icon');
    this.muteLabel = document.getElementById('mute-label');
    this.volumeSlider = document.getElementById('volume-slider');
    
    // Input Device status indicator
    this.inputDeviceBadge = document.getElementById('input-device-badge');
    this.inputDeviceIcon = document.getElementById('input-device-icon');
    this.inputDeviceLabel = document.getElementById('input-device-label');

    // City Editor & Map Expansion control
    this.btnExpandCity = document.getElementById('btn-expand-city');
    this.expandCityLabel = document.getElementById('expand-city-label');
    this.btnUnlockEast = document.getElementById('btn-unlock-east');
    this.btnBridgePriority = document.getElementById('btn-bridge-priority');
    this.btnSaveCity = document.getElementById('btn-save-city');
    this.btnNewCity = document.getElementById('btn-new-city');

    // Fun Mode controls
    this.btnFunMode = document.getElementById('btn-fun-mode');
    this.funModeLabel = document.getElementById('fun-mode-label');
    this.btnLaunchRocket = document.getElementById('btn-launch-rocket');
    this.launchRocketLabel = document.getElementById('launch-rocket-label');
    this.newsChyron = document.getElementById('news-chyron');
    
    // Real Estate Tracker (Satirical Crash Index)
    this.reTracker = document.getElementById('real-estate-tracker');
    this.reValueDisplay = document.getElementById('re-value-display');
    this.reStatusDisplay = document.getElementById('re-status-display');
    this.initialReValue = 4850000000; // $4.85 Billion
    this.currentReValue = 4850000000;
    this.targetReValue = 4850000000;
    
    // Inspector HUD
    this.inspectorHud = document.getElementById('inspector-hud');
    this.inspectorType = document.getElementById('inspector-type');
    this.inspectorTitle = document.getElementById('inspector-title');
    this.inspectorBody = document.getElementById('inspector-body');
    this.btnCloseInspector = document.getElementById('btn-close-inspector');
    this.btnFollowTarget = document.getElementById('btn-follow-target');
    this.btnTakeControl = document.getElementById('btn-take-control');
    this.btnInteractSfx = document.getElementById('btn-interact-sfx');
    this.btnCombatAction = document.getElementById('btn-combat-action');
    
    this.selectedEntity = null;
    this.isTimePlaying = true;
    this.timeSpeed = 1.0;
    this.alertFeedList = document.getElementById('alert-feed-list');
    this.topAlertSummary = document.getElementById('top-alert-summary');
    this.alertTimer = 0;
    this.speedometerHud = document.getElementById('street-speedometer');
    this.speedometerValue = document.getElementById('speedometer-value');
    this.speedometerGear = document.getElementById('speedometer-gear');
    this.flightHud = document.getElementById('flight-hud');
    this.flightMode = document.getElementById('flight-mode');
    this.flightAirspeed = document.getElementById('flight-airspeed');
    this.flightAltitude = document.getElementById('flight-altitude');
    this.flightThrottle = document.getElementById('flight-throttle');
    this.flightVerticalSpeed = document.getElementById('flight-vertical-speed');
    this.flightWarning = document.getElementById('flight-warning');
    this.streetControlHint = document.getElementById('street-control-hint');
    this.adaptiveContextIcon = document.getElementById('adaptive-context-icon');
    this.adaptiveContextLabel = document.getElementById('adaptive-context-label');
    this.adaptiveControlActions = document.getElementById('adaptive-control-actions');
    this.modeLabel = document.getElementById('current-mode-label');
    this.leftSidebar = document.getElementById('left-sidebar');
    this.sidebarContent = document.getElementById('sidebar-content');
    this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    this.bottomToolbar = document.querySelector('.bottom-right-toolbar');
    this._lastGameMode = null;
    this._sidebarWasCollapsedBeforeAction = null;
    document.body.dataset.inspector = 'closed';

    this.initEventListeners();
    if (window.matchMedia?.('(max-width: 780px)').matches) {
      this.leftSidebar?.classList.add('no-transition');
      this.leftSidebar?.classList.add('collapsed');
      requestAnimationFrame(() => requestAnimationFrame(() => this.leftSidebar?.classList.remove('no-transition')));
    }
    this.renderSidebarToggleState(this.leftSidebar?.classList.contains('collapsed'));

    if (this.app.gameManager?.subscribe) {
      this._unsubscribeGameState = this.app.gameManager.subscribe(event => this.syncGameState(event?.current || event), { emitCurrent: true });
    }
    if (this.app.economySystem?.subscribe) {
      this._unsubscribeEconomy = this.app.economySystem.subscribe(event => this.updateEconomy(event?.current || event), { emitCurrent: true });
    }
    if (this.app.cityServiceModel?.subscribe) {
      this._unsubscribeCityServices = this.app.cityServiceModel.subscribe(
        () => this.updateEconomy(this.app.economySystem.snapshot()),
        { emitCurrent: true }
      );
    }
    this.syncTimePlayingControl(this.app.timeManager?.isPlaying);
    this.syncTimeSpeedControl(this.app.timeManager?.speed);
    this.updateDynamicWeatherBtnState();
    this.syncWeatherButtons(this.app.environment?.weatherMode);
    document.body.dataset.inputMethod = this.app.inputManager?.activeInterface?.toLowerCase?.() || 'keyboard';
    this.updateControlDeviceBadge(this.app.inputManager?.activeInterface || 'KEYBOARD');
    this.updateAdaptiveControls(true);
    this.bindAlertService(this.app.alertService);
  }

  initEventListeners() {
    document.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.accordion-section');
        const collapsed = section?.classList.toggle('collapsed') || false;
        header.setAttribute('aria-expanded', String(!collapsed));
        const arrow = header.querySelector('.accordion-arrow');
        if (arrow) arrow.textContent = collapsed ? '›' : '⌄';
      });
    });

    // Time slider dragging
    if (this.timeSlider) {
      this.timeSlider.addEventListener('input', (e) => {
        const timeVal = parseFloat(e.target.value);
        this.app.timeManager.setTime(timeVal);
        this.updateTimeDisplay(timeVal);
      });
    }

    // Play/Pause Time
    if (this.btnTimePlay) {
      this.btnTimePlay.addEventListener('click', () => {
        this.app.timeManager.setPlaying(!this.app.timeManager.isPlaying);
      });
    }

    // Speed buttons
    this.speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.app.timeManager.setSpeed(parseFloat(btn.dataset.speed));
      });
    });

    // Camera presets
    this.cameraButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const cameraMode = btn.dataset.camera;
        if (!this.app.sceneManager.setCameraPreset(cameraMode)) return;
        this.cameraButtons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      });
    });

    // Weather toggle
    this.weatherButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Selecting a manual weather mode disables the automatic cycle.
        if (this.app.environment) {
          this.app.environment.setDynamicWeather(false);
        }

        this.weatherButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const weatherMode = btn.dataset.weather;
        this.app.environment.setWeather(weatherMode);
      });
    });

    // Dynamic Weather Cycle toggle
    if (this.btnDynamicWeather) {
      this.btnDynamicWeather.addEventListener('click', () => {
        if (this.app.environment) {
          const env = this.app.environment;
          env.setDynamicWeather(!env.isDynamicWeather);
        }
      });
    }

    // Collapsible Top Header & Left Sidebar controls
    const topHeader = document.getElementById('top-header');
    const btnToggleHeader = document.getElementById('btn-toggle-header');
    const leftSidebar = this.leftSidebar;
    const btnToggleSidebar = this.btnToggleSidebar;

    if (btnToggleHeader && topHeader) {
      btnToggleHeader.addEventListener('click', () => {
        const isCollapsed = topHeader.classList.toggle('collapsed');
        btnToggleHeader.textContent = isCollapsed ? '▼' : '▲';
      });
    }

    if (btnToggleSidebar && leftSidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        this.toggleCityTools();
      });
    }

    // Audio toggle
    if (this.btnMute) {
      this.btnMute.addEventListener('click', () => {
        if (this.app.audioSystem) {
          const enabled = this.app.audioSystem.toggleAudio();
          if (enabled) {
            this.btnMute.classList.add('active');
            if (this.muteIcon) this.muteIcon.textContent = '🔊';
            if (this.muteLabel) this.muteLabel.textContent = 'SFX Active';
            if (this.volumeSlider) this.volumeSlider.disabled = false;
          } else {
            this.btnMute.classList.remove('active');
            if (this.muteIcon) this.muteIcon.textContent = '🔇';
            if (this.muteLabel) this.muteLabel.textContent = 'Enable SFX';
            if (this.volumeSlider) this.volumeSlider.disabled = true;
          }
        }
      });

      if (this.volumeSlider) {
        this.volumeSlider.addEventListener('input', (e) => {
          if (this.app.audioSystem) {
            this.app.audioSystem.setVolume(parseFloat(e.target.value));
          }
        });
      }
    }

    // Expand City / City Editor toggle
    if (this.btnExpandCity) {
      this.btnExpandCity.addEventListener('click', () => {
        this.toggleCityEditor();
      });
    }

    // Fun Mode toggle
    if (this.btnFunMode) {
      this.btnFunMode.addEventListener('click', () => {
        this.setMayhem(!this.app.funMode, 'button');
      });
    }

    if (this.btnLaunchRocket) {
      this.btnLaunchRocket.addEventListener('click', () => {
        if (!this.app.features?.isEnabled?.('rocketLaunch')) return;
        if (this.app.rocketLaunched) {
          this.app.rocketLaunched = false;
          this.app.rocketCountdown = 300.0;
          if (this.app.cityBuilder) this.app.cityBuilder.resetRocket();
          if (this.app.billboardCanvas) this.app.billboardCanvas.forceRedrawAll();
        } else {
          if (!this.app.funMode && this.btnFunMode) {
            this.btnFunMode.click();
          }
          this.app.rocketCountdown = 0;
          this.app.triggerRocketLaunch();
        }
      });
    }

    // Inspector Close
    if (this.btnCloseInspector) {
      this.btnCloseInspector.addEventListener('click', () => {
        this.hideInspector();
      });
    }

    // Follow Target button
    if (this.btnFollowTarget) {
      this.btnFollowTarget.addEventListener('click', () => {
        if (this.selectedEntity) {
          const isFollowing = this.app.sceneManager.toggleFollowTarget(this.selectedEntity);
          this.btnFollowTarget.innerHTML = isFollowing ? '❌ Stop Following' : '👁️ Follow Camera';
          this.btnFollowTarget.classList.toggle('active', isFollowing);

        if (!isFollowing && this.selectedEntity.userControlled) {
          if (this.selectedEntity.type === 'VEHICLE') {
            this.app.trafficSystem.releaseControl(this.selectedEntity);
            if (this.btnTakeControl) {
              this.btnTakeControl.innerHTML = '🏎️ Take Control (Physics)';
              this.btnTakeControl.classList.remove('active');
            }
          } else if (this.selectedEntity.type === 'PEDESTRIAN') {
            this.app.pedestrianSystem.releaseControl(this.selectedEntity);
            if (this.btnTakeControl) {
              this.btnTakeControl.innerHTML = '🚶 Take Control (Walk)';
              this.btnTakeControl.classList.remove('active');
            }
          } else if (this.selectedEntity.type === 'AIRCRAFT') {
            const released = this.app.aircraftSystem?.releaseControl?.();
            if (!released) {
              this.app.sceneManager.startFollowTarget(this.selectedEntity);
              this.btnFollowTarget.innerHTML = '❌ Stop Following';
              this.btnFollowTarget.classList.add('active');
              return;
            }
            if (this.btnTakeControl) {
              this.btnTakeControl.innerHTML = '🛩️ Take Flight Control';
              this.btnTakeControl.classList.remove('active');
            }
          }
        }
      }
    });
    }

    // Take Control button (WASD / Arrows manual driving)
    if (this.btnTakeControl) {
      this.btnTakeControl.addEventListener('click', () => {
        if (!this.selectedEntity) return;

        if (this.selectedEntity.type === 'VEHICLE') {
          const ts = this.app.trafficSystem;
          const streetPedestrian = this.app.pedestrianSystem?.controlledPedestrian;
          if (streetPedestrian) {
            const distance = streetPedestrian.mesh.position.distanceTo(this.selectedEntity.mesh.position);
            if (distance > 3.5) {
              this.showToast('⚠️ Approach within 3.5 m to hijack this vehicle.');
              return;
            }
            this.app.pedestrianSystem.handlePedestrianActionKey();
            return;
          }
          const isNowControlled = ts.toggleUserControl(this.selectedEntity);
          this.btnTakeControl.innerHTML = isNowControlled ? '🛑 Release Physics Drive' : '🏎️ Take Control (Physics)';
          this.btnTakeControl.classList.toggle('active', isNowControlled);

          // Phase 2: Cinematic swoop transition to street level or ascend back to macro view
          if (isNowControlled) {
            this.app.sceneManager.startFollowTarget(this.selectedEntity);
            this.btnFollowTarget.innerHTML = '❌ Stop Following';
            this.btnFollowTarget.classList.add('active');
            this.hideInspector();
          } else {
            this.app.sceneManager.stopFollowTarget();
            this.btnFollowTarget.innerHTML = '🎯 Follow Target';
            this.btnFollowTarget.classList.remove('active');
          }
        } else if (this.selectedEntity.type === 'PEDESTRIAN') {
          const ps = this.app.pedestrianSystem;
          const isNowControlled = ps.toggleUserControl(this.selectedEntity);
          this.btnTakeControl.innerHTML = isNowControlled ? '🛑 Release Walk Control' : '🚶 Take Control (Walk)';
          this.btnTakeControl.classList.toggle('active', isNowControlled);

          if (isNowControlled) {
            this.app.sceneManager.startFollowTarget(this.selectedEntity);
            this.btnFollowTarget.innerHTML = '❌ Stop Following';
            this.btnFollowTarget.classList.add('active');
            this.hideInspector();
          } else {
            this.app.sceneManager.stopFollowTarget();
            this.btnFollowTarget.innerHTML = '🎯 Follow Target';
            this.btnFollowTarget.classList.remove('active');
          }
        } else if (this.selectedEntity.type === 'AIRCRAFT') {
          const isNowControlled = this.app.aircraftSystem?.toggleControl?.(this.selectedEntity) || false;
          this.btnTakeControl.innerHTML = isNowControlled ? '🛑 Leave Cockpit' : '🛩️ Take Flight Control';
          this.btnTakeControl.classList.toggle('active', isNowControlled);
          if (isNowControlled) this.hideInspector();
        }
      });
    }

    // Trigger SFX / Interaction button
    if (this.btnInteractSfx) this.btnInteractSfx.addEventListener('click', () => {
      if (!this.selectedEntity) return;

      if (this.selectedEntity.type === 'VEHICLE') {
        if (this.selectedEntity.isPolice) {
          this.app.audioSystem.playSiren(1.5);
        } else {
          this.app.audioSystem.playHonk();
        }
      } else if (this.selectedEntity.type === 'MISSION_PICKUP') {
        this.app.missionSystem.triggerMissionDialogue(this.selectedEntity.mission);
      } else if (this.selectedEntity.type === 'PEDESTRIAN') {
        // Pedestrian interaction: wave / greet
        this.selectedEntity.info['Action'] = 'Waved hello! 👋 "Hey driver!"';
        if (this.app.audioSystem) {
          this.app.audioSystem.playUIClick();
        }
        this.showInspector(this.selectedEntity);
      }
    });

    if (this.btnCombatAction) {
      this.btnCombatAction.addEventListener('click', () => {
        const pedestrian = this.app.pedestrianSystem?.controlledPedestrian;
        if (!pedestrian) {
          this.showToast('⚠️ Take walk control before using street combat.');
          return;
        }
        if (!pedestrian.hasBaseballBat) {
          this.showToast('🏏 Find a glowing baseball bat pickup first.');
          return;
        }
        this.app.pedestrianSystem.swingBaseballBat();
      });
    }

    // Canonical mode toggle. ACTION mode is entered by taking direct control.
    const btnModeSelector = document.getElementById('btn-mode-selector');
    if (btnModeSelector) {
      btnModeSelector.addEventListener('click', () => {
        this.handleModeToggle();
      });
    }

    // Zoning cards & Infrastructure buttons (open City Editor UI filtered by category)
    const zoningCards = document.querySelectorAll('.zoning-card[data-zone]');
    zoningCards.forEach(card => {
      card.addEventListener('click', () => {
        const zoneType = card.dataset.zone;
        if (this.cityEditorUI) {
          if (!this.cityEditorUI.isVisible && !this.cityEditorUI.show()) return;
          const categoryMap = {
            RESIDENTIAL: 'RESIDENTIAL',
            COMMERCIAL: 'COMMERCIAL',
            OPERATIONS: 'OPERATIONS'
          };
          const targetCat = categoryMap[zoneType] || 'ALL';
          this.cityEditorUI.currentCategory = targetCat;
          this.cityEditorUI.currentPage = 0;
          const selectedSpec = this.cityEditorUI.ensureValidSelection();
          this.cityEditorUI.renderCatalog();
          this.cityEditorUI.updateBlueprintPreview(selectedSpec);
          const pills = this.cityEditorUI.container.querySelectorAll('.tray-tab-pill');
          pills.forEach(p => {
            const active = p.dataset.category === targetCat;
            p.classList.toggle('active', active);
            p.setAttribute('aria-pressed', String(active));
          });
        }
        if (this.app.cityEditorSystem?.setZoningMode) this.app.cityEditorSystem.setZoningMode(zoneType);
      });
    });

    const infraBtns = document.querySelectorAll('.infra-btn[data-infra]');
    infraBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.cityEditorUI) {
          if (!this.cityEditorUI.isVisible && !this.cityEditorUI.show()) return;
          const infraSpecMap = {
            road: 'ROAD_STRAIGHT',
            power: 'SOLAR_GRID',
            water: 'WATER_RECLAMATION',
            fire: 'FIRE_STATION'
          };
          const specId = infraSpecMap[btn.dataset.infra];
          const targetCategory = ['power', 'water', 'fire'].includes(btn.dataset.infra)
            ? 'FACILITIES'
            : 'INFRASTRUCTURE';
          this.cityEditorUI.currentCategory = targetCategory;
          this.cityEditorUI.currentPage = 0;
          const pills = this.cityEditorUI.container.querySelectorAll('.tray-tab-pill');
          pills.forEach(p => {
            const active = p.dataset.category === targetCategory;
            p.classList.toggle('active', active);
            p.setAttribute('aria-pressed', String(active));
          });
          if (specId) {
            const selected = this.app.cityEditorSystem?.selectBuilding?.(specId);
            if (selected) {
              this.cityEditorUI.selectedSpecId = specId;
            } else {
              const fallback = this.cityEditorUI.ensureValidSelection();
              if (fallback) this.app.cityEditorSystem?.selectBuilding?.(fallback.id);
            }
          }
          this.cityEditorUI.renderCatalog();
          this.cityEditorUI.updateBlueprintPreview(this.app.cityEditorSystem?.selectedSpec);
        }
      });
    });

    if (this.heatmapToggle) {
      this.heatmapToggle.addEventListener('change', () => {
        const enabled = this.heatmapToggle.checked;
        this.app.trafficHeatmapSystem?.setVisible?.(enabled);
        this.app.trafficHeatmapEnabled = enabled;
        this.addAlert(enabled ? '🚦 Live congestion heat-map enabled.' : '🗺️ Traffic heat-map disabled.', 'info');
      });
    }

    if (this.btnUnlockEast) {
      this.btnUnlockEast.addEventListener('click', () => {
        if (!this.app.features?.isEnabled?.('eastSideDevelopment')) return;
        const result = this.app.economySystem?.unlockDistrict?.('EAST_CYBER_METROPOLIS');
        if (result?.success || result === true) {
          this.addAlert('🏙️ East Cyber-Metropolis unlocked for development.', 'success');
        } else {
          const district = this.app.economySystem?.snapshot?.().districts?.EAST_CYBER_METROPOLIS;
          const cost = Number(district?.unlockCost ?? 1_000_000);
          const decision = this.app.economySystem?.evaluateSpending?.(cost, {
            source: 'district-unlock', referenceId: 'EAST_CYBER_METROPOLIS'
          });
          this.showToast(result?.reason || `⚠️ ${decision?.reason || `$${cost.toLocaleString()} capital investment required.`} ${decision?.remedy || ''}`.trim());
        }
      });
    }

    this.btnSaveCity?.addEventListener('click', async () => {
      const saved = await this.app.saveService?.saveNow?.({ reason: 'manual' });
      this.showToast(saved ? '💾 City saved locally.' : '⚠️ City could not be saved; your previous save is still safe.');
    });

    this.btnNewCity?.addEventListener('click', () => {
      const confirmed = window.confirm('Start a new city? The current city will move to the recovery slot before the new session starts.');
      if (!confirmed) return;
      void this.app.saveService?.clear?.({ preserveRecovery: true }).then(cleared => {
        if (cleared) window.location.reload();
        else this.showToast('⚠️ The current city could not be cleared safely.');
      });
    });

    // Action Toolbar buttons
    const btnToolbarControl = document.getElementById('btn-toolbar-control');
    if (btnToolbarControl) {
      btnToolbarControl.addEventListener('click', () => {
        if (this.selectedEntity && this.btnTakeControl) {
          this.btnTakeControl.click();
        }
      });
    }

    const btnToolbarNext = document.getElementById('btn-toolbar-next');
    if (btnToolbarNext) {
      btnToolbarNext.addEventListener('click', () => {
        if (this.app.pedestrianSystem && this.app.pedestrianSystem.pedestrians.length > 0) {
          const peds = this.app.pedestrianSystem.pedestrians.filter(pedestrian => (
            !pedestrian.knockedDown && pedestrian.mesh?.parent
          ));
          const randomPed = peds[Math.floor(Math.random() * peds.length)];
          if (randomPed) {
            this.showInspector(randomPed);
            this.app.sceneManager.toggleFollowTarget(randomPed);
          }
        }
      });
    }

    const btnToolbarVehicles = document.getElementById('btn-toolbar-vehicles');
    if (btnToolbarVehicles) {
      btnToolbarVehicles.addEventListener('click', () => {
        const vehicles = (this.app.trafficSystem?.vehicles || []).filter(vehicle => (
          !vehicle.crashed && !vehicle.onFire && !vehicle.isDestroyed && vehicle.mesh?.parent
        ));
        if (vehicles.length === 0) {
          this.showToast('No operational vehicles are currently available.');
          return;
        }
        this._vehicleCursor = ((this._vehicleCursor ?? -1) + 1) % vehicles.length;
        this.showInspector(vehicles[this._vehicleCursor]);
      });
    }

    const btnToolbarFilter = document.getElementById('btn-toolbar-filter');
    if (btnToolbarFilter && this.heatmapToggle) {
      btnToolbarFilter.addEventListener('click', () => {
        this.heatmapToggle.checked = !this.heatmapToggle.checked;
        this.heatmapToggle.dispatchEvent(new Event('change'));
      });
    }
  }

  handleModeToggle() {
    const mode = this.app.gameManager?.mode || this.app.gameManager?.getSnapshot?.().mode || this.modeLabel?.textContent || 'MANAGEMENT';

    if (isStreetState(mode)) {
      const vehicle = this.app.trafficSystem?.controlledVehicle;
      const pedestrian = this.app.pedestrianSystem?.controlledPedestrian;
      const aircraft = this.app.aircraftSystem?.controlledAircraft;
      if (aircraft) {
        this.app.aircraftSystem.releaseControl();
        return;
      }
      if (vehicle) this.app.trafficSystem.releaseControl(vehicle);
      else if (pedestrian) this.app.pedestrianSystem.releaseControl(pedestrian);
      return;
    }

    if (mode === GAME_STATES.BUILDER || this.cityEditorUI?.isVisible) {
      this.app.transitionCoordinator?.transitionTo?.(GAME_STATES.MANAGEMENT, {
        reason: 'mode-toggle',
        source: 'UIManager'
      });
      return;
    }

    this.toggleCityEditor();
  }

  renderSidebarToggleState(collapsed) {
    if (!this.btnToggleSidebar) return;
    const actionMode = document.body.dataset.gameMode === 'action';
    this.btnToggleSidebar.textContent = collapsed ? (actionMode ? '☰' : '▶') : '◀';
    this.btnToggleSidebar.setAttribute('aria-expanded', String(!collapsed));
    this.btnToggleSidebar.setAttribute('aria-label', collapsed ? 'Expand city tools sidebar' : 'Collapse city tools sidebar');
    this.btnToggleSidebar.title = collapsed ? 'Expand City Tools' : 'Collapse City Tools';
    if (this.sidebarContent) {
      this.sidebarContent.inert = Boolean(collapsed);
      this.sidebarContent.setAttribute('aria-hidden', String(Boolean(collapsed)));
    }
  }

  toggleCityTools() {
    if (!this.leftSidebar) return false;
    const actionMode = document.body.dataset.gameMode === 'action';
    if (actionMode) {
      const expanded = this.leftSidebar.classList.toggle('action-expanded');
      this.renderSidebarToggleState(!expanded);
      return expanded;
    }
    const collapsed = this.leftSidebar.classList.toggle('collapsed');
    this.renderSidebarToggleState(collapsed);
    return !collapsed;
  }

  syncSidebarForMode(mode) {
    if (!this.leftSidebar || mode === this._lastGameMode) return;

    if (isStreetState(mode)) {
      this._sidebarWasCollapsedBeforeAction = this.leftSidebar.classList.contains('collapsed');
      this.leftSidebar.classList.remove('collapsed', 'action-expanded');
      this.renderSidebarToggleState(true);
    } else if (isStreetState(this._lastGameMode)) {
      this.leftSidebar.classList.remove('action-expanded');
      this.leftSidebar.classList.toggle('collapsed', Boolean(this._sidebarWasCollapsedBeforeAction));
      this.renderSidebarToggleState(Boolean(this._sidebarWasCollapsedBeforeAction));
      this._sidebarWasCollapsedBeforeAction = null;
    } else {
      this.renderSidebarToggleState(this.leftSidebar.classList.contains('collapsed'));
    }

    this._lastGameMode = mode;
  }

  syncGameState(snapshot = {}) {
    const state = typeof snapshot.state === 'object' ? snapshot.state : snapshot;
    const mode = typeof snapshot.state === 'string'
      ? snapshot.state
      : state.mode || this.app.gameManager?.mode || GAME_STATES.MANAGEMENT;
    if (isStreetState(mode) && this.cityEditorUI?.isVisible) {
      this.cityEditorUI.hide({ preserveMode: true });
    }
    if (this.modeLabel) {
      const labels = {
        [GAME_STATES.BUILDER]: 'CITY EDITOR',
        [GAME_STATES.STREET_ON_FOOT]: 'ON FOOT',
        [GAME_STATES.STREET_VEHICLE]: 'STREET VEHICLE'
      };
      this.modeLabel.textContent = labels[mode] || mode;
    }
    // CSS consumes a presentation category; it is a projection of canonical
    // state, never a second game-state owner.
    document.body.dataset.gameMode = isStreetState(mode) ? 'action' : mode.toLowerCase();
    this.syncSidebarForMode(mode);
    const managementOnly = [
      document.getElementById('bottom-time-bar'),
      this.bottomToolbar
    ];
    for (const element of managementOnly) {
      if (!element) continue;
      const unavailable = mode !== GAME_STATES.MANAGEMENT;
      element.inert = unavailable;
      element.setAttribute('aria-hidden', String(unavailable));
    }
    if (this.leftSidebar) {
      const unavailable = mode === GAME_STATES.BUILDER;
      this.leftSidebar.inert = unavailable;
      this.leftSidebar.setAttribute('aria-hidden', String(unavailable));
    }
    this.updateAdaptiveControls(true);

    const mayhem = snapshot.mayhemEnabled ?? state.mayhemEnabled ?? state.mayhem;
    if (typeof mayhem === 'boolean' && mayhem !== this.app.funMode) {
      this.renderMayhemState(mayhem);
    }
  }

  setMayhem(enabled, source = 'ui') {
    const survivalActive = this.app.missionSystem?.activeMission?.missionType === 'SURVIVAL';
    if (!enabled && survivalActive) {
      this.showToast('☄️ Mayhem cannot be disabled during a survival mission.');
      return false;
    }

    this.app.funMode = !!enabled;
    if (this.app.gameManager?.mayhem !== this.app.funMode) {
      this.app.gameManager?.setMayhem?.(this.app.funMode, source);
    }
    this.renderMayhemState(this.app.funMode);

    if (this.app.billboardCanvas) this.app.billboardCanvas.forceRedrawAll();
    if (this.app.funMode) {
      if (this.app.audioSystem && !this.app.audioSystem.isEnabled) this.app.audioSystem.toggleAudio();
      if (this.app.audioSystem) this.app.audioSystem.playSiren(1.5);
      this.addAlert('☄️ MAYHEM activated: comet insurance markets are now bullish.', 'danger');
    } else {
      this.app.buildingFactory?.restoreAllBuildings?.();
      this.addAlert('✅ Mayhem contained. Corporate continuity restored.', 'success');
    }
    return true;
  }

  renderMayhemState(enabled) {
    this.app.funMode = !!enabled;
    document.body.dataset.mayhem = enabled ? 'on' : 'off';
    this.btnFunMode?.classList.toggle('active', !!enabled);
    if (this.funModeLabel) this.funModeLabel.textContent = enabled ? 'Fun Mode: MAYHEM! 🔥' : 'Fun Mode: OFF';
    this.newsChyron?.classList.toggle('hidden', !enabled);
    this.reTracker?.classList.toggle('hidden', !enabled);
    if (enabled) this.resetRealEstateValue();
    else this.resetRealEstateValue();
    if (this.btnMute && this.app.audioSystem?.isEnabled) this.btnMute.classList.add('active');
    if (this.muteIcon) this.muteIcon.textContent = this.app.audioSystem?.isEnabled ? '🔊' : '🔇';
    if (this.muteLabel) this.muteLabel.textContent = this.app.audioSystem?.isEnabled ? 'SFX Active' : 'Enable SFX';
    if (this.volumeSlider) this.volumeSlider.disabled = !this.app.audioSystem?.isEnabled;
  }

  updateEconomy(snapshot = {}) {
    const state = snapshot.state || snapshot;
    const pulse = state.cityPulse || state;
    const cash = Number(state.cash ?? state.treasury ?? state.budget ?? pulse.budget ?? 0);
    const population = Math.max(0, Math.round(Number(state.population ?? pulse.population ?? 0)));
    const cityServices = this.app.cityServiceModel?.snapshot?.() || null;
    const energy = Math.max(0, Math.min(100, Math.round(Number(
      cityServices?.energy?.coveragePercent ?? state.energy ?? state.energyPercent ?? pulse.energy ?? 0
    ))));
    const happiness = Math.max(0, Math.min(100, Math.round(Number(state.happiness ?? pulse.happiness ?? 0))));
    const landValue = Math.max(0, Math.round(Number(state.landValue ?? pulse.landValue ?? 0)));
    const reputation = Math.round(Number(state.reputation ?? 0));
    const services = state.services || pulse.services || {};
    const currency = `$${cash.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    if (this.statPopulation) this.statPopulation.textContent = population.toLocaleString('en-US');
    if (this.statMoney) this.statMoney.textContent = currency;
    if (this.statEnergy) this.statEnergy.textContent = `${energy}%`;
    if (this.statHappiness) this.statHappiness.textContent = `${happiness}%`;
    if (this.pulsePopulation) this.pulsePopulation.textContent = population.toLocaleString('en-US');
    if (this.pulseCash) this.pulseCash.textContent = currency;
    if (this.pulseEnergy) this.pulseEnergy.textContent = `${energy}%`;
    if (this.pulseHappiness) this.pulseHappiness.textContent = `${happiness}%`;
    const demographics = state.demographics || pulse.demographics || {};
    const employment = Math.round(Number(
      demographics.accessibleEmploymentRate ?? demographics.employmentRate ?? 1
    ) * 100);
    if (this.pulseEmployment) {
      this.pulseEmployment.textContent = `${employment}%`;
      this.pulseEmployment.title = `${Number(demographics.accessibleEmployed ?? demographics.employed ?? 0).toLocaleString()} jobs reachable · ${Number(demographics.employed ?? 0).toLocaleString()} filled before traffic access · ${Number(demographics.availableJobs ?? 0).toLocaleString()} open jobs`;
    }
    const budget = state.budgetBreakdown || pulse.budgetBreakdown || {};
    const netRate = Number(budget.netRate ?? state.passiveIncomeRate ?? 0);
    if (this.pulseCashflow) {
      const sign = netRate >= 0 ? '+' : '−';
      this.pulseCashflow.textContent = `${sign}$${Math.abs(netRate * 60).toLocaleString('en-US', { maximumFractionDigits: 0 })}/min`;
      this.pulseCashflow.style.color = netRate >= 0 ? '#00ff88' : '#f87171';
      this.pulseCashflow.title = `Revenue $${Number(budget.adjustedRevenueRate ?? 0) * 60}/min · Upkeep $${Number(budget.operatingCostRate ?? 0) * 60}/min · Traffic policy $${Number(budget.managementCostRate ?? 0) * 60}/min`;
    }
    const demand = state.demand || {};
    if (this.pulseDemand) {
      this.pulseDemand.textContent = `${Math.round(demand.residential ?? 0)}/${Math.round(demand.commercial ?? 0)}/${Math.round(demand.operations ?? 0)}`;
      this.pulseDemand.title = 'Residential / Commercial / Operations development demand';
    }
    const happinessBreakdown = state.happinessBreakdown;
    if (this.pulseHappiness && happinessBreakdown) {
      this.pulseHappiness.title = [
        `Base ${happinessBreakdown.baseline}`,
        `Buildings ${happinessBreakdown.buildings >= 0 ? '+' : ''}${happinessBreakdown.buildings.toFixed(1)}`,
        `Zoning ${happinessBreakdown.zoning >= 0 ? '+' : ''}${happinessBreakdown.zoning.toFixed(1)}`,
        `Services ${happinessBreakdown.services.toFixed(1)}`,
        `Jobs ${happinessBreakdown.employment.toFixed(1)}`,
        `Traffic ${Number(happinessBreakdown.traffic ?? 0).toFixed(1)}`,
        `Incidents ${happinessBreakdown.incidents.toFixed(1)}`
      ].join(' · ');
    }
    if (this.pulseLandValue) this.pulseLandValue.textContent = landValue.toLocaleString('en-US');
    if (this.pulseReputation) this.pulseReputation.textContent = String(reputation);
    if (this.pulseServices) {
      const toCoverage = (service, fallback = 0) => {
        if (typeof service === 'number') return service <= 1 ? service * 100 : service;
        if (typeof service?.coverage === 'number') return service.coverage * 100;
        return fallback;
      };
      const power = Math.round(cityServices?.energy?.coveragePercent ?? toCoverage(services.power, energy));
      const water = Math.round(toCoverage(services.water));
      const fire = Math.round(cityServices?.safety?.coveragePercent ?? toCoverage(services.fire));
      const issues = cityServices?.activeIncidentCount ?? 0;
      this.pulseServices.textContent = `E ${power}% · Safety ${fire}% · ${issues} issue${issues === 1 ? '' : 's'}`;
      this.pulseServices.title = [
        cityServices?.energy?.explanation,
        cityServices?.safety?.explanation,
        `Water compatibility coverage ${water}%`
      ].filter(Boolean).join(' · ');
    }

    if (this.btnUnlockEast) {
      const district = state.districts?.EAST_CYBER_METROPOLIS;
      const unlocked = state.unlockedDistricts?.includes?.('EAST_CYBER_METROPOLIS') || district?.unlocked === true;
      const unlockCost = Number(district?.unlockCost ?? 1_000_000);
      this.btnUnlockEast.disabled = !!unlocked;
      this.btnUnlockEast.textContent = unlocked
        ? '✅ East District Unlocked'
        : `🏙️ Unlock East District ($${Math.round(unlockCost / 1_000)}k)`;
    }
  }

  updateActionHUD() {
    const vehicle = this.app.trafficSystem?.controlledVehicle || null;
    const pedestrian = this.app.pedestrianSystem?.controlledPedestrian || null;
    const aircraft = this.app.aircraftSystem?.controlledAircraft || null;
    const active = vehicle || pedestrian || aircraft;

    this.speedometerHud?.classList.toggle('hidden', !vehicle);
    this.flightHud?.classList.toggle('hidden', !aircraft);
    this.streetControlHint?.classList.remove('hidden');

    if (vehicle && this.speedometerValue) {
      const speed = Math.max(0, Math.round(Math.abs(
        vehicle.physicsVehicle?.speedKmH ?? vehicle.speedKmh ?? ((vehicle.speed || 0) * 3.6)
      )));
      this.speedometerValue.textContent = String(speed);
      if (this.speedometerGear) this.speedometerGear.textContent = `GEAR ${vehicle.physicsVehicle?.gear || '—'}`;
    }

    this.updateFlightHUD(aircraft);

    if (this.statWeather && this.app.environment) {
      this.statWeather.textContent = getWeatherDefinition(this.app.environment.weatherMode).statusText;
    }
    this.updateAdaptiveControls();
  }

  updateFlightHUD(aircraft = this.app.aircraftSystem?.controlledAircraft || null) {
    this.flightHud?.classList.toggle('hidden', !aircraft);
    if (!aircraft?.state) return;

    const state = aircraft.state;
    const airspeed = Math.max(0, Math.round((state.speed || 0) * 3.6));
    const ground = this.app.aircraftSystem?.getGroundHeight?.(state.position) || 0;
    const altitude = Math.max(0, Math.round((state.position?.y || 0) - ground - aircraft.config.gearHeight));
    const throttle = Math.round(Math.max(0, Math.min(1, state.throttle || 0)) * 100);
    const verticalSpeed = Number(state.verticalSpeed || 0);
    if (this.flightMode) this.flightMode.textContent = state.stallWarning ? 'STALL' : state.mode;
    if (this.flightAirspeed) this.flightAirspeed.textContent = String(airspeed);
    if (this.flightAltitude) this.flightAltitude.textContent = String(altitude);
    if (this.flightThrottle) this.flightThrottle.textContent = String(throttle);
    if (this.flightVerticalSpeed) this.flightVerticalSpeed.textContent = `${verticalSpeed >= 0 ? '+' : ''}${verticalSpeed.toFixed(1)}`;
    if (this.flightWarning) {
      const landing = this.app.aircraftSystem?.getLandingAssessment?.(state.position, state.heading);
      const warning = state.stallWarning
        ? '⚠ STALL · LOWER NOSE · ADD THROTTLE'
        : (state.grounded
          ? `${landing?.label || state.landingSurface || 'GROUND'} · W/S THROTTLE · ↓ ROTATE`
          : (landing?.allowed
            ? `LANDING AREA · ${landing.label} · MAX 126 KM/H`
            : '⚠ NO SAFE LANDING SURFACE BELOW'));
      this.flightWarning.textContent = warning;
      this.flightWarning.classList.toggle('danger', state.stallWarning || state.crashed || (!state.grounded && !landing?.allowed));
    }
  }

  activateSelectedEntity() {
    if (!this.selectedEntity) {
      this.showToast('Select a citizen, vehicle, building, or mission beacon first.');
      return false;
    }
    if (this.selectedEntity.type === 'MISSION_PICKUP' && !this.btnInteractSfx?.classList.contains('hidden')) {
      this.btnInteractSfx.click();
      return true;
    }
    if (['VEHICLE', 'PEDESTRIAN', 'AIRCRAFT'].includes(this.selectedEntity.type) && !this.btnTakeControl?.classList.contains('hidden')) {
      this.btnTakeControl.click();
      return true;
    }
    if (!this.btnInteractSfx?.classList.contains('hidden')) {
      this.btnInteractSfx.click();
      return true;
    }
    return false;
  }

  getInteractionCandidates() {
    if (!this.selectedEntity) return [];
    const type = this.selectedEntity.type || 'ENTITY';
    const label = this.selectedEntity.name
      || this.selectedEntity.info?.Name
      || this.selectedEntity.info?.Model
      || type.toLowerCase().replaceAll('_', ' ');
    const selectedId = this.selectedEntity.interactionId
      || this.selectedEntity.economyId
      || this.selectedEntity.mesh?.uuid
      || type;
    return [{
      id: `selected-entity:${selectedId}:${label}`,
      kind: 'SELECTED_ENTITY',
      priority: INTERACTION_PRIORITIES.SELECTED_ENTITY,
      prompt: `interact with selected ${label}`,
      action: () => this.activateSelectedEntity(),
      eligibility: true,
      failureReason: null,
      distance: Infinity,
      accessibilityLabel: `Interact with selected ${label}`,
      metadata: { entityType: type }
    }];
  }

  updateAdaptiveControls(force = false) {
    const inputManager = this.app?.inputManager;
    if (!inputManager || !this.adaptiveControlActions) return;
    const context = inputManager.getControlContext?.() || 'MANAGEMENT';
    const inputInterface = inputManager.activeInterface || 'KEYBOARD';
    document.body.dataset.controlContext = context.toLowerCase();
    const cameraInteraction = this.app?.sceneManager?.streetCameraController?.enabled
      ? 'LOOK'
      : 'ORBIT';
    const signature = `${context}:${inputInterface}:${cameraInteraction}`;
    if (!force && signature === this._adaptiveControlsSignature) return;
    this._adaptiveControlsSignature = signature;

    const contextDetails = {
      MANAGEMENT: ['◇', 'MANAGEMENT'],
      BUILDER: ['▦', 'CITY BUILDER'],
      VEHICLE: ['◉', 'DRIVING'],
      AIRCRAFT: ['✈', 'FLIGHT'],
      PEDESTRIAN: ['◆', 'ON FOOT'],
      DIALOGUE: ['●', 'DIALOGUE'],
      PAUSE: ['Ⅱ', 'PAUSED']
    };
    const [icon, label] = contextDetails[context] || contextDetails.MANAGEMENT;
    if (this.adaptiveContextIcon) this.adaptiveContextIcon.textContent = icon;
    if (this.adaptiveContextLabel) this.adaptiveContextLabel.textContent = label;

    this.adaptiveControlActions.replaceChildren();
    for (const binding of inputManager.getActiveBindings?.() || []) {
      const item = document.createElement('span');
      item.className = 'adaptive-control-item';
      item.dataset.action = binding.action;

      const tokenGroup = document.createElement('span');
      tokenGroup.className = 'control-token-group';
      const tokens = inputInterface === 'GAMEPAD' ? binding.gamepad : binding.keyboard;
      for (const token of tokens) {
        const tokenElement = document.createElement('span');
        tokenElement.className = `control-token control-token-${token.kind}`;
        if (token.tone) tokenElement.dataset.tone = token.tone;
        tokenElement.textContent = token.label;
        tokenGroup.appendChild(tokenElement);
      }

      const actionLabel = document.createElement('span');
      actionLabel.className = 'control-action-label';
      actionLabel.textContent = binding.action === 'ORBIT' && cameraInteraction === 'LOOK'
        ? 'Look around'
        : binding.label;
      item.append(tokenGroup, actionLabel);
      this.adaptiveControlActions.appendChild(item);
    }
  }

  updateTimeDisplay(timeVal) {
    // Format hours and minutes
    const hours = Math.floor(timeVal);
    const minutes = Math.floor((timeVal - hours) * 60);
    const hoursStr = hours.toString().padStart(2, '0');
    const minutesStr = minutes.toString().padStart(2, '0');
    this.clockDisplay.textContent = `${hoursStr}:${minutesStr}`;
    if (this.statSimTime) this.statSimTime.textContent = `${hoursStr}:${minutesStr}`;

    // Update slider position if not being dragged by user
    if (document.activeElement !== this.timeSlider) {
      this.timeSlider.value = timeVal;
    }

    // Determine Phase and Icon
    if (timeVal >= 5.0 && timeVal < 7.5) {
      this.timePhase.textContent = 'DAWN (SUNRISE)';
      this.timeIcon.textContent = '🌅';
    } else if (timeVal >= 7.5 && timeVal < 17.0) {
      this.timePhase.textContent = 'DAYTIME';
      this.timeIcon.textContent = '☀️';
    } else if (timeVal >= 17.0 && timeVal < 19.5) {
      this.timePhase.textContent = 'DUSK (SUNSET)';
      this.timeIcon.textContent = '🌇';
    } else {
      this.timePhase.textContent = 'NIGHTTIME';
      this.timeIcon.textContent = '🌙';
    }
  }

  updateStats(vehiclesCount, pedestriansCount, fps) {
    if (this.statVehicles) this.statVehicles.textContent = vehiclesCount;
    if (this.statPedestrians) this.statPedestrians.textContent = pedestriansCount;
    if (this.statFps) this.statFps.textContent = `${Math.round(fps)} FPS`;
    if (this.inspectorVehicleCount) this.inspectorVehicleCount.textContent = String(vehiclesCount);
    if (this.inspectorPedestrianCount) this.inspectorPedestrianCount.textContent = String(pedestriansCount);
    this.updateActionHUD();
  }

  showInspector(entity) {
    this.selectedEntity = entity;
    document.body.dataset.inspector = 'open';
    this.syncLocalLandValue(entity);
    if (this.inspectorHud) this.inspectorHud.classList.remove('hidden');
    if (this.inspectorType) this.inspectorType.textContent = entity.type || 'OBJECT';
    if (this.inspectorTitle) this.inspectorTitle.textContent = entity.name || 'Unknown Entity';
    
    // Clear and build info rows
    if (this.inspectorBody) {
      this.inspectorBody.innerHTML = '';
      if (entity.info) {
        for (const [key, value] of Object.entries(entity.info)) {
          const row = document.createElement('div');
          row.className = 'attr-row';
          const keyEl = document.createElement('span');
          keyEl.className = 'attr-key';
          keyEl.textContent = `${key}:`;
          const valueEl = document.createElement('span');
          valueEl.className = 'attr-val class-cyan';
          valueEl.textContent = String(value);
          row.append(keyEl, valueEl);
          this.inspectorBody.appendChild(row);
        }
      }
    }

    // Configure action buttons
    if (this.btnFollowTarget) {
      if (entity.type === 'VEHICLE' || entity.type === 'PEDESTRIAN' || entity.type === 'AIRCRAFT') {
        this.btnFollowTarget.classList.remove('hidden');
        const isFollowing = (this.app.sceneManager.followTarget === entity);
        this.btnFollowTarget.innerHTML = isFollowing ? '❌ Stop Following' : '👁️ Follow Camera';
        this.btnFollowTarget.classList.toggle('active', isFollowing);
      } else {
        this.btnFollowTarget.classList.add('hidden');
      }
    }

    if (entity.type === 'VEHICLE') {
      if (this.btnTakeControl) {
        this.btnTakeControl.classList.remove('hidden');
        const isControlled = (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle === entity && entity.userControlled);
        const isStreetHijack = !!this.app.pedestrianSystem?.controlledPedestrian;
        this.btnTakeControl.innerHTML = isControlled ? '🛑 Release Physics Drive' : (isStreetHijack ? '🏎️ Hijack Nearby Vehicle' : '🏎️ Take Control (Physics)');
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
      if (this.btnInteractSfx) {
        this.btnInteractSfx.classList.remove('hidden');
        this.btnInteractSfx.innerHTML = entity.isPolice ? '🚨 Sound Siren' : '📯 Sound Honk';
      }
      if (this.btnCombatAction) {
        this.btnCombatAction.classList.toggle('hidden', !this.app.pedestrianSystem?.controlledPedestrian);
        this.btnCombatAction.textContent = '🏏 Strike Vehicle';
      }
    } else if (entity.type === 'PEDESTRIAN') {
      if (this.btnTakeControl) {
        this.btnTakeControl.classList.remove('hidden');
        const isControlled = (this.app.pedestrianSystem && this.app.pedestrianSystem.controlledPedestrian === entity && entity.userControlled);
        this.btnTakeControl.innerHTML = isControlled ? '🛑 Release Walk Control' : '🚶 Take Control (Walk)';
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
      if (this.btnInteractSfx) {
        this.btnInteractSfx.classList.remove('hidden');
        this.btnInteractSfx.innerHTML = '👋 Wave / Talk';
      }
      if (this.btnCombatAction) {
        const canCombat = !!this.app.pedestrianSystem?.controlledPedestrian && this.app.pedestrianSystem.controlledPedestrian !== entity;
        this.btnCombatAction.classList.toggle('hidden', !canCombat);
        this.btnCombatAction.textContent = '🏏 Melee Attack';
      }
    } else if (entity.type === 'AIRCRAFT') {
      if (this.btnTakeControl) {
        this.btnTakeControl.classList.remove('hidden');
        const isControlled = this.app.aircraftSystem?.controlledAircraft === entity && entity.userControlled;
        this.btnTakeControl.innerHTML = isControlled ? '🛑 Leave Cockpit' : '🛩️ Take Flight Control';
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
      if (this.btnInteractSfx) this.btnInteractSfx.classList.add('hidden');
      if (this.btnCombatAction) this.btnCombatAction.classList.add('hidden');
    } else if (entity.type === 'MISSION_PICKUP') {
      if (this.btnTakeControl) this.btnTakeControl.classList.add('hidden');
      if (this.btnCombatAction) this.btnCombatAction.classList.add('hidden');
      if (this.btnInteractSfx) {
        this.btnInteractSfx.classList.remove('hidden');
        this.btnInteractSfx.innerHTML = '🚖 Start Fare Dialogue';
      }
    } else {
      if (this.btnTakeControl) this.btnTakeControl.classList.add('hidden');
      if (this.btnInteractSfx) this.btnInteractSfx.classList.add('hidden');
      if (this.btnCombatAction) this.btnCombatAction.classList.add('hidden');
    }
  }

  hideInspector() {
    this.selectedEntity = null;
    document.body.dataset.inspector = 'closed';
    if (this.inspectorHud) this.inspectorHud.classList.add('hidden');
  }

  updateInspectorLive() {
    this.updateRocketButtonDisplay();
    if (!this.selectedEntity) return;

    // Check if the inspected entity has been culled or removed from the scene
    if (this.selectedEntity.mesh && !this.selectedEntity.mesh.parent) {
      this.hideInspector();
      return;
    }
    if (this.selectedEntity.type === 'VEHICLE' && this.app && this.app.trafficSystem) {
      if (!this.app.trafficSystem.vehicles.includes(this.selectedEntity)) {
        this.hideInspector();
        return;
      }
    }
    if (this.selectedEntity.type === 'PEDESTRIAN' && this.app && this.app.pedestrianSystem) {
      if (!this.app.pedestrianSystem.pedestrians.includes(this.selectedEntity)) {
        this.hideInspector();
        return;
      }
    }
    if (this.selectedEntity.type === 'AIRCRAFT' && this.app.aircraftSystem?.aircraft !== this.selectedEntity) {
      this.hideInspector();
      return;
    }

    if (!this.selectedEntity.info) return;
    this.syncLocalLandValue(this.selectedEntity);

    // Keep Take Control action button live
    if (this.selectedEntity.type === 'VEHICLE' && this.btnTakeControl) {
      const isControlled = (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle === this.selectedEntity && this.selectedEntity.userControlled);
      const targetText = isControlled ? '🛑 Release Physics Drive' : (this.app.pedestrianSystem?.controlledPedestrian ? '🏎️ Hijack Nearby Vehicle' : '🏎️ Take Control (Physics)');
      if (this.btnTakeControl.innerHTML !== targetText) {
        this.btnTakeControl.innerHTML = targetText;
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
    } else if (this.selectedEntity.type === 'PEDESTRIAN' && this.btnTakeControl) {
      const isControlled = (this.app.pedestrianSystem && this.app.pedestrianSystem.controlledPedestrian === this.selectedEntity && this.selectedEntity.userControlled);
      const targetText = isControlled ? '🛑 Release Walk Control' : '🚶 Take Control (Walk)';
      if (this.btnTakeControl.innerHTML !== targetText) {
        this.btnTakeControl.innerHTML = targetText;
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
    } else if (this.selectedEntity.type === 'AIRCRAFT' && this.btnTakeControl) {
      const isControlled = this.app.aircraftSystem?.controlledAircraft === this.selectedEntity && this.selectedEntity.userControlled;
      const targetText = isControlled ? '🛑 Leave Cockpit' : '🛩️ Take Flight Control';
      if (this.btnTakeControl.innerHTML !== targetText) {
        this.btnTakeControl.innerHTML = targetText;
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
    }

    // Update live values like vehicle speed, coordinates, or battery
    const rows = this.inspectorBody.querySelectorAll('.attr-row');
    let idx = 0;
    for (const [key, value] of Object.entries(this.selectedEntity.info)) {
      if (rows[idx]) {
        const valSpan = rows[idx].querySelector('.attr-val');
        if (valSpan && valSpan.textContent !== String(value)) {
          valSpan.textContent = value;
        }
      }
      idx++;
    }
  }

  syncLocalLandValue(entity = this.selectedEntity) {
    const economy = this.app?.economySystem;
    const position = entity?.plot || entity?.group?.position;
    if (
      entity?.type !== 'BUILDING'
      || !entity.info
      || !Number.isFinite(position?.x)
      || !Number.isFinite(position?.z)
      || typeof economy?.getLandValueBreakdownAt !== 'function'
    ) {
      return null;
    }

    const breakdown = economy.getLandValueBreakdownAt(position.x, position.z);
    const amenity = Math.round(breakdown.amenityModifier);
    const mayhem = Math.round(breakdown.mayhemModifier);
    const signed = value => `${value >= 0 ? '+' : ''}${value}`;
    entity.info['Local Land Value'] = Math.round(breakdown.landValue).toLocaleString('en-US');
    entity.info['Local Influences'] = `Amenities ${signed(amenity)} · Mayhem ${signed(mayhem)}`;
    return breakdown;
  }

  updateRocketButtonDisplay() {
    if (!this.launchRocketLabel) return;
    const funMode = this.app && this.app.funMode;
    const launched = this.app && this.app.rocketLaunched;
    const countdown = this.app && typeof this.app.rocketCountdown === 'number' ? Math.max(0, Math.ceil(this.app.rocketCountdown)) : 300;

    if (launched) {
      this.launchRocketLabel.textContent = '🚀 LIFTOFF! (Reset)';
      if (this.btnLaunchRocket) this.btnLaunchRocket.classList.add('active');
    } else if (funMode) {
      const mins = Math.floor(countdown / 60);
      const secs = countdown % 60;
      this.launchRocketLabel.textContent = `🚀 Launch Now (T-${mins}:${String(secs).padStart(2, '0')})`;
      if (this.btnLaunchRocket) this.btnLaunchRocket.classList.remove('active');
    } else {
      this.launchRocketLabel.textContent = '🚀 Launch Rocket (T-5:00)';
      if (this.btnLaunchRocket) this.btnLaunchRocket.classList.remove('active');
    }
  }

  onBuildingDestroyed() {
    // Each destroyed building drops the real estate index!
    const drop = Math.floor(Math.random() * 180000000 + 140000000);
    this.targetReValue = Math.max(12000000, this.targetReValue - drop);
  }

  resetRealEstateValue() {
    this.targetReValue = this.initialReValue;
    this.currentReValue = this.initialReValue;
    if (this.reValueDisplay) {
      this.reValueDisplay.innerText = '$' + this.currentReValue.toLocaleString('en-US');
      this.reValueDisplay.classList.remove('dropping', 'collapsed');
    }
    if (this.reStatusDisplay) {
      this.reStatusDisplay.innerHTML = 'Market Status: <span class="accent-val" style="color: #10b981; font-weight: 700;">Speculative Bubble 🎈</span>';
    }
  }

  updateRealEstateTracker(delta) {
    if (!this.reTracker || this.reTracker.classList.contains('hidden')) return;

    if (this.currentReValue > this.targetReValue) {
      // Calculate drop rate: roll down smoothly over frames
      const diff = this.currentReValue - this.targetReValue;
      const step = Math.max(2500000, Math.ceil(diff * 5.0 * delta));
      this.currentReValue = Math.max(this.targetReValue, this.currentReValue - step);

      if (this.reValueDisplay) {
        this.reValueDisplay.innerText = '$' + this.currentReValue.toLocaleString('en-US');
        this.reValueDisplay.classList.add('dropping');
      }

      this.updateMarketStatusText();
    } else {
      if (this.reValueDisplay && this.reValueDisplay.classList.contains('dropping')) {
        this.reValueDisplay.classList.remove('dropping');
        this.reValueDisplay.innerText = '$' + this.currentReValue.toLocaleString('en-US');
      }
    }
  }

  updateMarketStatusText() {
    if (!this.reStatusDisplay) return;
    const val = this.currentReValue;
    let statusText = 'Speculative Bubble 🎈';
    let colorHex = '#10b981';
    let collapsed = false;

    if (val > 4000000000) {
      statusText = 'Speculative Bubble 🎈';
      colorHex = '#10b981';
    } else if (val > 3200000000) {
      statusText = 'Minor Market Correction 📉';
      colorHex = '#facc15';
    } else if (val > 2400000000) {
      statusText = 'Panic Selling! 😱';
      colorHex = '#fb923c';
    } else if (val > 1500000000) {
      statusText = 'Landlords Weeping! 😭';
      colorHex = '#f87171';
    } else if (val > 800000000) {
      statusText = 'Total Market Collapse! 🔥';
      colorHex = '#ef4444';
      collapsed = true;
    } else {
      statusText = 'Apocalyptic Bargains! 🏚️';
      colorHex = '#ff0055';
      collapsed = true;
    }

    if (this.reValueDisplay) {
      this.reValueDisplay.classList.toggle('collapsed', collapsed);
    }

    this.reStatusDisplay.innerHTML = `Market Status: <span style="color: ${colorHex}; font-weight: 700;">${statusText}</span>`;
  }

  updateDynamicWeatherBtnState() {
    this.syncDynamicWeatherControl(this.app.environment?.isDynamicWeather);
  }

  syncTimePlayingControl(isPlaying) {
    if (!this.btnTimePlay || typeof isPlaying !== 'boolean') return;
    this.isTimePlaying = isPlaying;
    this.btnTimePlay.textContent = isPlaying ? '⏸️' : '▶️';
    this.btnTimePlay.title = isPlaying ? 'Pause Time' : 'Play Time';
    this.btnTimePlay.setAttribute('aria-pressed', String(isPlaying));
  }

  syncTimeSpeedControl(speed) {
    if (!Number.isFinite(speed)) return;
    this.timeSpeed = speed;
    this.speedButtons.forEach(btn => {
      const active = Number(btn.dataset.speed) === speed;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  syncDynamicWeatherControl(active) {
    if (!this.btnDynamicWeather || typeof active !== 'boolean') return;
    this.btnDynamicWeather.classList.toggle('active', active);
    this.btnDynamicWeather.setAttribute('aria-pressed', String(active));
    this.btnDynamicWeather.textContent = active ? '🔄 Dynamic Cycle: ON' : '🔄 Dynamic Cycle: OFF';
  }

  syncWeatherButtons(mode) {
    if (!this.weatherButtons) return;
    this.weatherButtons.forEach(btn => {
      const active = btn.dataset.weather === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  toggleCityEditor() {
    if (!this.cityEditorUI) return;
    const enteringBuilder = !this.cityEditorUI.isVisible;
    const hasDirectControl = Boolean(
      this.app.trafficSystem?.controlledVehicle
      || this.app.aircraftSystem?.controlledAircraft
      || this.app.pedestrianSystem?.controlledPedestrian
    );
    if (enteringBuilder && (hasDirectControl || this.app.missionSystem?.activeMission)) {
      this.showToast('⚠️ Return to Management with [M] before opening the City Editor.');
      return false;
    }
    const destination = enteringBuilder ? GAME_STATES.BUILDER : GAME_STATES.MANAGEMENT;
    const result = this.app.transitionCoordinator?.tryTransitionTo?.(destination, {
      reason: 'city-editor',
      source: 'UIManager'
    });
    if (result && !result.ok) {
      this.showToast(`⚠️ ${result.error?.message || 'City Editor transition failed.'}`);
      return false;
    }
    if (!this.app.transitionCoordinator) this.cityEditorUI.toggle();
    const isActive = destination === GAME_STATES.BUILDER;
    if (this.btnExpandCity) {
      this.btnExpandCity.classList.toggle('active', isActive);
    }
    if (this.expandCityLabel) {
      this.expandCityLabel.textContent = isActive ? 'Expand City: ACTIVE 🏗️' : 'Expand City Mode [F]';
    }
    this.addAlert(isActive ? '🏗️ City Editor active: Zoning and placement tools ready.' : '✅ City Editor closed. Simulation resumed.', 'info');
    return isActive;
  }

  addAlert(message, type = 'info', context = {}) {
    if (this.app?.alertService) {
      return typeof message === 'object' && message !== null
        ? this.app.alertService.publish(message)
        : this.app.alertService.publishLegacy(message, type, context);
    }
    if (!this.alertFeedList) {
      this.alertFeedList = document.getElementById('alert-feed-list');
    }
    if (!this.alertFeedList) return;

    const timeStr = (this.app && this.app.timeManager && typeof this.app.timeManager.getFormattedTime === 'function')
      ? this.app.timeManager.getFormattedTime()
      : 'LIVE';

    const safeType = ['info', 'success', 'warn', 'danger'].includes(type) ? type : 'info';
    const item = document.createElement('div');
    item.className = `alert-item alert-${safeType}`;
    item.append(
      createTextElement('span', 'alert-time', timeStr),
      document.createTextNode(' '),
      createTextElement('span', 'alert-msg', message)
    );

    this.alertFeedList.insertBefore(item, this.alertFeedList.firstChild);
    if (this.topAlertSummary) {
      this.topAlertSummary.textContent = message.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 34).toUpperCase();
      this.topAlertSummary.title = message;
    }

    while (this.alertFeedList.children.length > 7) {
      this.alertFeedList.removeChild(this.alertFeedList.lastChild);
    }
    return item;
  }

  bindAlertService(service) {
    this.unsubscribeAlerts?.();
    if (!service?.subscribe) return false;
    if (!this.alertFeedList) this.alertFeedList = document.getElementById('alert-feed-list');
    if (this._alertClickHandler) this.alertFeedList?.removeEventListener?.('click', this._alertClickHandler);
    this._alertClickHandler = event => {
      const button = event.target?.closest?.('[data-alert-action]');
      if (!button) return;
      this.app.alertActionController?.execute?.(button.dataset.alertAction);
    };
    this.alertFeedList?.addEventListener?.('click', this._alertClickHandler);
    this.unsubscribeAlerts = service.subscribe(event => this.renderAlerts(event?.current || event), { emitCurrent: true });
    return true;
  }

  formatAlertTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : 'LIVE';
  }

  renderAlerts(snapshot) {
    if (!this.alertFeedList || !Array.isArray(snapshot?.items)) return false;
    const records = snapshot.items.slice(0, 7);
    const nodes = records.map(alert => {
      const severityClass = ALERT_SEVERITY_CLASSES[alert.severity] || 'info';
      const item = document.createElement('article');
      item.className = `alert-item alert-${severityClass}`;
      item.dataset.alertId = alert.id;
      item.dataset.alertState = alert.state.toLowerCase();

      const header = createTextElement('div', 'alert-header');
      header.append(
        createTextElement('span', 'alert-time', this.formatAlertTime(alert.startTime)),
        createTextElement('span', 'alert-severity', ALERT_SEVERITY_LABELS[alert.severity] || alert.severity),
        createTextElement('span', 'alert-state', alert.state === ALERT_STATES.ACTIVE ? 'Active' : alert.state === ALERT_STATES.RESOLVED ? 'Resolved' : 'Superseded')
      );
      const title = createTextElement('strong', 'alert-title', alert.title);
      const cause = createTextElement('span', 'alert-msg', alert.cause);
      const context = createTextElement('span', 'alert-context');
      context.append(
        createTextElement('span', 'alert-location', `⌖ ${alert.location.label}`),
        createTextElement('span', 'alert-recommendation', alert.recommendation)
      );
      item.append(header, title, cause, context);

      if (alert.occurrences > 1) {
        item.appendChild(createTextElement('span', 'alert-occurrences', `Collapsed ${alert.occurrences} reports`));
      }
      if (alert.state === ALERT_STATES.ACTIVE && alert.focusAction.type !== ALERT_FOCUS_ACTIONS.NONE) {
        const button = createTextElement('button', 'alert-action', alert.focusAction.label);
        button.type = 'button';
        button.dataset.alertAction = alert.id;
        button.setAttribute('aria-label', `${alert.focusAction.label}: ${alert.title} at ${alert.location.label}`);
        item.appendChild(button);
      }
      return item;
    });
    if (nodes.length === 0) {
      nodes.push(createTextElement('p', 'alert-empty', 'No active or recent city alerts.'));
    }
    this.alertFeedList.replaceChildren(...nodes);

    const priority = snapshot.active?.[0] || records[0] || null;
    if (this.topAlertSummary) {
      this.topAlertSummary.textContent = priority ? priority.title.slice(0, 34).toUpperCase() : 'NO ACTIVE ALERTS';
      this.topAlertSummary.title = priority
        ? `${priority.title}: ${priority.cause}`
        : 'No active city alerts';
    }
    return true;
  }

  bindSaveService(service) {
    this.unsubscribeSaveStatus?.();
    const element = document.getElementById('save-status');
    if (!service?.subscribe || !element) return false;
    const labels = {
      IDLE: 'Save ready',
      SCHEDULED: 'Save pending…',
      SAVING: 'Saving…',
      SAVED: 'Saved',
      LOADING: 'Loading save…',
      ERROR: 'Save failed',
      UNAVAILABLE: 'Saving unavailable'
    };
    this.unsubscribeSaveStatus = service.subscribe(snapshot => {
      element.textContent = labels[snapshot.status] || snapshot.status;
      element.dataset.status = snapshot.status;
      element.title = snapshot.error || (snapshot.lastSavedAt ? `Last saved ${snapshot.lastSavedAt}` : '');
      this.btnSaveCity?.toggleAttribute?.('disabled', snapshot.status === 'SAVING' || snapshot.status === 'LOADING');
    }, { emitCurrent: true });
    return true;
  }

  updateAlertFeed(delta) {
    if (!this.app) return;
    this.app.alertService?.expire?.();
    this.alertTimer += delta;
    if (this.alertTimer < 14.0) return;
    this.alertTimer = 0;

    const service = this.app.alertService;
    if (!service) return;
    if (this.currentReValue < 2_000_000_000) {
      service.publish({
        dedupeKey: 'economy:valuation-low',
        type: ALERT_TYPES.ECONOMY,
        severity: ALERT_SEVERITIES.WARNING,
        title: 'Property valuation is under pressure',
        cause: `Aggregate real-estate valuation fell to $${Math.round(this.currentReValue / 1e6)}M.`,
        location: 'Citywide',
        duration: { kind: ALERT_DURATION_KINDS.UNTIL_RESOLVED },
        recommendation: 'Review services, safety, congestion, and nearby amenities before expanding.',
        relatedEntityIds: [],
        focusAction: { type: ALERT_FOCUS_ACTIONS.NONE }
      });
    } else {
      service.resolve('economy:valuation-low', 'Property valuation recovered above the alert threshold');
    }
  }

  showToast(message) {
    let toast = document.getElementById('city-editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'city-editor-toast';
      toast.className = 'hud-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    document.body.classList.add('toast-visible');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      document.body.classList.remove('toast-visible');
    }, 3200);
  }

  updateControlDeviceBadge(newInterface) {
    if (!this.inputDeviceBadge || !this.inputDeviceIcon || !this.inputDeviceLabel) return;
    if (newInterface === 'GAMEPAD') {
      this.inputDeviceBadge.classList.add('gamepad-active');
      this.inputDeviceIcon.textContent = '🎮';
      this.inputDeviceLabel.textContent = 'XBOX';
      this.inputDeviceBadge.title = 'Xbox controller active — move the mouse or press a key to switch instantly';
    } else {
      this.inputDeviceBadge.classList.remove('gamepad-active');
      this.inputDeviceIcon.textContent = '⌨';
      this.inputDeviceLabel.textContent = 'KEYBOARD + MOUSE';
      this.inputDeviceBadge.title = 'Keyboard and mouse active — use the controller to switch instantly';
    }
    document.body.dataset.inputMethod = newInterface.toLowerCase();
    this.updateAdaptiveControls(true);
  }

  updateGamepadConnection(connected, id = '') {
    this.inputDeviceBadge?.classList.toggle('gamepad-connected', Boolean(connected));
    if (connected) {
      this.showToast(`🎮 Controller ready${id ? `: ${id.replace(/\s*\([^)]*\)\s*/g, '').trim()}` : ''}`);
    }
  }
}
