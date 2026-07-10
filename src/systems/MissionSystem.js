import * as THREE from 'three';
import missionsData from '../data/missions.json';

// ─── Named Constants ────────────────────────────────────────────────────────
/** Radius at which driving/following a vehicle triggers a pickup dialogue (metres) */
const MISSION_TRIGGER_RADIUS = 16.0;
/** Radius from the dropoff position that counts as a completed delivery (metres) */
const MISSION_COMPLETE_RADIUS = 10.5;

/**
 * MissionSystem.js
 * Core mission logic engine for MetroPulse 3D Phase 3.
 * Manages interactive 3D pickup rings, destination holographic light beacons,
 * live timer countdowns, dynamic navigation arrows, and fare payouts.
 *
 * State machine:
 *   IDLE → DIALOGUE_ACTIVE → IN_PROGRESS → COMPLETED | FAILED
 *   Any state → IDLE (via cancelMission or clearActiveMission)
 */
export class MissionSystem {
  constructor(app, dialogueOverlay) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.dialogueOverlay = dialogueOverlay;

    /** @type {'IDLE'|'DIALOGUE_ACTIVE'|'IN_PROGRESS'|'COMPLETED'|'FAILED'} */
    this.state = 'IDLE';

    this.missions = missionsData;
    this.availableMissions = [...this.missions];
    this.activeMission = null;
    this.timeRemaining = 0;
    this.payout = 0;

    /** Cached dropoff position Vector3 — set on startMission, avoids per-frame allocation */
    this._dropoffPos = new THREE.Vector3();

    /** Scratch Vector3 for per-frame arrow direction math — avoids allocation in hot path */
    this._toDropoff = new THREE.Vector3();

    /** Prevents instant dialogue re-triggering loop when player closes/declines dialogue */
    this.triggerCooldown = 0;

    // 3D Visual Objects
    this.pickupRings = [];
    this.destinationBeacon = null;

    // DOM HUD elements
    this.hudEl = document.getElementById('mission-hud');
    this.hudTitleEl = document.getElementById('mission-hud-title');
    this.hudDistEl = document.getElementById('mission-hud-dist');
    this.hudArrowEl = document.getElementById('mission-hud-arrow');
    this.hudTimerEl = document.getElementById('mission-hud-timer');
    this.hudFareEl = document.getElementById('mission-hud-fare');
    this.cancelBtn = document.getElementById('btn-cancel-mission');

    // Payout toast element (injected dynamically)
    this._toastEl = null;

    this.pendingMission = null;

    window.addEventListener('keydown', (e) => {
      if ((e.key === 'e' || e.key === 'E') && !e.repeat && this.pendingMission) {
        this.openPendingMissionDetails();
      }
    });

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.cancelMission());
    }

    this.initPickupBeacons();
  }

  /**
   * Spawns glowing cyan pickup rings on city streets for each available mission.
   * Each ring is individually created (separate geometry + material) so that
   * disposing one ring never corrupts the others.
   */
  initPickupBeacons() {
    for (const mission of this.availableMissions) {
      // Create unique geometry + material per ring to avoid shared-disposal bug
      const ringGeo = new THREE.TorusGeometry(4.2, 0.45, 12, 32);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00f0ff,
        emissiveIntensity: 1.2,
        roughness: 0.2,
        metalness: 0.8
      });

      const group = new THREE.Group();
      group.position.set(mission.pickup.x, 0.5, mission.pickup.z);

      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      group.add(ringMesh);

      // Floating light column indicator above ring
      const colGeo = new THREE.CylinderGeometry(0.6, 0.6, 12, 16);
      const colMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.35
      });
      const colMesh = new THREE.Mesh(colGeo, colMat);
      colMesh.position.y = 6;
      group.add(colMesh);

      this.scene.add(group);

      const pickupEntity = {
        type: 'MISSION_PICKUP',
        name: `Taxi Pickup: ${mission.passengerName}`,
        mission: mission,
        info: {
          Passenger: mission.passengerName,
          Role: mission.passengerRole,
          Destination: mission.dropoff.district,
          Reward: `$${mission.baseReward}`,
          Status: 'Click or Drive through ring to start!'
        }
      };

      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(ringMesh, pickupEntity);
        this.app.inspectorHud.registerObject(colMesh, pickupEntity);
      }

      this.pickupRings.push({ mission, group, ringMesh });
    }
  }

  showMissionAvailablePrompt(mission) {
    if (this.state !== 'IDLE' || this.activeMission) return;
    this.pendingMission = mission;

    let prompt = document.getElementById('mission-available-prompt');
    if (!prompt) {
      prompt = document.createElement('div');
      prompt.id = 'mission-available-prompt';
      prompt.style.position = 'fixed';
      prompt.style.bottom = '18%';
      prompt.style.left = '50%';
      prompt.style.transform = 'translateX(-50%)';
      prompt.style.padding = '14px 28px';
      prompt.style.borderRadius = '30px';
      prompt.style.background = 'rgba(7, 18, 38, 0.88)';
      prompt.style.backdropFilter = 'blur(14px)';
      prompt.style.border = '1px solid #00f0ff';
      prompt.style.color = '#fff';
      prompt.style.fontFamily = 'Outfit, Inter, sans-serif';
      prompt.style.fontSize = '1.05rem';
      prompt.style.fontWeight = 'bold';
      prompt.style.boxShadow = '0 0 20px rgba(0, 240, 255, 0.5)';
      prompt.style.zIndex = '1000';
      prompt.style.pointerEvents = 'none';
      prompt.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      document.body.appendChild(prompt);
    }

    prompt.innerHTML = `🌟 <span style="color: #00f0ff; font-weight: 800;">MISSION AVAILABLE!</span> Press <span style="color: #00f0ff; background: rgba(0,240,255,0.22); padding: 3px 10px; border-radius: 8px; border: 1px solid #00f0ff; margin: 0 4px;">[E]</span> for details (${mission.passengerName})`;
    prompt.style.display = 'block';
    prompt.style.opacity = '1';
  }

  hideMissionAvailablePrompt() {
    this.pendingMission = null;
    const prompt = document.getElementById('mission-available-prompt');
    if (prompt) {
      prompt.style.display = 'none';
      prompt.style.opacity = '0';
    }
  }

  openPendingMissionDetails() {
    if (!this.pendingMission) return false;
    const mission = this.pendingMission;
    this.hideMissionAvailablePrompt();
    this.triggerMissionDialogue(mission);
    return true;
  }

  /**
   * Triggers the passenger dialogue overlay for a given mission.
   * Guards against re-triggering during cooldown or an active mission.
   * @param {object} mission - The mission data object from missions.json
   */
  triggerMissionDialogue(mission) {
    if (this.triggerCooldown > 0 || this.activeMission) return;
    if (this.state === 'DIALOGUE_ACTIVE') return;
    this.hideMissionAvailablePrompt();
    if (this.dialogueOverlay && !this.dialogueOverlay.currentMission) {
      this.state = 'DIALOGUE_ACTIVE';
      this.dialogueOverlay.showMissionDialogue(mission, this);
    }
  }

  /**
   * Starts the active mission after the player accepts a fare.
   * @param {object} mission - Mission data
   * @param {object} choiceNode - The accepted dialogue choice node (may contain rushBonus/timeLimitOverride)
   */
  startMission(mission, choiceNode) {
    this.activeMission = mission;
    this.state = 'IN_PROGRESS';

    // Determine time limit and reward
    this.timeRemaining = choiceNode.timeLimitOverride || mission.timeLimit || 60;
    const rushBonus = choiceNode.rushBonus || 0;
    this.payout = (mission.baseReward || 400) + rushBonus;

    // Cache dropoff position to avoid per-frame Vector3 allocation
    this._dropoffPos.set(mission.dropoff.x, 0, mission.dropoff.z);

    // Hide pickup ring for this mission
    const ringObj = this.pickupRings.find(r => r.mission.id === mission.id);
    if (ringObj) {
      ringObj.group.visible = false;
    }

    // Create soaring holographic destination beacon at dropoff coordinate
    this.createDestinationBeacon(mission.dropoff);

    // Show HUD
    if (this.hudEl) {
      this.hudEl.classList.remove('hidden');
      if (this.hudTitleEl) {
        this.hudTitleEl.textContent = `${mission.passengerName} → ${mission.dropoff.district || 'Destination'}`;
      }
    }

    if (this.app.audioSystem) {
      this.app.audioSystem.playHonk();
    }
  }

  /**
   * Creates an 80-metre tall holographic green pillar at the dropoff location.
   * Disposes any previously existing beacon to prevent GPU memory leaks.
   * @param {{x: number, z: number, district: string}} dropoff
   */
  createDestinationBeacon(dropoff) {
    this.disposeBeacon(this.destinationBeacon);

    const group = new THREE.Group();
    group.position.set(dropoff.x, 0, dropoff.z);

    // 80-meter tall holographic pillar
    const pillarGeo = new THREE.CylinderGeometry(3.5, 3.5, 80, 24);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.45
    });
    const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
    pillarMesh.position.y = 40;
    group.add(pillarMesh);

    // Ground landing circle
    const circleGeo = new THREE.RingGeometry(3.6, 6.5, 32);
    circleGeo.rotateX(-Math.PI / 2);
    const circleMat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      side: THREE.DoubleSide
    });
    const circleMesh = new THREE.Mesh(circleGeo, circleMat);
    circleMesh.position.y = 0.3;
    group.add(circleMesh);

    this.scene.add(group);
    this.destinationBeacon = group;
  }

  /**
   * Recursively disposes all geometries and materials in a Three.js Group,
   * then removes it from the scene. Prevents GPU memory leaks.
   * @param {THREE.Group|null} group
   */
  disposeBeacon(group) {
    if (!group) return;
    this.scene.remove(group);
    group.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  /**
   * Shows a floating payout toast banner on screen for 3 seconds.
   * Provides visual feedback in normal (non-Fun-Mode) play.
   * @param {number} amount - Dollar amount earned
   * @param {string} name - Passenger name
   */
  showPayoutToast(amount, name) {
    // Remove any existing toast
    if (this._toastEl && this._toastEl.parentNode) {
      this._toastEl.parentNode.removeChild(this._toastEl);
    }

    // Build DOM nodes safely using textContent (not innerHTML) to avoid XSS
    const toast = document.createElement('div');
    toast.className = 'payout-toast';

    const check = document.createElement('span');
    check.className = 'payout-check';
    check.textContent = '\u2705'; // ✅

    const label = document.createElement('span');
    label.className = 'payout-label';
    label.textContent = 'Fare Complete!';

    const passenger = document.createElement('span');
    passenger.className = 'payout-passenger';
    passenger.textContent = `${name} delivered`;

    const amountEl = document.createElement('span');
    amountEl.className = 'payout-amount';
    amountEl.textContent = `+$${amount}`;

    toast.appendChild(check);
    toast.appendChild(label);
    toast.appendChild(passenger);
    toast.appendChild(amountEl);
    document.body.appendChild(toast);
    this._toastEl = toast;

    // Animate in on next paint
    requestAnimationFrame(() => toast.classList.add('payout-toast--visible'));

    // Auto-remove after 3.5 seconds
    setTimeout(() => {
      toast.classList.remove('payout-toast--visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 3500);
  }

  showFailureToast(reasonText, name) {
    // Remove any existing toast
    if (this._toastEl && this._toastEl.parentNode) {
      this._toastEl.parentNode.removeChild(this._toastEl);
    }

    // Build DOM nodes safely using textContent (not innerHTML) to avoid XSS
    const toast = document.createElement('div');
    toast.className = 'payout-toast payout-toast--failed';

    const check = document.createElement('span');
    check.className = 'payout-check';
    check.textContent = '❌';

    const label = document.createElement('span');
    label.className = 'payout-label payout-label--failed';
    label.textContent = 'Mission Failed';

    const passenger = document.createElement('span');
    passenger.className = 'payout-passenger';
    passenger.textContent = name ? `${name}'s ride cancelled.` : '';

    const reasonEl = document.createElement('span');
    reasonEl.className = 'payout-amount payout-amount--failed';
    reasonEl.textContent = reasonText;

    toast.appendChild(check);
    toast.appendChild(label);
    if (name) toast.appendChild(passenger);
    toast.appendChild(reasonEl);
    document.body.appendChild(toast);
    this._toastEl = toast;

    // Animate in on next paint
    requestAnimationFrame(() => toast.classList.add('payout-toast--visible'));

    // Auto-remove after 3.5 seconds
    setTimeout(() => {
      toast.classList.remove('payout-toast--visible');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, 3500);
  }

  /** Called when the player successfully delivers a passenger to the destination. */
  completeMission() {
    if (!this.activeMission) return;
    this.state = 'COMPLETED';

    // Award fare to city treasury
    if (this.app && this.app.cityBuilder) {
      this.app.cityBuilder.treasury = (this.app.cityBuilder.treasury || 0) + this.payout;
    }

    // Show payout toast (always visible, regardless of Fun Mode)
    this.showPayoutToast(this.payout, this.activeMission.passengerName);

    // Play completion sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playSiren(1.2);
    }

    // Also update chyron in Fun Mode
    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = `*** 🚖 FARE COMPLETED: Delivered ${this.activeMission.passengerName} to ${this.activeMission.dropoff.district}! EARNED $${this.payout}! *** ` + newsEl.textContent;
    }

    this.clearActiveMission();
  }

  /** Called when the mission fails (e.g. timeout or released vehicle control). */
  failMission(reason = 'timeout') {
    if (!this.activeMission) return;
    this.state = 'FAILED';

    let toastMsg = 'Time ran out!';
    let tickerMsg = `*** ❌ FARE FAILED: Time ran out for ${this.activeMission.passengerName}! *** `;

    if (reason === 'released') {
      toastMsg = 'Released vehicle control!';
      tickerMsg = `*** ❌ FARE FAILED: Released vehicle control during fare for ${this.activeMission.passengerName}! *** `;
    }

    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = tickerMsg + newsEl.textContent;
    }

    // Play failed sound (honk twice detuned / sad)
    if (this.app.audioSystem) {
      this.app.audioSystem.playHonk(true);
    }

    this.showFailureToast(toastMsg, this.activeMission.passengerName);

    this.clearActiveMission();
  }

  /** Called when the player manually cancels an active mission. */
  cancelMission() {
    if (!this.activeMission) return;
    this.clearActiveMission();
  }

  /** Resets all mission state, removes beacon, hides HUD, and starts cooldown timer. */
  clearActiveMission() {
    if (this.destinationBeacon) {
      this.disposeBeacon(this.destinationBeacon);
      this.destinationBeacon = null;
    }

    if (this.hudEl) {
      this.hudEl.classList.add('hidden');
    }

    // Re-show pickup ring for the completed/failed/cancelled mission
    if (this.activeMission) {
      const ringObj = this.pickupRings.find(r => r.mission.id === this.activeMission.id);
      if (ringObj) {
        ringObj.group.visible = true;
      }
    }

    // 4-second cooldown so player can drive away without instantly re-triggering
    this.triggerCooldown = 4.0;
    this.activeMission = null;
    this.state = 'IDLE';
  }

  /**
   * Main update loop — called once per animation frame.
   * Animates rings, checks proximity triggers, updates HUD, and handles timer.
   * @param {number} delta - Seconds since last frame
   */
  update(delta) {
    if (this.triggerCooldown > 0) {
      this.triggerCooldown -= delta;
    }

    const controlledVehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
    const followedVehicle = (this.app.sceneManager && this.app.sceneManager.followTarget && this.app.sceneManager.followTarget.type === 'VEHICLE')
      ? this.app.sceneManager.followTarget
      : null;
    const activeVehicle = controlledVehicle || followedVehicle;
    const activeVType = activeVehicle ? activeVehicle.vType : null;

    // 1. Dynamic visibility & rotation of pickup rings
    for (const r of this.pickupRings) {
      if (this.state === 'IN_PROGRESS') {
        r.group.visible = false;
      } else {
        // Show only matching vehicle types when driving, or show all when free-floating (no active vehicle)
        r.group.visible = !activeVType || (r.mission.vehicleType === activeVType);
      }

      if (r.group.visible) {
        r.ringMesh.rotation.z += 1.8 * delta;
      }
    }

    // 2. Animate destination beacon
    if (this.destinationBeacon) {
      this.destinationBeacon.rotation.y += 1.5 * delta;
    }

    // 3. If IDLE, check distance to pickup rings (MISSION_TRIGGER_RADIUS capture zone)
    //    Only triggered when the PLAYER has an active vehicle (controlled or followed).
    //    AI vehicles driving near rings must NOT auto-trigger dialogues for the player.
    if (this.state === 'IDLE' && this.triggerCooldown <= 0 && activeVehicle) {
      let insideRingMission = null;
      for (const r of this.pickupRings) {
        if (!r.group.visible) continue;
        if (activeVehicle.mesh.position.distanceTo(r.group.position) < MISSION_TRIGGER_RADIUS) {
          insideRingMission = r.mission;
          break;
        }
      }

      if (insideRingMission) {
        this.showMissionAvailablePrompt(insideRingMission);
      } else {
        this.hideMissionAvailablePrompt();
      }
    } else {
      this.hideMissionAvailablePrompt();
    }

    // No active mission or active vehicle — nothing more to update
    if (!activeVehicle || !activeVehicle.mesh) return;
    if (this.state !== 'IN_PROGRESS') return;

    const vPos = activeVehicle.mesh.position;

    // 4. ACTIVE MISSION: update countdown timer
    this.timeRemaining -= delta;
    if (this.timeRemaining <= 0) {
      this.failMission();
      return;
    }

    // 5. Check dropoff arrival using cached _dropoffPos
    const distToDropoff = vPos.distanceTo(this._dropoffPos);
    if (distToDropoff < MISSION_COMPLETE_RADIUS) {
      this.completeMission();
      return;
    }

    // 6. Update HUD elements
    if (this.hudDistEl) {
      this.hudDistEl.textContent = `${Math.round(distToDropoff)} m`;
    }
    if (this.hudTimerEl) {
      this.hudTimerEl.textContent = `⏱️ ${Math.ceil(this.timeRemaining)}s`;
    }
    if (this.hudFareEl) {
      this.hudFareEl.textContent = `$${this.payout}`;
    }

    // 7. Compute navigation compass arrow angle.
    //    Uses activeVehicle (not controlledVehicle) so it works when only following.
    //    Reuses pre-allocated _toDropoff scratch vector to avoid per-frame allocation.
    if (this.hudArrowEl) {
      this._toDropoff.copy(this._dropoffPos).sub(vPos).normalize();
      const angle = Math.atan2(this._toDropoff.x, this._toDropoff.z) - activeVehicle.mesh.rotation.y;
      this.hudArrowEl.style.transform = `rotate(${angle}rad)`;
    }
  }
}
