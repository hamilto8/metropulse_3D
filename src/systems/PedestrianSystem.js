import * as THREE from 'three';
import { captureAiHandoffPose, completeAiHandoff } from './AiControlHandoff.js';
import { Pedestrian } from '../entities/Pedestrian.js';
import { createPedestrianDescriptor } from '../entities/PedestrianArchetypes.js';
import { setTextSegments } from '../ui/dom.js';
import { createCafeSeating } from '../world/CafeSeating.js';
import {
  startPedestrianKnockdown,
  resetPedestrianKnockdown,
  updatePedestrianKnockdown
} from './PedestrianImpact.js';
import { movePedestrianWithCollisions } from './PedestrianCollision.js';
import {
  advanceTouristBehavior,
  beginAggression,
  createNpcBehaviorState,
  finishAggression,
  NPC_BEHAVIOR,
  selectAggressionTarget
} from './NpcBehavior.js';

/** Shared forward-axis vector — avoids per-frame allocation in 60-pedestrian movement loop */
const FORWARD_AXIS = Object.freeze(new THREE.Vector3(0, 0, 1));
const UP_AXIS = Object.freeze(new THREE.Vector3(0, 1, 0));

class SidewalkNode {
  constructor(id, x, z, y = 0.4) {
    this.id = id;
    this.pos = new THREE.Vector3(x, y, z);
    this.nextNodes = [];
  }
}

export class PedestrianSystem {
  constructor(app) {
    this.app = app;
    this.pedestrians = [];
    this.nodes = new Map();
    this.talkingPedestrian = null;
    this.talkingBubbleText = '';
    this.talkingBubbleTimer = 0;
    this.sidewalkCoordsX = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109, 201, 219, 251, 269, 301, 319, 441, 459, 541, 559, 641, 659, 741, 759];
    this.sidewalkCoordsZ = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109];
    this.targetPedestrianCount = 60;
    this.nextPedestrianSerial = 0;
    this.populationCheckTimer = 2.0;
    this.random = Math.random;
    this.nextCafeSeatIndex = 0;
    
    this.initWaypoints();
    this.cafeSeats = createCafeSeating(this.app.sceneManager?.scene, this.app.physicsWorld);
    this.spawnPedestrians(this.targetPedestrianCount);
    this.baseballBats = [];
    this.isWanted = false;
    this.escapeTimer = 0;
    this.crimeSequence = 0;
    this.activeCrimeIncidentId = null;
    this.hijackTransition = null;
    this.spawnBaseballBats();

    // Listen for attacks
    window.addEventListener('click', (e) => {
      if (e.target.closest('header, aside, footer, button, input') || e.target.classList.contains('action-btn')) {
        return;
      }
      if (this.controlledPedestrian && this.controlledPedestrian.hasBaseballBat) {
        this.swingBaseballBat();
      }
    });
  }

  initWaypoints() {
    const coordsX = this.sidewalkCoordsX;
    const coordsZ = this.sidewalkCoordsZ;

    // 1. Create a grid of sidewalk intersection and corner nodes
    for (const x of coordsX) {
      for (const z of coordsZ) {
        const y = (x < -60 && z < -60) ? 0.7 : 0.4; // Elevated inside park area
        this.nodes.set(`${x},${z}`, new SidewalkNode(`${x},${z}`, x, z, y));
      }
    }

    // 2. Connect orthogonal neighbors (sidewalk edges along blocks, crosswalks, and river bridge sidewalks)
    for (let i = 0; i < coordsX.length; i++) {
      for (let j = 0; j < coordsZ.length; j++) {
        const current = this.nodes.get(`${coordsX[i]},${coordsZ[j]}`);
        if (!current) continue;

        // Connect East neighbor (i + 1)
        if (i < coordsX.length - 1) {
          const eastX = coordsX[i + 1];
          // Do not allow crossing River 1 (109 to 201) or River 2 (319 to 441) except on the bridge sidewalks near Z = 0
          if (((coordsX[i] === 109 && eastX === 201) || (coordsX[i] === 319 && eastX === 441)) && Math.abs(coordsZ[j]) > 10) {
            continue;
          }
          const east = this.nodes.get(`${eastX},${coordsZ[j]}`);
          if (east) {
            current.nextNodes.push(east);
            east.nextNodes.push(current); // Bi-directional walking
          }
        }

        // Connect South neighbor (j + 1)
        if (j < coordsZ.length - 1) {
          const south = this.nodes.get(`${coordsX[i]},${coordsZ[j + 1]}`);
          if (south) {
            current.nextNodes.push(south);
            south.nextNodes.push(current); // Bi-directional walking
          }
        }
      }
    }

    // 3. Add Central Park internal walking paths (in the NW quadrant: x and z between -100 and -50)
    const parkNodes = [
      new SidewalkNode('park_center', -75, -75, 0.7),
      new SidewalkNode('park_n', -75, -91, 0.7),
      new SidewalkNode('park_s', -75, -59, 0.7),
      new SidewalkNode('park_w', -91, -75, 0.7),
      new SidewalkNode('park_e', -59, -75, 0.7)
    ];

    for (const pn of parkNodes) {
      this.nodes.set(pn.id, pn);
    }

    // Link park paths to sidewalk grid
    this.linkBiDir('park_center', 'park_n');
    this.linkBiDir('park_center', 'park_s');
    this.linkBiDir('park_center', 'park_w');
    this.linkBiDir('park_center', 'park_e');

    this.linkBiDir('park_n', '-75,-91'); if (!this.nodes.has('-75,-91')) {
      const n = new SidewalkNode('-75,-91', -75, -91, 0.7);
      this.nodes.set('-75,-91', n);
      this.linkBiDir('-75,-91', '-91,-91');
      this.linkBiDir('-75,-91', '-59,-91');
      this.linkBiDir('park_n', '-75,-91');
    }

    // Safety check: ensure NO dead-end sidewalk nodes exist
    for (const node of this.nodes.values()) {
      node.nextNodes = node.nextNodes.filter(Boolean);
      if (node.nextNodes.length === 0) {
        for (const other of this.nodes.values()) {
          if (other !== node) {
            node.nextNodes.push(other);
            break;
          }
        }
      }
    }
  }

  linkBiDir(id1, id2) {
    const n1 = this.nodes.get(id1);
    const n2 = this.nodes.get(id2);
    if (n1 && n2) {
      if (!n1.nextNodes.includes(n2)) n1.nextNodes.push(n2);
      if (!n2.nextNodes.includes(n1)) n2.nextNodes.push(n1);
    }
  }

  randomValue() {
    try {
      const value = Number(this.random?.());
      return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    } catch {
      return 0.5;
    }
  }

  spawnPedestrians(count) {
    const firstNames = ['Alex', 'Jordan', 'Elena', 'Marcus', 'Sophia', 'Liam', 'Chloe', 'David', 'Maya', 'Lucas', 'Zoe', 'Daniel'];
    const lastNames = ['V.', 'K.', 'M.', 'S.', 'R.', 'T.', 'L.', 'H.', 'W.', 'P.', 'B.', 'N.'];

    const allNodes = Array.from(this.nodes.values()).filter(n => n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const serial = this.nextPedestrianSerial++;
      const descriptor = createPedestrianDescriptor(serial, this.random);
      const fname = firstNames[Math.floor(this.randomValue() * firstNames.length)];
      const lname = lastNames[Math.floor(this.randomValue() * lastNames.length)];
      const name = `${fname} ${lname}`;

      const behaviorState = createNpcBehaviorState(descriptor.archetype, this.random);
      const ped = new Pedestrian(descriptor.archetype, descriptor.color, name, {
        ...descriptor,
        behaviorState
      });

      // Pick starting node
      if (descriptor.archetype === 'CAFE_READER' && this.cafeSeats.length > 0) {
        const seat = this.cafeSeats[this.nextCafeSeatIndex++ % this.cafeSeats.length];
        ped.cafeSeat = seat;
        ped.mesh.position.set(seat.x, seat.y, seat.z);
        ped.mesh.rotation.y = seat.rotation;
        ped.currentNode = null;
        ped.targetNode = null;
      } else {
        let startNode = allNodes[serial % allNodes.length];
        for (let offset = 0; offset < allNodes.length; offset++) {
          const candidate = allNodes[(serial + offset) % allNodes.length];
          const occupied = this.pedestrians.some(existing => existing.mesh.position.distanceTo(candidate.pos) < 1.2);
          if (!occupied) {
            startNode = candidate;
            break;
          }
        }
        ped.mesh.position.copy(startNode.pos);
        ped.currentNode = startNode;
        ped.targetNode = startNode.nextNodes[Math.floor(this.randomValue() * startNode.nextNodes.length)];

        if (ped.targetNode) ped.mesh.lookAt(ped.targetNode.pos);
      }

      this.app.sceneManager.scene.add(ped.mesh);
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(ped.mesh, ped);
      }
      this.pedestrians.push(ped);
    }
  }

  knockDownPedestrian(p, knockDir, impactSpeed = 8) {
    if (p?.archetype === 'CRIMINAL' && p.behaviorState?.target) {
      finishAggression(p, p.behaviorState, this.random);
    }
    if (!startPedestrianKnockdown(p, knockDir, impactSpeed)) return false;

    if (!p.normalActivity) p.normalActivity = p.info['Activity'];
    p.info['Activity'] = '💥 Knocked Down by Car!';
    p.info['Mood'] = 'Dazed on Ground';

    if (this.app && this.app.audioSystem) {
      this.app.audioSystem.playBump();
    }
    return true;
  }

  moveControlledPedestrian(pedestrian, distance) {
    if (!pedestrian?.mesh || !Number.isFinite(distance)) return false;
    const displacement = new THREE.Vector3(0, 0, distance).applyQuaternion(pedestrian.mesh.quaternion);
    displacement.y = 0;
    const movement = movePedestrianWithCollisions(
      pedestrian.mesh.position,
      displacement,
      this.app?.physicsWorld
    );
    pedestrian.mesh.position.x = movement.position.x;
    pedestrian.mesh.position.z = movement.position.z;
    return movement.collided;
  }

  updateNpcSpecialBehavior(pedestrian, delta, isRaining, index) {
    const state = pedestrian?.behaviorState;
    if (!state) return false;
    const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;

    if (pedestrian.archetype === 'CAFE_READER') {
      // A reader released somewhere else in the city must resume as a walking
      // NPC from that handoff point. Only readers still explicitly assigned to
      // the seated mode may be anchored to their authored café seat.
      if (state.mode !== 'SITTING_READING') return false;
      pedestrian.speed = 0;
      pedestrian.targetSpeed = 0;
      state.mode = 'SITTING_READING';
      pedestrian.info.Activity = '📖 Reading at Sidewalk Café';
      pedestrian.info.Mood = 'Quietly Absorbed';
      if (pedestrian.cafeSeat) {
        pedestrian.mesh.position.set(
          pedestrian.cafeSeat.x,
          pedestrian.cafeSeat.y,
          pedestrian.cafeSeat.z
        );
        pedestrian.mesh.rotation.y = pedestrian.cafeSeat.rotation;
      }
      if (this.app.performanceSystem?.shouldAnimate(pedestrian, index) ?? true) {
        pedestrian.update(safeDelta, isRaining);
      }
      return true;
    }

    if (pedestrian.archetype === 'TOURIST') {
      const mode = advanceTouristBehavior(state, safeDelta, this.random);
      if (mode === 'TAKING_PHOTO') {
        pedestrian.targetSpeed = 0;
        pedestrian.speed = Math.max(0, pedestrian.speed - 12 * safeDelta);
        pedestrian.info.Activity = '📸 Photographing the Skyline';
        pedestrian.info.Mood = 'Delighted';
        if (this.app.performanceSystem?.shouldAnimate(pedestrian, index) ?? true) {
          pedestrian.update(safeDelta, isRaining);
        }
        return true;
      }
      pedestrian.info.Activity = '🗺️ Exploring Landmarks';
      pedestrian.info.Mood = 'Curious';
      return false;
    }

    if (pedestrian.archetype !== 'CRIMINAL') return false;
    return this.updateCriminalBehavior(pedestrian, state, safeDelta, isRaining, index);
  }

  updateCriminalBehavior(criminal, state, delta, isRaining, index) {
    if (state.mode === 'LOITERING') {
      state.timer = Math.max(0, (Number.isFinite(state.timer) ? state.timer : 0) - delta);
      criminal.info.Activity = '👀 Loitering Suspiciously';
      criminal.info.Mood = 'Hostile';
      if (state.timer <= 0) {
        const target = selectAggressionTarget(
          criminal,
          this.pedestrians,
          this.controlledPedestrian,
          NPC_BEHAVIOR
        );
        if (target && beginAggression(criminal, state, target)) {
          criminal.info.Activity = `🥊 Picking a Fight with ${target.name || 'Citizen'}`;
          target.info && (target.info.Mood = 'Alarmed');
          if (target === this.controlledPedestrian) {
            this.app.uiManager?.addAlert?.(`⚠️ ${criminal.name} is coming after you!`, 'warn');
          }
        } else {
          state.timer = 3;
        }
      }
      return false;
    }

    if (state.mode !== 'CHASING') return false;
    const target = state.target;
    state.chaseElapsed += delta;
    state.attackCooldown = Math.max(0, state.attackCooldown - delta);
    const distance = target?.mesh?.position
      ? criminal.mesh.position.distanceTo(target.mesh.position)
      : Infinity;
    if (
      !target?.mesh
      || !this.pedestrians.includes(target)
      || target.knockedDown
      || target.isHijacking
      || distance > NPC_BEHAVIOR.aggressionRadius * 1.75
      || state.chaseElapsed >= NPC_BEHAVIOR.chaseDuration
    ) {
      finishAggression(criminal, state, this.random);
      criminal.info.Activity = '👀 Loitering Suspiciously';
      return false;
    }

    criminal.info.Activity = `🥊 Confronting ${target.name || 'Citizen'}`;
    criminal.info.Mood = 'Aggressive';
    const direction = target.mesh.position.clone().sub(criminal.mesh.position);
    direction.y = 0;
    if (direction.lengthSq() > 1e-6) {
      direction.normalize();
      criminal.mesh.rotation.y = Math.atan2(direction.x, direction.z);
    }

    if (distance <= NPC_BEHAVIOR.attackRange && state.attackCooldown <= 0) {
      state.attackCooldown = NPC_BEHAVIOR.attackCooldown;
      criminal.attackTimer = 0.35;
      const landed = this.knockDownPedestrian(target, direction, 7);
      if (landed && target === this.controlledPedestrian) {
        this.app.uiManager?.addAlert?.(`💥 ${criminal.name} knocked you down!`, 'danger');
      }
      finishAggression(criminal, state, this.random);
      criminal.info.Activity = '🚶 Leaving the Scene';
      criminal.info.Mood = 'Defiant';
      criminal.update(delta, isRaining);
      return true;
    }

    criminal.targetSpeed = criminal.normalMaxSpeed * 1.35;
    criminal.speed = Math.min(criminal.targetSpeed, criminal.speed + 12 * delta);
    const displacement = new THREE.Vector3(0, 0, criminal.speed * delta).applyQuaternion(criminal.mesh.quaternion);
    displacement.y = 0;
    const movement = movePedestrianWithCollisions(
      criminal.mesh.position,
      displacement,
      this.app.physicsWorld
    );
    criminal.mesh.position.x = movement.position.x;
    criminal.mesh.position.z = movement.position.z;
    criminal.mesh.position.y = this.getTerrainHeight(criminal.mesh.position.x, criminal.mesh.position.z);
    if (this.app.performanceSystem?.shouldAnimate(criminal, index) ?? true) {
      criminal.update(delta, isRaining);
    }
    return true;
  }

  reportCrime(position, reason = 'Criminal activity reported', showAlert = true) {
    const newlyWanted = !this.isWanted;
    this.isWanted = true;
    this.escapeTimer = 0;

    if (this.app.trafficSystem && position) {
      this.app.trafficSystem.dispatchPolice(position.clone ? position.clone() : new THREE.Vector3(position.x, position.y || 0, position.z));
    }
    if (newlyWanted && showAlert && this.app.uiManager && this.app.uiManager.addAlert) {
      this.app.uiManager.addAlert(`🚨 POLICE DISPATCHED: ${reason}`, 'danger');
    }
    if (newlyWanted && this.app.economySystem?.recordIncident) {
      const incidentId = `player-crime-${++this.crimeSequence}`;
      const incidentPosition = Number.isFinite(position?.x) && Number.isFinite(position?.z)
        ? { x: position.x, z: position.z }
        : null;
      this.app.economySystem.recordIncident({
        id: incidentId,
        type: 'CRIME',
        severity: 2,
        reputationDelta: -1,
        happinessModifier: -2,
        landValueModifier: -1,
        ...(incidentPosition ? {
          position: incidentPosition,
          influenceRadius: 40
        } : {})
      });
      this.activeCrimeIncidentId = incidentId;
    }
  }

  resolveCrimeIncident() {
    if (!this.activeCrimeIncidentId) return;
    this.app.economySystem?.resolveIncident?.(this.activeCrimeIncidentId);
    this.activeCrimeIncidentId = null;
  }

  clearPoliceResponse() {
    if (!this.app.trafficSystem || !this.app.trafficSystem.vehicles) return;
    for (const vehicle of this.app.trafficSystem.vehicles) {
      if (!vehicle.isPolice || vehicle.userControlled || vehicle.pursuitTarget) continue;
      vehicle.emergencyTarget = null;
      vehicle.maxSpeed = vehicle.normalMaxSpeed || 20;
      vehicle.targetSpeed = vehicle.maxSpeed;
      vehicle.sirenActive = false;
      vehicle.sirenTimer = 0;
    }
  }

  ensurePopulationFloor() {
    const suspendedAircraftPilot = this.app.aircraftSystem?.controlSession?.source === 'pedestrian'
      ? 1
      : 0;
    const representedPopulation = this.pedestrians.length + suspendedAircraftPilot;
    if (representedPopulation < this.targetPedestrianCount) {
      this.spawnPedestrians(this.targetPedestrianCount - representedPopulation);
    }
  }

  update(delta) {
    const weather = this.app.environment ? this.app.environment.weatherMode : 'clear';
    const isRaining = (weather === 'rain' || weather === 'thunderstorm');

    this.updateHijackTransition(delta);

    this.populationCheckTimer -= delta;
    if (this.populationCheckTimer <= 0) {
      this.populationCheckTimer = 2.0;
      this.ensurePopulationFloor();
    }

    // Update baseball bat pick-ups
    const p = this.controlledPedestrian;
    if (p && !p.hasBaseballBat && this.baseballBats) {
      for (const bat of this.baseballBats) {
        if (bat.pickedUp) continue;
        const dist = p.mesh.position.distanceTo(bat.pos);
        if (dist < 2.0) {
          bat.pickedUp = true;
          this.app.sceneManager.scene.remove(bat.mesh);
          p.hasBaseballBat = true;
          p.attachBaseballBat();

          // Show pickup notice via the proximity prompt element
          const prompt = document.getElementById('vehicle-enter-prompt');
          if (prompt) {
            prompt.innerHTML = '🏏 <span style="color: #00ff88; font-weight:700;">BASEBALL BAT EQUIPPED!</span> Left-Click to swing!';
            prompt.classList.remove('hidden');
            setTimeout(() => { prompt.classList.add('hidden'); }, 3000);
          }
          if (this.app.audioSystem) {
            this.app.audioSystem.playUIClick();
          }
          break;
        }
      }
    }

    // Animate active (uncollected) baseball bats
    if (this.baseballBats) {
      for (const bat of this.baseballBats) {
        if (bat.pickedUp) continue;
        bat.pulseTime += delta * 4.0;
        const scale = 1.0 + Math.sin(bat.pulseTime) * 0.18;
        bat.halo.scale.set(scale, scale, 1.0);
        bat.mesh.rotation.y += 1.5 * delta;
      }
    }

    // Handle wanted level/police pursuit and arrest check across both street
    // and vehicle control. Wanted state belongs to the player, not whichever
    // entity happens to be controlled at this instant.
    const controlledVehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
    const wantedTarget = p || controlledVehicle;
    if (this.isWanted && wantedTarget && wantedTarget.mesh) {
      const playerPos = wantedTarget.mesh.position;
      
      // Update police targets to track the player
      if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
        const policeVehicles = this.app.trafficSystem.vehicles.filter(v => (
          v.isPolice
          && !v.crashed
          && v !== controlledVehicle
          && !v.userControlled
          && !v.pursuitTarget
        ));
        let minPoliceDist = Infinity;

        for (const pv of policeVehicles) {
          pv.emergencyTarget = playerPos.clone();
          pv.maxSpeed = 42;
          pv.targetSpeed = 42;
          pv.sirenTimer = 5.0; // Keep siren blaring!
          pv.sirenActive = true;
          
          const distToPlayer = pv.mesh.position.distanceTo(playerPos);
          if (distToPlayer < minPoliceDist) {
            minPoliceDist = distToPlayer;
          }
        }

        const arrestDistance = controlledVehicle ? 4.5 : 3.0;
        if (minPoliceDist < arrestDistance) {
          this.arrestPlayer();
        } else {
          // If the player is far away from all police cruisers (> 35 meters), let them escape over time
          if (minPoliceDist > 35.0) {
            this.escapeTimer += delta;
            if (this.escapeTimer >= 8.0) {
              // Successfully escaped!
              this.isWanted = false;
              this.escapeTimer = 0;
              this.resolveCrimeIncident();
              
              this.clearPoliceResponse();
              
              // Show notification on prompt
              const prompt = document.getElementById('vehicle-enter-prompt');
              if (prompt) {
                prompt.innerHTML = '🚨 <span style="color:#00ff88; font-weight:700;">LOST THE COPS!</span> Wanted level cleared.';
                prompt.classList.remove('hidden');
                setTimeout(() => { prompt.classList.add('hidden'); }, 3000);
              }
            }
          } else {
            // Cops are nearby (between 3.0m and 35.0m), reset escape timer
            this.escapeTimer = 0;
          }
        }
      }
    } else if (!this.isWanted) {
      this.escapeTimer = 0;
    }

    // Always update wanted HUD
    this.updateWantedHud();

    // Update active speech bubble if any
    if (this.talkingBubbleTimer > 0) {
      this.talkingBubbleTimer -= delta;
      this.updateSpeechBubblePosition();
      if (this.talkingBubbleTimer <= 0) {
        this.talkingPedestrian = null;
        const bubble = document.getElementById('pedestrian-speech-bubble');
        if (bubble) bubble.classList.add('hidden');
      }
    }

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];
      const pos = p.mesh.position;

      if (this.app && this.app.cityBuilder && this.app.cityBuilder.isInWater(pos)) {
        if (this.app.audioSystem && this.app.audioSystem.playSplash) {
          this.app.audioSystem.playSplash();
        }
        if (p.userControlled || (this.app.sceneManager && this.app.sceneManager.followTarget === p)) {
          if (this.app.sceneManager) {
            this.app.sceneManager.breakToFreeOrbit();
          }
        }
        this.cullPedestrian(p);
        continue;
      }

      // 0. Check knockdown recovery
      if (p.knockedDown) {
        const remainsDown = updatePedestrianKnockdown(
          p,
          delta,
          (x, z) => this.getTerrainHeight(x, z)
        );
        if (!remainsDown) {
          if (p.normalActivity) p.info['Activity'] = p.normalActivity;
          p.info['Mood'] = 'Recovered & Walking';
        } else {
          continue;
        }
      }

      // 1. Check collisions and avoidance with nearby vehicles
      let isBlocked = false;
      if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
        const nearbyVehicles = this.app.performanceSystem?.nearbyVehicles(pos, 4.5) || this.app.trafficSystem.vehicles;
        for (const v of nearbyVehicles) {
          const dist = pos.distanceTo(v.mesh.position);
          const hitDist = (v.vType === 'BUS' || v.vType === 'TRUCK') ? 3.8 : 2.6;

          if (dist < hitDist && v.speed > 2.0) {
            // HIT BY A CAR!
            const pushDir = pos.clone().sub(v.mesh.position).normalize();
            const wasKnockedDown = this.knockDownPedestrian(p, pushDir, v.speed);
            if (wasKnockedDown) {
              if (v.userControlled) {
                this.reportCrime(v.mesh.position, 'Hit-and-run reported');
              } else {
                this.app.trafficSystem.handleNpcPedestrianHit?.(v, p);
              }
            }
            break;
          } else if (dist < 4.5 && v.speed > 1.0) {
            isBlocked = true;
          }
        }
      }

      if (p.knockedDown) continue;

      if (p.userControlled) {
        if (p.isHijacking) {
          p.speed = 0;
          continue;
        }
        if (this.app.cityBuilder && this.app.cityBuilder.isInWater(p.mesh.position)) {
          if (this.app.audioSystem && this.app.audioSystem.playSplash) {
            this.app.audioSystem.playSplash();
          }
          this.releaseControl(p);
          if (this.app.sceneManager) {
            this.app.sceneManager.breakToFreeOrbit();
          }
          continue;
        }

        const ts = this.app.trafficSystem;
        const keys = ts ? ts.keys : null;
        const inputManager = this.app.inputManager;
        const usingGamepad = inputManager?.activeInterface === 'GAMEPAD';

        if (usingGamepad) {
          const moveX = inputManager.state.moveX || 0;
          const moveY = inputManager.state.moveY || 0;
          if (Math.abs(moveX) > 0.05) p.mesh.rotation.y -= moveX * 3.2 * delta;
          p.targetSpeed = Math.abs(moveY) > 0.05
            ? p.maxSpeed * moveY
            : 0;
        } else if (keys) {
          const isW = keys['w'] || keys['arrowup'];
          const isS = keys['s'] || keys['arrowdown'];
          const isA = keys['a'] || keys['arrowleft'];
          const isD = keys['d'] || keys['arrowright'];
          const isShift = keys['shift'];

          // Rotate pedestrian
          if (isA) p.mesh.rotation.y += 3.2 * delta;
          if (isD) p.mesh.rotation.y -= 3.2 * delta;

          // Determine target speed based on keys (Shift triples maxSpeed)
          let moveSpeed = 0;
          const currentMaxSpeed = isShift ? p.maxSpeed * 3.0 : p.maxSpeed;
          if (isW) moveSpeed = currentMaxSpeed;
          if (isS) moveSpeed = -currentMaxSpeed * 0.6; // Backwards movement is slower
          
          p.targetSpeed = moveSpeed;
        }

        // Interpolate speed
        if (p.speed < p.targetSpeed) {
          p.speed = Math.min(p.targetSpeed, p.speed + 16 * delta);
        } else if (p.speed > p.targetSpeed) {
          p.speed = Math.max(p.targetSpeed, p.speed - 16 * delta);
        }

        // Swept circle movement prevents keyboard and controller traversal
        // from tunneling through active static building/scenery colliders.
        const moveStep = Math.abs(p.speed) > 0.05 ? p.speed * delta : 0;
        this.moveControlledPedestrian(p, moveStep);

        // Jump physics update
        const terrainHeight = this.getTerrainHeight(pos.x, pos.z);
        if (p.isJumping) {
          p.jumpVelocity = (p.jumpVelocity || 0) - 28.0 * delta; // Gravity acceleration
          p.mesh.position.y += p.jumpVelocity * delta;
          if (p.mesh.position.y <= terrainHeight) {
            p.mesh.position.y = terrainHeight;
            p.jumpVelocity = 0;
            p.isJumping = false;
          }
        } else {
          p.mesh.position.y = terrainHeight;
        }

        // Update leg/arm swing animations
        p.update(delta, isRaining);
        continue;
      }

      if (this.updateNpcSpecialBehavior(p, delta, isRaining, i)) continue;

      if (isBlocked) {
        p.targetSpeed = 0;
      } else {
        const isFunMode = this.app && this.app.funMode;
        p.targetSpeed = isFunMode ? p.maxSpeed * 3.0 : p.maxSpeed;
      }

      if (p.speed < p.targetSpeed) {
        p.speed = Math.min(p.targetSpeed, p.speed + 12 * delta);
      } else if (p.speed > p.targetSpeed) {
        p.speed = Math.max(p.targetSpeed, p.speed - 14 * delta);
      }

      // 2. Move along sidewalk graph towards target node
      if (p.targetNode) {
        const dist = Math.hypot(pos.x - p.targetNode.pos.x, pos.z - p.targetNode.pos.z);
        if (dist < 1.8) {
          // Reached node! Pick next connected node along sidewalk (prefer not turning immediately back if possible)
          const prevNode = p.currentNode;
          p.currentNode = p.targetNode;
          
          let candidates = p.currentNode.nextNodes.filter(n => n !== prevNode);
          if (candidates.length === 0) candidates = p.currentNode.nextNodes;
          
          if (candidates.length > 0) {
            p.targetNode = candidates[Math.floor(this.randomValue() * candidates.length)];
          }
        }

        if (p.targetNode) {
          const dx = p.targetNode.pos.x - pos.x;
          const dz = p.targetNode.pos.z - pos.z;
          const targetAngle = Math.atan2(dx, dz);

          let currentAngle = p.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.mesh.rotation.y += diff * 7.0 * delta;

          const moveStep = p.speed * delta;
          p.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
          p.mesh.position.y = this.getTerrainHeight(pos.x, pos.z);
        }
      }

      // 3. Update walk animation
      if (this.app.performanceSystem?.shouldAnimate(p, i) ?? true) p.update(delta, isRaining);
    }

    // 4. Handle proximity checking for vehicles and pedestrians
    this.updateProximityChecks();
  }

  updateProximityChecks() {
    if (!this.controlledPedestrian) {
      const prompt = document.getElementById('vehicle-enter-prompt');
      if (prompt) prompt.classList.add('hidden');
      return;
    }

    const p = this.controlledPedestrian;
    const pos = p.mesh.position;
    const boarding = this.app.aircraftSystem?.getBoardingEligibility?.(p);
    const prompt = this.getOrCreateInteractionPrompt();

    if (boarding?.allowed) {
      setTextSegments(prompt, [
        '🛩️ Press ',
        { text: this.app?.inputManager?.getActionLabel?.('INTERACT') || 'E', className: 'prompt-key' },
        ' to Board Northwind Sparrow'
      ]);
      prompt.classList.remove('hidden');
      return;
    }
    
    // 1. Scan for closest vehicle
    let closestVehicle = null;
    let minVehDist = 3.5;

    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      const nearbyVehicles = this.app.performanceSystem?.nearbyVehicles(pos, minVehDist) || this.app.trafficSystem.vehicles;
      for (const v of nearbyVehicles) {
        const dist = pos.distanceTo(v.mesh.position);
        if (dist < minVehDist) {
          minVehDist = dist;
          closestVehicle = v;
        }
      }
    }

    // 2. Scan for closest other pedestrian
    let closestPed = null;
    let minPedDist = 3.0;

    const nearbyPedestrians = this.app.performanceSystem?.nearbyPedestrians(pos, minPedDist) || this.pedestrians;
    for (const other of nearbyPedestrians) {
      if (other === p || other.knockedDown) continue;
      const dist = pos.distanceTo(other.mesh.position);
      if (dist < minPedDist) {
        minPedDist = dist;
        closestPed = other;
      }
    }

    // 3. Resolve priority: whichever is closer triggers prompt
    if (closestVehicle && (closestPed === null || minVehDist < minPedDist)) {
      // Vehicle prompt
      setTextSegments(prompt, [
        '🏎️ Press ',
        { text: this.app?.inputManager?.getActionLabel?.('INTERACT') || 'E', className: 'prompt-key' },
        ` to Hijack ${closestVehicle.name.toUpperCase()}`
      ]);
      prompt.classList.remove('hidden');
    } else if (closestPed) {
      // Pedestrian Talk prompt
      setTextSegments(prompt, [
        '💬 Press ',
        { text: this.app?.inputManager?.getActionLabel?.('INTERACT') || 'E', className: 'prompt-key' },
        ` to Talk to ${closestPed.name.toUpperCase()}`
      ]);
      prompt.classList.remove('hidden');
    } else {
      // Check if near a baseball bat pickup
      let nearBat = false;
      if (p && !p.hasBaseballBat && this.baseballBats) {
        for (const bat of this.baseballBats) {
          if (bat.pickedUp) continue;
          const dist = p.mesh.position.distanceTo(bat.pos);
          if (dist < 4.0) {
            nearBat = true;
            if (prompt) {
              setTextSegments(prompt, [
                '🏏 Walk over to pick up ',
                { text: 'BASEBALL BAT', className: 'prompt-success prompt-strong' }
              ]);
              prompt.classList.remove('hidden');
            }
            break;
          }
        }
      }
      if (!nearBat && prompt) {
        prompt.classList.add('hidden');
      }
    }
  }

  getOrCreateInteractionPrompt() {
    let prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) return prompt;
    prompt = document.createElement('div');
    prompt.id = 'vehicle-enter-prompt';
    prompt.setAttribute('role', 'status');
    prompt.setAttribute('aria-live', 'polite');
    Object.assign(prompt.style, {
      position: 'fixed',
      bottom: '15%',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '12px 24px',
      borderRadius: '24px',
      background: 'rgba(7, 12, 30, 0.82)',
      backdropFilter: 'blur(12px)',
      border: '1px solid #ff007f',
      color: '#fff',
      fontFamily: 'Outfit, Inter, sans-serif',
      fontSize: '0.95rem',
      fontWeight: 'bold',
      boxShadow: '0 0 15px rgba(255, 0, 127, 0.4)',
      zIndex: '1000',
      pointerEvents: 'none'
    });
    document.body.appendChild(prompt);
    return prompt;
  }

  handlePedestrianActionKey() {
    if (!this.controlledPedestrian || this.hijackTransition) return false;

    const p = this.controlledPedestrian;
    const pos = p.mesh.position;

    if (this.app.aircraftSystem?.getBoardingEligibility?.(p)?.allowed) {
      return this.app.aircraftSystem.boardFromPedestrian(p);
    }

    // 1. Scan for closest vehicle
    let closestVehicle = null;
    let minVehDist = 3.5;

    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      const nearbyVehicles = this.app.performanceSystem?.nearbyVehicles(pos, minVehDist) || this.app.trafficSystem.vehicles;
      for (const v of nearbyVehicles) {
        const dist = pos.distanceTo(v.mesh.position);
        if (dist < minVehDist) {
          minVehDist = dist;
          closestVehicle = v;
        }
      }
    }

    // 2. Scan for closest other pedestrian
    let closestPed = null;
    let minPedDist = 3.0;

    const nearbyPedestrians = this.app.performanceSystem?.nearbyPedestrians(pos, minPedDist) || this.pedestrians;
    for (const other of nearbyPedestrians) {
      if (other === p || other.knockedDown) continue;
      const dist = pos.distanceTo(other.mesh.position);
      if (dist < minPedDist) {
        minPedDist = dist;
        closestPed = other;
      }
    }

    // 3. Trigger action based on priority
    if (closestVehicle && (closestPed === null || minVehDist < minPedDist)) {
      return this.beginHijack(p, closestVehicle);
    } else if (closestPed) {
      const funnyDialogues = [
        "Corporate told me to smile 15% harder today.",
        "Did you see the comets? Excellent for property prices!",
        "Buy the dip! NeoTech stock is basically free!",
        "Property damage is temporary, profit is eternal.",
        "I'm commuting to work. My shift is 48 hours.",
        "I love the smell of comet fuel in the morning.",
        "Please do not step on my briefcase. It has my lunch.",
        "My coffee costs $80. What a steal!",
        "A drone scanned my iris and deducted $5 tax.",
        "Living the dream! (Help me, the AI is watching)",
        "I'm jogger #3829. Enforcing cardiovascular optimization.",
        "Can you move? I have a corporate synergy meeting."
      ];
      
      this.talkingPedestrian = closestPed;
      this.talkingBubbleText = funnyDialogues[Math.floor(Math.random() * funnyDialogues.length)];
      this.talkingBubbleTimer = 3.5;

      if (this.app.audioSystem) {
        this.app.audioSystem.playUIClick();
      }

      let bubble = document.getElementById('pedestrian-speech-bubble');
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.id = 'pedestrian-speech-bubble';
        bubble.className = 'floating-speech-bubble';
        document.body.appendChild(bubble);
      }
      bubble.textContent = this.talkingBubbleText;
      bubble.classList.remove('hidden');
      this.updateSpeechBubblePosition();
      return true;
    }
    return false;
  }

  getHijackDoorPosition(vehicle, target = new THREE.Vector3()) {
    const rotationY = vehicle?.mesh?.rotation?.y || 0;
    target.set(-1.45, 0, 0).applyAxisAngle(UP_AXIS, rotationY);
    target.add(vehicle.mesh.position);
    target.y = this.getTerrainHeight(target.x, target.z);
    return target;
  }

  beginHijack(pedestrian, vehicle) {
    if (!pedestrian?.mesh || !vehicle?.mesh || this.hijackTransition) return false;
    pedestrian.isHijacking = true;
    pedestrian.speed = 0;
    pedestrian.info.Activity = `Hijacking ${vehicle.name || vehicle.vType || 'vehicle'}`;
    vehicle.preHijackTargetSpeed = vehicle.targetSpeed;
    vehicle.targetSpeed = 0;
    vehicle.speed = Math.min(Math.abs(vehicle.speed || 0), 1.5);

    this.hijackTransition = {
      pedestrian,
      vehicle,
      elapsed: 0,
      duration: 0.6,
      start: pedestrian.mesh.position.clone(),
      door: new THREE.Vector3()
    };

    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) {
      prompt.textContent = '🏎️ Hijacking in progress…';
      prompt.classList.remove('hidden');
    }
    this.app.uiManager?.addAlert?.(`🏎️ Seizing ${vehicle.name || vehicle.vType || 'vehicle'}…`, 'warn');
    return true;
  }

  updateHijackTransition(delta) {
    const transition = this.hijackTransition;
    if (!transition) return;
    const { pedestrian, vehicle } = transition;
    if (!pedestrian?.mesh || !vehicle?.mesh || vehicle.crashed) {
      if (pedestrian) pedestrian.isHijacking = false;
      if (vehicle) vehicle.targetSpeed = vehicle.preHijackTargetSpeed || vehicle.maxSpeed;
      this.hijackTransition = null;
      return;
    }

    transition.elapsed += Math.max(0, delta);
    const progress = Math.min(1, transition.elapsed / transition.duration);
    const eased = progress * progress * (3 - 2 * progress);
    this.getHijackDoorPosition(vehicle, transition.door);
    pedestrian.mesh.position.lerpVectors(transition.start, transition.door, eased);
    pedestrian.mesh.lookAt(vehicle.mesh.position.x, pedestrian.mesh.position.y, vehicle.mesh.position.z);
    if (pedestrian.armL && pedestrian.armR) {
      pedestrian.armL.rotation.x = -1.15 * eased;
      pedestrian.armR.rotation.x = -1.35 * eased;
    }

    if (progress >= 1) this.finalizeHijack(transition);
  }

  finalizeHijack(transition) {
    if (this.hijackTransition !== transition) return false;
    this.hijackTransition = null;
    const { pedestrian, vehicle } = transition;
    pedestrian.isHijacking = false;

    const success = this.app.trafficSystem.toggleUserControl(vehicle, {
      source: 'pedestrian',
      pedestrian
    });
    if (!success) {
      vehicle.targetSpeed = vehicle.preHijackTargetSpeed || vehicle.maxSpeed;
      pedestrian.info.Activity = 'Hijack failed';
      return false;
    }

    vehicle.preHijackTargetSpeed = null;
    vehicle.driverPedestrian = pedestrian;
    if (vehicle.vType === 'MOTORBIKE') {
      vehicle.mountRider(pedestrian);
    } else {
      this.app.sceneManager.scene.remove(pedestrian.mesh);
    }

    this.app.inspectorHud?.unregisterObject?.(pedestrian.mesh);
    const index = this.pedestrians.indexOf(pedestrian);
    if (index > -1) this.pedestrians.splice(index, 1);

    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) prompt.classList.add('hidden');
    this.app.sceneManager.startFollowTarget(vehicle);
    this.app.uiManager?.showInspector?.(vehicle);
    return true;
  }

  updateSpeechBubblePosition() {
    if (!this.talkingPedestrian || !this.talkingPedestrian.mesh) {
      const bubble = document.getElementById('pedestrian-speech-bubble');
      if (bubble) bubble.classList.add('hidden');
      return;
    }
    
    const camera = this.app.sceneManager.camera;
    if (!camera) return;

    // Ensure camera world matrix is fresh
    camera.updateMatrixWorld();

    const targetPos = new THREE.Vector3();
    this.talkingPedestrian.mesh.getWorldPosition(targetPos);
    targetPos.y += 2.8; // Position above the pedestrian's head

    // Check mathematically if the target is in front of the camera plane
    const toTarget = targetPos.clone().sub(camera.position);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const dot = toTarget.dot(camDir);

    const bubble = document.getElementById('pedestrian-speech-bubble');
    if (!bubble) return;

    if (dot <= 0.1) {
      // Behind camera, hide bubble
      bubble.classList.add('hidden');
      return;
    }

    // Project world coordinates onto screen
    targetPos.project(camera);

    // NDC coordinates must be within visible viewport depth limits
    if (targetPos.z > 1.0) {
      bubble.classList.add('hidden');
    } else {
      const x = (targetPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (targetPos.y * -0.5 + 0.5) * window.innerHeight;

      if (isNaN(x) || isNaN(y)) {
        bubble.classList.add('hidden');
        return;
      }

      bubble.style.left = `${x}px`;
      bubble.style.top = `${y}px`;
      bubble.classList.remove('hidden');
    }
  }

  toggleUserControl(pedestrian) {
    if (!pedestrian) return false;
    
    if (pedestrian.userControlled && this.controlledPedestrian === pedestrian) {
      this.releaseControl(pedestrian);
      return false;
    } else {
      // Release any currently controlled pedestrian
      if (this.controlledPedestrian && this.controlledPedestrian !== pedestrian) {
        this.releaseControl(this.controlledPedestrian);
      }
      // Release control of any vehicle to prevent conflicts
      if (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle) {
        this.app.trafficSystem.releaseControl(this.app.trafficSystem.controlledVehicle);
      }
      if (pedestrian.archetype === 'CRIMINAL' && pedestrian.behaviorState?.target) {
        finishAggression(pedestrian, pedestrian.behaviorState, this.random);
      }
      if (pedestrian.behaviorState) pedestrian.behaviorState.mode = 'WALKING';
      
      pedestrian.userControlled = true;
      this.controlledPedestrian = pedestrian;
      this.app.gameManager?.setMode?.('ACTION', { reason: 'pedestrian-control' });
      pedestrian.info['Mood'] = '🎮 USER CONTROLLED';
      pedestrian.info['Activity'] = 'Walking streets';
      if (this.app.uiManager && this.app.uiManager.addAlert) {
        this.app.uiManager.addAlert(`🚶 Direct walk control engaged: ${pedestrian.name || 'Citizen'}`, 'info');
      }
      return true;
    }
  }

  suspendControlledPedestrian(pedestrian) {
    if (!pedestrian?.mesh || this.controlledPedestrian !== pedestrian || !pedestrian.userControlled) {
      return false;
    }
    pedestrian.userControlled = false;
    pedestrian.controlSuspended = true;
    pedestrian.speed = 0;
    pedestrian.targetSpeed = 0;
    pedestrian.info['Mood'] = '🛩️ PILOTING AIRCRAFT';
    pedestrian.info['Activity'] = 'Aboard Northwind Sparrow';
    this.controlledPedestrian = null;
    this.app.inspectorHud?.unregisterObject?.(pedestrian.mesh);
    this.app.sceneManager?.scene?.remove?.(pedestrian.mesh);
    const index = this.pedestrians.indexOf(pedestrian);
    if (index >= 0) this.pedestrians.splice(index, 1);
    const prompt = typeof document !== 'undefined' ? document.getElementById('vehicle-enter-prompt') : null;
    prompt?.classList.add('hidden');
    return true;
  }

  restoreSuspendedPedestrian(pedestrian, position, rotationY = 0) {
    if (!pedestrian?.mesh || !position?.isVector3 || !pedestrian.controlSuspended) return false;
    pedestrian.mesh.position.copy(position);
    pedestrian.mesh.position.y = this.getTerrainHeight(position.x, position.z);
    pedestrian.mesh.rotation.y = Number.isFinite(rotationY) ? rotationY : 0;
    pedestrian.mesh.visible = true;
    pedestrian.controlSuspended = false;
    pedestrian.userControlled = false;
    pedestrian.speed = 0;
    pedestrian.targetSpeed = pedestrian.maxSpeed;
    pedestrian.isJumping = false;
    pedestrian.jumpVelocity = 0;
    resetPedestrianKnockdown(pedestrian);
    if (!this.pedestrians.includes(pedestrian)) this.pedestrians.push(pedestrian);
    if (!pedestrian.mesh.parent) this.app.sceneManager?.scene?.add?.(pedestrian.mesh);
    this.app.inspectorHud?.registerObject?.(pedestrian.mesh, pedestrian);
    return true;
  }

  cullPedestrian(p) {
    if (!p) return;
    if (p.behaviorState?.target) finishAggression(p, p.behaviorState, this.random);
    if (p.attackedBy?.behaviorState) finishAggression(p.attackedBy, p.attackedBy.behaviorState, this.random);
    const wasControlled = this.controlledPedestrian === p || p.userControlled;
    if (wasControlled) this.releaseControl(p);

    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) prompt.classList.add('hidden');

    if (this.app && this.app.sceneManager) {
      if (this.app.sceneManager.followTarget === p || this.app.sceneManager.activePreset === 'FREE_ORBIT') {
        this.app.sceneManager.breakToFreeOrbit();
      }
    }
    // Recover citizens to the closest safe sidewalk instead of permanently
    // shrinking the 60-agent crowd whenever one enters a river volume.
    const safeNodes = Array.from(this.nodes.values()).filter(node =>
      node.nextNodes.length > 0 && !(this.app.cityBuilder && this.app.cityBuilder.isInWater(node.pos))
    );
    let closestNode = null;
    let closestDistance = Infinity;
    for (const node of safeNodes) {
      const distance = p.mesh.position.distanceTo(node.pos);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNode = node;
      }
    }
    if (closestNode) {
      p.mesh.position.copy(closestNode.pos);
      p.mesh.position.y = this.getTerrainHeight(closestNode.pos.x, closestNode.pos.z);
      p.currentNode = closestNode;
      p.targetNode = closestNode.nextNodes[0] || closestNode;
      p.mesh.lookAt(p.targetNode.pos);
    }
    resetPedestrianKnockdown(p);
    p.isJumping = false;
    p.jumpVelocity = 0;
    p.speed = 0;
    p.targetSpeed = p.maxSpeed;

    if (this.app.uiManager && this.app.uiManager.addAlert) {
      this.app.uiManager.addAlert(wasControlled ? '🌊 Citizen rescued from the river; walk control released.' : '🚶 Citizen returned to the sidewalk network.', 'warn');
    }
  }

  releaseControl(pedestrian) {
    if (!pedestrian?.mesh) return false;
    const handoffPose = captureAiHandoffPose(pedestrian);
    if (!handoffPose) return false;
    pedestrian.userControlled = false;
    if (this.controlledPedestrian === pedestrian) {
      this.controlledPedestrian = null;
    }
    if (!this.app.trafficSystem?.controlledVehicle) {
      this.app.gameManager?.setMode?.('MANAGEMENT', { reason: 'pedestrian-release' });
    }
    
    pedestrian.info['Mood'] = pedestrian.defaultMood || 'Energized';
    pedestrian.info['Activity'] = pedestrian.defaultActivity || 'Strolling Downtown';
    if (pedestrian.behaviorState) {
      if (pedestrian.archetype === 'CAFE_READER') {
        pedestrian.behaviorState.mode = 'WALKING';
        pedestrian.info['Activity'] = 'Walking streets';
      } else if (pedestrian.archetype === 'JOGGER') pedestrian.behaviorState.mode = 'JOGGING';
      else if (pedestrian.archetype === 'CRIMINAL') {
        finishAggression(pedestrian, pedestrian.behaviorState, this.random);
      } else pedestrian.behaviorState.mode = 'WALKING';
    }
    
    const prompt = typeof document !== 'undefined'
      ? document.getElementById('vehicle-enter-prompt')
      : null;
    if (prompt) prompt.classList.add('hidden');

    completeAiHandoff(pedestrian, {
      pose: handoffPose,
      nodes: this.nodes?.values?.(),
      entities: this.pedestrians,
      scene: this.app?.sceneManager?.scene
    });
    return true;
  }

  getTerrainHeight(x, z) {
    if (typeof this.app?.cityBuilder?.getTerrainHeight === 'function') {
      return this.app.cityBuilder.getTerrainHeight(x, z);
    }
    const userBridgeHeight = this.app?.cityBuilder?.getUserBridgeDeckHeight?.(x, z);
    if (userBridgeHeight !== null && userBridgeHeight !== undefined) return userBridgeHeight;

    // 1. Bridges over the rivers (first river X: 110 to 210, second river X: 380 to 420)
    if (x >= 110 && x <= 210) {
      if (Math.abs(z) <= 9.5) {
        return 0.05; // Flush top surface of the suspension bridge deck
      }
    }
    if (x >= 380 && x <= 420) {
      for (const bz of [-100, -50, 0, 50, 100]) {
        if (Math.abs(z - bz) <= 9.5) {
          return 0.05; // Flush top surface of the stone arch bridges
        }
      }
    }

    // 2. River Basin bottoms (-4.0)
    if (x >= 135 && x <= 185) {
      return -4.0;
    }
    if (x >= 380 && x <= 420) {
      return -4.0;
    }

    // 3. Northwest Central Park region
    if (x < -60 && z < -60) return 0.7;

    // 4. Main street blocks (sidewalks)
    const blockCentersX = [-75, -25, 25, 75, 235, 285];
    const blockCentersZ = [-75, -25, 25, 75];
    const size = 22.0; // Block half-width (36 block + 4 sidewalk on each side = 44 / 2 = 22)

    for (const bx of blockCentersX) {
      for (const bz of blockCentersZ) {
        if (Math.abs(x - bx) < size && Math.abs(z - bz) < size) {
          return 0.4; // Elevated sidewalk height
        }
      }
    }

    // 5. Countryside rolling hills (X >= 420)
    if (x >= 420) {
      if (this.app && this.app.cityBuilder) {
        return this.app.cityBuilder.getHillHeight(x, z) + 0.05;
      }
      const factor = Math.min(1.0, (x - 420) / 100);
      const hillHeight = (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 8 + Math.sin(x * 0.02) * 15) * factor;
      return hillHeight + 0.05; // Base offset to align with street
    }

    // 6. Street/Asphalt level
    return 0.05;
  }

  spawnBaseballBats() {
    const batPositions = [
      { x: 12, z: 12 },
      { x: -42, z: 55 },
      { x: 95, z: -38 },
      { x: 55, z: 95 },
      { x: -95, z: 12 },
      { x: 210, z: 55 },
      { x: 265, z: -38 },
      { x: 305, z: 95 },
    ];

    for (const bp of batPositions) {
      const y = this.getTerrainHeight(bp.x, bp.z) + 0.5;
      const group = new THREE.Group();
      group.position.set(bp.x, y, bp.z);

      // Bat model (wooden cylinder)
      const batGeo = new THREE.CylinderGeometry(0.06, 0.03, 1.1, 8);
      const batMat = new THREE.MeshStandardMaterial({
        color: 0xc19a6b, roughness: 0.6, metalness: 0.1,
        emissive: 0x6b4226, emissiveIntensity: 0.15
      });
      const batMesh = new THREE.Mesh(batGeo, batMat);
      batMesh.rotation.z = Math.PI / 2; // Lay horizontally
      batMesh.position.y = 0.15;
      batMesh.castShadow = true;
      group.add(batMesh);

      // Glowing ground halo
      const haloGeo = new THREE.RingGeometry(0.6, 1.2, 32);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2; // Lay flat on ground
      halo.position.y = -0.15;
      group.add(halo);

      // Vertical glow pillar
      const pillarGeo = new THREE.CylinderGeometry(0.15, 0.15, 3.0, 8);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0.08
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.y = 1.2;
      group.add(pillar);

      this.app.sceneManager.scene.add(group);

      this.baseballBats.push({
        mesh: group,
        halo: halo,
        pos: new THREE.Vector3(bp.x, y, bp.z),
        pickedUp: false,
        pulseTime: Math.random() * 6.28
      });
    }
  }

  swingBaseballBat() {
    const ped = this.controlledPedestrian;
    if (!ped || !ped.hasBaseballBat) return;
    if (ped.swingTimer > 0) return; // Already swinging

    ped.swingTimer = 0.3;

    // Play whoosh/swing sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playUIClick();
    }

    // Hit detection: use XZ-plane only to avoid Y-offset issues
    const pedPos2D = new THREE.Vector2(ped.mesh.position.x, ped.mesh.position.z);
    const pedFwd3D = new THREE.Vector3(0, 0, 1).applyQuaternion(ped.mesh.quaternion);
    const pedDir2D = new THREE.Vector2(pedFwd3D.x, pedFwd3D.z).normalize();

    let hitSomething = false;

    // Check vehicle hits (range 5m on XZ plane, wide 180-degree cone)
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        if (v.crashed) continue;
        const vPos2D = new THREE.Vector2(v.mesh.position.x, v.mesh.position.z);
        const dist = pedPos2D.distanceTo(vPos2D);
        if (dist > 5.0) continue;

        const toVeh2D = vPos2D.clone().sub(pedPos2D).normalize();
        const dot = pedDir2D.dot(toVeh2D);
        if (dot < 0.0) continue; // Must be in front hemisphere

        hitSomething = true;

        // Register hit
        v.batHits = (v.batHits || 0) + 1;
        v.info['Damage'] = '🏏 ' + v.batHits + '/3 hits';

        // Visual feedback: flash vehicle body red briefly
        if (v.mesh.children && v.mesh.children.length > 0) {
          const body = v.mesh.children[0];
          if (body && body.material) {
            const origColor = body.material.color.getHex();
            body.material.color.setHex(0xff2200);
            setTimeout(() => { body.material.color.setHex(origColor); }, 150);
          }
        }

        // Show hit count prompt
        const prompt = document.getElementById('vehicle-enter-prompt');
        if (prompt) {
          setTextSegments(prompt, [
            '🏏 ',
            { text: 'HIT!', className: 'prompt-danger prompt-strong' },
            ` ${v.name} — `,
            { text: `${v.batHits}/3`, className: 'prompt-warning' },
            ' hits'
          ]);
          prompt.classList.remove('hidden');
          setTimeout(() => { prompt.classList.add('hidden'); }, 1200);
        }

        if (v.batHits >= 3) {
          this.app.trafficSystem.igniteVehicle(v, { delay: 5.0 });

          // Dispatch police for destruction
          this.reportCrime(ped.mesh.position, 'Vehicle destruction reported', false);
          if (this.app.uiManager && this.app.uiManager.addAlert) {
            this.app.uiManager.addAlert("🚨 POLICE DISPATCHED: Vehicle destruction reported!", "danger");
          }
        }
        break; // Only hit one vehicle per swing
      }
    }

    // Check NPC hits (range 3.5m on XZ plane, wide 180-degree cone)
    if (!hitSomething) {
      for (const other of this.pedestrians) {
        if (other === ped || other.knockedDown) continue;
        const oPos2D = new THREE.Vector2(other.mesh.position.x, other.mesh.position.z);
        const dist = pedPos2D.distanceTo(oPos2D);
        if (dist > 3.5) continue;

        const toNpc2D = oPos2D.clone().sub(pedPos2D).normalize();
        const dot = pedDir2D.dot(toNpc2D);
        if (dot < 0.0) continue;

        hitSomething = true;

        // NPC runs away in fear
        other.info['Mood'] = '😱 TERRIFIED';
        other.info['Activity'] = '🏃 Fleeing!';
        other.maxSpeed = 12.0;
        other.targetSpeed = 12.0;
        other.speed = 10.0;

        // Face away from the player and run
        const fleeDir = other.mesh.position.clone().sub(ped.mesh.position);
        fleeDir.y = 0;
        fleeDir.normalize();
        other.mesh.lookAt(
          other.mesh.position.x + fleeDir.x * 10,
          other.mesh.position.y,
          other.mesh.position.z + fleeDir.z * 10
        );

        // Show hit prompt
        const prompt = document.getElementById('vehicle-enter-prompt');
        if (prompt) {
          setTextSegments(prompt, [
            '🏏 ',
            { text: 'HIT!', className: 'prompt-danger prompt-strong' },
            ` ${other.name} is `,
            { text: 'FLEEING!', className: 'prompt-warning prompt-strong' }
          ]);
          prompt.classList.remove('hidden');
          setTimeout(() => { prompt.classList.add('hidden'); }, 1500);
        }

        // Dispatch police for assault
        this.reportCrime(ped.mesh.position, 'Citizen assault reported', false);
        if (this.app.uiManager && this.app.uiManager.addAlert) {
          this.app.uiManager.addAlert(`🚨 POLICE DISPATCHED: Citizen assault reported!`, 'danger');
        }
        break; // Only hit one NPC per swing
      }
    }

    // Play impact sound if we hit something
    if (hitSomething && this.app.audioSystem) {
      this.app.audioSystem.playExplosion();
    }
  }

  arrestPlayer() {
    const ped = this.controlledPedestrian;
    const controlledVehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
    if (!ped && !controlledVehicle) return;

    // Show arrested overlay
    const overlay = document.getElementById('arrested-overlay');
    if (overlay) overlay.classList.remove('hidden');

    // Play arrest sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playExplosion();
    }

    // Clear wanted state
    this.isWanted = false;
    this.escapeTimer = 0;
    this.resolveCrimeIncident();

    // Reset police targets
    this.clearPoliceResponse();

    // Remove baseball bat from pedestrian
    if (ped) {
      ped.hasBaseballBat = false;
      if (ped.batMesh) {
        ped.armR.remove(ped.batMesh);
        ped.batMesh = null;
      }
    }

    if (controlledVehicle) {
      controlledVehicle.sirenActive = false;
      if (controlledVehicle.vType === 'AMBULANCE' && this.app.audioSystem) {
        this.app.audioSystem.stopAmbulanceSiren(controlledVehicle);
      }
      this.app.trafficSystem.releaseControl(controlledVehicle);
    } else {
      this.releaseControl(ped);
    }

    // Stop camera follow and reset to orbital view
    this.app.sceneManager.stopFollowTarget();
    if (this.app.uiManager) {
      this.app.uiManager.hideInspector();
    }

    // Hide the overlay after 3 seconds
    setTimeout(() => {
      if (overlay) overlay.classList.add('hidden');
    }, 3000);
  }

  triggerPedestrianJump() {
    const p = this.controlledPedestrian;
    if (!p) return;
    const terrainHeight = this.getTerrainHeight(p.mesh.position.x, p.mesh.position.z);
    // Only jump if on or very close to the ground
    if (!p.isJumping && p.mesh.position.y <= terrainHeight + 0.05) {
      p.jumpVelocity = 11.5;
      p.isJumping = true;
      if (this.app.audioSystem && this.app.audioSystem.playUIClick) {
        this.app.audioSystem.playUIClick();
      }
    }
  }

  updateWantedHud() {
    let hud = document.getElementById('wanted-hud');
    if (!this.isWanted) {
      if (hud) {
        hud.classList.add('hidden');
        hud.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'wanted-hud';
      hud.className = 'wanted-hud';
      hud.setAttribute('role', 'status');
      hud.setAttribute('aria-live', 'polite');
      hud.setAttribute('aria-hidden', 'false');
      const title = document.createElement('div');
      title.className = 'wanted-title';
      title.textContent = '🚨 WANTED 🚨';
      const subtitle = document.createElement('div');
      subtitle.className = 'wanted-subtitle';
      const barBackground = document.createElement('div');
      barBackground.className = 'wanted-bar-bg';
      const bar = document.createElement('div');
      bar.className = 'wanted-bar';
      this.wantedHudSubtitle = subtitle;
      this.wantedHudBar = bar;
      barBackground.appendChild(bar);
      hud.append(title, subtitle, barBackground);
      const statusStack = document.getElementById('status-hud-stack');
      (statusStack || document.body).prepend(hud);
    }

    // Calculate how many seconds left to escape
    const escapeProgress = Math.max(0, 8.0 - this.escapeTimer);
    const progressPercent = Math.min(100, (this.escapeTimer / 8.0) * 100);

    const subtitle = this.wantedHudSubtitle || hud.querySelector('.wanted-subtitle');
    const bar = this.wantedHudBar || hud.querySelector('.wanted-bar');
    this.wantedHudSubtitle = subtitle;
    this.wantedHudBar = bar;
    if (subtitle) subtitle.textContent = this.escapeTimer > 0 ? `ESCAPING... (${escapeProgress.toFixed(1)}s)` : 'POLICE PURSUIT!';
    if (bar) bar.style.width = `${progressPercent}%`;
    hud.classList.remove('hidden');
    hud.setAttribute('aria-hidden', 'false');
  }
}
