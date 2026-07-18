import * as THREE from 'three';
import { GAME_STATES } from '../core/GameManager.js';
import missionsData from '../data/missions.json' with { type: 'json' };
import { validateMissionData } from '../data/MissionDataValidator.js';
import { INTERACTION_PRIORITIES } from './InteractionService.js';
import {
  MISSION_PHASES,
  MissionLifecycleController,
  MissionLifecycleError
} from '../missions/MissionLifecycleController.js';

// ─── Named Constants ────────────────────────────────────────────────────────
/** Radius at which driving/following a vehicle triggers a pickup dialogue (metres) */
const MISSION_TRIGGER_RADIUS = 16.0;
/** Radius from the dropoff position that counts as a completed delivery (metres) */
const MISSION_COMPLETE_RADIUS = 10.5;

export { validateMissionData } from '../data/MissionDataValidator.js';

/**
 * MissionSystem.js
 * Core mission logic engine for MetroPulse 3D Phase 3.
 * Manages interactive 3D pickup rings, destination holographic light beacons,
 * live timer countdowns, dynamic navigation arrows, and fare payouts.
 *
 * Three.js/DOM execution adapter for the renderer-free mission lifecycle.
 * MissionLifecycleController owns availability, phases, checkpoints, retry,
 * weather compatibility, cleanup commitment, results, and recovery.
 */
export class MissionSystem {
  constructor(app, dialogueOverlay, {
    missionId = null,
    missionIds = null,
    includeMayhem = true,
    missionDefinitions = missionsData
  } = {}) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.dialogueOverlay = dialogueOverlay;

    validateMissionData(missionDefinitions);
    const allowedIds = missionId
      ? new Set([missionId])
      : Array.isArray(missionIds)
        ? new Set(missionIds)
        : null;
    const selectedMissions = missionDefinitions.filter(mission => (
      (!allowedIds || allowedIds.has(mission.id))
      && (includeMayhem || !mission.requiresMayhem)
    ));
    if (selectedMissions.length === 0) {
      throw new RangeError(`Unknown deterministic mission fixture: ${missionId}`);
    }
    this.missions = selectedMissions;
    this.availableMissions = [...this.missions];
    this.lifecycle = new MissionLifecycleController({
      missions: this.missions,
      conditionService: app.cityConditionService,
      outcomeService: app.missionOutcomeService,
      weatherProvider: () => app.environment?.weatherMode || 'clear'
    });
    this.activeMission = null;
    this.timeRemaining = 0;
    this.payout = 0;
    this.basePayout = 0;
    this.initialTimeLimit = 0;
    this.activeVehicle = null;
    this.congestionSamples = 0;
    this.congestionTotal = 0;
    this.routePoints = [];
    this.routeIndex = 0;
    this.raceElapsed = 0;
    this.raceLeader = null;
    this.sabotageProgress = 0;
    this.sabotageActive = false;
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
    this.retryBtn = document.getElementById('btn-retry-mission');

    // Payout toast element (injected dynamically)
    this._toastEl = null;

    this.pendingMission = null;

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.cancelMission());
    }
    if (this.retryBtn) {
      this.retryBtn.addEventListener('click', () => this.retryMission());
    }

    this.initPickupBeacons();
  }

  get state() {
    return this.lifecycle.phase;
  }

  get narrativeState() {
    const progress = this.lifecycle.progressSnapshot();
    return {
      completedMissionIds: new Set(progress.completedMissionIds),
      dialogueChoices: progress.dialogueChoices,
      chronologyStep: progress.chronologyStep
    };
  }

  set narrativeState(value) {
    const current = this.lifecycle.progressSnapshot();
    this.lifecycle.restoreProgress({
      completedMissionIds: [...(value?.completedMissionIds || [])],
      dialogueChoices: value?.dialogueChoices || [],
      chronologyStep: value?.chronologyStep || 0,
      runCounts: current.runCounts
    });
  }

  get missionRunCounts() {
    return new Map(this.lifecycle.progressSnapshot().runCounts);
  }

  set missionRunCounts(value) {
    const current = this.lifecycle.progressSnapshot();
    this.lifecycle.restoreProgress({ ...current, runCounts: [...(value || new Map())] });
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
          Objective: mission.missionType || mission.objectiveType || 'DELIVERY',
          Destination: mission.dropoff?.district || 'Survive the Mayhem zone',
          Reward: `$${this.getBasePayout(mission).toLocaleString('en-US')}`,
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

  getBasePayout(mission, choiceNode = null) {
    const scale = Number.isFinite(mission?.rewardScale) ? mission.rewardScale : 100;
    const base = Number.isFinite(mission?.baseReward) ? mission.baseReward : 400;
    const bonus = Number.isFinite(choiceNode?.rushBonus) ? choiceNode.rushBonus : 0;
    return Math.round((base + bonus) * scale);
  }

  getControlledVehicle() {
    const vehicle = this.app?.trafficSystem?.controlledVehicle || null;
    return vehicle && vehicle.userControlled ? vehicle : null;
  }

  canUseMission(mission, { requireProximity = true, notify = false } = {}) {
    const vehicle = this.getControlledVehicle();
    let reason = '';
    if (!mission) reason = 'Mission data is unavailable.';
    else {
      const availability = this.lifecycle.evaluateAvailability(mission);
      if (!availability.available) reason = availability.reasons[0] || 'Mission is unavailable.';
    }
    if (!reason) {
      if (!vehicle) reason = 'Take direct control of a vehicle first.';
      else if (vehicle.vType !== mission.vehicleType) reason = `Requires a ${mission.vehicleType} vehicle.`;
      else if (requireProximity && vehicle.mesh.position.distanceTo(new THREE.Vector3(mission.pickup.x, vehicle.mesh.position.y, mission.pickup.z)) >= MISSION_TRIGGER_RADIUS) {
        reason = 'Drive into the mission pickup ring first.';
      }
    }

    if (reason && notify && this.app?.uiManager) this.app.uiManager.showToast(`⚠️ ${reason}`);
    return { allowed: !reason, vehicle, reason };
  }

  recordDialogueChoice(mission, nodeId, choice) {
    if (!mission || !choice) return;
    this.lifecycle.recordDialogueChoice(mission.id, nodeId, choice);
  }

  showMissionAvailablePrompt(mission) {
    if (this.state !== MISSION_PHASES.IDLE || this.activeMission) return;
    this.pendingMission = mission;
  }

  hideMissionAvailablePrompt() {
    this.pendingMission = null;
    // Remove the legacy second prompt if a restored/long-lived page created it
    // before InteractionPrompt became authoritative.
    const prompt = typeof document !== 'undefined'
      ? document.getElementById('mission-available-prompt')
      : null;
    if (prompt) {
      prompt.style.display = 'none';
      prompt.style.opacity = '0';
    }
  }

  openPendingMissionDetails() {
    if (!this.pendingMission) return false;
    return this.openMissionDetails(this.pendingMission);
  }

  openMissionDetails(mission) {
    if (!this.canUseMission(mission, { requireProximity: true, notify: true }).allowed) {
      this.hideMissionAvailablePrompt();
      return false;
    }
    this.hideMissionAvailablePrompt();
    return this.triggerMissionDialogue(mission);
  }

  getInteractionCandidates() {
    const candidates = [];
    const vehicle = this.getControlledVehicle();
    const objective = this.activeMission?.missionType || this.activeMission?.objectiveType;

    if (this.state === MISSION_PHASES.ACTIVE && objective === 'SABOTAGE') {
      const distance = vehicle?.mesh?.position?.distanceTo?.(this._dropoffPos) ?? Infinity;
      let failureReason = null;
      if (!vehicle) failureReason = 'Take direct control of the mission vehicle first.';
      else if (distance >= MISSION_COMPLETE_RADIUS) failureReason = 'Reach the sabotage target first.';
      else if (Math.abs(vehicle.speed || 0) > 1) failureReason = 'Stop the vehicle before deploying the jammer.';
      const actionLabel = this.activeMission.sabotageAction || 'Deploy the jammer';
      candidates.push({
        id: `mission-objective:${this.activeMission.id}`,
        kind: 'MISSION_OBJECTIVE',
        priority: INTERACTION_PRIORITIES.MISSION_OBJECTIVE,
        prompt: actionLabel,
        action: () => this.handleActionKey(),
        eligibility: { allowed: !failureReason, reason: failureReason },
        failureReason,
        distance,
        accessibilityLabel: `${actionLabel} for mission ${this.activeMission.title || this.activeMission.id}`,
        metadata: { missionId: this.activeMission.id, objective }
      });
      return candidates;
    }

    if (this.state !== MISSION_PHASES.IDLE || this.triggerCooldown > 0 || !vehicle) return candidates;
    for (const ring of this.pickupRings) {
      if (!ring.group.visible) continue;
      const distance = vehicle.mesh.position.distanceTo(ring.group.position);
      if (distance >= MISSION_TRIGGER_RADIUS) continue;
      const eligibility = this.canUseMission(ring.mission, {
        requireProximity: true,
        notify: false
      });
      const passenger = ring.mission.passengerName || ring.mission.title || 'mission contact';
      candidates.push({
        id: `mission-pickup:${ring.mission.id}`,
        kind: 'MISSION_PICKUP',
        priority: INTERACTION_PRIORITIES.MISSION_PICKUP,
        prompt: `view mission details for ${passenger}`,
        action: () => this.openMissionDetails(ring.mission),
        eligibility: { allowed: eligibility.allowed, reason: eligibility.reason || null },
        failureReason: eligibility.reason || null,
        distance,
        accessibilityLabel: `View mission details for ${passenger}`,
        metadata: { missionId: ring.mission.id }
      });
    }
    return candidates;
  }

  /**
   * Triggers the passenger dialogue overlay for a given mission.
   * Guards against re-triggering during cooldown or an active mission.
   * @param {object} mission - The mission data object from missions.json
   */
  triggerMissionDialogue(mission) {
    if (this.triggerCooldown > 0 || this.activeMission) return false;
    if (this.state === MISSION_PHASES.BRIEFING) return false;
    if (!this.canUseMission(mission, { requireProximity: true, notify: true }).allowed) return false;
    this.hideMissionAvailablePrompt();
    if (this.dialogueOverlay && !this.dialogueOverlay.currentMission) {
      try {
        this.lifecycle.prepare(mission.id);
        this.lifecycle.beginBriefing();
      } catch (error) {
        const message = error instanceof MissionLifecycleError ? error.message : 'Mission preparation failed.';
        this.app?.uiManager?.showToast?.(`⚠️ ${message}`);
        return false;
      }
      this.dialogueOverlay.showMissionDialogue(mission, this);
      return true;
    }
    return false;
  }

  /**
   * Starts the active mission after the player accepts a fare.
   * @param {object} mission - Mission data
   * @param {object} choiceNode - The accepted dialogue choice node (may contain rushBonus/timeLimitOverride)
   */
  startMission(mission, choiceNode) {
    const eligibility = this.canUseMission(mission, { requireProximity: true, notify: true });
    if (!eligibility.allowed || this.activeMission) {
      this.lifecycle.abandonBriefing();
      return false;
    }
    if (this.state === MISSION_PHASES.IDLE) {
      try {
        this.lifecycle.prepare(mission.id);
        this.lifecycle.beginBriefing();
      } catch (error) {
        this.app?.uiManager?.showToast?.(`⚠️ ${error.message}`);
        return false;
      }
    }
    this.activeMission = mission;
    this.activeVehicle = eligibility.vehicle;

    // Determine time limit and reward
    const baseTimeLimit = choiceNode?.timeLimitOverride || mission.timeLimit || 60;
    const timerLeniency = this.app?.settingsStore?.get?.('timerLeniency', 1) ?? 1;
    const baseReward = this.getBasePayout(mission, choiceNode);
    try {
      this.lifecycle.accept({
        choice: choiceNode ? {
          rushBonus: choiceNode.rushBonus || 0,
          timeLimitOverride: choiceNode.timeLimitOverride || null
        } : null,
        baseTimeLimit: baseTimeLimit * timerLeniency,
        baseReward
      });
    } catch (error) {
      this.activeMission = null;
      this.activeVehicle = null;
      this.lifecycle.abandonBriefing();
      this.app?.uiManager?.showToast?.(`⚠️ ${error.message}`);
      return false;
    }
    const run = this.lifecycle.snapshot().run;
    this.timeRemaining = run.initialTimeLimit;
    this.initialTimeLimit = this.timeRemaining;
    this.basePayout = run.baseReward;
    this.payout = this.basePayout;
    this.congestionSamples = 0;
    this.congestionTotal = 0;

    const objective = mission.missionType || mission.objectiveType || 'DELIVERY';
    this.routePoints = objective === 'RACE'
      ? [...mission.checkpoints, mission.dropoff]
      : (mission.dropoff ? [mission.dropoff] : []);
    this.routeIndex = 0;
    this.raceElapsed = 0;
    this.raceLeader = objective === 'RACE'
      ? mission.rivals.reduce((leader, rival) => !leader || rival.finishTime < leader.finishTime ? rival : leader, null)
      : null;
    this.sabotageProgress = 0;
    this.sabotageActive = false;
    if (this.routePoints[0]) this.setNavigationTarget(this.routePoints[0]);
    this.lifecycle.beginExecution();

    // Hide pickup ring for this mission
    const ringObj = this.pickupRings.find(r => r.mission.id === mission.id);
    if (ringObj) {
      ringObj.group.visible = false;
    }

    // Create soaring holographic destination beacon at dropoff coordinate
    if (objective !== 'SURVIVAL' && this.routePoints[0]) this.createDestinationBeacon(this.routePoints[0]);

    // Show HUD
    if (this.hudEl) {
      this.hudEl.classList.remove('hidden');
      if (this.hudTitleEl) {
        if (objective === 'SURVIVAL') this.hudTitleEl.textContent = `${mission.title}: survive the comet storm`;
        else if (objective === 'RACE') this.hudTitleEl.textContent = `${mission.title}: checkpoint 1/${this.routePoints.length}`;
        else if (objective === 'SABOTAGE') this.hudTitleEl.textContent = `${mission.title}: reach the target and disrupt it`;
        else this.hudTitleEl.textContent = `${mission.passengerName} → ${mission.dropoff?.district || 'Destination'}`;
      }
    }

    if (objective === 'SURVIVAL') {
      if (this.app.gameManager) this.app.gameManager.setMayhem(true, 'mission');
      if (this.app.uiManager?.setMayhem) this.app.uiManager.setMayhem(true, 'mission');
    }

    const transitionOwner = this.app.transitionCoordinator || this.app.gameManager;
    if (transitionOwner) {
      const transitionMethod = transitionOwner.transitionTo || transitionOwner.setState;
      transitionMethod?.call(transitionOwner, GAME_STATES.STREET_VEHICLE, {
        reason: 'mission',
        source: 'MissionSystem',
        target: this.activeVehicle
      });
    }

    if (this.app.audioSystem) {
      this.app.audioSystem.playHonk();
    }
    if (run.weather.disposition === 'ADAPTED') {
      this.app?.uiManager?.showToast?.(`🌦️ ${run.weather.reason}`);
    }
    return true;
  }

  setNavigationTarget(point) {
    if (!point) return;
    this._dropoffPos.set(point.x, 0, point.z);
  }

  getNavigationTarget() {
    return this.routePoints[this.routeIndex] || this.activeMission?.dropoff || null;
  }

  /** Starts the distinct sabotage interaction when the player is stopped on target. */
  handleActionKey() {
    const objective = this.activeMission?.missionType || this.activeMission?.objectiveType;
    if (this.state !== MISSION_PHASES.ACTIVE || objective !== 'SABOTAGE') return false;

    const vehicle = this.getControlledVehicle();
    const inRange = vehicle?.mesh?.position?.distanceTo?.(this._dropoffPos) < MISSION_COMPLETE_RADIUS;
    if (!vehicle || !inRange) {
      this.app?.uiManager?.showToast?.('⚠️ Reach the sabotage target first.');
      return true;
    }
    if (Math.abs(vehicle.speed || 0) > 1) {
      this.app?.uiManager?.showToast?.('⚠️ Stop the vehicle before deploying the jammer.');
      return true;
    }
    this.sabotageActive = true;
    this.sabotageProgress = 0;
    this.app?.uiManager?.showToast?.(`📡 ${this.activeMission.sabotageAction}… hold position.`);
    return true;
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
    amountEl.textContent = `+$${Number(amount).toLocaleString('en-US')}`;

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
    if (!this.activeMission || this.state !== MISSION_PHASES.ACTIVE) return false;

    const objective = this.activeMission.missionType || this.activeMission.objectiveType || 'DELIVERY';
    let satisfaction = 100;
    if (objective === 'TAXI') {
      const usedRatio = 1 - Math.max(0, this.timeRemaining) / Math.max(1, this.initialTimeLimit);
      const congestion = this.congestionSamples > 0 ? this.congestionTotal / this.congestionSamples : 0;
      satisfaction = Math.round(Math.max(25, Math.min(100, 100 - usedRatio * 42 - congestion * 35)));
      this.payout = Math.round(this.basePayout * (0.75 + satisfaction / 200));
    }

    const committed = this.commitMissionResult({
      outcome: 'SUCCESS',
      payout: this.payout,
      satisfaction,
      summary: objective === 'TAXI'
        ? `${this.activeMission.passengerName} arrived with ${satisfaction}% satisfaction.`
        : `${this.activeMission.title} completed successfully.`
    });
    if (!committed) return false;

    // Show payout toast (always visible, regardless of Fun Mode)
    this.showPayoutToast(this.payout, objective === 'TAXI' ? `${this.activeMission.passengerName} (${satisfaction}% satisfaction)` : this.activeMission.passengerName);

    // Play completion sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playSiren(1.2);
    }

    // Also update chyron in Fun Mode
    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = `*** 💰 MISSION COMPLETE: ${this.activeMission.title}! EARNED $${this.payout.toLocaleString('en-US')}! *** ` + newsEl.textContent;
    }

    this.presentMissionResult({ success: true, satisfaction });
    return true;
  }

  /** Called when the mission fails (e.g. timeout or released vehicle control). */
  failMission(reason = 'timeout') {
    if (!this.activeMission || this.state !== MISSION_PHASES.ACTIVE) return false;

    let toastMsg = 'Time ran out!';
    let tickerMsg = `*** ❌ FARE FAILED: Time ran out for ${this.activeMission.passengerName}! *** `;

    if (reason === 'released') {
      toastMsg = 'Released vehicle control!';
      tickerMsg = `*** ❌ FARE FAILED: Released vehicle control during fare for ${this.activeMission.passengerName}! *** `;
    } else if (reason === 'vehicle_lost') {
      toastMsg = 'Mission vehicle was lost or changed.';
      tickerMsg = `*** ❌ MISSION FAILED: Required ${this.activeMission.vehicleType} vehicle lost! *** `;
    } else if (reason === 'race_lost') {
      toastMsg = 'A rival crossed the finish line first.';
      tickerMsg = `*** 🏁 RACE LOST: ${this.activeMission.title} has a new corporate champion. *** `;
    } else if (reason === 'cancelled') {
      toastMsg = 'Mission cancelled. Recovery options are available.';
      tickerMsg = `*** ❌ MISSION CANCELLED: ${this.activeMission.title}. *** `;
    }

    const committed = this.commitMissionResult({
      outcome: 'FAILURE',
      reason,
      payout: 0,
      summary: toastMsg
    });
    if (!committed) return false;

    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = tickerMsg + newsEl.textContent;
    }

    // Play failed sound (honk twice detuned / sad)
    if (this.app.audioSystem) {
      this.app.audioSystem.playHonk(true);
    }

    this.showFailureToast(toastMsg, this.activeMission.passengerName);

    this.presentMissionResult({ success: false });
    return true;
  }

  commitMissionResult({ outcome, reason = null, payout = 0, satisfaction = null, summary }) {
    try {
      if (outcome === 'SUCCESS') {
        this.lifecycle.resolveSuccess({ payout, satisfaction, summary });
      } else {
        this.lifecycle.resolveFailure(reason || 'failed', { payout: 0, satisfaction, summary });
      }
      this.lifecycle.beginCleanup();
      const transaction = this.lifecycle.createOutcomeTransaction();
      const receipt = this.app?.missionOutcomeService?.apply
        ? this.app.missionOutcomeService.apply(transaction)
        : {
            transactionId: transaction.transactionId,
            source: transaction.source,
            summary: transaction.summary,
            effects: []
          };
      this.lifecycle.commitCleanup(receipt);
      this.app?.saveService?.scheduleSave?.('mission-progress');
      return true;
    } catch (error) {
      if (this.state === MISSION_PHASES.CLEANUP) this.lifecycle.recordCleanupFailure(error);
      this.app?.uiManager?.showToast?.('⚠️ Mission result could not be committed. Gameplay remains locked for safe recovery.');
      console.error('Mission cleanup transaction failed.', error);
      return false;
    }
  }

  presentMissionResult({ success, satisfaction = null, transition = true }) {
    if (this.destinationBeacon) {
      this.disposeBeacon(this.destinationBeacon);
      this.destinationBeacon = null;
    }
    // The P3.3 debrief owns committed result presentation. Keep the compact
    // mission HUD only as a compatibility fallback for isolated adapters that
    // do not compose the result screen.
    if (this.hudEl) this.hudEl.classList.toggle('hidden', Boolean(this.app?.resultScreen));
    if (this.hudTitleEl) {
      this.hudTitleEl.textContent = success
        ? `${this.activeMission.title} complete${satisfaction == null ? '' : ` · ${satisfaction}% satisfaction`}`
        : `${this.activeMission.title} failed`;
    }
    if (this.hudDistEl) this.hudDistEl.textContent = success ? 'RESULT COMMITTED' : 'RECOVERY READY';
    if (this.hudTimerEl) this.hudTimerEl.textContent = success ? '✓ COMPLETE' : '↻ FAILED';
    if (this.hudFareEl) this.hudFareEl.textContent = success ? `+$${this.payout.toLocaleString('en-US')}` : '$0';
    if (this.cancelBtn) {
      this.cancelBtn.textContent = 'Continue';
      this.cancelBtn.title = 'Continue to management';
      this.cancelBtn.setAttribute('aria-label', 'Acknowledge mission result and continue');
    }
    const retry = this.lifecycle.getRetryDecision();
    if (this.retryBtn) {
      this.retryBtn.classList.toggle('hidden', !retry.allowed);
      this.retryBtn.disabled = !retry.allowed;
      this.retryBtn.title = retry.reason;
    }
    if (transition) {
      const transitionResult = this.requestTransition(GAME_STATES.RESULT, {
        reason: 'mission-result-committed',
        source: 'MissionSystem'
      });
      if (!transitionResult.ok) {
        this.app?.uiManager?.showToast?.('⚠️ Result committed, but the result view could not open. Continue to recover safely.');
      }
    }
  }

  /** Called when the player manually cancels an active mission. */
  cancelMission() {
    if (!this.activeMission) return;
    if (this.state === MISSION_PHASES.RESULT) {
      return this.acknowledgeResult();
    }
    if (this.state === MISSION_PHASES.ACTIVE) return this.failMission('cancelled');
    return false;
  }

  retryMission() {
    if (this.state !== MISSION_PHASES.RESULT) return false;
    const decision = this.lifecycle.getRetryDecision();
    if (!decision.allowed) return false;
    const transitionResult = this.requestTransition(GAME_STATES.STREET_VEHICLE, {
      reason: 'mission-retry',
      source: 'MissionSystem',
      target: this.activeVehicle,
      control: this.activeVehicle ? {
        action: 'ACQUIRE',
        kind: 'VEHICLE',
        entity: this.activeVehicle,
        source: 'mission-retry'
      } : undefined
    });
    if (!transitionResult.ok) {
      this.app?.uiManager?.showToast?.(`⚠️ Retry could not begin: ${transitionResult.error?.message || 'vehicle control unavailable'}`);
      return false;
    }
    const recovery = this.lifecycle.beginRecovery({ retry: true });
    const checkpoint = recovery.decision.checkpoint?.payload || null;
    this.lifecycle.finishRecovery({ retry: true });
    this.restoreRetryExecution(checkpoint);
    this.lifecycle.beginExecution();
    this.showActiveMissionHud();
    if (this.retryBtn) this.retryBtn.classList.add('hidden');
    return true;
  }

  acknowledgeResult() {
    if (this.state !== MISSION_PHASES.RESULT) return false;
    const lifecycleBeforeRecovery = this.lifecycle.serialize();
    this.lifecycle.beginRecovery({ retry: false });
    this.lifecycle.finishRecovery({ retry: false });
    const transitionResult = this.requestTransition(GAME_STATES.MANAGEMENT, {
      reason: 'mission-result-acknowledged',
      source: 'MissionSystem'
    });
    if (!transitionResult.ok) {
      this.lifecycle.restore(lifecycleBeforeRecovery, { contentRegistry: this.app.contentRegistry });
      this.app?.uiManager?.showToast?.(`⚠️ Result recovery could not finish: ${transitionResult.error?.message || 'management unavailable'}`);
      return false;
    }
    this.clearMissionPresentation();
    return true;
  }

  requestTransition(destination, options) {
    const owner = this.app.transitionCoordinator || this.app.gameManager;
    if (!owner) return { ok: true, snapshot: null, error: null };
    if (typeof owner.tryTransitionTo === 'function') return owner.tryTransitionTo(destination, options);
    try {
      const transitionMethod = owner.transitionTo || owner.setState;
      const snapshot = transitionMethod?.call(owner, destination, options) ?? null;
      return { ok: true, snapshot, error: null };
    } catch (error) {
      console.warn(`Mission transition to ${destination} failed.`, error);
      return { ok: false, snapshot: null, error };
    }
  }

  restoreRetryExecution(checkpoint) {
    const run = this.lifecycle.snapshot().run;
    this.timeRemaining = checkpoint?.timeRemaining ?? run.initialTimeLimit;
    this.initialTimeLimit = run.initialTimeLimit;
    this.basePayout = run.baseReward;
    this.payout = checkpoint?.payout ?? run.baseReward;
    this.routeIndex = checkpoint?.routeIndex ?? 0;
    this.raceElapsed = checkpoint?.raceElapsed ?? 0;
    this.sabotageProgress = 0;
    this.sabotageActive = false;
    this.congestionSamples = checkpoint?.congestionSamples ?? 0;
    this.congestionTotal = checkpoint?.congestionTotal ?? 0;
    const target = this.routePoints[this.routeIndex];
    if (target) {
      this.setNavigationTarget(target);
      if ((this.activeMission.missionType || this.activeMission.objectiveType) !== 'SURVIVAL') this.createDestinationBeacon(target);
    }
  }

  showActiveMissionHud() {
    if (this.hudEl) this.hudEl.classList.remove('hidden');
    if (this.cancelBtn) {
      this.cancelBtn.textContent = '✕';
      this.cancelBtn.title = 'Cancel Mission';
      this.cancelBtn.setAttribute('aria-label', 'Cancel active mission');
    }
  }

  /** Resets all mission state, removes beacon, hides HUD, and starts cooldown timer. */
  clearActiveMission() {
    if (this.state === MISSION_PHASES.ACTIVE) return this.failMission('cancelled');
    if (this.state === MISSION_PHASES.RESULT) return this.acknowledgeResult();
    return false;
  }

  clearMissionPresentation() {
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
    this.activeVehicle = null;
    this.routePoints = [];
    this.routeIndex = 0;
    this.raceElapsed = 0;
    this.raceLeader = null;
    this.sabotageProgress = 0;
    this.sabotageActive = false;
    if (this.retryBtn) this.retryBtn.classList.add('hidden');
    if (this.cancelBtn) {
      this.cancelBtn.textContent = '✕';
      this.cancelBtn.title = 'Cancel Mission';
      this.cancelBtn.setAttribute('aria-label', 'Cancel active mission');
    }
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

    const activeVehicle = this.getControlledVehicle();
    const activeVType = activeVehicle ? activeVehicle.vType : null;

    if (this.state === MISSION_PHASES.CHECKPOINT) this.lifecycle.resumeFromCheckpoint();

    // 1. Dynamic visibility & rotation of pickup rings
    for (const r of this.pickupRings) {
      const missionOccupied = this.state !== MISSION_PHASES.IDLE;
      const available = this.lifecycle.evaluateAvailability(r.mission).available;
      if (missionOccupied) {
        r.group.visible = false;
      } else {
        // Show only matching vehicle types when driving, or show all when free-floating (no active vehicle)
        r.group.visible = available && (!activeVType || (r.mission.vehicleType === activeVType));
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
    //    Only a directly controlled player vehicle can trigger missions.
    if (this.state === MISSION_PHASES.IDLE && this.triggerCooldown <= 0 && activeVehicle) {
      let insideRing = null;
      for (const r of this.pickupRings) {
        if (!r.group.visible) continue;
        const distance = activeVehicle.mesh.position.distanceTo(r.group.position);
        if (distance >= MISSION_TRIGGER_RADIUS) continue;
        if (
          !insideRing
          || distance < insideRing.distance
          || (distance === insideRing.distance && r.mission.id < insideRing.mission.id)
        ) insideRing = { mission: r.mission, distance };
      }

      if (insideRing) {
        this.showMissionAvailablePrompt(insideRing.mission);
      } else {
        this.hideMissionAvailablePrompt();
      }
    } else {
      this.hideMissionAvailablePrompt();
    }

    if (this.state !== MISSION_PHASES.ACTIVE) return;

    if (!activeVehicle || !activeVehicle.mesh || activeVehicle !== this.activeVehicle || activeVehicle.vType !== this.activeMission?.vehicleType) {
      this.failMission('vehicle_lost');
      return;
    }

    const vPos = activeVehicle.mesh.position;

    const objective = this.activeMission.missionType || this.activeMission.objectiveType || 'DELIVERY';

    if (objective === 'RACE') {
      this.raceElapsed += delta;
      if (this.raceLeader && this.raceElapsed >= this.raceLeader.finishTime) {
        this.failMission('race_lost');
        return;
      }
    }

    const congestion = this.app.trafficSystem?.getCongestionMetrics?.().index ?? this.estimateCongestion();
    this.congestionTotal += congestion;
    this.congestionSamples += 1;

    // 4. ACTIVE MISSION: update countdown timer
    this.timeRemaining -= delta;
    if (this.timeRemaining <= 0) {
      if (objective === 'SURVIVAL') this.completeMission();
      else this.failMission();
      return;
    }

    if (objective === 'SURVIVAL') {
      if (this.hudDistEl) this.hudDistEl.textContent = 'SURVIVE';
      if (this.hudTimerEl) this.hudTimerEl.textContent = `☄️ ${Math.ceil(this.timeRemaining)}s`;
      if (this.hudFareEl) this.hudFareEl.textContent = `$${this.payout.toLocaleString('en-US')}`;
      if (this.hudArrowEl) this.hudArrowEl.style.transform = 'rotate(0rad)';
      return;
    }

    if (objective === 'SABOTAGE' && this.sabotageActive) {
      const dist = vPos.distanceTo(this._dropoffPos);
      if (dist >= MISSION_COMPLETE_RADIUS || Math.abs(activeVehicle.speed || 0) > 1) {
        this.sabotageActive = false;
        this.sabotageProgress = 0;
        const action = this.app?.inputManager?.getActionLabel?.('INTERACT') || 'E';
        this.app?.uiManager?.showToast?.(`⚠️ Signal lost. Stop on target and press ${action} to retry.`);
      } else {
        this.sabotageProgress += delta;
        const remaining = Math.max(0, this.activeMission.sabotageDuration - this.sabotageProgress);
        if (this.hudDistEl) this.hudDistEl.textContent = `JAMMING ${remaining.toFixed(1)}s`;
        if (this.hudTimerEl) this.hudTimerEl.textContent = `⏱️ ${Math.ceil(this.timeRemaining)}s`;
        if (this.sabotageProgress >= this.activeMission.sabotageDuration) this.completeMission();
        return;
      }
    }

    // 5. Check dropoff arrival using cached _dropoffPos
    const distToDropoff = vPos.distanceTo(this._dropoffPos);
    if (distToDropoff < MISSION_COMPLETE_RADIUS) {
      if (objective === 'RACE' && this.routeIndex < this.routePoints.length - 1) {
        this.routeIndex += 1;
        const nextTarget = this.routePoints[this.routeIndex];
        this.setNavigationTarget(nextTarget);
        this.createDestinationBeacon(nextTarget);
        if (this.hudTitleEl) this.hudTitleEl.textContent = `${this.activeMission.title}: checkpoint ${this.routeIndex + 1}/${this.routePoints.length}`;
        this.app?.uiManager?.showToast?.(`🏁 Checkpoint ${this.routeIndex}/${this.routePoints.length - 1} cleared`);
        this.recordExecutionCheckpoint(`route-${this.routeIndex}`);
      } else if (objective === 'SABOTAGE') {
        if (!this.lifecycle.snapshot().run.checkpoint) this.recordExecutionCheckpoint('sabotage-target');
        if (this.hudDistEl) {
          const action = this.app?.inputManager?.getActionLabel?.('INTERACT') || 'E';
          this.hudDistEl.textContent = `STOP · PRESS ${action.toUpperCase()}`;
        }
      } else {
        this.completeMission();
      }
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
      if (objective === 'RACE') {
        const rival = this.raceLeader;
        this.hudFareEl.textContent = rival ? `VS ${rival.name} · ${Math.max(0, rival.finishTime - this.raceElapsed).toFixed(1)}s` : `$${this.payout.toLocaleString('en-US')}`;
      } else {
        this.hudFareEl.textContent = `$${this.payout.toLocaleString('en-US')}`;
      }
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

  estimateCongestion() {
    const vehicles = this.app?.trafficSystem?.vehicles || [];
    if (vehicles.length === 0) return 0;
    const weighted = vehicles.reduce((sum, vehicle) => {
      if (vehicle.crashed || vehicle.onFire) return sum + 2;
      if (!vehicle.isParked && Math.abs(vehicle.speed || 0) < 1) return sum + 1;
      return sum;
    }, 0);
    return Math.max(0, Math.min(1, weighted / vehicles.length));
  }

  recordExecutionCheckpoint(checkpointId) {
    if (this.state !== MISSION_PHASES.ACTIVE) return false;
    this.lifecycle.recordCheckpoint(`${this.activeMission.id}:${checkpointId}`, {
      timeRemaining: Math.max(0, this.timeRemaining),
      payout: Math.max(0, this.payout),
      routeIndex: this.routeIndex,
      raceElapsed: Math.max(0, this.raceElapsed),
      congestionSamples: this.congestionSamples,
      congestionTotal: this.congestionTotal
    });
    this.app?.saveService?.scheduleSave?.('checkpoint', {
      checkpoint: `${this.activeMission.id}:${checkpointId}`
    });
    return true;
  }
}
