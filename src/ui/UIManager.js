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
    
    // Audio controls
    this.btnMute = document.getElementById('btn-mute');
    this.muteIcon = document.getElementById('mute-icon');
    this.muteLabel = document.getElementById('mute-label');
    this.volumeSlider = document.getElementById('volume-slider');
    
    // Fun Mode controls
    this.btnFunMode = document.getElementById('btn-fun-mode');
    this.funModeLabel = document.getElementById('fun-mode-label');
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
    this.timeSlider.addEventListener('input', (e) => {
      const timeVal = parseFloat(e.target.value);
      this.app.timeManager.setTime(timeVal);
      this.updateTimeDisplay(timeVal);
    });

    // Play/Pause Time
    this.btnTimePlay.addEventListener('click', () => {
      this.isTimePlaying = !this.isTimePlaying;
      this.app.timeManager.setPlaying(this.isTimePlaying);
      this.btnTimePlay.innerHTML = this.isTimePlaying ? '⏸️' : '▶️';
      this.btnTimePlay.title = this.isTimePlaying ? 'Pause Time' : 'Play Time';
    });

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
        this.weatherButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const weatherMode = btn.dataset.weather;
        this.app.environment.setWeather(weatherMode);
        if (this.app.physicsWorld) {
          this.app.physicsWorld.setWeatherFriction(weatherMode);
        }
      });
    });

    // Audio toggle
    if (this.btnMute) {
      this.btnMute.addEventListener('click', () => {
        if (this.app.audioSystem) {
          const enabled = this.app.audioSystem.toggleAudio();
          if (enabled) {
            this.btnMute.classList.add('active');
            this.muteIcon.textContent = '🔊';
            this.muteLabel.textContent = 'SFX Active';
            this.volumeSlider.disabled = false;
          } else {
            this.btnMute.classList.remove('active');
            this.muteIcon.textContent = '🔇';
            this.muteLabel.textContent = 'Enable SFX';
            this.volumeSlider.disabled = true;
          }
        }
      });

      this.volumeSlider.addEventListener('input', (e) => {
        if (this.app.audioSystem) {
          this.app.audioSystem.setVolume(parseFloat(e.target.value));
        }
      });
    }

    // Fun Mode toggle
    if (this.btnFunMode) {
      this.btnFunMode.addEventListener('click', () => {
        this.app.funMode = !this.app.funMode;
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
            this.btnMute.classList.add('active');
            this.muteIcon.textContent = '🔊';
            this.muteLabel.textContent = 'SFX Active';
            this.volumeSlider.disabled = false;
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

    // Inspector Close
    this.btnCloseInspector.addEventListener('click', () => {
      this.hideInspector();
    });

    // Follow Target button
    this.btnFollowTarget.addEventListener('click', () => {
      if (this.selectedEntity) {
        const isFollowing = this.app.sceneManager.toggleFollowTarget(this.selectedEntity);
        this.btnFollowTarget.innerHTML = isFollowing ? '❌ Stop Following' : '👁️ Follow Camera';
        this.btnFollowTarget.classList.toggle('active', isFollowing);

        if (!isFollowing && this.selectedEntity.type === 'VEHICLE' && this.selectedEntity.userControlled) {
          this.app.trafficSystem.releaseControl(this.selectedEntity);
          if (this.btnTakeControl) {
            this.btnTakeControl.innerHTML = '🏎️ Take Control (Physics)';
            this.btnTakeControl.classList.remove('active');
          }
        }
      }
    });

    // Take Control button (WASD / Arrows manual driving)
    if (this.btnTakeControl) {
      this.btnTakeControl.addEventListener('click', () => {
        if (this.selectedEntity && this.selectedEntity.type === 'VEHICLE') {
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
        }
      });
    }

    // Trigger SFX button
    this.btnInteractSfx.addEventListener('click', () => {
      if (this.selectedEntity) {
        if (this.selectedEntity.type === 'VEHICLE') {
          if (this.selectedEntity.isPolice) {
            this.app.audioSystem.playSiren(1.5);
          } else {
            this.app.audioSystem.playHonk();
          }
        }
      }
    });
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
    this.inspectorHud.classList.remove('hidden');
    this.inspectorType.textContent = entity.type || 'OBJECT';
    this.inspectorTitle.textContent = entity.name || 'Unknown Entity';
    
    // Clear and build info rows
    this.inspectorBody.innerHTML = '';
    
    if (entity.info) {
      for (const [key, value] of Object.entries(entity.info)) {
        const row = document.createElement('div');
        row.className = 'info-row';
        row.innerHTML = `<span class="info-label">${key}:</span> <span class="info-val accent">${value}</span>`;
        this.inspectorBody.appendChild(row);
      }
    }

    // Configure action buttons
    if (entity.type === 'VEHICLE' || entity.type === 'PEDESTRIAN') {
      this.btnFollowTarget.classList.remove('hidden');
      const isFollowing = (this.app.sceneManager.followTarget === entity);
      this.btnFollowTarget.innerHTML = isFollowing ? '❌ Stop Following' : '👁️ Follow Camera';
      this.btnFollowTarget.classList.toggle('active', isFollowing);
    } else {
      this.btnFollowTarget.classList.add('hidden');
    }

    if (entity.type === 'VEHICLE') {
      if (this.btnTakeControl) {
        this.btnTakeControl.classList.remove('hidden');
        const isControlled = (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle === entity && entity.userControlled);
        this.btnTakeControl.innerHTML = isControlled ? '🛑 Release Physics Drive' : '🏎️ Take Control (Physics)';
        this.btnTakeControl.classList.toggle('active', isControlled);
      }
      this.btnInteractSfx.classList.remove('hidden');
      this.btnInteractSfx.innerHTML = entity.isPolice ? '🚨 Sound Siren' : '📯 Sound Honk';
    } else {
      if (this.btnTakeControl) this.btnTakeControl.classList.add('hidden');
      this.btnInteractSfx.classList.add('hidden');
    }
  }

  hideInspector() {
    if (this.app && this.app.trafficSystem && this.app.trafficSystem.controlledVehicle) {
      this.app.trafficSystem.releaseControl(this.app.trafficSystem.controlledVehicle);
      if (this.btnTakeControl) {
        this.btnTakeControl.innerHTML = '🏎️ Take Control (Physics)';
        this.btnTakeControl.classList.remove('active');
      }
    }
    this.selectedEntity = null;
    this.inspectorHud.classList.add('hidden');
    this.app.sceneManager.stopFollowTarget();
  }

  updateInspectorLive() {
    if (!this.selectedEntity || !this.selectedEntity.info) return;
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
}
