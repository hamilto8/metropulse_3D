import * as THREE from 'three';
import { GAME_STATES } from '../core/GameManager.js';
import { AIRCRAFT_MODES } from '../entities/AircraftFlightModel.js';
import { PropellerAircraft } from '../entities/PropellerAircraft.js';
import { AIRFIELD_LAYOUT, createAirfield } from '../world/Airfield.js';
import { assessLandingSurface } from './AircraftLandingSurface.js';

const AIRSPACE_BOUNDS = Object.freeze({
  minX: -245,
  maxX: 860,
  minZ: -455,
  maxZ: 455
});
const AIRCRAFT_BOARDING_RADIUS = 5.5;

function isFinitePosition(position) {
  return Number.isFinite(position?.x)
    && Number.isFinite(position?.y)
    && Number.isFinite(position?.z);
}

function intersectsCollider(position, collider, padding = 1.4) {
  if (!isFinitePosition(position) || !collider?.position || !collider?.size) return false;
  const halfX = Number(collider.size.x || 0) * 0.5 + padding;
  const halfY = Number(collider.size.y || 0) * 0.5 + padding;
  const halfZ = Number(collider.size.z || 0) * 0.5 + padding;
  return Math.abs(position.x - collider.position.x) <= halfX
    && Math.abs(position.y - collider.position.y) <= halfY
    && Math.abs(position.z - collider.position.z) <= halfZ;
}

export class AircraftSystem {
  constructor(app) {
    this.app = app;
    this.layout = AIRFIELD_LAYOUT;
    this.controlledAircraft = null;
    this.crashRecoveryTimer = 0;
    this.boundaryNoticeCooldown = 0;
    this.controlSession = null;
    this.landingAssessment = null;

    this.airfield = createAirfield(this.layout);
    this.app.sceneManager.scene.add(this.airfield);

    this.aircraft = new PropellerAircraft({
      position: this.layout.aircraftStart,
      heading: this.layout.aircraftStart.heading
    });
    this.app.sceneManager.scene.add(this.aircraft.mesh);
    this.app.inspectorHud?.registerObject?.(this.aircraft.mesh, this.aircraft);
    this.registerAirfieldColliders();
  }

  registerAirfieldColliders() {
    const colliders = this.airfield.userData.staticColliders || [];
    if (!Array.isArray(this.app.cityBuilder.sceneryColliders)) {
      this.app.cityBuilder.sceneryColliders = [];
    }
    for (const collider of colliders) {
      this.app.cityBuilder.sceneryColliders.push(collider);
      this.app.physicsWorld?.addStaticBoxCollider?.(collider.position, collider.size);
    }
  }

  getInputControls() {
    const state = this.app.inputManager?.state || {};
    return {
      roll: state.flightRoll || 0,
      pitch: state.flightPitch || 0,
      throttleUp: state.flightThrottleUp || 0,
      throttleDown: state.flightThrottleDown || 0,
      brake: state.flightBrake || 0
    };
  }

  getBoardingEligibility(pedestrian) {
    const pedestrianPosition = pedestrian?.mesh?.position;
    const aircraftPosition = this.aircraft?.mesh?.position;
    if (!isFinitePosition(pedestrianPosition) || !isFinitePosition(aircraftPosition)) {
      return { allowed: false, reason: 'unavailable', distance: Infinity };
    }
    const distance = Math.hypot(
      pedestrianPosition.x - aircraftPosition.x,
      pedestrianPosition.z - aircraftPosition.z
    );
    if (distance > AIRCRAFT_BOARDING_RADIUS) return { allowed: false, reason: 'too-far', distance };
    if (pedestrian.knockedDown) return { allowed: false, reason: 'pedestrian-incapacitated', distance };
    if (this.aircraft.isCrashed) return { allowed: false, reason: 'aircraft-recovering', distance };
    if (this.aircraft.isAirborne || this.aircraft.state.speed > 2) {
      return { allowed: false, reason: 'aircraft-moving', distance };
    }
    return { allowed: true, reason: null, distance };
  }

  boardFromPedestrian(pedestrian) {
    const eligibility = this.getBoardingEligibility(pedestrian);
    if (!eligibility.allowed) {
      if (eligibility.reason !== 'too-far') {
        this.app.uiManager?.showToast?.('The aircraft must be safely stopped before boarding.');
      }
      return false;
    }
    return this.takeControl(this.aircraft, { source: 'pedestrian', pedestrian });
  }

  takeControl(aircraft = this.aircraft, options = {}) {
    if (aircraft !== this.aircraft) return false;
    if (aircraft.isCrashed) aircraft.resetToSpawn();
    if (this.controlledAircraft === aircraft) return true;

    if (!options.coordinated && this.app?.transitionCoordinator) {
      const result = this.app.transitionCoordinator.tryTransitionTo(GAME_STATES.STREET_VEHICLE, {
        reason: 'aircraft-control',
        source: 'AircraftSystem',
        target: aircraft,
        control: {
          action: 'ACQUIRE',
          kind: 'AIRCRAFT',
          entity: aircraft,
          source: options.source || 'camera',
          pedestrian: options.pedestrian || null
        }
      });
      return result.ok;
    }

    let source = options.source || 'camera';
    let pedestrian = options.pedestrian || null;
    const walkingPedestrian = this.app.pedestrianSystem?.controlledPedestrian || null;
    if (source === 'camera' && walkingPedestrian && this.getBoardingEligibility(walkingPedestrian).allowed) {
      source = 'pedestrian';
      pedestrian = walkingPedestrian;
    }
    if (source === 'pedestrian') {
      pedestrian ||= walkingPedestrian;
      if (!this.getBoardingEligibility(pedestrian).allowed) return false;
    }

    const vehicle = this.app.trafficSystem?.controlledVehicle;
    if (vehicle) this.app.trafficSystem.releaseControl(vehicle, { coordinated: true });
    if (source === 'pedestrian') {
      const suspended = this.app.pedestrianSystem?.suspendControlledPedestrian?.(pedestrian);
      if (!suspended) return false;
    } else if (walkingPedestrian) {
      this.app.pedestrianSystem.releaseControl(walkingPedestrian, { coordinated: true });
    }
    if (this.app.uiManager?.cityEditorUI?.isVisible) {
      this.app.uiManager.cityEditorUI.hide({ preserveMode: true });
    }

    this.controlledAircraft = aircraft;
    this.controlSession = Object.freeze({ source, pedestrian: source === 'pedestrian' ? pedestrian : null });
    aircraft.setControlled(true);
    this.app.audioSystem?.startAircraftSound?.();
    this.app.sceneManager?.startFollowTarget?.(aircraft);
    this.app.inputManager?.restoreGameplayFocus?.();
    this.app.uiManager?.hideInspector?.();
    this.app.uiManager?.updateActionHUD?.();
    const pilotLabel = source === 'pedestrian' ? `${pedestrian.name || 'Citizen'} boarded` : 'Pilot control engaged';
    this.app.uiManager?.addAlert?.(`🛩️ ${pilotLabel}. Northwind Sparrow cleared for runway 36.`, 'success');
    this.app.uiManager?.showToast?.('W/S throttle · A/D bank · ↑/↓ pitch · Space brake · E exit after landing');
    return true;
  }

  releaseControl({ force = false, coordinated = false } = {}) {
    const aircraft = this.controlledAircraft;
    if (!aircraft) return false;
    if (!force && (aircraft.isAirborne || aircraft.state.speed > 3)) {
      this.app.uiManager?.showToast?.('Land and stop the aircraft before leaving the cockpit.');
      return false;
    }

    if (!coordinated && this.app?.transitionCoordinator) {
      const destination = this.controlSession?.source === 'pedestrian'
        ? GAME_STATES.STREET_ON_FOOT
        : GAME_STATES.MANAGEMENT;
      const result = this.app.transitionCoordinator.tryTransitionTo(destination, {
        reason: destination === GAME_STATES.STREET_ON_FOOT
          ? 'aircraft-to-pedestrian'
          : 'aircraft-release',
        source: 'AircraftSystem',
        target: aircraft,
        control: {
          action: 'EXIT_AIRCRAFT',
          kind: destination === GAME_STATES.STREET_ON_FOOT ? 'PEDESTRIAN' : 'NONE',
          sourceAircraft: aircraft,
          force
        }
      });
      return result.ok;
    }

    if (force && aircraft.isAirborne) aircraft.resetToSpawn();
    const session = this.controlSession || { source: 'camera', pedestrian: null };
    aircraft.state.throttle = 0;
    aircraft.setControlled(false);
    this.controlledAircraft = null;
    this.controlSession = null;
    this.app.audioSystem?.stopAircraftSound?.();

    if (session.source === 'pedestrian' && session.pedestrian) {
      const resumed = this.resumePedestrianControl(session.pedestrian);
      if (resumed) {
        this.app.uiManager?.updateActionHUD?.();
        return true;
      }
    }

    this.app.sceneManager?.stopFollowTarget?.();
    this.app.uiManager?.updateActionHUD?.();
    return true;
  }

  toggleControl(aircraft = this.aircraft) {
    return this.controlledAircraft === aircraft
      ? this.releaseControl()
      : this.takeControl(aircraft);
  }

  getPedestrianExitPose() {
    const heading = this.aircraft.state.heading || 0;
    const position = this.aircraft.mesh.position.clone();
    const offset = new THREE.Vector3(-7.2, 0, -1.5).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      heading
    );
    position.add(offset);
    position.y = this.getGroundHeight(position);
    return { position, heading };
  }

  resumePedestrianControl(pedestrian) {
    const pedestrianSystem = this.app.pedestrianSystem;
    if (!pedestrianSystem || !pedestrian) return false;
    const exitPose = this.getPedestrianExitPose();
    if (!pedestrianSystem.restoreSuspendedPedestrian?.(pedestrian, exitPose.position, exitPose.heading)) {
      return false;
    }
    if (!pedestrianSystem.toggleUserControl(pedestrian, { coordinated: true })) return false;
    this.app.sceneManager?.startFollowTarget?.(pedestrian);
    this.app.uiManager?.hideInspector?.();
    this.app.uiManager?.addAlert?.(`🚶 ${pedestrian.name || 'Pilot'} exited the aircraft and resumed walk control.`, 'info');
    return true;
  }

  requestExit() {
    if (!this.controlledAircraft) return false;
    return this.releaseControl();
  }

  resetToRunway({ announce = true } = {}) {
    this.aircraft.resetToSpawn();
    this.crashRecoveryTimer = 0;
    this.landingAssessment = null;
    if (announce) this.app.uiManager?.showToast?.('↺ Aircraft returned to runway 36');
    this.app.sceneManager?.startFollowTarget?.(this.aircraft);
    this.app.uiManager?.updateActionHUD?.();
    return true;
  }

  getGroundHeight(position = this.aircraft.mesh.position) {
    return this.getLandingAssessment(position).groundHeight;
  }

  getLandingAssessment(position = this.aircraft.mesh.position, heading = this.aircraft.state.heading) {
    return assessLandingSurface({
      position: position || this.aircraft.mesh.position,
      heading,
      cityBuilder: this.app.cityBuilder,
      layout: this.layout
    });
  }

  getObstacleCollision() {
    const position = this.aircraft.mesh.position;
    const colliders = [
      ...(this.airfield.userData.staticColliders || []),
      ...(this.app.cityBuilder?.sceneryColliders || [])
    ];
    for (const collider of colliders) {
      if (intersectsCollider(position, collider)) return collider;
    }

    for (const building of this.app.buildingFactory?.buildings || []) {
      if (!building?.plot || building.isDestroyed) continue;
      const collider = {
        position: {
          x: building.plot.x,
          y: (building.plot.y || 0) + (building.height || 30) * 0.5,
          z: building.plot.z
        },
        size: {
          x: building.plot.width || 20,
          y: building.height || 30,
          z: building.plot.depth || 20
        },
        kind: 'building'
      };
      if (intersectsCollider(position, collider)) return collider;
    }
    return null;
  }

  enforceAirspaceBounds() {
    const state = this.aircraft.state;
    const position = state.position;
    let reflected = false;
    if (position.x < AIRSPACE_BOUNDS.minX || position.x > AIRSPACE_BOUNDS.maxX) {
      position.x = Math.max(AIRSPACE_BOUNDS.minX, Math.min(AIRSPACE_BOUNDS.maxX, position.x));
      state.heading = (Math.PI * 2 - state.heading) % (Math.PI * 2);
      reflected = true;
    }
    if (position.z < AIRSPACE_BOUNDS.minZ || position.z > AIRSPACE_BOUNDS.maxZ) {
      position.z = Math.max(AIRSPACE_BOUNDS.minZ, Math.min(AIRSPACE_BOUNDS.maxZ, position.z));
      state.heading = (Math.PI - state.heading + Math.PI * 2) % (Math.PI * 2);
      reflected = true;
    }
    if (reflected) {
      state.roll = 0;
      this.aircraft.syncRenderState();
      if (this.boundaryNoticeCooldown <= 0) {
        this.app.uiManager?.showToast?.('Metro airspace boundary — course corrected');
        this.boundaryNoticeCooldown = 5;
      }
    }
    return reflected;
  }

  triggerCrash(reason = 'impact') {
    if (this.aircraft.state.crashed && this.crashRecoveryTimer > 0) return false;
    this.aircraft.state.crashed = true;
    this.aircraft.state.mode = AIRCRAFT_MODES.CRASHED;
    this.aircraft.state.speed = 0;
    this.aircraft.state.verticalSpeed = 0;
    this.aircraft.syncRenderState();
    this.crashRecoveryTimer = 2.2;
    this.app.sceneManager?.triggerShake?.(0.65);
    this.app.audioSystem?.playExplosion?.(0.55);
    this.app.uiManager?.addAlert?.(`🚨 Aircraft ${reason}. Emergency runway recovery engaged.`, 'danger');
    this.app.uiManager?.showToast?.('Impact detected — recovering aircraft to runway');
    return true;
  }

  update(delta) {
    const safeDelta = Math.max(0, Math.min(0.1, Number(delta) || 0));
    this.boundaryNoticeCooldown = Math.max(0, this.boundaryNoticeCooldown - safeDelta);

    if (this.crashRecoveryTimer > 0) {
      this.app.audioSystem?.updateAircraftSound?.(this.aircraft.state, this.aircraft.config.maxSpeed);
      this.crashRecoveryTimer = Math.max(0, this.crashRecoveryTimer - safeDelta);
      if (this.crashRecoveryTimer === 0) this.resetToRunway({ announce: true });
      return;
    }

    const landingAssessment = assessLandingSurface({
      position: this.aircraft.mesh.position,
      heading: this.aircraft.state.heading,
      cityBuilder: this.app.cityBuilder,
      layout: this.layout
    });
    this.landingAssessment = landingAssessment;
    const groundHeight = landingAssessment.groundHeight;
    const inWater = landingAssessment.reason === 'water';
    const controls = this.controlledAircraft ? this.getInputControls() : {};
    const wasGrounded = this.aircraft.state.grounded;
    const state = this.aircraft.update(controls, safeDelta, {
      groundHeight,
      inWater,
      canLand: landingAssessment.allowed,
      landingSurface: landingAssessment.type
    });
    this.landingAssessment = this.getLandingAssessment(state.position, state.heading);
    if (this.controlledAircraft) {
      this.app.audioSystem?.updateAircraftSound?.(state, this.aircraft.config.maxSpeed);
    }
    if (!wasGrounded && state.grounded && !state.crashed) {
      this.app.audioSystem?.playBump?.();
      this.app.uiManager?.addAlert?.(`🛬 Safe touchdown on ${landingAssessment.label.toLowerCase()}.`, 'success');
      this.app.uiManager?.showToast?.(`Touchdown · ${landingAssessment.label} · Brake to stop`);
    }

    if (state.crashed) {
      const landingFailure = inWater
        ? 'ditched in water'
        : (!landingAssessment.allowed ? `attempted an unsafe landing on ${landingAssessment.label.toLowerCase()}` : 'made a hard landing');
      this.triggerCrash(landingFailure);
      return;
    }

    this.enforceAirspaceBounds();
    const collision = this.getObstacleCollision();
    if (collision) {
      this.triggerCrash(`collided with ${collision.kind || 'an obstacle'}`);
      return;
    }

    this.app.uiManager?.updateFlightHUD?.(this.controlledAircraft);
  }
}

export { AIRCRAFT_BOARDING_RADIUS, AIRSPACE_BOUNDS, intersectsCollider };
