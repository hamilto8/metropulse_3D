import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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
    this.info = {
      'Status': '🏎️ PHYSICS ACTION MODE',
      'Engine': this.getEngineName(vType),
      'Drive': this.getDriveType(vType),
      'Speed': '0 km/h'
    };

    const startPos = initialPosition || mesh.position;
    const startRot = initialRotation || mesh.rotation;
    
    // Set dynamic offsets
    this.meshOffset = 0.55;
    if (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') this.meshOffset = 0.48;
    else if (this.vType === 'TRUCK') this.meshOffset = 1.35;
    else if (this.vType === 'BUS') this.meshOffset = 2.05;
    else if (this.vType === 'AMBULANCE') this.meshOffset = 1.15;
    else if (this.vType === 'ICECREAM') this.meshOffset = 1.10;
    else if (this.vType === 'DUMP_TRUCK') this.meshOffset = 1.45;
    else if (this.vType === 'MOTORBIKE') this.meshOffset = 0.40;

    this.initPhysics(startPos, startRot);
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
    let mass = 1200;
    let width = 2.0, height = 1.4, length = 4.2;
    let wheelRadius = 0.4, suspensionRestLength = 0.45, suspensionStiffness = 48;
    let maxSuspensionForce = 100000;
    
    if (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') {
      mass = 950;
      width = 2.1; height = 1.05; length = 4.4;
      wheelRadius = 0.45;
      suspensionRestLength = 0.38;
      suspensionStiffness = 68;
    } else if (this.vType === 'BUS') {
      mass = 4800;
      width = 2.6; height = 3.2; length = 10.5;
      wheelRadius = 0.6;
      suspensionRestLength = 0.6;
      suspensionStiffness = 120;
      maxSuspensionForce = 350000;
    } else if (this.vType === 'TRUCK') {
      mass = 3500;
      width = 2.4; height = 3.0; length = 7.5;
      wheelRadius = 0.55;
      suspensionRestLength = 0.55;
      suspensionStiffness = 95;
      maxSuspensionForce = 250000;
    } else if (this.vType === 'AMBULANCE') {
      mass = 2400;
      width = 2.3; height = 2.4; length = 6.2;
      wheelRadius = 0.5;
      suspensionRestLength = 0.5;
      suspensionStiffness = 75;
      maxSuspensionForce = 180000;
    } else if (this.vType === 'ICECREAM') {
      mass = 1900;
      width = 2.2; height = 2.3; length = 5.8;
      wheelRadius = 0.48;
      suspensionRestLength = 0.48;
      suspensionStiffness = 65;
      maxSuspensionForce = 150000;
    } else if (this.vType === 'DUMP_TRUCK') {
      mass = 4200;
      width = 2.5; height = 2.9; length = 7.8;
      wheelRadius = 0.6;
      suspensionRestLength = 0.58;
      suspensionStiffness = 110;
      maxSuspensionForce = 300000;
    } else if (this.vType === 'MOTORBIKE') {
      mass = 250;
      width = 0.7; height = 1.0; length = 2.2;
      wheelRadius = 0.35;
      suspensionRestLength = 0.35;
      suspensionStiffness = 55;
      maxSuspensionForce = 80000;
    }

    // 1. Chassis rigid body
    const chassisShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, length / 2));
    this.chassisBody = new CANNON.Body({
      mass: mass,
      material: this.physicsWorld.wheelMaterial
    });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, height * 0.15, 0));
    
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
      frictionSlip: this.vType === 'SPORTS' ? 8.0 : 6.0,
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

    if (this.vType === 'BUS') {
      // 6 wheels connection points
      // Front axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, -0.05, length * 0.38), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, -0.05, length * 0.38), wheelRadius));
      
      // Middle axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, -0.05, -length * 0.1), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, -0.05, -length * 0.1), wheelRadius));
      
      // Rear axle
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, -0.05, -length * 0.38), wheelRadius));
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, -0.05, -length * 0.38), wheelRadius));
    } else {
      // 4 wheels connection points
      const wOffsetZ = length * 0.35;
      
      // Front Left
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, -0.05, wOffsetZ), wheelRadius));
      // Front Right
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, -0.05, wOffsetZ), wheelRadius));
      // Rear Left
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(wOffsetX, -0.05, -wOffsetZ), wheelRadius));
      // Rear Right
      this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-wOffsetX, -0.05, -wOffsetZ), wheelRadius));
    }

    this.raycastVehicle.addToWorld(this.physicsWorld.world);
  }

  applyInput(keys, delta) {
    if (!keys || !this.chassisBody) return;

    // Freeze controls while a dialogue modal is open
    const dialogueOpen = window.app?.dialogueOverlay?.currentMission != null;
    if (dialogueOpen) {
      const numWheels = this.raycastVehicle.wheelInfos.length;
      for (let i = 0; i < numWheels; i++) {
        this.raycastVehicle.applyEngineForce(0, i);
        this.raycastVehicle.setBrake(80, i);
      }
      this.chassisBody.angularVelocity.y *= 0.7;
      return;
    }

    // Get analog inputs from InputManager or fall back to keys
    let analogThrottle = keys['w'] || keys['arrowup'] ? 1.0 : 0.0;
    let analogBrake = keys['s'] || keys['arrowdown'] ? 1.0 : 0.0;
    let analogSteer = (keys['a'] || keys['arrowleft'] ? 1.0 : 0.0) - (keys['d'] || keys['arrowright'] ? 1.0 : 0.0);
    let isHandbrake = keys[' '];

    if (window.app && window.app.inputManager) {
      const imState = window.app.inputManager.state;
      analogThrottle = Math.max(analogThrottle, imState.throttle);
      analogBrake = Math.max(analogBrake, imState.brake);
      if (Math.abs(imState.steer) > 0.05) {
        analogSteer = imState.steer;
      }
      isHandbrake = isHandbrake || imState.handbrake;
    }

    const isForward = analogThrottle > 0.05;
    const isReverse = analogBrake > 0.05;

    // Calculate forward speed along vehicle forward vector (+Z local)
    const forwardVec = new CANNON.Vec3(0, 0, 1);
    this.chassisBody.quaternion.vmult(forwardVec, forwardVec);
    const currentForwardSpeed = this.chassisBody.velocity.dot(forwardVec);

    const maxEngineForce = (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') ? 7200 : (this.vType === 'BUS' || this.vType === 'DUMP_TRUCK' ? 18000 : (this.vType === 'TRUCK' ? 12000 : (this.vType === 'AMBULANCE' ? 8500 : 4500)));
    const maxBrakeForce = (this.vType === 'BUS' || this.vType === 'DUMP_TRUCK') ? 600 : (this.vType === 'TRUCK' ? 400 : 160);
    const maxSteerVal = (this.vType === 'BUS' || this.vType === 'DUMP_TRUCK') ? 0.35 : (this.vType === 'TRUCK' ? 0.45 : 0.55);

    // 1. Steering (Analog smooth steering)
    const targetSteering = analogSteer * maxSteerVal;
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
    let engineForce = 0;
    let brakeForce = 0;

    if (isForward) {
      if (currentForwardSpeed < -1.5) {
        brakeForce = maxBrakeForce * analogThrottle;
      } else {
        engineForce = maxEngineForce * 1.3 * analogThrottle;
        brakeForce = 0;
        
        // Scale thrust dynamically with mass/type
        const thrustForceVal = (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') ? 54000 : (this.vType === 'BUS' || this.vType === 'DUMP_TRUCK' ? 140000 : (this.vType === 'TRUCK' ? 95000 : (this.vType === 'AMBULANCE' ? 68000 : 38000)));
        const maxSpeedLimit = (this.vType === 'SPORTS' || this.vType === 'SPORTS_CAR') ? 56 : (this.vType === 'BUS' || this.vType === 'DUMP_TRUCK' ? 22 : (this.vType === 'TRUCK' ? 28 : (this.vType === 'AMBULANCE' ? 46 : 42)));
        
        if (currentForwardSpeed < maxSpeedLimit) {
          const thrust = forwardVec.clone();
          thrust.scale(thrustForceVal * analogThrottle, thrust);
          this.chassisBody.applyForce(thrust, new CANNON.Vec3(0, 0, 0));
        }

        // Low speed takeoff assist to guarantee breaking out of any standstill or slight obstruction
        if (Math.abs(currentForwardSpeed) < 3.0) {
          const boost = forwardVec.clone();
          boost.scale(this.chassisBody.mass * 18.0 * analogThrottle, boost);
          this.chassisBody.applyForce(boost, new CANNON.Vec3(0, 0, 0));
        }
      }
    } else if (isReverse) {
      if (currentForwardSpeed > 1.5) {
        brakeForce = maxBrakeForce * analogBrake;
      } else {
        engineForce = -maxEngineForce * 1.15 * analogBrake;
        brakeForce = 0;
        if (currentForwardSpeed > -18) {
          const revThrust = forwardVec.clone();
          revThrust.scale(-24000, revThrust);
          this.chassisBody.applyForce(revThrust, new CANNON.Vec3(0, 0, 0));
        }
        // Low speed reverse assist
        if (Math.abs(currentForwardSpeed) < 3.0) {
          const revBoost = forwardVec.clone();
          revBoost.scale(-this.chassisBody.mass * 14.0, revBoost);
          this.chassisBody.applyForce(revBoost, new CANNON.Vec3(0, 0, 0));
        }
      }
    } else {
      brakeForce = 15;
    }

    if (isHandbrake) {
      brakeForce = maxBrakeForce * 2.5;
    }

    // 3. Lateral grip stabilization
    if (!isHandbrake && Math.abs(currentForwardSpeed) > 1.0) {
      const rightVec = new CANNON.Vec3(1, 0, 0);
      this.chassisBody.quaternion.vmult(rightVec, rightVec);
      const lateralVel = this.chassisBody.velocity.dot(rightVec);
      const antiDrift = rightVec.clone();
      antiDrift.scale(-lateralVel * this.chassisBody.mass * (this.vType === 'SPORTS' ? 12.0 : 10.0), antiDrift);
      this.chassisBody.applyForce(antiDrift, new CANNON.Vec3(0, 0, 0));
    }

    // 4. Aerodynamic downforce (oriented along vehicle local -Y normal)
    const speed = this.chassisBody.velocity.length();
    if (speed > 2) {
      const downForceFactor = this.vType === 'SPORTS' ? 600 : (this.vType === 'BUS' ? 100 : (this.vType === 'TRUCK' ? 200 : 400));
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
  }

  syncMesh() {
    if (!this.mesh || !this.chassisBody) return;

    // 1. Anti-Flip Auto-Righting Protection: Prevent vehicle from flipping upside down or rolling over sideways
    const upVec = new CANNON.Vec3(0, 1, 0);
    this.chassisBody.quaternion.vmult(upVec, upVec);
    if (upVec.y < 0.65) {
      const forwardCheck = new CANNON.Vec3(0, 0, 1);
      this.chassisBody.quaternion.vmult(forwardCheck, forwardCheck);
      const yaw = Math.atan2(forwardCheck.x, forwardCheck.z);
      const terrainSystem = this.physicsWorld ? this.physicsWorld.terrainSystem : null;
      const frontH = terrainSystem ? terrainSystem.getTerrainHeight(this.chassisBody.position.x + forwardCheck.x * 2.2, this.chassisBody.position.z + forwardCheck.z * 2.2) : 0;
      const backH = terrainSystem ? terrainSystem.getTerrainHeight(this.chassisBody.position.x - forwardCheck.x * 2.2, this.chassisBody.position.z - forwardCheck.z * 2.2) : 0;
      const pitch = Math.atan2(frontH - backH, 4.4);
      const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
      this.chassisBody.quaternion.set(targetQ.x, targetQ.y, targetQ.z, targetQ.w);
      this.chassisBody.angularVelocity.set(0, 0, 0);
    }

    // 2. Ensure vehicle never clips through terrain or road surfaces and stays flush on wheels
    let terrainY = 0.0;
    const terrainSystem = this.physicsWorld ? this.physicsWorld.terrainSystem : null;
    if (terrainSystem) {
      terrainY = terrainSystem.getTerrainHeight(this.chassisBody.position.x, this.chassisBody.position.z);
    }
    const minChassisY = terrainY + (this.meshOffset || 0.55);
    if (this.chassisBody.position.y < minChassisY) {
      this.chassisBody.position.y = minChassisY;
      if (this.chassisBody.velocity.y < 0) {
        this.chassisBody.velocity.y = 0;
      }
    }

    if (terrainSystem && this.chassisBody.position.y <= minChassisY + 0.85) {
      const forwardVec = new CANNON.Vec3(0, 0, 1);
      const rightVec = new CANNON.Vec3(1, 0, 0);
      this.chassisBody.quaternion.vmult(forwardVec, forwardVec);
      this.chassisBody.quaternion.vmult(rightVec, rightVec);

      const frontH = terrainSystem.getTerrainHeight(this.chassisBody.position.x + forwardVec.x * 2.2, this.chassisBody.position.z + forwardVec.z * 2.2);
      const backH = terrainSystem.getTerrainHeight(this.chassisBody.position.x - forwardVec.x * 2.2, this.chassisBody.position.z - forwardVec.z * 2.2);
      const leftH = terrainSystem.getTerrainHeight(this.chassisBody.position.x - rightVec.x * 1.2, this.chassisBody.position.z - rightVec.z * 1.2);
      const rightH = terrainSystem.getTerrainHeight(this.chassisBody.position.x + rightVec.x * 1.2, this.chassisBody.position.z + rightVec.z * 1.2);

      const targetPitch = Math.atan2(frontH - backH, 4.4);
      const targetRoll = Math.atan2(leftH - rightH, 2.4);
      const yaw = Math.atan2(forwardVec.x, forwardVec.z);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-targetPitch, yaw, targetRoll, 'YXZ'));
      this.chassisBody.quaternion.slerp(new CANNON.Quaternion(q.x, q.y, q.z, q.w), 0.45, this.chassisBody.quaternion);
      this.chassisBody.angularVelocity.z *= 0.1;
    }

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
    const speedMs = vel.length();
    this.speedKmH = Math.round(speedMs * 3.6);

    if (this.speedKmH < 3) this.gear = 1;
    else if (this.speedKmH < 35) this.gear = 2;
    else if (this.speedKmH < 65) this.gear = 3;
    else if (this.speedKmH < 105) this.gear = 4;
    else this.gear = 5;

    this.info['Speed'] = `${this.speedKmH} km/h (Gear ${this.gear})`;
  }

  resetPosition() {
    if (!this.chassisBody) return;
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
    if (this.raycastVehicle) {
      this.raycastVehicle.removeFromWorld(this.physicsWorld.world);
    }
    if (this.chassisBody) {
      this.physicsWorld.world.removeBody(this.chassisBody);
    }
  }
}
