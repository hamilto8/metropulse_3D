export class UIManager {
  constructor(app) {
    this.app = app;
    
    // Time UI elements
    this.timeSlider = document.getElementById('time-slider');
    this.clockDisplay = document.getElementById('clock-display');
    this.timePhase = document.getElementById('time-phase');
    this.timeIcon = document.getElementById('time-icon');
    this.btnTimePlay = document.getElementById('btn-time-play');
    this.speedButtons = document.querySelectorAll('.speed-btn');
    
    // Header stat counters
    this.statVehicles = document.getElementById('stat-vehicles');
    this.statPedestrians = document.getElementById('stat-pedestrians');
    this.statFps = document.getElementById('stat-fps');
    
    // Camera and Weather controls
    this.cameraButtons = document.querySelectorAll('[data-camera]');
    this.weatherButtons = document.querySelectorAll('[data-weather]');
    this.btnDynamicWeather = document.getElementById('btn-dynamic-weather');
    
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
    
    this.selectedEntity = null;
    this.isTimePlaying = true;
    this.timeSpeed = 1.0;

    this.initEventListeners();
  }

  initEventListeners() {
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
        this.isTimePlaying = !this.isTimePlaying;
        this.app.timeManager.setPlaying(this.isTimePlaying);
        this.btnTimePlay.innerHTML = this.isTimePlaying ? '⏸️' : '▶️';
        this.btnTimePlay.title = this.isTimePlaying ? 'Pause Time' : 'Play Time';
      });
    }

    // Speed buttons
    this.speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.timeSpeed = parseFloat(btn.dataset.speed);
        this.app.timeManager.setSpeed(this.timeSpeed);
      });
    });

    // Camera presets
    this.cameraButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.cameraButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const cameraMode = btn.dataset.camera;
        this.app.sceneManager.setCameraPreset(cameraMode);
      });
    });

    // Weather toggle
    this.weatherButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Turning on manual weather disables dynamic weather cycle
        if (this.app.environment) {
          this.app.environment.isDynamicWeather = false;
          this.updateDynamicWeatherBtnState();
        }

        this.weatherButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const weatherMode = btn.dataset.weather;
        this.app.environment.setWeather(weatherMode);
        if (this.app.physicsWorld) {
          this.app.physicsWorld.setWeatherFriction(weatherMode);
        }
      });
    });

    // Dynamic Weather Cycle toggle
    if (this.btnDynamicWeather) {
      this.btnDynamicWeather.addEventListener('click', () => {
        if (this.app.environment) {
          const env = this.app.environment;
          env.isDynamicWeather = !env.isDynamicWeather;
          this.updateDynamicWeatherBtnState();

          if (env.isDynamicWeather) {
            // Immediate transition timer
            env.weatherCycleTimer = 25.0 + Math.random() * 25.0;
          }
        }
      });
    }

    // Collapsible Top Header & Left Sidebar controls
    const topHeader = document.getElementById('top-header');
    const btnToggleHeader = document.getElementById('btn-toggle-header');
    const leftSidebar = document.getElementById('left-sidebar');
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

    if (btnToggleHeader && topHeader) {
      btnToggleHeader.addEventListener('click', () => {
        const isCollapsed = topHeader.classList.toggle('collapsed');
        btnToggleHeader.textContent = isCollapsed ? '▼' : '▲';
      });
    }

    if (btnToggleSidebar && leftSidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        const isCollapsed = leftSidebar.classList.toggle('collapsed');
        btnToggleSidebar.textContent = isCollapsed ? '▶' : '◀';
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

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F') {
        this.toggleCityEditor();
      }
    });

    // Fun Mode toggle
    if (this.btnFunMode) {
      this.btnFunMode.addEventListener('click', () => {
        this.app.funMode = !this.app.funMode;
        if (this.app.billboardCanvas) {
          this.app.billboardCanvas.forceRedrawAll();
        }
        if (this.app.funMode) {
          this.btnFunMode.classList.add('active');
          if (this.funModeLabel) this.funModeLabel.textContent = 'Fun Mode: MAYHEM! 🔥';
          if (this.newsChyron) this.newsChyron.classList.remove('hidden');
          if (this.reTracker) {
            this.reTracker.classList.remove('hidden');
            this.resetRealEstateValue();
          }
          if (this.app.audioSystem && !this.app.audioSystem.isEnabled) {
            this.app.audioSystem.toggleAudio();
            if (this.btnMute) this.btnMute.classList.add('active');
            if (this.muteIcon) this.muteIcon.textContent = '🔊';
            if (this.muteLabel) this.muteLabel.textContent = 'SFX Active';
            if (this.volumeSlider) this.volumeSlider.disabled = false;
          }
          if (this.app.audioSystem) this.app.audioSystem.playSiren(1.5);
        } else {
          this.btnFunMode.classList.remove('active');
          if (this.funModeLabel) this.funModeLabel.textContent = 'Fun Mode: OFF';
          if (this.newsChyron) this.newsChyron.classList.add('hidden');
          if (this.reTracker) this.reTracker.classList.add('hidden');
          this.resetRealEstateValue();
          if (this.app.buildingFactory) {
            this.app.buildingFactory.restoreAllBuildings();
          }
        }
      });
    }

    if (this.btnLaunchRocket) {
      this.btnLaunchRocket.addEventListener('click', () => {
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
          const isNowControlled = ts.toggleUserControl(this.selectedEntity);
          this.btnTakeControl.innerHTML = isNowControlled ? '🛑 Release Physics Drive' : '🏎️ Take Control (Physics)';
          this.btnTakeControl.classList.toggle('active', isNowControlled);

          // Phase 2: Cinematic swoop transition to street level or ascend back to macro view
          if (isNowControlled) {
            this.app.sceneManager.startFollowTarget(this.selectedEntity);
            this.btnFollowTarget.innerHTML = '❌ Stop Following';
            this.btnFollowTarget.classList.add('active');
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
          } else {
            this.app.sceneManager.stopFollowTarget();
            this.btnFollowTarget.innerHTML = '🎯 Follow Target';
            this.btnFollowTarget.classList.remove('active');
          }
        }
      });
    }

    // Trigger SFX / Interaction button
    this.btnInteractSfx.addEventListener('click', () => {
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

    // Speed pill listeners (.speed-pill)
    const speedPills = document.querySelectorAll('.speed-pill');
    speedPills.forEach(btn => {
      btn.addEventListener('click', () => {
        speedPills.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.timeSpeed = parseFloat(btn.dataset.speed || 1);
        this.app.timeManager.setSpeed(this.timeSpeed);
      });
    });

    // Mode Selector dropdown
    const btnModeSelector = document.getElementById('btn-mode-selector');
    const modeLabel = document.getElementById('current-mode-label');
    if (btnModeSelector) {
      btnModeSelector.addEventListener('click', () => {
        if (!modeLabel) return;
        const currentMode = modeLabel.textContent.trim();
        if (currentMode === 'MANAGEMENT') {
          modeLabel.textContent = 'CITY EDITOR';
          this.toggleCityEditor();
        } else if (currentMode === 'CITY EDITOR') {
          modeLabel.textContent = 'MAYHEM / FUN';
          if (this.btnFunMode) this.btnFunMode.click();
        } else {
          modeLabel.textContent = 'MANAGEMENT';
          if (this.app.funMode && this.btnFunMode) this.btnFunMode.click();
          if (this.app.cityEditorSystem && this.app.cityEditorSystem.enabled) {
            this.toggleCityEditor();
          }
        }
      });
    }

    // Zoning cards (triggers City Editor with hover preview)
    const zoningCards = document.querySelectorAll('.zoning-card[data-zone]');
    zoningCards.forEach(card => {
      card.addEventListener('click', () => {
        const zoneType = card.dataset.zone;
        if (!this.app.cityEditorSystem || !this.app.cityEditorSystem.enabled) {
          this.toggleCityEditor();
        }
        if (modeLabel) modeLabel.textContent = 'CITY EDITOR';
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
          const peds = this.app.pedestrianSystem.pedestrians;
          const randomPed = peds[Math.floor(Math.random() * peds.length)];
          if (randomPed) {
            this.showInspector(randomPed);
            this.app.sceneManager.toggleFollowTarget(randomPed);
          }
        }
      });
    }
  }

  updateTimeDisplay(timeVal) {
    // Format hours and minutes
    const hours = Math.floor(timeVal);
    const minutes = Math.floor((timeVal - hours) * 60);
    const hoursStr = hours.toString().padStart(2, '0');
    const minutesStr = minutes.toString().padStart(2, '0');
    this.clockDisplay.textContent = `${hoursStr}:${minutesStr}`;

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
  }

  showInspector(entity) {
    this.selectedEntity = entity;
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
          row.innerHTML = `<span class="attr-key">${key}:</span> <span class="attr-val class-cyan">${value}</span>`;
          this.inspectorBody.appendChild(row);
        }
      }
    }

    // Configure action buttons
    if (this.btnFollowTarget) {
      if (entity.type === 'VEHICLE' || entity.type === 'PEDESTRIAN') {
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
        this.btnTakeControl.innerHTML = isControlled ? '🛑 Release Physics Drive' : '🏎️ Take Control (Physics)';
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
      if (this.btnInteractSfx) {
        this.btnInteractSfx.classList.remove('hidden');
        this.btnInteractSfx.innerHTML = entity.isPolice ? '🚨 Sound Siren' : '📯 Sound Honk';
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
    } else if (entity.type === 'MISSION_PICKUP') {
      if (this.btnTakeControl) this.btnTakeControl.classList.add('hidden');
      if (this.btnInteractSfx) {
        this.btnInteractSfx.classList.remove('hidden');
        this.btnInteractSfx.innerHTML = '🚖 Start Fare Dialogue';
      }
    } else {
      if (this.btnTakeControl) this.btnTakeControl.classList.add('hidden');
      if (this.btnInteractSfx) this.btnInteractSfx.classList.add('hidden');
    }
  }

  hideInspector() {
    this.selectedEntity = null;
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

    if (!this.selectedEntity.info) return;

    // Keep Take Control action button live
    if (this.selectedEntity.type === 'VEHICLE' && this.btnTakeControl) {
      const isControlled = (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle === this.selectedEntity && this.selectedEntity.userControlled);
      const targetText = isControlled ? '🛑 Release Physics Drive' : '🏎️ Take Control (Physics)';
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
    }

    // Update live values like vehicle speed, coordinates, or battery
    const rows = this.inspectorBody.querySelectorAll('.info-row');
    let idx = 0;
    for (const [key, value] of Object.entries(this.selectedEntity.info)) {
      if (rows[idx]) {
        const valSpan = rows[idx].querySelector('.info-val');
        if (valSpan && valSpan.textContent !== String(value)) {
          valSpan.textContent = value;
        }
      }
      idx++;
    }
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
    if (!this.btnDynamicWeather || !this.app.environment) return;
    const active = this.app.environment.isDynamicWeather;
    this.btnDynamicWeather.classList.toggle('active', active);
    this.btnDynamicWeather.innerHTML = active ? '🔄 Dynamic Cycle: ON' : '🔄 Dynamic Cycle: OFF';
  }

  syncWeatherButtons(mode) {
    if (!this.weatherButtons) return;
    this.weatherButtons.forEach(btn => {
      if (btn.dataset.weather === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    if (this.app.physicsWorld) {
      this.app.physicsWorld.setWeatherFriction(mode);
    }
  }

  toggleCityEditor() {
    if (!this.cityEditorUI) return;
    this.cityEditorUI.toggle();
    const isActive = this.cityEditorUI.isVisible;
    if (this.btnExpandCity) {
      this.btnExpandCity.classList.toggle('active', isActive);
    }
    if (this.expandCityLabel) {
      this.expandCityLabel.textContent = isActive ? 'Expand City: ACTIVE 🏗️' : 'Expand City Mode [E]';
    }
  }

  showToast(message) {
    let toast = document.getElementById('city-editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'city-editor-toast';
      toast.style.cssText = `
        position: fixed;
        top: 86px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(11, 16, 33, 0.92);
        color: #00f0ff;
        border: 1px solid #00f0ff;
        padding: 10px 24px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 0.9rem;
        z-index: 3000;
        pointer-events: none;
        box-shadow: 0 0 20px rgba(0, 240, 255, 0.35);
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
    }, 3200);
  }

  updateControlDeviceBadge(newInterface) {
    if (!this.inputDeviceBadge || !this.inputDeviceIcon || !this.inputDeviceLabel) return;
    if (newInterface === 'GAMEPAD') {
      this.inputDeviceBadge.classList.add('gamepad-active');
      this.inputDeviceIcon.textContent = '🎮';
      this.inputDeviceLabel.textContent = 'XBOX CONTROLLER';
      this.inputDeviceBadge.title = 'Active Control Scheme: Xbox Gamepad Connected (RT/LT Throttle, LS Steer, RS Orbit)';
    } else {
      this.inputDeviceBadge.classList.remove('gamepad-active');
      this.inputDeviceIcon.textContent = '⌨️+🖱️';
      this.inputDeviceLabel.textContent = 'KEYBOARD';
      this.inputDeviceBadge.title = 'Active Control Scheme: Keyboard & Mouse Active';
    }
  }
}

