import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PHYSICS_GROUPS } from '../physics/PhysicsWorld.js';
import {
  getPlayerVehiclePhysicsLayout,
  getVehicleProfile
} from './VehicleProfiles.js';
import {
  resolvePlayerVehicleDriveForces,
  resolvePlayerVehicleControls,
  updateVehicleMobilityTimer
} from './PlayerVehicleControls.js';

export class PlayerVehicle {
  constructor(mesh, physicsWorld, initialPosition = null, initialRotation = null, vType = 'SEDAN') {
    this.mesh = mesh;
    this.physicsWorld = physicsWorld;
    this.type = 'VEHICLE';
    this.vType = vType;
    this.isPhysicsControlled = true;
    this.currentSteering = 0;
    this.speedKmH = 0;
    this.gear = 1;
    this.gripMultiplier = 1.0;
    this.lastSafePose = null;
    this.safePoseHistory = [];
    this.safePoseFrame = 0;
    this.stuckElapsed = 0;
    this.recoveryCooldown = 0;
    this.info = {
      'Status': '🏎️ PHYSICS ACTION MODE',
      'Engine': this.getEngineName(vType),
      'Drive': this.getDriveType(vType),
      'Speed': '0 km/h'
    };

    const startPos = initialPosition || mesh.position;
    const startRot = initialRotation || mesh.rotation;
    
    this.meshOffset = 0;

    this.initPhysics(startPos, startRot);
    this.lastSafePose = {
      position: this.chassisBody.position.clone(),
      quaternion: this.chassisBody.quaternion.clone()
    };
  }

  getEngineName(vType) {
    switch (vType) {
      case 'SPORTS':
      case 'SPORTS_CAR': return 'High-Rev V10 Supercar (cannon-es)';
      case 'BUS': return 'Heavy-Duty Electric Drive';
      case 'TRUCK': return 'High-Torque Turbodiesel';
      case 'POLICE': return 'Interceptor V8 Supercharged';
      case 'AMBULANCE': return 'EMS Rescue V8 Turbo-Diesel';
      case 'ICECREAM': return 'Sweet Delivery Van 4-Cylinder';
      case 'DUMP_TRUCK': return 'Heavy Titan Diesel Industrial';
      case 'MOTORBIKE': return 'Inline-4 Streetfighter 1000cc';
      default: return 'Twin-Turbo V6 (cannon-es)';
    }
  }

  getDriveType(vType) {
    switch (vType) {
      case 'SPORTS':
      case 'SPORTS_CAR': return 'RWD Performance GT Chassis';
      case 'BUS': return '6x4 Transit Chassis';
      case 'TRUCK': return 'Rear-Dual Heavy Duty';
      case 'POLICE': return 'Pursuit-Tuned AWD';
      case 'AMBULANCE': return 'EMS Rapid Response AWD';
      case 'ICECREAM': return 'Delivery Van FWD';
      case 'DUMP_TRUCK': return '6x4 Heavy Dumper Chassis';
      case 'MOTORBIKE': return 'RWD Motorcycle Chain Drive';
      default: return 'AWD RaycastVehicle';
    }
  }

  initPhysics(pos, rot) {
    const profile = getVehicleProfile(this.vType);
    const {
      mass,
      width,
      height,
      length,
      wheelRadius,
      suspensionRestLength,
      suspensionStiffness,
      maxSuspensionForce
    } = profile;
    this.physicsLayout = getPlayerVehiclePhysicsLayout(
      this.vType,
      this.physicsWorld?.world?.gravity?.y
    );
    this.meshOffset = this.physicsLayout.settledRideHeight;
    this.driveProfile = profile.drive;
    this.footprint = Object.freeze({ width, length });

    // 1. Chassis rigid body
    const chassisShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, length / 2));
    this.chassisBody = new CANNON.Body({
      mass: mass,
      material: this.physicsWorld.wheelMaterial
    });
    // AI traffic is resolved by TrafficSystem's planar arcade contact model.
    // Excluding its kinematic boxes here also prevents wheel rays from
    // mistaking another vehicle for a road surface and launching the chassis.
    this.chassisBody.collisionFilterGroup = PHYSICS_GROUPS.PLAYER;
    this.chassisBody.collisionFilterMask = PHYSICS_GROUPS.SURFACE | PHYSICS_GROUPS.STATIC_OBSTACLE;
    this.chassisBody.addShape(
      chassisShape,
      new CANNON.Vec3(0, this.physicsLayout.chassisShapeOffsetY, 0)
    );
    
    const initialY = pos.y + this.meshOffset;
    this.chassisBody.position.set(pos.x, initialY, pos.z);

    if (rot) {
      const q = new THREE.Quaternion().setFromEuler(rot);
      this.chassisBody.quaternion.set(q.x, q.y, q.z, q.w);
    }
    this.chassisBody.linearDamping = 0.15;
    this.chassisBody.angularDamping = 0.25;
    this.chassisBody.allowSleep = false;

    // 2. Create RaycastVehicle
    this.raycastVehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2
    });

    // Create distinct options object per wheel
    const createWheelOptions = (connectionPoint, radius) => ({
      radius: radius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: suspensionStiffness,
      suspensionRestLength: suspensionRestLength,
      frictionSlip: (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') ? 8.0 : 6.0,
      dampingRelaxation: 2.8,
      dampingCompression: 4.5,
      maxSuspensionForce: maxSuspensionForce,
      rollInfluence: 0.05,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: connectionPoint,
      maxSuspensionTravel: 0.28,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true
    });

    const wOffsetX = width * 0.45;

    if (this.physicsLayout.wheelCount === 6) {
      // 6 wheels connection points
      // Front axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, this.physicsLayout.wheelConnectionY, length * 0.38), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, this.physicsLayout.wheelConnectionY, length * 0.38), wheelRadius));
      
      // Middle axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, this.physicsLayout.wheelConnectionY, -length * 0.1), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, this.physicsLayout.wheelConnectionY, -length * 0.1), wheelRadius));
      
      // Rear axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, this.physicsLayout.wheelConnectionY, -length * 0.38), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, this.physicsLayout.wheelConnectionY, -length * 0.38), wheelRadius));
    } else {
      // 4 wheels connection points
      const wOffsetZ = length * 0.35;
      
      // Front Left
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, this.physicsLayout.wheelConnectionY, wOffsetZ), wheelRadius));
      // Front Right
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, this.physicsLayout.wheelConnectionY, wOffsetZ), wheelRadius));
      // Rear Left
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, this.physicsLayout.wheelConnectionY, -wOffsetZ), wheelRadius));
      // Rear Right
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, this.physicsLayout.wheelConnectionY, -wOffsetZ), wheelRadius));
    }

    this.raycastVehicle.addToWorld(this.physicsWorld.world);
    if (typeof this.physicsWorld.registerPlayerVehicle === 'function') {
      this.physicsWorld.registerPlayerVehicle(this);
    }
  }

  applyWeatherGrip(multiplier = 1.0) {
    this.gripMultiplier = Math.max(0.2, Math.min(1.0, multiplier));
    if (!this.raycastVehicle) return;

    for (const wheel of this.raycastVehicle.wheelInfos) {
      if (wheel._dryFrictionSlip === undefined) {
        wheel._dryFrictionSlip = wheel.frictionSlip;
      }
      wheel.frictionSlip = wheel._dryFrictionSlip * this.gripMultiplier;
    }
  }

  applyCrashBrake(force = 500) {
    if (!this.raycastVehicle || !this.chassisBody) return;
    for (let i = 0; i < this.raycastVehicle.wheelInfos.length; i++) {
      this.raycastVehicle.applyEngineForce(0, i);
      this.raycastVehicle.setBrake(force, i);
    }
    this.chassisBody.angularVelocity.y *= 0.94;
  }

  setForwardSpeed(speed = 0) {
    if (!this.chassisBody) return false;
    const safeSpeed = Number.isFinite(speed) ? speed : 0;
    const forward = new CANNON.Vec3(0, 0, 1);
    this.chassisBody.quaternion.vmult(forward, forward);
    forward.y = 0;
    const length = forward.length();
    if (length <= 1e-6) forward.set(0, 0, 1);
    else forward.scale(1 / length, forward);
    this.chassisBody.velocity.set(forward.x * safeSpeed, 0, forward.z * safeSpeed);
    this.chassisBody.wakeUp?.();
    return true;
  }

  applyInput(keys, delta) {
    if (!keys || !this.chassisBody) return false;

    // Freeze controls while a dialogue modal is open
    const dialogueOpen = typeof window !== 'undefined'
      && window.app?.dialogueOverlay?.currentMission != null;
    if (dialogueOpen) {
      const numWheels = this.raycastVehicle.wheelInfos.length;
      for (let i = 0; i < numWheels; i++) {
        this.raycastVehicle.applyEngineForce(0, i);
        this.raycastVehicle.setBrake(80, i);
      }
      this.chassisBody.angularVelocity.y *= 0.7;
      return false;
    }

    const controls = resolvePlayerVehicleControls(
      keys,
      typeof window !== 'undefined' ? window.app?.inputManager?.state : null
    );
    const analogThrottle = controls.throttle;
    const analogBrake = controls.reverse;
    const analogSteer = controls.steer;
    const isHandbrake = controls.handbrake;

    // Calculate forward speed along vehicle forward vector (+Z local)
    const forwardVec = new CANNON.Vec3(0, 0, 1);
    this.chassisBody.quaternion.vmult(forwardVec, forwardVec);
    const currentForwardSpeed = this.chassisBody.velocity.dot(forwardVec);

    // 1. Steering (Analog smooth steering)
    const targetSteering = analogSteer * this.driveProfile.maxSteering;
    this.currentSteering += (targetSteering - this.currentSteering) * Math.min(1.0, delta * 16.0);

    this.raycastVehicle.setSteeringValue(this.currentSteering, 0);
    this.raycastVehicle.setSteeringValue(this.currentSteering, 1);

    // Apply direct yaw response when moving so steering is accurate and responsive
    if (Math.abs(currentForwardSpeed) > 0.5 && Math.abs(analogSteer) > 0.05) {
      const turnDir = currentForwardSpeed > 0 ? 1 : -1;
      const turnRate = Math.min(2.8, Math.abs(currentForwardSpeed) * 0.16) * analogSteer;
      this.chassisBody.angularVelocity.y = turnRate * turnDir;
    } else if (Math.abs(analogSteer) <= 0.05) {
      this.chassisBody.angularVelocity.y *= 0.85;
    }

    // 2. Engine & Braking (Analog smooth throttle & brake)
    const { engineForce, brakeForce } = resolvePlayerVehicleDriveForces(
      controls,
      currentForwardSpeed,
      this.driveProfile
    );

    // 3. Lateral grip stabilization
    if (!isHandbrake && Math.abs(currentForwardSpeed) > 1.0) {
      const rightVec = new CANNON.Vec3(1, 0, 0);
      this.chassisBody.quaternion.vmult(rightVec, rightVec);
      const lateralVel = this.chassisBody.velocity.dot(rightVec);
      const antiDrift = rightVec.clone();
      const sportsType = this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR';
      antiDrift.scale(-lateralVel * this.chassisBody.mass * (sportsType ? 12.0 : 10.0) * this.gripMultiplier, antiDrift);
      this.chassisBody.applyForce(antiDrift, new CANNON.Vec3(0, 0, 0));
    }

    // 4. Aerodynamic downforce (oriented along vehicle local -Y normal)
    const speed = this.chassisBody.velocity.length();
    if (speed > 2) {
      const downForceFactor = (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') ? 600 : (this.vType === 'BUS' ? 100 : (this.vType === 'TRUCK' ? 200 : 400));
      const downVec = new CANNON.Vec3(0, -1, 0);
      this.chassisBody.quaternion.vmult(downVec, downVec);
      downVec.scale(downForceFactor * speed, downVec);
      this.chassisBody.applyForce(downVec, new CANNON.Vec3(0, 0, 0));
    }

    const numWheels = this.raycastVehicle.wheelInfos.length;
    for (let i = 0; i < numWheels; i++) {
      this.raycastVehicle.applyEngineForce(engineForce, i);
      this.raycastVehicle.setBrake(brakeForce, i);
    }

    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - delta);
    const horizontalSpeed = Math.hypot(this.chassisBody.velocity.x, this.chassisBody.velocity.z);
    const mobility = updateVehicleMobilityTimer(this.stuckElapsed, {
      throttle: analogThrottle,
      reverse: analogBrake,
      handbrake: isHandbrake,
      horizontalSpeed
    }, delta);
    this.stuckElapsed = mobility.elapsed;
    if (mobility.shouldRecover && this.recoveryCooldown <= 0) {
      this.recoverToSafePose();
      this.stuckElapsed = 0;
      this.recoveryCooldown = 4;
      return true;
    }
    return false;
  }

  syncMesh() {
    if (!this.mesh || !this.chassisBody) return;

    const terrainSystem = this.physicsWorld?.terrainSystem || null;
    const terrainY = terrainSystem?.getTerrainHeight?.(
      this.chassisBody.position.x,
      this.chassisBody.position.z
    ) ?? 0;
    const positionIsFinite = Number.isFinite(this.chassisBody.position.x)
      && Number.isFinite(this.chassisBody.position.y)
      && Number.isFinite(this.chassisBody.position.z);
    const withinWorld = terrainSystem?.isWithinDrivableBounds?.(
      this.chassisBody.position.x,
      this.chassisBody.position.z
    ) ?? true;
    if (!positionIsFinite || !withinWorld || this.chassisBody.position.y < terrainY - 2.5) {
      this.recoverToSafePose();
    }

    // 1. Anti-Flip Auto-Righting Protection: Prevent vehicle from flipping upside down or rolling over sideways
    const upVec = new CANNON.Vec3(0, 1, 0);
    this.chassisBody.quaternion.vmult(upVec, upVec);
    if (upVec.y < 0.65) {
      const forwardCheck = new CANNON.Vec3(0, 0, 1);
      this.chassisBody.quaternion.vmult(forwardCheck, forwardCheck);
      const yaw = Math.atan2(forwardCheck.x, forwardCheck.z);
      const frontH = terrainSystem ? terrainSystem.getTerrainHeight(this.chassisBody.position.x + forwardCheck.x * 2.2, this.chassisBody.position.z + forwardCheck.z * 2.2) : 0;
      const backH = terrainSystem ? terrainSystem.getTerrainHeight(this.chassisBody.position.x - forwardCheck.x * 2.2, this.chassisBody.position.z - forwardCheck.z * 2.2) : 0;
      const pitch = Math.atan2(frontH - backH, 4.4);
      const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
      this.chassisBody.quaternion.set(targetQ.x, targetQ.y, targetQ.z, targetQ.w);
      this.chassisBody.angularVelocity.set(0, 0, 0);
    }

    // RaycastVehicle suspension owns pitch, roll, and road contact. The former
    // per-frame terrain quaternion override fought the solver at each hill
    // sample boundary and could force the chassis through its own wheel plane.

    // Sync chassis transform to visual Three.js mesh
    this.mesh.position.copy(this.chassisBody.position);
    this.mesh.position.y -= this.meshOffset;
    this.mesh.quaternion.copy(this.chassisBody.quaternion);
    if (this.vType === 'MOTORBIKE' && this.chassisBody.angularVelocity) {
      // Lean motorcycle into turns based on angular yaw velocity
      const leanAngle = Math.max(-0.45, Math.min(0.45, -this.chassisBody.angularVelocity.y * 0.28));
      this.mesh.rotateZ(leanAngle);
    }

    // Calculate Speed and Gear for HUD
    const vel = this.chassisBody.velocity;
    const speedMs = Math.hypot(vel.x, vel.z);
    this.speedKmH = Math.round(speedMs * 3.6);

    if (this.speedKmH < 3) this.gear = 1;
    else if (this.speedKmH < 35) this.gear = 2;
    else if (this.speedKmH < 65) this.gear = 3;
    else if (this.speedKmH < 105) this.gear = 4;
    else this.gear = 5;

    this.info['Speed'] = `${this.speedKmH} km/h (Gear ${this.gear})`;

    const contactCount = this.raycastVehicle.wheelInfos.reduce(
      (count, wheel) => count + (wheel.isInContact ? 1 : 0),
      0
    );
    if (contactCount >= Math.min(2, this.raycastVehicle.wheelInfos.length) && upVec.y > 0.7) {
      this.safePoseFrame += 1;
      if (this.speedKmH > 3 || this.safePoseHistory.length === 0) {
        this.lastSafePose = {
          position: this.chassisBody.position.clone(),
          quaternion: this.chassisBody.quaternion.clone()
        };
        if (this.safePoseFrame >= 30 || this.safePoseHistory.length === 0) {
          this.safePoseHistory.push(this.lastSafePose);
          if (this.safePoseHistory.length > 8) this.safePoseHistory.shift();
          this.safePoseFrame = 0;
        }
      }
    }
  }

  recoverToSafePose() {
    if (!this.chassisBody) return false;
    const historicalPose = this.safePoseHistory[Math.max(0, this.safePoseHistory.length - 4)];
    const safePose = historicalPose || this.lastSafePose;
    if (safePose) {
      this.chassisBody.position.copy(safePose.position);
      this.chassisBody.position.y += 0.35;
      this.chassisBody.quaternion.copy(safePose.quaternion);
    } else {
      if (!Number.isFinite(this.chassisBody.position.x)) this.chassisBody.position.x = this.mesh?.position?.x || 0;
      if (!Number.isFinite(this.chassisBody.position.z)) this.chassisBody.position.z = this.mesh?.position?.z || 0;
      const terrainY = this.physicsWorld?.terrainSystem?.getTerrainHeight?.(
        this.chassisBody.position.x,
        this.chassisBody.position.z
      ) ?? 0;
      this.chassisBody.position.y = terrainY + Math.max(1.1, this.meshOffset + 0.5);
      const forward = new CANNON.Vec3(0, 0, 1);
      this.chassisBody.quaternion.vmult(forward, forward);
      this.chassisBody.quaternion.setFromAxisAngle(
        new CANNON.Vec3(0, 1, 0),
        Math.atan2(forward.x, forward.z)
      );
    }
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
    this.chassisBody.wakeUp?.();
    this.chassisBody.aabbNeedsUpdate = true;
    return true;
  }

  resetPosition() {
    if (!this.chassisBody) return;
    if (this.lastSafePose) {
      this.recoverToSafePose();
      return;
    }
    let terrainY = 0.0;
    const terrainSystem = this.physicsWorld ? this.physicsWorld.terrainSystem : null;
    if (terrainSystem) {
      terrainY = terrainSystem.getTerrainHeight(this.chassisBody.position.x, this.chassisBody.position.z) - 0.05;
    }
    const yOffset = terrainY + (this.vType === 'BUS' ? 2.8 : (this.vType === 'TRUCK' ? 2.2 : 1.2));
    this.chassisBody.position.y = yOffset;
    const euler = new THREE.Euler(0, this.mesh.rotation.y, 0);
    const q = new THREE.Quaternion().setFromEuler(euler);
    this.chassisBody.quaternion.set(q.x, q.y, q.z, q.w);
    this.chassisBody.velocity.set(0, 0, 0);
    this.chassisBody.angularVelocity.set(0, 0, 0);
  }

  toggleAmbulanceSiren(audioSystem) {
    if (this.vType !== 'AMBULANCE' && this.vType !== 'POLICE') return;
    this.sirenActive = !this.sirenActive;
    if (audioSystem) {
      if (this.sirenActive) {
        audioSystem.startAmbulanceSiren(this);
      } else {
        audioSystem.stopAmbulanceSiren(this);
      }
    }
  }

  destroy() {
    if (this.physicsWorld && typeof this.physicsWorld.unregisterPlayerVehicle === 'function') {
      this.physicsWorld.unregisterPlayerVehicle(this);
    }
    if (this.raycastVehicle) {
      this.raycastVehicle.removeFromWorld(this.physicsWorld.world);
      this.raycastVehicle = null;
    }
    if (this.chassisBody && this.physicsWorld.world.bodies.includes(this.chassisBody)) {
      this.physicsWorld.world.removeBody(this.chassisBody);
    }
    this.chassisBody = null;
  }
}
