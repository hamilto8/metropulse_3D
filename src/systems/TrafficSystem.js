import * as THREE from 'three';
import { Vehicle } from '../entities/Vehicle.js';
import { PlayerVehicle } from '../entities/PlayerVehicle.js';
import { Pedestrian } from '../entities/Pedestrian.js';
import { getVehicleSeparation } from './VehicleSeparation.js';
import {
  getRiderEjectionImpact,
  MOTORBIKE_RIDER_EJECTION
} from './MotorbikeImpact.js';
import {
  approachTrafficTargetSpeed,
  createPedestrianTrafficState,
  getPedestrianEmergencyStopDistance,
  getPedestrianYieldKinematics,
  updatePedestrianTrafficState
} from './TrafficPedestrianBehavior.js';
import {
  advanceHitAndRunState,
  createHitAndRunState,
  DEFAULT_HIT_AND_RUN_PURSUIT,
  getPursuitSpeed,
  selectNearbyPolice
} from './HitAndRunPursuit.js';
import {
  enforceLaneCorridor,
  findTrafficObstacleAhead,
  getNavigationSpeedLimit,
  getTrafficObstacleSnapshot,
  hasReachedNavigationTarget,
  TRAFFIC_NAVIGATION
} from './TrafficNavigation.js';
import { TrafficControlSystem } from './TrafficControlSystem.js';
import { createDriverRuleProfile } from './TrafficRules.js';

/** Shared forward-axis vector — never mutated, avoids per-frame allocation in hot loops */
const FORWARD_AXIS = Object.freeze(new THREE.Vector3(0, 0, 1));
const UP_AXIS = Object.freeze(new THREE.Vector3(0, 1, 0));

class TrafficNode {
  constructor(id, x, z) {
    this.id = id;
    this.pos = new THREE.Vector3(x, 0, z);
    this.nextNodes = [];
  }
}

export class TrafficSystem {
  constructor(app) {
    this.app = app;
    this.vehicles = [];
    this.nodes = new Map();
    this.roadCoordsX = [-100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750];
    this.roadCoordsZ = [-100, -50, 0, 50, 100];
    this.laneOffset = 3.5; // Right-hand traffic lane center
    this.targetMovingVehicleCount = 48;
    this.chainReactionRadius = 10;
    this.chainReactionDelay = 4;
    this.destroyedVehicleLifetime = 30;
    this.pedestrianImpatienceProbability = 0.2;
    this.pedestrianImpatienceDelay = 3.5;
    this.hitAndRunPursuitConfig = { ...DEFAULT_HIT_AND_RUN_PURSUIT };
    this.navigationConfig = { ...TRAFFIC_NAVIGATION };
    this.random = Math.random;
    this.nextVehicleSerial = 0;
    this.populationCheckTimer = 2.0;
    this.bridgePriorityEnabled = false;
    this.placedRoadSegments = new Map();

    this.initWaypoints();
    this.trafficControlSystem = new TrafficControlSystem(
      app,
      this.roadCoordsX,
      this.roadCoordsZ
    );
    this.spawnVehicles(this.targetMovingVehicleCount);
    this.spawnParkedVehicles();
  }

  get keys() {
    return this.app?.inputManager?.keys || {};
  }

  assignDriverRuleProfile(vehicle, serial) {
    if (!vehicle) return null;
    vehicle.driverRuleProfile = createDriverRuleProfile(serial);
    vehicle.trafficRuleCompliant = vehicle.driverRuleProfile.compliant;
    vehicle.info['Driving Style'] = vehicle.trafficRuleCompliant
      ? 'Rule-following'
      : 'Reckless';
    return vehicle.driverRuleProfile;
  }

  toggleUserControl(vehicle, { source = 'camera', pedestrian = null } = {}) {
    if (!vehicle) return false;
    if (vehicle.userControlled && this.controlledVehicle === vehicle) {
      this.releaseControl(vehicle);
      return false;
    } else {
      if (this.controlledVehicle && this.controlledVehicle !== vehicle) {
        this.releaseControl(this.controlledVehicle);
      }
      // Release control of any pedestrian to prevent conflicts
      if (this.app && this.app.pedestrianSystem && this.app.pedestrianSystem.controlledPedestrian) {
        this.app.pedestrianSystem.releaseControl(this.app.pedestrianSystem.controlledPedestrian);
      }
      
      // If the vehicle was parked, unpark it!
      if (vehicle.isParked) {
        vehicle.isParked = false;
      }

      vehicle.userControlled = true;
      this.controlledVehicle = vehicle;
      this.controlSession = Object.freeze({ source, pedestrian });
      this.app.gameManager?.setMode?.('ACTION', { reason: 'vehicle-control' });
      vehicle.info['Status'] = '🎮 USER CONTROLLED';
      if (this.app.uiManager && this.app.uiManager.addAlert) {
        this.app.uiManager.addAlert(`🏎️ Direct control engaged: ${vehicle.vType || 'VEHICLE'}`, 'info');
      }

      // If hijacking an active motorbike with an NPC rider mounted, knock them off onto the ground!
      if (vehicle.vType === 'MOTORBIKE' && vehicle.mountedRider) {
        if (this.app.uiManager && this.app.uiManager.addAlert) {
          this.app.uiManager.addAlert(`🏍️ Motorbike hijacked! Rider knocked onto street.`, 'warn');
        }
        const npcPed = vehicle.unmountRider();
        if (npcPed && this.app && this.app.pedestrianSystem) {
          const knockPos = vehicle.mesh.position.clone();
          const offset = new THREE.Vector3(1.4, 0.4, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), vehicle.mesh.rotation.y);
          knockPos.add(offset);
          knockPos.y = this.getTerrainHeight(knockPos.x, knockPos.z);

          this.registerPedestrianInWorld(npcPed, knockPos, vehicle.mesh.rotation.y);
          this.app.pedestrianSystem.knockDownPedestrian(
            npcPed,
            new THREE.Vector3(1.3, 0.2, 0).applyAxisAngle(UP_AXIS, vehicle.mesh.rotation.y)
          );
        }
      }

      // Phase 1: Attach cannon-es PlayerVehicle if PhysicsWorld is available
      if (this.app && this.app.physicsWorld) {
        if (vehicle.physicsVehicle) {
          vehicle.physicsVehicle.destroy();
          vehicle.physicsVehicle = null;
        }
        if (vehicle.physicsBody) this.app.physicsWorld.removeKinematicCollider(vehicle.physicsBody);
        vehicle.mesh.position.y = this.getTerrainHeight(vehicle.mesh.position.x, vehicle.mesh.position.z);
        vehicle.physicsVehicle = new PlayerVehicle(vehicle.mesh, this.app.physicsWorld, null, null, vehicle.vType);
      }

      if (this.app && this.app.audioSystem) {
        this.app.audioSystem.startEngineSound(vehicle.vType);
      }

      return true;
    }
  }

  releaseControl(vehicle) {
    if (!vehicle) return;
    vehicle.userControlled = false;

    // Clean up cannon-es physics vehicle
    if (vehicle.physicsVehicle) {
      vehicle.physicsVehicle.destroy();
      vehicle.physicsVehicle = null;
    }
    if (vehicle.physicsBody && this.app && this.app.physicsWorld) {
      // Move the lightweight AI collider to the last rendered player pose
      // before restoring it. This prevents a stale collider from reappearing
      // at the pre-hijack location for a frame.
      vehicle.physicsBody.position.set(vehicle.mesh.position.x, vehicle.mesh.position.y + 1.05, vehicle.mesh.position.z);
      vehicle.physicsBody.quaternion.set(vehicle.mesh.quaternion.x, vehicle.mesh.quaternion.y, vehicle.mesh.quaternion.z, vehicle.mesh.quaternion.w);
      vehicle.physicsBody.velocity.set(0, 0, 0);
      vehicle.physicsBody.angularVelocity.set(0, 0, 0);
      vehicle.physicsBody.aabbNeedsUpdate = true;
      this.app.physicsWorld.restoreKinematicCollider(vehicle.physicsBody);
    }

    if (this.controlledVehicle === vehicle) {
      this.controlledVehicle = null;
    }
    this.controlSession = null;
    if (!this.app.pedestrianSystem?.controlledPedestrian) {
      this.app.gameManager?.setMode?.('MANAGEMENT', { reason: 'vehicle-release' });
    }
    vehicle.info['Status'] = 'Cruising';

    if (this.app && this.app.audioSystem) {
      this.app.audioSystem.stopEngineSound();
      if (vehicle.vType === 'AMBULANCE') {
        this.app.audioSystem.stopAmbulanceSiren(vehicle);
      }
    }

    // If there is an active mission in progress, fail the mission
    if (this.app && this.app.missionSystem && this.app.missionSystem.activeMission) {
      this.app.missionSystem.failMission('released');
    }

    const allNodesList = Array.from(this.nodes.values());
    if (allNodesList.length > 0) {
      let closestNode = allNodesList[0];
      let minDist = vehicle.mesh.position.distanceTo(closestNode.pos);
      for (const node of allNodesList) {
        const dist = vehicle.mesh.position.distanceTo(node.pos);
        if (dist < minDist) {
          minDist = dist;
          closestNode = node;
        }
      }
      vehicle.currentNode = closestNode;
      if (closestNode.nextNodes && closestNode.nextNodes.length > 0) {
        vehicle.targetNode = closestNode.nextNodes[0];
      } else {
        vehicle.targetNode = closestNode;
      }
         if (vehicle.targetNode) {
        vehicle.mesh.lookAt(vehicle.targetNode.pos);
      }
      if (this.app && this.app.cityBuilder && this.app.cityBuilder.isInWater(vehicle.mesh.position)) {
        vehicle.mesh.position.copy(closestNode.pos);
        vehicle.mesh.position.y = this.getTerrainHeight(closestNode.pos.x, closestNode.pos.z);
      }
      vehicle.speed = Math.max(8, vehicle.speed);
    }

    if (vehicle.physicsBody && this.app && this.app.physicsWorld) {
      vehicle.physicsBody.position.set(vehicle.mesh.position.x, vehicle.mesh.position.y + 1.05, vehicle.mesh.position.z);
      vehicle.physicsBody.quaternion.set(vehicle.mesh.quaternion.x, vehicle.mesh.quaternion.y, vehicle.mesh.quaternion.z, vehicle.mesh.quaternion.w);
      vehicle.physicsBody.aabbNeedsUpdate = true;
    }
  }

  exitControlledVehicle() {
    const v = this.controlledVehicle;
    if (!v) return false;
    const session = this.controlSession || { source: 'camera', pedestrian: null };

    if (session.source !== 'pedestrian') {
      this.releaseControl(v);
      this.app.sceneManager?.stopFollowTarget?.();
      this.app.uiManager?.hideInspector?.();
      return true;
    }

    if (v.vType === 'MOTORBIKE' && v.mountedRider) {
      v.unmountRider();
    }

    let ped = session.pedestrian || v.driverPedestrian;
    if (!ped) {
      const pedColors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed];
      ped = new Pedestrian('CASUAL', pedColors[Math.floor(Math.random() * pedColors.length)], `Driver of ${v.name}`);
      v.driverPedestrian = ped;
    }

    const pos = v.mesh.position.clone();
    const rotY = v.mesh.rotation.y;

    // Offset position to the left side of the vehicle
    const offsetDist = v.vType === 'MOTORBIKE' ? -1.1 : -1.8;
    const offset = new THREE.Vector3(offsetDist, 0.4, 0);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    pos.add(offset);
    pos.y = this.getTerrainHeight(pos.x, pos.z);

    if (this.app.pedestrianSystem) {
      this.registerPedestrianInWorld(ped, pos, rotY);

      // Release the vehicle before taking pedestrian control. Doing this in
      // the opposite order makes PedestrianSystem release the same vehicle a
      // second time while switching modes.
      // Camera ownership is independent from input ownership, so restore both
      // through the same lifecycle used by collision-driven rider ejection.
      this.resumePedestrianControl(v, ped);
    }

    v.info['Driver'] = 'None (Exited)';
    if (v.driverPedestrian === ped) v.driverPedestrian = null;
    ped.info['Activity'] = 'Walking streets';

    // If no pedestrian system is available, still return the vehicle to AI.
    if (!this.app.pedestrianSystem) {
      this.releaseControl(v);
    }
    return true;
  }

  getTerrainHeight(x, z) {
    const pedestrians = this.app && this.app.pedestrianSystem;
    if (pedestrians && typeof pedestrians.getTerrainHeight === 'function') {
      return pedestrians.getTerrainHeight(x, z);
    }
    if (this.app && this.app.cityBuilder && typeof this.app.cityBuilder.getHillHeight === 'function' && x >= 420) {
      return this.app.cityBuilder.getHillHeight(x, z) + 0.05;
    }
    return 0.05;
  }

  registerPedestrianInWorld(pedestrian, position, rotationY = 0) {
    const pedestrianSystem = this.app?.pedestrianSystem;
    const scene = this.app?.sceneManager?.scene;
    if (
      !pedestrian?.mesh
      || !Array.isArray(pedestrianSystem?.pedestrians)
      || !scene
      || !position?.isVector3
    ) return false;

    pedestrian.mesh.position.copy(position);
    pedestrian.mesh.rotation.y = Number.isFinite(rotationY) ? rotationY : 0;
    pedestrian.mesh.visible = true;
    if (!pedestrianSystem.pedestrians.includes(pedestrian)) {
      pedestrianSystem.pedestrians.push(pedestrian);
    }
    if (!pedestrian.mesh.parent) scene.add(pedestrian.mesh);
    this.app.inspectorHud?.registerObject?.(pedestrian.mesh, pedestrian);
    this.assignNearestPedestrianNode(pedestrian, position);
    return true;
  }

  assignNearestPedestrianNode(pedestrian, position) {
    const nodes = Array.from(this.app?.pedestrianSystem?.nodes?.values?.() || []);
    if (!pedestrian || !position?.isVector3 || nodes.length === 0) return false;
    let closest = nodes[0];
    let minDistanceSq = position.distanceToSquared(closest.pos);
    for (let i = 1; i < nodes.length; i += 1) {
      const distanceSq = position.distanceToSquared(nodes[i].pos);
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
        closest = nodes[i];
      }
    }
    pedestrian.currentNode = closest;
    pedestrian.targetNode = closest.nextNodes?.[0] || closest;
    return true;
  }

  resumePedestrianControl(vehicle, pedestrian) {
    if (!vehicle || !pedestrian || !this.app?.pedestrianSystem) return false;
    this.releaseControl(vehicle);
    const resumed = this.app.pedestrianSystem.toggleUserControl(pedestrian);
    if (!resumed) return false;
    this.app.sceneManager?.startFollowTarget?.(pedestrian);
    this.app.uiManager?.hideInspector?.();
    return true;
  }

  ejectMotorbikeRider(impact) {
    const { motorbike, impactor, direction, closingSpeed } = impact || {};
    const pedestrianSystem = this.app?.pedestrianSystem;
    if (
      !motorbike?.mountedRider
      || !direction?.isVector3
      || !Number.isFinite(closingSpeed)
      || !pedestrianSystem?.knockDownPedestrian
      || !Array.isArray(pedestrianSystem.pedestrians)
      || !this.app?.sceneManager?.scene
    ) return false;

    const rider = motorbike.mountedRider;
    const controlSession = this.controlledVehicle === motorbike ? this.controlSession : null;
    const restoreUserControl = controlSession?.source === 'pedestrian'
      && controlSession.pedestrian === rider;
    motorbike.unmountRider();

    const riderPosition = motorbike.mesh.position.clone().addScaledVector(
      direction,
      MOTORBIKE_RIDER_EJECTION.riderSpawnOffset
    );
    riderPosition.y = this.getTerrainHeight(riderPosition.x, riderPosition.z);
    if (!this.registerPedestrianInWorld(rider, riderPosition, motorbike.mesh.rotation.y)) {
      return false;
    }

    if (restoreUserControl) this.resumePedestrianControl(motorbike, rider);
    motorbike.speed = 0;
    motorbike.targetSpeed = 0;
    motorbike.crashed = true;
    motorbike.crashTimer = MOTORBIKE_RIDER_EJECTION.bikeCrashDuration;
    motorbike.mesh.rotation.z = direction.x >= 0 ? -1.05 : 1.05;
    motorbike.info.Status = 'Rider ejected';
    motorbike.driverPedestrian = null;

    pedestrianSystem.knockDownPedestrian(rider, direction, closingSpeed);
    rider.info.Activity = '💥 Knocked off motorbike';
    this.app.uiManager?.addAlert?.(
      `🏍️ ${rider.name || 'Motorbike rider'} was knocked off by ${impactor?.name || 'a vehicle'}!`,
      'warn'
    );
    return true;
  }

  handleRiderEjection(vehicleA, vehicleB, separationNormal) {
    const impacts = [
      getRiderEjectionImpact(vehicleB, vehicleA, separationNormal),
      getRiderEjectionImpact(vehicleA, vehicleB, separationNormal?.clone?.().negate())
    ];
    let ejected = false;
    for (const impact of impacts) {
      if (impact) ejected = this.ejectMotorbikeRider(impact) || ejected;
    }
    return ejected;
  }

  moveVehicleHorizontally(vehicle, offset) {
    const body = vehicle?.physicsVehicle?.chassisBody;
    if (body) {
      body.position.x += offset.x;
      body.position.z += offset.z;
      body.aabbNeedsUpdate = true;
      vehicle.mesh.position.x = body.position.x;
      vehicle.mesh.position.z = body.position.z;
      return;
    }
    vehicle.mesh.position.add(offset);
    if (vehicle.physicsBody) {
      vehicle.physicsBody.position.x = vehicle.mesh.position.x;
      vehicle.physicsBody.position.z = vehicle.mesh.position.z;
      vehicle.physicsBody.aabbNeedsUpdate = true;
    }
  }

  resolveVehicleOverlap(vehicleA, vehicleB, { playerContact = false } = {}) {
    const separation = getVehicleSeparation(vehicleA, vehicleB);
    if (!separation) return false;
    this.handleRiderEjection(vehicleA, vehicleB, separation.normal);
    const aMovable = !vehicleA.isParked || vehicleA.userControlled;
    const bMovable = !vehicleB.isParked || vehicleB.userControlled;
    const neitherMovable = !aMovable && !bMovable;
    const aShare = neitherMovable ? 0.5 : (aMovable ? (bMovable ? 0.5 : 1) : 0);
    const bShare = neitherMovable ? 0.5 : (bMovable ? (aMovable ? 0.5 : 1) : 0);
    this.moveVehicleHorizontally(vehicleA, separation.normal.clone().multiplyScalar(separation.depth * aShare));
    this.moveVehicleHorizontally(vehicleB, separation.normal.clone().multiplyScalar(-separation.depth * bShare));

    const removeInwardVelocity = (vehicle, normal) => {
      const body = vehicle.physicsVehicle?.chassisBody;
      if (!body) return;
      const inwardSpeed = body.velocity.x * normal.x + body.velocity.z * normal.z;
      if (inwardSpeed < 0) {
        body.velocity.x -= normal.x * inwardSpeed;
        body.velocity.z -= normal.z * inwardSpeed;
      }
      body.angularVelocity.x *= 0.45;
      body.angularVelocity.z *= 0.45;
    };
    removeInwardVelocity(vehicleA, separation.normal);
    removeInwardVelocity(vehicleB, separation.normal.clone().negate());
    if (playerContact) vehicleB.speed = Math.max(0, Number(vehicleB.speed || 0) * 0.65);
    return true;
  }

  resolveUserVehicleContact(player, other) {
    const physicsVehicle = player?.physicsVehicle;
    const body = physicsVehicle?.chassisBody;
    if (!body || !other?.mesh || other === player) return false;
    return this.resolveVehicleOverlap(player, other, { playerContact: true });
  }

  isOnPrimaryBridge(vehicle) {
    const position = vehicle?.mesh?.position;
    return Boolean(
      position
      && position.x >= 100
      && position.x <= 210
      && Math.abs(position.z) <= 16
    );
  }

  toggleBridgePriority(forceEnabled = null) {
    this.bridgePriorityEnabled = forceEnabled == null
      ? !this.bridgePriorityEnabled
      : Boolean(forceEnabled);

    for (const vehicle of this.vehicles) {
      if (!this.isOnPrimaryBridge(vehicle) || !vehicle.info || vehicle.userControlled) continue;
      vehicle.info.Status = this.bridgePriorityEnabled
        ? 'Bridge Priority Lane'
        : 'Cruising';
    }

    return this.bridgePriorityEnabled;
  }

  getCongestionMetrics() {
    const activeVehicles = this.vehicles.filter(vehicle => !vehicle.isParked);
    if (activeVehicles.length === 0) {
      return {
        index: 0,
        activeVehicles: 0,
        stoppedVehicles: 0,
        crashedVehicles: 0,
        bridge: { index: 0, vehicles: 0, stoppedVehicles: 0 },
        hotspots: []
      };
    }

    let stoppedVehicles = 0;
    let crashedVehicles = 0;
    let bridgeVehicles = 0;
    let bridgeStoppedVehicles = 0;

    for (const vehicle of activeVehicles) {
      const stopped = Math.abs(vehicle.speed || 0) < 1;
      const crashed = Boolean(vehicle.crashed || vehicle.onFire);
      if (stopped) stoppedVehicles += 1;
      if (crashed) crashedVehicles += 1;
      if (this.isOnPrimaryBridge(vehicle)) {
        bridgeVehicles += 1;
        if (stopped || crashed) bridgeStoppedVehicles += 1;
      }
    }

    const congestionWeight = stoppedVehicles + crashedVehicles * 2;
    return {
      index: Math.max(0, Math.min(1, congestionWeight / activeVehicles.length)),
      activeVehicles: activeVehicles.length,
      stoppedVehicles,
      crashedVehicles,
      bridge: {
        index: bridgeVehicles === 0 ? 0 : bridgeStoppedVehicles / bridgeVehicles,
        vehicles: bridgeVehicles,
        stoppedVehicles: bridgeStoppedVehicles
      },
      hotspots: (this.app?.trafficHeatmapSystem?.hotspots || []).slice(0, 5)
    };
  }

  registerRoadSegment(building, spec = building?.spec) {
    if (!building?.plot || spec?.generatorType !== 'ROAD_SEGMENT') return false;
    const id = String(building.economyId || building.id || `road-${this.placedRoadSegments.size + 1}`);
    if (this.placedRoadSegments.has(id)) return false;

    const center = new THREE.Vector3(building.plot.x, 0, building.plot.z);
    const rotationY = building.group?.rotation?.y || 0;
    const halfWidth = Math.max(5, Number(building.plot.width || spec.footprint?.width || 30) * 0.5);
    const halfDepth = Math.max(5, Number(building.plot.depth || spec.footprint?.depth || 30) * 0.5);
    const directions = spec.roadType === 'INTERSECTION'
      ? [
          { suffix: 'N', offset: new THREE.Vector3(0, 0, -halfDepth) },
          { suffix: 'S', offset: new THREE.Vector3(0, 0, halfDepth) },
          { suffix: 'E', offset: new THREE.Vector3(halfWidth, 0, 0) },
          { suffix: 'W', offset: new THREE.Vector3(-halfWidth, 0, 0) }
        ]
      : [
          { suffix: 'N', offset: new THREE.Vector3(0, 0, -halfDepth) },
          { suffix: 'S', offset: new THREE.Vector3(0, 0, halfDepth) }
        ];

    const centerNode = new TrafficNode(`USER_ROAD:${id}:CENTER`, center.x, center.z);
    const segmentNodes = [centerNode];
    this.nodes.set(centerNode.id, centerNode);

    for (const { suffix, offset } of directions) {
      offset.applyAxisAngle(UP_AXIS, rotationY);
      const endpoint = center.clone().add(offset);
      const endpointNode = new TrafficNode(`USER_ROAD:${id}:${suffix}`, endpoint.x, endpoint.z);
      endpointNode.nextNodes.push(centerNode);
      centerNode.nextNodes.push(endpointNode);
      segmentNodes.push(endpointNode);
      this.nodes.set(endpointNode.id, endpointNode);
    }

    const segmentNodeSet = new Set(segmentNodes);
    for (const endpointNode of segmentNodes.slice(1)) {
      const nearest = [...this.nodes.values()]
        .filter(node => !segmentNodeSet.has(node))
        .map(node => ({ node, distance: node.pos.distanceTo(endpointNode.pos) }))
        .filter(candidate => candidate.distance <= 38)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 2);
      for (const { node } of nearest) {
        if (!endpointNode.nextNodes.includes(node)) endpointNode.nextNodes.push(node);
        if (!node.nextNodes.includes(endpointNode)) node.nextNodes.push(endpointNode);
      }
    }

    building.trafficRoadId = id;
    this.placedRoadSegments.set(id, {
      id,
      building,
      spec,
      nodes: segmentNodes,
      connected: segmentNodes.some(node => node.nextNodes.some(next => !segmentNodeSet.has(next)))
    });
    return this.placedRoadSegments.get(id);
  }

  unregisterRoadSegment(building) {
    const id = String(building?.trafficRoadId || building?.economyId || building?.id || '');
    const record = this.placedRoadSegments.get(id);
    if (!record) return false;

    const removedNodes = new Set(record.nodes);
    for (const node of this.nodes.values()) {
      node.nextNodes = node.nextNodes.filter(nextNode => !removedNodes.has(nextNode));
    }
    for (const node of record.nodes) this.nodes.delete(node.id);
    this.placedRoadSegments.delete(id);

    const remainingNodes = [...this.nodes.values()].filter(node => node.nextNodes.length > 0);
    for (const vehicle of this.vehicles) {
      if (!removedNodes.has(vehicle.currentNode) && !removedNodes.has(vehicle.targetNode)) continue;
      let closestNode = null;
      let closestDistance = Infinity;
      for (const node of remainingNodes) {
        const distance = vehicle.mesh.position.distanceTo(node.pos);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestNode = node;
        }
      }
      vehicle.currentNode = closestNode;
      vehicle.targetNode = closestNode?.nextNodes?.[0] || closestNode;
    }
    return true;
  }

  cullVehicle(v) {
    if (!v) return;
    const wasControlled = this.controlledVehicle === v || v.userControlled;
    if (wasControlled) this.releaseControl(v);

    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) prompt.classList.add('hidden');

    if (this.app && this.app.sceneManager) {
      if (this.app.sceneManager.followTarget === v || this.app.sceneManager.activePreset === 'FREE_ORBIT') {
        this.app.sceneManager.breakToFreeOrbit();
      }
    }
    // Water is a recoverable out-of-bounds condition. Reuse the entity rather
    // than permanently shrinking the promised 48-vehicle simulation.
    v.isParked = false;
    this.respawnVehicle(v, true);
    if (this.app && this.app.uiManager && this.app.uiManager.addAlert) {
      this.app.uiManager.addAlert(wasControlled ? '🌊 Vehicle recovered from the river; direct control released.' : '🚗 Traffic vehicle recovered to the road network.', 'warn');
    }
  }

  igniteVehicle(vehicle, { delay = this.chainReactionDelay } = {}) {
    if (!vehicle?.mesh || vehicle.isDestroyed || vehicle.onFire) return false;
    vehicle.onFire = true;
    vehicle.fireTimer = Math.max(0.25, Number(delay) || this.chainReactionDelay);
    vehicle.crashed = false;
    vehicle.speed = 0;
    vehicle.targetSpeed = 0;
    vehicle.info.Status = '🔥 ON FIRE!';

    const fireGeo = new THREE.SphereGeometry(1.2, 8, 8);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.7 });
    vehicle.fireMesh = new THREE.Mesh(fireGeo, fireMat);
    vehicle.fireMesh.position.y = 2;
    vehicle.mesh.add(vehicle.fireMesh);
    return true;
  }

  explodeVehicle(vehicle) {
    if (!vehicle?.mesh || vehicle.isDestroyed) return false;
    const origin = vehicle.mesh.position.clone();
    if (vehicle.hitAndRunState) this.clearHitAndRunPursuit(vehicle);
    if (this.controlledVehicle === vehicle || vehicle.userControlled) {
      this.releaseControl(vehicle);
    }
    vehicle.onFire = false;
    vehicle.isDestroyed = true;
    vehicle.destroyedTimer = this.destroyedVehicleLifetime;
    vehicle.crashed = true;
    vehicle.crashTimer = this.destroyedVehicleLifetime;
    vehicle.speed = 0;
    vehicle.targetSpeed = 0;
    vehicle.info.Status = '💥 DESTROYED';
    vehicle.info.Damage = '💥 Wrecked';
    if (vehicle.fireMesh) {
      vehicle.mesh.remove(vehicle.fireMesh);
      vehicle.fireMesh.geometry.dispose();
      vehicle.fireMesh.material.dispose();
      vehicle.fireMesh = null;
    }
    this.app.explosionManager?.createExplosion?.(origin);
    this.app.audioSystem?.playExplosion?.();

    if (!vehicle.chainReactionTriggered) {
      vehicle.chainReactionTriggered = true;
      const radiusSq = this.chainReactionRadius ** 2;
      for (const other of this.vehicles) {
        if (other === vehicle || other.isDestroyed || other.onFire || !other.mesh) continue;
        if (other.mesh.position.distanceToSquared(origin) <= radiusSq) {
          this.igniteVehicle(other);
        }
      }
    }
    this.dispatchPolice(origin);
    return true;
  }

  removeDestroyedVehicle(vehicle) {
    if (!vehicle || !this.vehicles.includes(vehicle)) return false;
    if (vehicle.hitAndRunState) this.clearHitAndRunPursuit(vehicle);
    if (this.controlledVehicle === vehicle) this.releaseControl(vehicle);
    if (vehicle.mountedRider) vehicle.unmountRider();
    if (vehicle.fireMesh) {
      vehicle.mesh.remove(vehicle.fireMesh);
      vehicle.fireMesh.geometry.dispose();
      vehicle.fireMesh.material.dispose();
      vehicle.fireMesh = null;
    }
    vehicle.physicsVehicle?.destroy?.();
    vehicle.physicsVehicle = null;
    if (vehicle.physicsBody) this.app.physicsWorld?.removeKinematicCollider?.(vehicle.physicsBody);
    this.app.inspectorHud?.unregisterObject?.(vehicle.mesh);
    vehicle.mesh.parent?.remove(vehicle.mesh);
    const index = this.vehicles.indexOf(vehicle);
    this.vehicles.splice(index, 1);
    return true;
  }

  updateUserControlledVehicle(v, delta) {
    if (!this.keys) return;

    if (this.app.cityBuilder && this.app.cityBuilder.isInWater(v.mesh.position)) {
      if (this.app.audioSystem && this.app.audioSystem.playSplash) {
        this.app.audioSystem.playSplash();
      }
      if (this.app.sceneManager) {
        this.app.sceneManager.breakToFreeOrbit();
      }
      this.cullVehicle(v);
      return;
    }

    // Check reset key 'r' to flip upright if rolled over
    if (this.keys['r'] && v.physicsVehicle) {
      v.physicsVehicle.resetPosition();
    }

    // Delegate to cannon-es physics vehicle if active
    if (v.physicsVehicle) {
      const autoRecovered = v.physicsVehicle.applyInput(this.keys, delta);
      v.physicsVehicle.syncMesh();
      v.speed = v.physicsVehicle.speedKmH / 3.6;
      Object.assign(v.info, v.physicsVehicle.info);
      if (autoRecovered) {
        this.app.uiManager?.showToast?.('Vehicle repositioned on the last safe road surface', 'warn');
      }

      if (this.app.audioSystem) {
        this.app.audioSystem.updateEngineSound(v.physicsVehicle.speedKmH, v.maxSpeed * 3.6);
      }

      // AI kinematic bodies are intentionally excluded from wheel/chassis
      // raycasts. Resolve vehicle contact once in the horizontal plane so a
      // traffic jam cannot roll or launch the player on a narrow bridge.
      if (v.bumpCooldown > 0) {
        v.bumpCooldown -= delta;
      }
      const collisionCandidates = this.app.performanceSystem?.nearbyVehicles(v.mesh.position, 8) || this.vehicles;
      for (const other of collisionCandidates) {
        if (other === v) continue;
        if (this.resolveUserVehicleContact(v, other)) {
          if (v.bumpCooldown <= 0) {
            v.bumpCooldown = 0.55;
            if (Math.abs(v.speed) > 8.0 && this.app.pedestrianSystem && typeof this.app.pedestrianSystem.reportCrime === 'function') {
              this.app.pedestrianSystem.reportCrime(v.mesh.position, 'Reckless vehicle ramming reported');
            }
            const audio = this.app?.audioSystem;
            if (audio) {
              audio.playBump();
              const isPolice = other.isPolice;
              setTimeout(() => {
                if (isPolice) {
                  audio.playSiren(1.5);
                } else {
                  audio.playHonk(true);
                }
              }, 80);
            }
          }
        }
      }

      // Check collision with pedestrians (knockback onto ground)
      if (this.app.pedestrianSystem && this.app.pedestrianSystem.pedestrians) {
        const nearbyPedestrians = this.app.performanceSystem?.nearbyPedestrians(v.mesh.position, 3.2) || this.app.pedestrianSystem.pedestrians;
        for (const ped of nearbyPedestrians) {
          if (ped.knockedDown) continue;
          if (Math.abs(v.speed) > 1.5 && v.mesh.position.distanceTo(ped.mesh.position) < 3.2) {
            const knockDir = ped.mesh.position.clone().sub(v.mesh.position).normalize();
            this.app.pedestrianSystem.knockDownPedestrian(ped, knockDir, v.speed);
            if (Math.abs(v.speed) > 2.0 && typeof this.app.pedestrianSystem.reportCrime === 'function') {
              this.app.pedestrianSystem.reportCrime(v.mesh.position, 'Hit-and-run reported');
            }
          }
        }
      }

      return;
    }

    const dialogueOpen = this.app.dialogueOverlay && this.app.dialogueOverlay.currentMission != null;
    const isForward = !dialogueOpen && (this.keys['w'] || this.keys['arrowup']);
    const isReverse = !dialogueOpen && (this.keys['s'] || this.keys['arrowdown']);
    const isLeft = !dialogueOpen && (this.keys['a'] || this.keys['arrowleft']);
    const isRight = !dialogueOpen && (this.keys['d'] || this.keys['arrowright']);

    const userMaxSpeed = v.maxSpeed * 1.35; // A bit faster for manual driving

    // 1. Acceleration / Braking / Reverse
    if (dialogueOpen) {
      v.speed = THREE.MathUtils.lerp(v.speed, 0, delta * 8);
    } else if (isForward) {
      v.speed = Math.min(userMaxSpeed, v.speed + v.acceleration * 1.8 * delta);
    } else if (isReverse) {
      if (v.speed > 0) {
        v.speed = Math.max(-12, v.speed - v.acceleration * 3.0 * delta); // Brake
      } else {
        v.speed = Math.max(-12, v.speed - v.acceleration * 1.5 * delta); // Reverse
      }
    } else {
      // Natural engine deceleration / friction
      if (v.speed > 0) {
        v.speed = Math.max(0, v.speed - 9.0 * delta);
      } else if (v.speed < 0) {
        v.speed = Math.min(0, v.speed + 9.0 * delta);
      }
    }

    // Save previous state before movement/steering
    const oldPos = v.mesh.position.clone();
    const oldRotY = v.mesh.rotation.y;

    // 2. Steering (Turning Left / Right when moving)
    if (Math.abs(v.speed) > 0.2) {
      const turnDir = v.speed > 0 ? 1 : -1;
      const steerSpeed = 2.8 * delta * turnDir;
      if (isLeft) {
        v.mesh.rotation.y += steerSpeed;
      }
      if (isRight) {
        v.mesh.rotation.y -= steerSpeed;
      }
    }

    // 3. Move vehicle along its orientation
    const moveStep = v.speed * delta;
    v.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
    v.mesh.position.y = this.getTerrainHeight(v.mesh.position.x, v.mesh.position.z);

    // 4. Solid Obstacle Collision Check (Buildings & Lamp Posts!)
    let hitObstacle = false;

    // Check Buildings
    if (this.app.buildingFactory && this.app.buildingFactory.buildings) {
      const pos = v.mesh.position;
      for (const b of this.app.buildingFactory.buildings) {
        if (b.isDestroyed) continue; // Can drive over destroyed rubble

        const minX = b.plot.x - (b.plot.width - 4) / 2 - 1.8;
        const maxX = b.plot.x + (b.plot.width - 4) / 2 + 1.8;
        const minZ = b.plot.z - (b.plot.depth - 4) / 2 - 1.8;
        const maxZ = b.plot.z + (b.plot.depth - 4) / 2 + 1.8;

        if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
          if (this.app.funMode && Math.abs(v.speed) > 14) {
            // In Fun Mode, high speed impact destroys building into rubble!
            this.app.buildingFactory.destroyBuilding(b);
            if (this.app.audioSystem) {
              this.app.audioSystem.playExplosion();
            }
            if (this.app.sceneManager) {
              this.app.sceneManager.triggerShake(0.35);
            }
            v.speed *= 0.3;
          } else {
            hitObstacle = true;
          }
          break;
        }
      }
    }

    // Check Lamp Posts
    if (!hitObstacle && this.app.cityBuilder && this.app.cityBuilder.streetlamps) {
      const pos = v.mesh.position;
      for (const lamp of this.app.cityBuilder.streetlamps) {
        if (lamp.pos && pos.distanceTo(lamp.pos) < 1.8) {
          hitObstacle = true;
          break;
        }
      }
    }

    // Traffic lights and stop signs use the same solid post footprint in both
    // physics and fallback movement modes.
    if (!hitObstacle && this.trafficControlSystem?.intersectsPost?.(v.mesh.position, 1.25)) {
      hitObstacle = true;
    }

    if (hitObstacle) {
      // Solid Obstacle Collision! Revert position and rotation so vehicle cannot penetrate wall or lamp post!
      v.mesh.position.copy(oldPos);
      v.mesh.rotation.y = oldRotY;

      if (Math.abs(v.speed) > 2.0 && this.app.audioSystem && Math.random() < 0.4) {
        this.app.audioSystem.playBump();
      }

      v.speed = -v.speed * 0.35; // Bounce back off obstacle
    }

    // 5. Check collision with other cars while manual driving (bounce effect + angry honk!)
    if (v.bumpCooldown > 0) {
      v.bumpCooldown -= delta;
    } else {
      for (const other of this.vehicles) {
        if (other === v) continue;
        if (v.mesh.position.distanceTo(other.mesh.position) < 3.8) {
          if (this.app.funMode && Math.abs(v.speed) > 13) {
            other.crashed = true;
            other.crashTimer = 10.0;
            if (this.app.audioSystem) this.app.audioSystem.playExplosion();
            if (this.app.explosionManager) this.app.explosionManager.createExplosion(other.mesh.position.clone());
            v.bumpCooldown = 0.5;
          } else {
            // CAR-TO-CAR COLLISION BOUNCE EFFECT!
            const bumpDir = other.mesh.position.clone().sub(v.mesh.position);
            bumpDir.y = 0;
            if (bumpDir.lengthSq() === 0) bumpDir.set(1, 0, 0);
            bumpDir.normalize();

            // Knock both vehicles slightly away from each other
            other.mesh.position.add(bumpDir.clone().multiplyScalar(0.85));
            v.mesh.position.add(bumpDir.clone().multiplyScalar(-0.65));

            // Bounce speed
            other.speed = Math.sign(v.speed || 1) * Math.max(6, Math.abs(v.speed) * 0.5);
            v.speed = -v.speed * 0.45; // Bounce player backward

            v.bumpCooldown = 0.6; // Cooldown to prevent spamming

            // Play collision bump and the other car honking at you!
            const audio = this.app?.audioSystem;
            if (audio) {
              audio.playBump();
              const isPolice = other.isPolice;
              setTimeout(() => {
                if (isPolice) {
                  audio.playSiren(1.5);
                } else {
                  audio.playHonk();
                }
              }, 80); // Cinematic 80ms delay for driver reaction
            }

            if (other.info) {
              other.info['Status'] = 'Honking at Driver!';
              other.info['Mood'] = 'Annoyed & Honking 😡';
            }
          }
          break;
        }
      }
    }
  }

  initWaypoints() {
    const coordsX = this.roadCoordsX;
    const coordsZ = this.roadCoordsZ;
    const off = this.laneOffset;

    for (const rx of coordsX) {
      for (const rz of coordsZ) {
        this.nodes.set(`EB_IN:${rx},${rz}`, new TrafficNode(`EB_IN:${rx},${rz}`, rx - 10, rz + off));
        this.nodes.set(`EB_OUT:${rx},${rz}`, new TrafficNode(`EB_OUT:${rx},${rz}`, rx + 10, rz + off));

        this.nodes.set(`WB_IN:${rx},${rz}`, new TrafficNode(`WB_IN:${rx},${rz}`, rx + 10, rz - off));
        this.nodes.set(`WB_OUT:${rx},${rz}`, new TrafficNode(`WB_OUT:${rx},${rz}`, rx - 10, rz - off));

        this.nodes.set(`SB_IN:${rx},${rz}`, new TrafficNode(`SB_IN:${rx},${rz}`, rx - off, rz - 10));
        this.nodes.set(`SB_OUT:${rx},${rz}`, new TrafficNode(`SB_OUT:${rx},${rz}`, rx - off, rz + 10));

        this.nodes.set(`NB_IN:${rx},${rz}`, new TrafficNode(`NB_IN:${rx},${rz}`, rx + off, rz + 10));
        this.nodes.set(`NB_OUT:${rx},${rz}`, new TrafficNode(`NB_OUT:${rx},${rz}`, rx + off, rz - 10));
      }
    }

    // Link East-West streets across intersections and river bridge
    for (let i = 0; i < coordsX.length - 1; i++) {
      const c1 = coordsX[i];
      const c2 = coordsX[i + 1];

      for (const rz of coordsZ) {
        // River 1 (100 to 210) only has a bridge at rz === 0. Countryside River (310 to 450) has bridges at all 5 rz values.
        if (c1 === 100 && c2 === 210 && rz !== 0) {
          continue;
        }

        const ebOut = this.nodes.get(`EB_OUT:${c1},${rz}`);
        const ebIn = this.nodes.get(`EB_IN:${c2},${rz}`);
        if (ebOut && ebIn) ebOut.nextNodes.push(ebIn);

        const wbOut = this.nodes.get(`WB_OUT:${c2},${rz}`);
        const wbIn = this.nodes.get(`WB_IN:${c1},${rz}`);
        if (wbOut && wbIn) wbOut.nextNodes.push(wbIn);
      }
    }

    // Link North-South streets
    for (let i = 0; i < coordsZ.length - 1; i++) {
      const c1 = coordsZ[i];
      const c2 = coordsZ[i + 1];

      for (const rx of coordsX) {
        const sbOut = this.nodes.get(`SB_OUT:${rx},${c1}`);
        const sbIn = this.nodes.get(`SB_IN:${rx},${c2}`);
        if (sbOut && sbIn) sbOut.nextNodes.push(sbIn);

        const nbOut = this.nodes.get(`NB_OUT:${rx},${c2}`);
        const nbIn = this.nodes.get(`NB_IN:${rx},${c1}`);
        if (nbOut && nbIn) nbOut.nextNodes.push(nbIn);
      }
    }

    const canDriveEast = (rx, rz) => rx !== 100 || rz === 0;
    const canDriveWest = (rx, rz) => rx !== 210 || rz === 0;

    for (const rx of coordsX) {
      for (const rz of coordsZ) {
        const ebIn = this.nodes.get(`EB_IN:${rx},${rz}`);
        if (ebIn) {
          if (rx < 750 && canDriveEast(rx, rz)) ebIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rz < 100) ebIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rz > -100) ebIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
        }

        const wbIn = this.nodes.get(`WB_IN:${rx},${rz}`);
        if (wbIn) {
          if (rx > -100 && canDriveWest(rx, rz)) wbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rz > -100) wbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rz < 100) wbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
        }

        const sbIn = this.nodes.get(`SB_IN:${rx},${rz}`);
        if (sbIn) {
          if (rz < 100) sbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rx > -100 && canDriveWest(rx, rz)) sbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rx < 750 && canDriveEast(rx, rz)) sbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
        }

        const nbIn = this.nodes.get(`NB_IN:${rx},${rz}`);
        if (nbIn) {
          if (rz > -100) nbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rx < 750 && canDriveEast(rx, rz)) nbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rx > -100 && canDriveWest(rx, rz)) nbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
        }
      }
    }

    // Safety pass: ensure NO dead-end nodes exist in the traffic graph
    for (const node of this.nodes.values()) {
      node.nextNodes = node.nextNodes.filter(Boolean);
      if (node.nextNodes.length === 0) {
        const [dir, coords] = node.id.split(':');
        let fallbackId = null;
        if (dir === 'EB_OUT') fallbackId = `WB_IN:${coords}`;
        else if (dir === 'WB_OUT') fallbackId = `EB_IN:${coords}`;
        else if (dir === 'NB_OUT') fallbackId = `SB_IN:${coords}`;
        else if (dir === 'SB_OUT') fallbackId = `NB_IN:${coords}`;
        else if (dir === 'EB_IN') fallbackId = `WB_OUT:${coords}`;
        else if (dir === 'WB_IN') fallbackId = `EB_OUT:${coords}`;
        else if (dir === 'NB_IN') fallbackId = `SB_OUT:${coords}`;
        else if (dir === 'SB_IN') fallbackId = `NB_OUT:${coords}`;

        const fallback = this.nodes.get(fallbackId);
        if (fallback) {
          node.nextNodes.push(fallback);
        } else {
          for (const other of this.nodes.values()) {
            if (other !== node) {
              node.nextNodes.push(other);
              break;
            }
          }
        }
      }
    }
  }

  spawnVehicles(count) {
    const types = ['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'TAXI', 'POLICE', 'AMBULANCE', 'ICECREAM', 'DUMP_TRUCK', 'SPORTS_CAR', 'MOTORBIKE'];
    const colors = [0xdf0054, 0x00f0ff, 0xffcc00, 0x22ee44, 0xeeeeee, 0x1a1a24, 0xffffff, 0xffe4e1, 0xea580c, 0xff2200, 0xea580c];
    const names = [
      'Cyber Cruiser 2099', 'Apex GT Turbo', 'Metro Transit Bus #42', 'Express Freight Truck',
      'City Yellow Cab #88', 'Metro Police Interceptor #01', 'Metro EMS Rescue Ambulance', 'Sweet Treats Ice Cream Van',
      'Heavy Titan Dump Truck', 'Veloce V10 Supercar', 'Phantom Streetfighter Motorbike'
    ];

    const outNodes = Array.from(this.nodes.values()).filter(n => n.id.includes('_OUT') && n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const serial = this.nextVehicleSerial++;
      const typeIdx = serial % types.length;
      const vType = types[typeIdx];
      const color = colors[serial % colors.length];
      const name = `${names[typeIdx]} #${serial + 10}`;

      const vehicle = new Vehicle(vType, color, name);
      vehicle.crashed = false;
      vehicle.crashTimer = 0;
      vehicle.emergencyTarget = null;
      vehicle.normalMaxSpeed = vehicle.maxSpeed;
      this.assignDriverRuleProfile(vehicle, serial);

      const pedColors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed];
      const pedType = ['BUSINESS', 'CASUAL', 'JOGGER'][serial % 3];
      vehicle.driverPedestrian = new Pedestrian(pedType, pedColors[serial % pedColors.length], `Driver of ${name}`);
      if (vehicle.vType === 'MOTORBIKE' && vehicle.driverPedestrian) {
        vehicle.mountRider(vehicle.driverPedestrian);
      }

      let startNode = outNodes[serial % outNodes.length];
      for (let offset = 0; offset < outNodes.length; offset++) {
        const candidate = outNodes[(serial + offset) % outNodes.length];
        const occupied = this.vehicles.some(existing => existing.mesh.position.distanceTo(candidate.pos) < 6.0);
        if (!occupied) {
          startNode = candidate;
          break;
        }
      }
      vehicle.mesh.position.copy(startNode.pos);
      vehicle.currentNode = startNode;
      vehicle.targetNode = startNode.nextNodes[0];

      if (vehicle.targetNode) {
        vehicle.mesh.lookAt(vehicle.targetNode.pos);
      }

      this.app.sceneManager.scene.add(vehicle.mesh);
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(vehicle.mesh, vehicle);
      }
      if (this.app.physicsWorld) {
        vehicle.physicsBody = this.app.physicsWorld.addKinematicBoxCollider(
          new THREE.Vector3(startNode.pos.x, 1.0, startNode.pos.z),
          new THREE.Vector3(2.1, 1.2, 4.4)
        );
      }
      this.vehicles.push(vehicle);
    }
  }

  dispatchPolice(crashPos) {
    const policeVehicles = this.vehicles.filter(v => v.isPolice && !v.crashed && !v.pursuitTarget);
    
    // Sort police by distance to crash site
    policeVehicles.sort((a, b) => {
      return a.mesh.position.distanceTo(crashPos) - b.mesh.position.distanceTo(crashPos);
    });

    // Dispatch up to 2 closest police cruisers to rush to the crash scene
    const responders = policeVehicles.slice(0, 2);
    for (const p of responders) {
      p.emergencyTarget = crashPos.clone();
      p.maxSpeed = 42; // High speed pursuit/response
      p.targetSpeed = 42;
      p.sirenActive = true;
    }
  }

  handleNpcPedestrianHit(offender, pedestrian) {
    if (
      !offender?.mesh?.position
      || offender.userControlled
      || offender.isPolice
      || offender.isParked
      || offender.crashed
      || offender.isDestroyed
      || offender.hitAndRunState
    ) {
      return false;
    }

    const config = this.hitAndRunPursuitConfig || DEFAULT_HIT_AND_RUN_PURSUIT;
    const origin = pedestrian?.mesh?.position || offender.mesh.position;
    const responders = selectNearbyPolice(this.vehicles, origin, config);
    const state = createHitAndRunState(offender, responders, config);
    offender.hitAndRunState = state;
    offender.maxSpeed = state.escapeSpeed;
    offender.targetSpeed = state.escapeSpeed;
    if (offender.info) {
      offender.info.Status = responders.length > 0 ? '🚨 Fleeing police' : '⚠️ Fleeing hit-and-run';
      offender.info.Mood = 'Panicked & Fleeing';
    }

    for (const police of responders) {
      police.pursuitTarget = offender;
      police.emergencyTarget = offender.mesh.position.clone();
      const responseSpeed = Number.isFinite(config.policeMaxSpeed)
        ? config.policeMaxSpeed
        : DEFAULT_HIT_AND_RUN_PURSUIT.policeMaxSpeed;
      police.maxSpeed = responseSpeed;
      police.targetSpeed = responseSpeed;
      police.sirenActive = true;
      police.sirenTimer = Math.max(police.sirenTimer || 0, 5);
      if (police.info) police.info.Status = '🚨 HIT-AND-RUN PURSUIT';
    }

    const message = responders.length > 0
      ? `🚨 HIT-AND-RUN: ${responders.length} nearby police unit${responders.length === 1 ? '' : 's'} pursuing the vehicle!`
      : '⚠️ HIT-AND-RUN: vehicle fleeing; no nearby police unit available.';
    this.app.uiManager?.addAlert?.(message, responders.length > 0 ? 'danger' : 'warn');
    return true;
  }

  clearHitAndRunPursuit(offender) {
    const state = offender?.hitAndRunState;
    if (!state) return false;
    offender.hitAndRunState = null;
    offender.maxSpeed = state.normalMaxSpeed;
    offender.targetSpeed = state.normalMaxSpeed;
    if (!offender.crashed && !offender.isDestroyed && offender.info) {
      offender.info.Status = 'Cruising';
      offender.info.Mood = 'Relieved';
    }

    for (const police of this.vehicles) {
      if (police?.pursuitTarget !== offender) continue;
      police.pursuitTarget = null;
      police.emergencyTarget = null;
      police.maxSpeed = police.normalMaxSpeed || 20;
      police.targetSpeed = police.maxSpeed;
      police.sirenActive = false;
      police.sirenTimer = 0;
      if (police.info) police.info.Status = 'Cruising';
    }
    return true;
  }

  updateHitAndRunPursuits(delta) {
    for (const offender of this.vehicles) {
      const state = offender?.hitAndRunState;
      if (!state) continue;
      if (offender.crashed || offender.isDestroyed || !advanceHitAndRunState(state, delta)) {
        this.clearHitAndRunPursuit(offender);
        continue;
      }

      offender.maxSpeed = state.escapeSpeed;
      offender.targetSpeed = state.escapeSpeed;
      if (offender.info) offender.info.Status = '🚨 Fleeing police';
      for (const police of state.responders) {
        if (!this.vehicles.includes(police) || police.crashed || police.isDestroyed) continue;
        if (police.pursuitTarget !== offender) continue;
        police.emergencyTarget = offender.mesh.position.clone();
        police.sirenActive = true;
        police.sirenTimer = Math.max(police.sirenTimer || 0, 1);
      }
    }
  }

  updatePoliceEmergencyResponse(vehicle, delta) {
    const pursuitTarget = vehicle.pursuitTarget;
    if (pursuitTarget && (!this.vehicles.includes(pursuitTarget) || pursuitTarget.crashed || pursuitTarget.isDestroyed)) {
      this.clearHitAndRunPursuit(pursuitTarget);
      return false;
    }
    const targetPosition = pursuitTarget?.mesh?.position || vehicle.emergencyTarget;
    if (!targetPosition) return false;
    const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;

    vehicle.emergencyTarget = targetPosition.clone();
    const distance = vehicle.mesh.position.distanceTo(targetPosition);
    if (!pursuitTarget && distance < 10) {
      vehicle.speed = 0;
      vehicle.targetSpeed = 0;
    } else {
      vehicle.targetSpeed = pursuitTarget
        ? getPursuitSpeed(vehicle, pursuitTarget, distance, this.hitAndRunPursuitConfig)
        : vehicle.maxSpeed;
      if (vehicle.speed < vehicle.targetSpeed) {
        vehicle.speed = Math.min(vehicle.targetSpeed, vehicle.speed + vehicle.acceleration * 2 * safeDelta);
      } else if (vehicle.speed > vehicle.targetSpeed) {
        vehicle.speed = Math.max(vehicle.targetSpeed, vehicle.speed - vehicle.acceleration * 2.4 * safeDelta);
      }

      const navigationTarget = this.getPursuitNavigationTarget(vehicle, targetPosition);
      const direction = navigationTarget.clone().sub(vehicle.mesh.position);
      direction.y = 0;
      if (direction.lengthSq() > 1e-6) {
        direction.normalize();
        const targetAngle = Math.atan2(direction.x, direction.z);
        let difference = targetAngle - vehicle.mesh.rotation.y;
        while (difference < -Math.PI) difference += Math.PI * 2;
        while (difference > Math.PI) difference -= Math.PI * 2;
        vehicle.mesh.rotation.y += difference * 8 * safeDelta;
      }

      vehicle.mesh.translateOnAxis(FORWARD_AXIS, vehicle.speed * safeDelta);
      enforceLaneCorridor(vehicle, this.navigationConfig);
      vehicle.mesh.position.y = this.app.pedestrianSystem
        ? this.app.pedestrianSystem.getTerrainHeight(vehicle.mesh.position.x, vehicle.mesh.position.z) - 0.05
        : 0;
    }
    vehicle.sirenActive = true;
    vehicle.sirenTimer = Math.max(vehicle.sirenTimer || 0, 1);
    vehicle.update(safeDelta);
    return true;
  }

  getPursuitNavigationTarget(vehicle, offenderPosition) {
    const currentTarget = vehicle?.targetNode;
    if (!currentTarget?.pos) return offenderPosition;
    if (hasReachedNavigationTarget(vehicle)) {
      vehicle.currentNode = currentTarget;
      const candidates = currentTarget.nextNodes?.filter(node => node?.pos) || [];
      if (candidates.length > 0) {
        vehicle.targetNode = candidates.reduce((best, node) => (
          node.pos.distanceToSquared(offenderPosition) < best.pos.distanceToSquared(offenderPosition)
            ? node
            : best
        ));
      }
    }
    return vehicle.targetNode?.pos || offenderPosition;
  }

  findBlockingPedestrian(vehicle, maxDistance = null) {
    const pedestrians = this.app.pedestrianSystem?.pedestrians || [];
    if (!vehicle?.mesh || pedestrians.length === 0) return null;
    const detectionDistance = Number.isFinite(maxDistance)
      ? Math.max(1, maxDistance)
      : getPedestrianYieldKinematics(vehicle).detectionDistance;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    let closest = null;
    let closestDistance = detectionDistance;
    for (const pedestrian of pedestrians) {
      if (!pedestrian?.mesh || pedestrian.knockedDown || pedestrian.isHijacking) continue;
      const offset = pedestrian.mesh.position.clone().sub(vehicle.mesh.position);
      offset.y = 0;
      const distance = offset.length();
      if (distance >= closestDistance) continue;
      const forwardDistance = offset.dot(forward);
      const lateralDistance = Math.abs(offset.dot(right));
      if (forwardDistance < -1.2 || forwardDistance > detectionDistance || lateralDistance > 1.9) continue;
      closest = { pedestrian, distance, forwardDistance, lateralDistance };
      closestDistance = distance;
    }
    return closest;
  }

  updatePedestrianYield(vehicle, delta) {
    if (!vehicle || vehicle.isParked || vehicle.emergencyTarget || vehicle.hitAndRunState || vehicle.crashed) {
      vehicle && (vehicle.pedestrianYieldState = null);
      return false;
    }
    const blocker = this.findBlockingPedestrian(vehicle);
    if (!blocker) {
      vehicle.pedestrianYieldState = null;
      return false;
    }

    let state = vehicle.pedestrianYieldState;
    if (!state || state.pedestrian !== blocker.pedestrian) {
      state = vehicle.pedestrianYieldState = createPedestrianTrafficState(
        blocker.pedestrian,
        this.random,
        { impatienceProbability: this.pedestrianImpatienceProbability }
      );
    }
    const action = updatePedestrianTrafficState(state, delta, {
      impatienceDelay: this.pedestrianImpatienceDelay
    });
    state.forwardDistance = blocker.forwardDistance;

    if (action.shouldYield) {
      const emergencyStopDistance = getPedestrianEmergencyStopDistance(vehicle);
      if (blocker.forwardDistance <= emergencyStopDistance) vehicle.speed = 0;
      vehicle.info.Status = state.impatient ? 'Waiting behind pedestrian' : 'Yielding to pedestrian';
      vehicle.info.Mood = state.impatient ? 'Growing Impatient' : 'Waiting Patiently';
      return true;
    }

    if (action.shouldHonk) {
      this.app.audioSystem?.playHonk?.(true);
    }
    vehicle.info.Status = '⚠️ Impatient driver proceeding';
    vehicle.info.Mood = 'Impatient & Proceeding';
    return false;
  }

  ensurePopulationFloor() {
    const movingCount = this.vehicles.reduce((count, vehicle) => count + (!vehicle.isParked ? 1 : 0), 0);
    if (movingCount < this.targetMovingVehicleCount) {
      this.spawnVehicles(this.targetMovingVehicleCount - movingCount);
    }
  }

  triggerMayhemCollision(v1, v2) {
    if (!v1 || !v2 || v1 === v2 || v1.crashed || v2.crashed || (v1.isParked && v2.isParked)) return false;
    if (v1.mesh.position.distanceToSquared(v2.mesh.position) >= 3.8 ** 2) return false;
    for (const vehicle of [v1, v2]) {
      vehicle.crashed = true;
      vehicle.speed = 0;
      vehicle.targetSpeed = 0;
      vehicle.crashTimer = 16;
      vehicle.mesh.rotation.z = (Math.random() - 0.5) * 0.9;
    }
    const crashPos = v1.mesh.position.clone().add(v2.mesh.position).multiplyScalar(0.5);
    this.app.explosionManager?.createExplosion?.(crashPos);
    this.app.audioSystem?.playExplosion?.();
    this.dispatchPolice(crashPos);
    return true;
  }

  update(delta) {
    const funMode = this.app.funMode;
    const trafficObstacleSnapshot = getTrafficObstacleSnapshot(this.app.physicsWorld);
    this.trafficControlSystem?.update?.(delta);

    this.populationCheckTimer -= delta;
    if (this.populationCheckTimer <= 0) {
      this.populationCheckTimer = 2.0;
      this.ensurePopulationFloor();
    }
    this.updateHitAndRunPursuits(delta);

    // Check collisions between cars in Fun Mode!
    if (funMode) {
      const indexByVehicle = new Map(this.vehicles.map((vehicle, index) => [vehicle, index]));
      for (let i = 0; i < this.vehicles.length; i += 1) {
        const v1 = this.vehicles[i];
        const candidates = this.app.performanceSystem?.nearbyVehicles(v1.mesh.position, 3.8) || this.vehicles;
        for (const v2 of candidates) {
          const j = indexByVehicle.get(v2);
          if (!Number.isInteger(j) || j <= i) continue;
          this.triggerMayhemCollision(v1, v2);
        }
      }
    }

    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const pos = v.mesh.position;

      if (this.app.cityBuilder && this.app.cityBuilder.isInWater(pos)) {
        this.cullVehicle(v);
        continue;
      }

      // Handle crashed state recovery
      if (v.crashed) {
        if (v.isDestroyed) {
          v.destroyedTimer -= delta;
          v.update(delta);
          if (v.destroyedTimer <= 0) {
            this.removeDestroyedVehicle(v);
            this.spawnVehicles(1);
          }
          continue;
        }
        v.crashTimer -= delta;
        if (v.physicsVehicle) {
          v.physicsVehicle.applyCrashBrake();
          v.physicsVehicle.syncMesh();
          v.speed = v.physicsVehicle.speedKmH / 3.6;
        }
        if (v.crashTimer <= 0) {
          // Clear accident and resume driving/parking
          v.crashed = false;
          v.mesh.rotation.z = 0;
          if (v.userControlled && v.physicsVehicle) {
            v.info['Status'] = '🎮 USER CONTROLLED';
          } else if (v.isParked) {
            v.speed = 0;
            v.info['Status'] = '🅿️ Parked';
          } else {
            v.speed = 12;
            v.maxSpeed = v.normalMaxSpeed || 18;
            v.info['Status'] = 'Cruising';
          }
          
          // Release any responding police cars
          for (const p of this.vehicles) {
            if (p.isPolice && p.emergencyTarget && !p.pursuitTarget) {
              p.emergencyTarget = null;
              p.maxSpeed = p.normalMaxSpeed || 20;
              p.targetSpeed = p.maxSpeed;
              p.sirenActive = false;
            }
          }
        }
        v.update(delta);
        continue;
      }
      // Handle vehicle on fire from baseball bat strikes
      if (v.onFire) {
        v.fireTimer -= delta;
        // Flicker fire visual
        if (v.fireMesh) {
          v.fireMesh.material.opacity = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
          const s = 1.0 + Math.sin(Date.now() * 0.01) * 0.25;
          v.fireMesh.scale.set(s, s, s);
        }
        if (v.fireTimer <= 0) {
          this.explodeVehicle(v);
          v.mesh.rotation.z = (Math.random() - 0.5) * 0.8;
          if (this.app.uiManager) {
            this.app.uiManager.onBuildingDestroyed();
          }
          continue;
        }
      }

      // Handle Parked State
      if (v.isParked) {
        v.update(delta);
        continue;
      }

      // Handle emergency police rushing to crash site
      if (v.isPolice && v.emergencyTarget) {
        this.updatePoliceEmergencyResponse(v, delta);
        continue;
      }

      // Handle User Controlled manual driving (WASD / Arrows)
      if (v.userControlled) {
        this.updateUserControlledVehicle(v, delta);
        v.update(delta);
        continue;
      }

      // 1. Normal Collision avoidance check with vehicle ahead
      let isBlocked = false;
      let queuedForTrafficControl = false;
      const nearbyTraffic = this.app.performanceSystem?.nearbyVehicles(pos, 11.5) || this.vehicles;
      for (const other of nearbyTraffic) {
        if (other === v) continue;
        if (other.isParked) continue; // Parked cars along curbs don't block active lanes

        const dist = pos.distanceTo(other.mesh.position);

        if (dist < 11.5) {
          const toOtherOffset = other.mesh.position.clone().sub(pos);
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.mesh.quaternion);
          const forwardDist = toOtherOffset.dot(forward);
          const lateralDist = Math.abs(toOtherOffset.dot(right));

          // Only block if the other vehicle is ahead in our lane corridor (< 2.6m lateral offset)
          // OR physically touching/overlapping within 3.8m
          const isInOurLaneAhead = (forwardDist > 0.4 && forwardDist < 11.5 && lateralDist < 2.6);
          const isDirectCollision = (dist < 3.8 && forwardDist > -0.5);

          if (isInOurLaneAhead || isDirectCollision) {
            // In Fun Mode, ignore collision avoidance so cars smash into each other!
            if (!funMode) {
              isBlocked = true;
              queuedForTrafficControl ||= Boolean(other.trafficControlBlocked);
              break;
            } else {
              // Accelerate slightly before crash for maximum mayhem!
              v.targetSpeed = v.maxSpeed * 1.3;
            }
          }
        }
      }

      const streetObstacle = findTrafficObstacleAhead(
        v,
        this.app.physicsWorld,
        this.navigationConfig,
        trafficObstacleSnapshot
      );
      if (streetObstacle) {
        isBlocked = true;
        if (v.info) v.info.Status = 'Avoiding street obstacle';
      }

      // Stuck and Reversing logic for AI vehicles to prevent gridlocks
      const pedestrianBlocked = this.updatePedestrianYield(v, delta);
      if (pedestrianBlocked) {
        isBlocked = true;
      }
      const trafficControlDecision = this.trafficControlSystem?.evaluateVehicle?.(v, delta)
        || { shouldStop: false, reason: null };
      const trafficControlBlocked = trafficControlDecision.shouldStop;
      if (trafficControlBlocked) {
        isBlocked = true;
        v.info.Status = trafficControlDecision.reason === 'STOP_SIGN'
          ? 'Stopping at stop sign'
          : `Waiting at ${String(trafficControlDecision.reason).toLowerCase()} light`;
        v.info.Mood = 'Following traffic rules';
      } else if (trafficControlDecision.reason === 'VIOLATION') {
        v.info.Status = '⚠️ Ignoring traffic control';
        v.info.Mood = 'Reckless Driver';
      }

      if (!v.userControlled && !v.isParked && !v.crashed && !v.emergencyTarget) {
        if (v.stuckTimer === undefined) v.stuckTimer = 0;
        if (v.isReversing === undefined) v.isReversing = false;
        if (v.reverseTimer === undefined) v.reverseTimer = 0;
        if (v.stuckRecoveryElapsed === undefined) v.stuckRecoveryElapsed = 0;

        const intentionalStop = pedestrianBlocked || trafficControlBlocked || queuedForTrafficControl;
        const tryingToMove = intentionalStop ? false : (v.targetSpeed > 0 || isBlocked);
        const stationaryOrRecovering = v.isReversing || (tryingToMove && Math.abs(v.speed) < 0.3);
        if (stationaryOrRecovering) {
          v.stuckRecoveryElapsed += delta;
        } else {
          v.stuckRecoveryElapsed = Math.max(0, v.stuckRecoveryElapsed - delta * 2.0);
        }

        // This timer deliberately survives individual reverse attempts. The
        // old fallback inspected stuckTimer after resetting it to zero, so it
        // was unreachable under a permanent obstruction.
        if (v.stuckRecoveryElapsed > 12.0) {
          this.respawnVehicle(v);
          continue;
        }

        if (v.isReversing) {
          v.reverseTimer -= delta;
          v.targetSpeed = -4.5; // Drive backwards out of obstruction
          if (v.reverseTimer <= 0) {
            v.isReversing = false;
            v.stuckTimer = 0;
            // Force select a new target node to break any deadlock loops
            if (v.currentNode && v.currentNode.nextNodes && v.currentNode.nextNodes.length > 0) {
              v.targetNode = v.currentNode.nextNodes[Math.floor(Math.random() * v.currentNode.nextNodes.length)];
            }
          }
        } else {
          const isTryingToMove = intentionalStop ? false : (v.targetSpeed > 0 || isBlocked);
          const isNearlyStopped = (v.speed < 0.3);
          if (isTryingToMove && isNearlyStopped) {
            v.stuckTimer += delta;
          } else {
            v.stuckTimer = Math.max(0, v.stuckTimer - delta * 0.5);
          }

          if (v.stuckTimer > 2.2) {
            v.isReversing = true;
            v.reverseTimer = 1.6 + Math.random() * 1.0;
            v.stuckTimer = 0;
            if (v.info) {
              v.info['Status'] = 'Unsticking (Reversing) 🔄';
            }
          }

        }
      }

      if (!v.isReversing) {
        if (!funMode) {
          if (isBlocked) {
            v.targetSpeed = 0;
          } else {
            const bridgeBoost = this.bridgePriorityEnabled && this.isOnPrimaryBridge(v) ? 1.25 : 1;
            const cruiseSpeed = v.maxSpeed * bridgeBoost;
            v.targetSpeed = Math.min(
              cruiseSpeed,
              getNavigationSpeedLimit(v, this.navigationConfig)
            );
          }
        } else if (!isBlocked) {
          v.targetSpeed = v.maxSpeed * 1.2;
        }
      }

      v.speed = approachTrafficTargetSpeed(
        v,
        delta,
        pedestrianBlocked || trafficControlBlocked || queuedForTrafficControl
      );

      // 2. Steer along road graph towards target node
      if (v.targetNode) {
        if (hasReachedNavigationTarget(v) && !v.isReversing) {
          v.currentNode = v.targetNode;
          if (v.currentNode.nextNodes && v.currentNode.nextNodes.length > 0) {
            v.targetNode = v.currentNode.nextNodes[Math.floor(Math.random() * v.currentNode.nextNodes.length)];
          }
        }

        if (v.targetNode) {
          const isReversingState = (v.isReversing === true);
          if (!isReversingState) {
            const dx = v.targetNode.pos.x - pos.x;
            const dz = v.targetNode.pos.z - pos.z;
            const targetAngle = Math.atan2(dx, dz);

            let currentAngle = v.mesh.rotation.y;
            let diff = targetAngle - currentAngle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            v.mesh.rotation.y += diff * 6.5 * delta;
          }

          const moveStep = v.speed * delta;
          v.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
          enforceLaneCorridor(v, this.navigationConfig);

          if (this.app.pedestrianSystem) {
            const currentH = this.app.pedestrianSystem.getTerrainHeight(v.mesh.position.x, v.mesh.position.z);
            v.mesh.position.y = currentH;

            // Far agents use one terrain sample and a low-poly proxy. Nearby
            // agents retain the more expensive four-corner suspension pose.
            if (v.detailLevel !== 'LOW') {
              const forwardX = Math.sin(v.mesh.rotation.y);
              const forwardZ = Math.cos(v.mesh.rotation.y);
              const rightX = Math.cos(v.mesh.rotation.y);
              const rightZ = -Math.sin(v.mesh.rotation.y);
              const frontH = this.app.pedestrianSystem.getTerrainHeight(v.mesh.position.x + forwardX * 2.2, v.mesh.position.z + forwardZ * 2.2);
              const backH = this.app.pedestrianSystem.getTerrainHeight(v.mesh.position.x - forwardX * 2.2, v.mesh.position.z - forwardZ * 2.2);
              const leftH = this.app.pedestrianSystem.getTerrainHeight(v.mesh.position.x - rightX * 1.2, v.mesh.position.z - rightZ * 1.2);
              const rightH = this.app.pedestrianSystem.getTerrainHeight(v.mesh.position.x + rightX * 1.2, v.mesh.position.z + rightZ * 1.2);
              v.mesh.rotation.x = -Math.atan2(frontH - backH, 4.4);
              v.mesh.rotation.z = Math.atan2(leftH - rightH, 2.4);
            }
          } else {
            v.mesh.position.y = 0;
            v.mesh.rotation.x = 0;
            v.mesh.rotation.z = 0;
          }
        }
      }

      // 3. Update vehicle animations & wheels
      if (this.app.performanceSystem?.shouldAnimate(v, i) ?? true) v.update(delta);

      if (v.physicsBody) {
        v.physicsBody.position.set(v.mesh.position.x, v.mesh.position.y + 1.05, v.mesh.position.z);
        v.physicsBody.quaternion.set(v.mesh.quaternion.x, v.mesh.quaternion.y, v.mesh.quaternion.z, v.mesh.quaternion.w);
      }

      // 4. Update siren timers for police cars
      if (v.isPolice) {
        if (v.sirenTimer && v.sirenTimer > 0) {
          v.sirenTimer -= delta;
        }
        
        if (v.speed > 5 && !v.emergencyTarget && this.app.audioSystem && this.app.audioSystem.isEnabled) {
          const camDist = pos.distanceTo(this.app.sceneManager.camera.position);
          if (camDist < 40 && Math.random() < 0.003 && (!v.sirenTimer || v.sirenTimer <= 0)) {
            v.sirenTimer = 6.0 + Math.random() * 4.0;
          }
        }
      }
    }

    this.resolveTrafficOverlaps();
    for (const vehicle of this.vehicles) {
      enforceLaneCorridor(vehicle, this.navigationConfig);
    }
    this.updateAmbientEngineAudio(delta);
  }

  resolveTrafficOverlaps(iterations = 2) {
    const index = new Map(this.vehicles.map((vehicle, i) => [vehicle, i]));
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < this.vehicles.length; i += 1) {
        const vehicle = this.vehicles[i];
        // Player contacts are already resolved once by
        // updateUserControlledVehicle. A second correction in this ambient AI
        // pass can repeatedly cancel the player's escape velocity.
        if (!vehicle?.mesh || vehicle.crashed || vehicle.userControlled) continue;
        const candidates = this.app.performanceSystem?.nearbyVehicles(vehicle.mesh.position, 13) || this.vehicles;
        for (const other of candidates) {
          if (!other?.mesh || other.crashed || other.userControlled || (index.get(other) ?? -1) <= i) continue;
          this.resolveVehicleOverlap(vehicle, other);
        }
      }
    }
  }

  updateAmbientEngineAudio(delta) {
    if (!this.app || !this.app.audioSystem || !this.app.audioSystem.isEnabled || !this.app.audioSystem.ctx) {
      // Clean up any active AI engine and siren sounds
      for (const v of this.vehicles) {
        if (v.aiEngineSound) {
          this.app.audioSystem.stopEngineInstance(v.aiEngineSound);
          v.aiEngineSound = null;
        }
        if (v.spatialSiren) {
          this.app.audioSystem.stopSirenInstance(v.spatialSiren);
          v.spatialSiren = null;
        }
      }
      return;
    }

    const camera = this.app.sceneManager.camera;
    if (!camera) return;

    const camPos = camera.position;
    const maxAudibleDist = 65.0; // Distance roll-off limit (meters)

    for (const v of this.vehicles) {
      if (v.userControlled) {
        // Player controlled vehicle handles its own sound, clean up AI engine/siren instances if any
        if (v.aiEngineSound) {
          this.app.audioSystem.stopEngineInstance(v.aiEngineSound);
          v.aiEngineSound = null;
        }
        if (v.spatialSiren) {
          this.app.audioSystem.stopSirenInstance(v.spatialSiren);
          v.spatialSiren = null;
        }
        continue;
      }

      if (v.crashed || v.isParked) {
        if (v.aiEngineSound) {
          this.app.audioSystem.stopEngineInstance(v.aiEngineSound);
          v.aiEngineSound = null;
        }
        if (v.spatialSiren) {
          this.app.audioSystem.stopSirenInstance(v.spatialSiren);
          v.spatialSiren = null;
        }
        continue;
      }

      const dist = v.mesh.position.distanceTo(camPos);
      const dopplerMultiplier = this.calculateDoppler(v, camPos);

      // 1. Update AI engine audio
      if (dist < maxAudibleDist) {
        const volumeMultiplier = Math.max(0, 1.0 - dist / maxAudibleDist);

        if (!v.aiEngineSound) {
          v.aiEngineSound = this.app.audioSystem.createEngineInstance(v.vType);
        }

        const speedKmh = v.speed * 3.6;
        const maxSpeedKmh = v.maxSpeed * 3.6;
        
        // Scale AI engines back a bit, but slightly louder than before (* 0.40) as requested!
        this.app.audioSystem.updateEngineInstance(v.aiEngineSound, speedKmh, maxSpeedKmh, volumeMultiplier * 0.40, dopplerMultiplier);
      } else {
        if (v.aiEngineSound) {
          this.app.audioSystem.stopEngineInstance(v.aiEngineSound);
          v.aiEngineSound = null;
        }
      }

      // 2. Update police/ambulance spatial siren audio
      const hasActiveSiren = (v.isPolice && (v.sirenActive || v.emergencyTarget != null || (v.sirenTimer && v.sirenTimer > 0))) || (v.vType === 'AMBULANCE' && v.sirenActive === true);
      if (hasActiveSiren && dist < maxAudibleDist) {
        const volumeMultiplier = Math.max(0, 1.0 - dist / maxAudibleDist);

        if (!v.spatialSiren) {
          v.spatialSiren = v.vType === 'AMBULANCE'
            ? this.app.audioSystem.createAmbulanceSirenInstance()
            : this.app.audioSystem.createSirenInstance();
        }

        if (v.vType === 'AMBULANCE') {
          this.app.audioSystem.updateAmbulanceSirenInstance(v.spatialSiren, dopplerMultiplier, volumeMultiplier * 0.75);
        } else {
          this.app.audioSystem.updateSirenInstance(v.spatialSiren, dopplerMultiplier, volumeMultiplier * 0.65);
        }
      } else {
        if (v.spatialSiren) {
          if (v.vType === 'AMBULANCE') {
            this.app.audioSystem.stopAmbulanceSirenInstance(v.spatialSiren);
          } else {
            this.app.audioSystem.stopSirenInstance(v.spatialSiren);
          }
          v.spatialSiren = null;
        }
      }

      // 3. Update Ice Cream Truck spatial musical jingle
      if (v.vType === 'ICECREAM' && dist < maxAudibleDist) {
        const volumeMultiplier = Math.max(0, 1.0 - dist / maxAudibleDist);
        if (!v.spatialJingle) {
          v.spatialJingle = this.app.audioSystem.createIceCreamJingleInstance();
        }
        this.app.audioSystem.updateIceCreamJingleInstance(v.spatialJingle, dopplerMultiplier, volumeMultiplier * 0.65);
      } else {
        if (v.spatialJingle) {
          this.app.audioSystem.stopIceCreamJingleInstance(v.spatialJingle);
          v.spatialJingle = null;
        }
      }
    }
  }

  calculateDoppler(v, camPos) {
    const toCam = camPos.clone().sub(v.mesh.position);
    const dist = toCam.length();
    if (dist < 0.1) return 1.0;
    toCam.normalize();

    // AI velocity vector
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
    const carVel = forward.multiplyScalar(v.speed);

    // Component toward the camera
    const speedTowardCam = carVel.dot(toCam);

    // Physical Doppler shift formula using game speed of sound
    const speedOfSound = 65.0; // scale factor
    let doppler = speedOfSound / (speedOfSound - speedTowardCam);

    // Clamp shift multiplier
    return Math.max(0.65, Math.min(1.75, doppler));
  }

  spawnParkedVehicles() {
    const types = ['SEDAN', 'SPORTS', 'TAXI', 'SEDAN'];
    const colors = [0x555555, 0x00ff88, 0xffbb00, 0x0ea5e9, 0xef4444, 0x10b981];
    const names = ['Cyber Cruiser', 'Apex GT', 'City Yellow Cab', 'Neo Tech Sedan'];

    const spots = [
      { x: 6.0, z: 25.0, ry: 0 },
      { x: -6.0, z: -25.0, ry: Math.PI },
      { x: 56.0, z: 30.0, ry: 0 },
      { x: 44.0, z: -30.0, ry: Math.PI },
      { x: 106.0, z: 15.0, ry: 0 },
      { x: 94.0, z: -15.0, ry: Math.PI },
      { x: 25.0, z: 6.0, ry: Math.PI / 2 },
      { x: -25.0, z: -6.0, ry: -Math.PI / 2 },
      { x: 20.0, z: 56.0, ry: Math.PI / 2 },
      { x: -20.0, z: 44.0, ry: -Math.PI / 2 },
      { x: 275.0, z: 6.0, ry: Math.PI / 2 },
      { x: 245.0, z: -6.0, ry: -Math.PI / 2 }
    ];

    spots.forEach((spot, idx) => {
      const typeIdx = idx % types.length;
      const vType = types[typeIdx];
      const color = colors[idx % colors.length];
      const name = `${names[typeIdx]} (Parked) #${idx + 50}`;

      const vehicle = new Vehicle(vType, color, name);
      vehicle.crashed = false;
      vehicle.crashTimer = 0;
      vehicle.isParked = true;
      vehicle.speed = 0;
      vehicle.info['Status'] = '🅿️ Parked';
      this.assignDriverRuleProfile(vehicle, 1000 + idx);

      const pedColors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed];
      const pedType = ['BUSINESS', 'CASUAL', 'JOGGER'][idx % 3];
      vehicle.driverPedestrian = new Pedestrian(pedType, pedColors[idx % pedColors.length], `Driver of ${name}`);

      vehicle.mesh.position.set(spot.x, 0, spot.z);
      vehicle.mesh.rotation.y = spot.ry;

      this.app.sceneManager.scene.add(vehicle.mesh);
      
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(vehicle.mesh, vehicle);
      }
      
      if (this.app.physicsWorld) {
        vehicle.physicsBody = this.app.physicsWorld.addKinematicBoxCollider(
          new THREE.Vector3(spot.x, 1.05, spot.z),
          new THREE.Vector3(2.1, 1.2, 4.4)
        );
        if (vehicle.physicsBody) {
          vehicle.physicsBody.quaternion.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            spot.ry
          );
        }
      }
      this.vehicles.push(vehicle);
    });

    // Dedicated parked Motorbikes around town
    const bikeSpots = [
      { x: 12.0, z: 25.0, ry: 0, color: 0xea580c },
      { x: -12.0, z: -25.0, ry: Math.PI, color: 0x00f0ff },
      { x: 48.0, z: 30.0, ry: 0, color: 0x22ee44 },
      { x: -28.0, z: -6.0, ry: -Math.PI / 2, color: 0xdf0054 }
    ];

    bikeSpots.forEach((spot, idx) => {
      const name = `Phantom Streetfighter (Parked) #${idx + 90}`;
      const vehicle = new Vehicle('MOTORBIKE', spot.color, name);
      vehicle.crashed = false;
      vehicle.crashTimer = 0;
      vehicle.isParked = true;
      vehicle.speed = 0;
      vehicle.info['Status'] = '🅿️ Parked Motorbike';
      this.assignDriverRuleProfile(vehicle, 1100 + idx);

      const pedColors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed];
      const pedType = ['BUSINESS', 'CASUAL', 'JOGGER'][idx % 3];
      vehicle.driverPedestrian = new Pedestrian(pedType, pedColors[idx % pedColors.length], `Rider of ${name}`);

      vehicle.mesh.position.set(spot.x, 0, spot.z);
      vehicle.mesh.rotation.y = spot.ry;

      this.app.sceneManager.scene.add(vehicle.mesh);
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(vehicle.mesh, vehicle);
      }
      if (this.app.physicsWorld) {
        vehicle.physicsBody = this.app.physicsWorld.addKinematicBoxCollider(
          new THREE.Vector3(spot.x, 0.8, spot.z),
          new THREE.Vector3(0.8, 1.1, 2.3)
        );
        if (vehicle.physicsBody) {
          vehicle.physicsBody.quaternion.setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            spot.ry
          );
        }
      }
      this.vehicles.push(vehicle);
    });
  }

  respawnVehicle(vehicle, force = false) {
    if (!vehicle || (!force && (vehicle.userControlled || vehicle.isParked))) return;
    if (vehicle.hitAndRunState) this.clearHitAndRunPursuit(vehicle);

    // Filter for out nodes that are not currently occupied by other vehicles
    const outNodes = Array.from(this.nodes.values()).filter(n => n.id.includes('_OUT') && n.nextNodes.length > 0);
    
    // Pick the best (least occupied) starting node
    let bestNode = null;
    let maxClearDist = 0;
    
    for (let attempts = 0; attempts < 15; attempts++) {
      const node = outNodes[Math.floor(Math.random() * outNodes.length)];
      let minDist = 999999;
      for (const other of this.vehicles) {
        if (other === vehicle || other.isParked) continue;
        const dist = other.mesh.position.distanceTo(node.pos);
        if (dist < minDist) minDist = dist;
      }
      if (minDist > maxClearDist) {
        maxClearDist = minDist;
        bestNode = node;
      }
      if (minDist > 30) {
        bestNode = node;
        break; // Far enough!
      }
    }

    if (!bestNode) {
      bestNode = outNodes[Math.floor(Math.random() * outNodes.length)];
    }

    // Reset vehicle variables
    vehicle.mesh.position.copy(bestNode.pos);
    vehicle.mesh.position.y = this.getTerrainHeight(bestNode.pos.x, bestNode.pos.z);
    vehicle.currentNode = bestNode;
    vehicle.targetNode = bestNode.nextNodes[Math.floor(Math.random() * bestNode.nextNodes.length)] || bestNode.nextNodes[0];
    if (vehicle.targetNode) {
      vehicle.mesh.lookAt(vehicle.targetNode.pos.x, vehicle.mesh.position.y, vehicle.targetNode.pos.z);
    }
    if (vehicle.physicsBody) {
      vehicle.physicsBody.position.set(vehicle.mesh.position.x, vehicle.mesh.position.y + 1.05, vehicle.mesh.position.z);
      vehicle.physicsBody.quaternion.set(vehicle.mesh.quaternion.x, vehicle.mesh.quaternion.y, vehicle.mesh.quaternion.z, vehicle.mesh.quaternion.w);
      vehicle.physicsBody.velocity.set(0, 0, 0);
      vehicle.physicsBody.angularVelocity.set(0, 0, 0);
      vehicle.physicsBody.aabbNeedsUpdate = true;
      this.app.physicsWorld?.restoreKinematicCollider?.(vehicle.physicsBody);
    }

    vehicle.speed = 0;
    vehicle.maxSpeed = vehicle.normalMaxSpeed || vehicle.maxSpeed;
    vehicle.targetSpeed = vehicle.maxSpeed;
    vehicle.crashed = false;
    vehicle.crashTimer = 0;
    vehicle.emergencyTarget = null;
    vehicle.stuckTimer = 0;
    vehicle.isReversing = false;
    vehicle.reverseTimer = 0;
    vehicle.stuckRecoveryElapsed = 0;
    vehicle.sirenActive = false;
    if (vehicle.info) {
      vehicle.info['Status'] = 'Cruising';
      vehicle.info['Mood'] = 'Relaxed ☀️';
    }
  }
}
