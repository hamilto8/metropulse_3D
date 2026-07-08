import * as THREE from 'three';
import missionsData from '../data/missions.json';

/**
 * MissionSystem.js
 * Core mission logic engine for MetroPulse 3D Phase 3.
 * Manages interactive 3D pickup rings, destination holographic light beacons,
 * live timer countdowns, dynamic navigation arrows, and fare payouts.
 */
export class MissionSystem {
  constructor(app, dialogueOverlay) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.dialogueOverlay = dialogueOverlay;

    this.missions = missionsData;
    this.availableMissions = [...this.missions];
    this.activeMission = null;
    this.timeRemaining = 0;
    this.payout = 0;

    // Prevents instant dialogue re-triggering loop when player closes/declines dialogue
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

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.cancelMission());
    }

    this.initPickupBeacons();
  }

  initPickupBeacons() {
    // Create glowing pickup rings on the streets for available missions
    const ringGeo = new THREE.TorusGeometry(4.2, 0.45, 12, 32);
    ringGeo.rotateX(Math.PI / 2);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.8
    });

    for (const mission of this.availableMissions) {
      const group = new THREE.Group();
      group.position.set(mission.pickup.x, 0.5, mission.pickup.z);

      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      group.add(ringMesh);

      // Add a small floating light column indicator above ring
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
      this.pickupRings.push({ mission, group, ringMesh });
    }
  }

  startMission(mission, choiceNode) {
    this.activeMission = mission;

    // Determine time limit and reward
    this.timeRemaining = choiceNode.timeLimitOverride || mission.timeLimit || 60;
    const rushBonus = choiceNode.rushBonus || 0;
    this.payout = (mission.baseReward || 400) + rushBonus;

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
        this.hudTitleEl.textContent = `${mission.passengerName} (${mission.dropoff.district || 'Destination'})`;
      }
    }

    if (this.app.audioSystem) {
      this.app.audioSystem.playHonk();
    }
  }

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

  completeMission() {
    if (!this.activeMission) return;

    // Award fare to city treasury
    if (this.app && this.app.cityBuilder) {
      this.app.cityBuilder.treasury = (this.app.cityBuilder.treasury || 0) + this.payout;
    }

    // Play completion sound and notification
    if (this.app.audioSystem) {
      this.app.audioSystem.playSiren(1.2);
    }

    // Update Chyron or Alert
    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = `*** 🚖 FARE COMPLETED: Delivered ${this.activeMission.passengerName} to ${this.activeMission.dropoff.district}! EARNED $${this.payout} FOR METROPULSE TREASURY! *** ` + newsEl.textContent;
    }

    this.clearActiveMission();
  }

  failMission() {
    if (!this.activeMission) return;

    // Show failure notice
    const newsEl = document.querySelector('.chyron-ticker-text span');
    if (newsEl) {
      newsEl.textContent = `*** ❌ FARE FAILED: Time ran out for ${this.activeMission.passengerName}! *** ` + newsEl.textContent;
    }

    this.clearActiveMission();
  }

  cancelMission() {
    this.clearActiveMission();
  }

  clearActiveMission() {
    if (this.destinationBeacon) {
      this.disposeBeacon(this.destinationBeacon);
      this.destinationBeacon = null;
    }

    if (this.hudEl) {
      this.hudEl.classList.add('hidden');
    }

    // Re-show pickup ring
    if (this.activeMission) {
      const ringObj = this.pickupRings.find(r => r.mission.id === this.activeMission.id);
      if (ringObj) {
        ringObj.group.visible = true;
      }
    }

    // Set a 4-second cooldown so player can drive away without re-triggering dialogue loop
    this.triggerCooldown = 4.0;
    this.activeMission = null;
  }

  update(delta) {
    if (this.triggerCooldown > 0) {
      this.triggerCooldown -= delta;
    }

    // 1. Animate pickup rings
    for (const r of this.pickupRings) {
      if (r.group.visible) {
        r.ringMesh.rotation.z += 1.8 * delta;
      }
    }

    // 2. Animate destination beacon
    if (this.destinationBeacon) {
      this.destinationBeacon.rotation.y += 1.5 * delta;
    }

    const controlledVehicle = this.app.trafficSystem ? this.app.trafficSystem.controlledVehicle : null;
    if (!controlledVehicle || !controlledVehicle.mesh) return;

    const vPos = controlledVehicle.mesh.position;

    // 3. If NO active mission, check distance to pickup rings
    if (!this.activeMission && this.triggerCooldown <= 0) {
      for (const r of this.pickupRings) {
        if (!r.group.visible) continue;
        const dist = vPos.distanceTo(r.group.position);
        if (dist < 7.5) {
          // Trigger dialogue if overlay is not already shown
          if (this.dialogueOverlay && !this.dialogueOverlay.currentMission) {
            this.dialogueOverlay.showMissionDialogue(r.mission, this);
          }
          break;
        }
      }
      return;
    }

    // 4. ACTIVE MISSION: update timer & navigation HUD
    if (!this.activeMission) return;

    this.timeRemaining -= delta;
    if (this.timeRemaining <= 0) {
      this.failMission();
      return;
    }

    const dropoffPos = new THREE.Vector3(
      this.activeMission.dropoff.x,
      0,
      this.activeMission.dropoff.z
    );
    const distToDropoff = vPos.distanceTo(dropoffPos);

    if (distToDropoff < 10.5) {
      this.completeMission();
      return;
    }

    // Update HUD elements
    if (this.hudDistEl) {
      this.hudDistEl.textContent = `${Math.round(distToDropoff)} m`;
    }
    if (this.hudTimerEl) {
      this.hudTimerEl.textContent = `⏱️ ${Math.ceil(this.timeRemaining)}s`;
    }
    if (this.hudFareEl) {
      this.hudFareEl.textContent = `$${this.payout}`;
    }

    // Compute navigation arrow angle pointing from vehicle heading to destination
    if (this.hudArrowEl) {
      const toDropoff = dropoffPos.clone().sub(vPos).normalize();
      const angle = Math.atan2(toDropoff.x, toDropoff.z) - controlledVehicle.mesh.rotation.y;
      this.hudArrowEl.style.transform = `rotate(${angle}rad)`;
    }
  }
}
