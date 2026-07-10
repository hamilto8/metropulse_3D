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
    if (this.vType === 'SPORTS') this.meshOffset = 0.48;
    else if (this.vType === 'TRUCK') this.meshOffset = 1.35;
    else if (this.vType === 'BUS') this.meshOffset = 2.05;

    this.initPhysics(startPos, startRot);
  }

  getEngineName(vType) {
    switch (vType) {
      case 'SPORTS': return 'High-Rev V8 Hybrid (cannon-es)';
      case 'BUS': return 'Heavy-Duty Electric Drive';
      case 'TRUCK': return 'High-Torque Turbodiesel';
      case 'POLICE': return 'Interceptor V8 Supercharged';
      default: return 'Twin-Turbo V6 (cannon-es)';
    }
  }

  getDriveType(vType) {
    switch (vType) {
      case 'SPORTS': return 'RWD Performance Chassis';
      case 'BUS': return '6x4 Transit Chassis';
      case 'TRUCK': return 'Rear-Dual Heavy Duty';
      case 'POLICE': return 'Pursuit-Tuned AWD';
      default: return 'AWD RaycastVehicle';
    }
  }

  initPhysics(pos, rot) {
    let mass = 1200;
    let width = 2.0, height = 1.4, length = 4.2;
    let wheelRadius = 0.4, suspensionRestLength = 0.45, suspensionStiffness = 48;
    let maxSuspensionForce = 100000;
    
    if (this.vType === 'SPORTS') {
      mass = 950;
      width = 2.1; height = 1.1; length = 4.4;
      wheelRadius = 0.45;
      suspensionRestLength = 0.38;
      suspensionStiffness = 65;
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
    }

    // 1. Chassis rigid body
    const chassisShape = new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, length / 2));
    this.chassisBody = new CANNON.Body({
      mass: mass,
      material: this.physicsWorld.wheelMaterial
    });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, height * 0.15, 0));
    
    const initialY = pos.y > 0.5 ? pos.y : (wheelRadius + height * 0.5);
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

    const isForward = keys['w'] || keys['arrowup'];
    const isReverse = keys['s'] || keys['arrowdown'];
    const isLeft = keys['a'] || keys['arrowleft'];
    const isRight = keys['d'] || keys['arrowright'];
    const isHandbrake = keys[' '];

    // Calculate forward speed along vehicle forward vector (+Z local)
    const forwardVec = new CANNON.Vec3(0, 0, 1);
    this.chassisBody.quaternion.vmult(forwardVec, forwardVec);
    const currentForwardSpeed = this.chassisBody.velocity.dot(forwardVec);

    const maxEngineForce = this.vType === 'SPORTS' ? 6500 : (this.vType === 'BUS' ? 18000 : (this.vType === 'TRUCK' ? 12000 : 4500));
    const maxBrakeForce = this.vType === 'BUS' ? 600 : (this.vType === 'TRUCK' ? 400 : 160);
    const maxSteerVal = this.vType === 'BUS' ? 0.35 : (this.vType === 'TRUCK' ? 0.45 : 0.55);

    // 1. Steering
    let targetSteering = 0;
    if (isLeft) targetSteering = maxSteerVal;
    if (isRight) targetSteering = -maxSteerVal;
    this.currentSteering += (targetSteering - this.currentSteering) * Math.min(1.0, delta * 16.0);

    this.raycastVehicle.setSteeringValue(this.currentSteering, 0);
    this.raycastVehicle.setSteeringValue(this.currentSteering, 1);

    // Apply direct yaw response when moving so steering is accurate and responsive
    if (Math.abs(currentForwardSpeed) > 0.5) {
      const turnDir = currentForwardSpeed > 0 ? 1 : -1;
      const turnRate = Math.min(2.8, Math.abs(currentForwardSpeed) * 0.16);
      if (isLeft) {
        this.chassisBody.angularVelocity.y = turnRate * turnDir;
      } else if (isRight) {
        this.chassisBody.angularVelocity.y = -turnRate * turnDir;
      } else {
        this.chassisBody.angularVelocity.y *= 0.85;
      }
    }

    // 2. Engine & Braking
    let engineForce = 0;
    let brakeForce = 0;

    if (isForward) {
      if (currentForwardSpeed < -1.5) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = maxEngineForce * 1.3;
        brakeForce = 0;
        
        // Scale thrust dynamically with mass/type
        const thrustForceVal = this.vType === 'SPORTS' ? 48000 : (this.vType === 'BUS' ? 140000 : (this.vType === 'TRUCK' ? 95000 : 38000));
        const maxSpeedLimit = this.vType === 'SPORTS' ? 52 : (this.vType === 'BUS' ? 22 : (this.vType === 'TRUCK' ? 28 : 42));
        
        if (currentForwardSpeed < maxSpeedLimit) {
          const thrust = forwardVec.clone();
          thrust.scale(thrustForceVal, thrust);
          this.chassisBody.applyForce(thrust, new CANNON.Vec3(0, 0, 0));
        }

        // Low speed takeoff assist to guarantee breaking out of any standstill or slight obstruction
        if (Math.abs(currentForwardSpeed) < 3.0) {
          const boost = forwardVec.clone();
          boost.scale(this.chassisBody.mass * 18.0, boost);
          this.chassisBody.applyForce(boost, new CANNON.Vec3(0, 0, 0));
        }
      }
    } else if (isReverse) {
      if (currentForwardSpeed > 1.5) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = -maxEngineForce * 1.15;
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

    // 4. Aerodynamic downforce
    const speed = this.chassisBody.velocity.length();
    if (speed > 2) {
      const downForceFactor = this.vType === 'SPORTS' ? -600 : (this.vType === 'BUS' ? -100 : (this.vType === 'TRUCK' ? -200 : -400));
      const downForce = new CANNON.Vec3(0, downForceFactor * speed, 0);
      this.chassisBody.applyForce(downForce, new CANNON.Vec3(0, 0, 0));
    }

    const numWheels = this.raycastVehicle.wheelInfos.length;
    for (let i = 0; i < numWheels; i++) {
      this.raycastVehicle.applyEngineForce(engineForce, i);
      this.raycastVehicle.setBrake(brakeForce, i);
    }
  }

  syncMesh() {
    if (!this.mesh || !this.chassisBody) return;

    // Safety height check only if the vehicle has fallen through the ground plane
    let terrainY = 0.0;
    const terrainSystem = this.physicsWorld ? this.physicsWorld.terrainSystem : null;
    if (terrainSystem) {
      terrainY = terrainSystem.getTerrainHeight(this.chassisBody.position.x, this.chassisBody.position.z) - 0.05;
    }
    if (this.chassisBody.position.y < terrainY - 5.0) {
      this.chassisBody.position.y = terrainY + 1.2;
      this.chassisBody.velocity.set(0, 0, 0);
      this.chassisBody.angularVelocity.set(0, 0, 0);
    }

    // Sync chassis transform to visual Three.js mesh
    this.mesh.position.copy(this.chassisBody.position);
    this.mesh.position.y -= this.meshOffset;
    this.mesh.quaternion.copy(this.chassisBody.quaternion);

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

  destroy() {
    if (this.raycastVehicle) {
      this.raycastVehicle.removeFromWorld(this.physicsWorld.world);
    }
    if (this.chassisBody) {
      this.physicsWorld.world.removeBody(this.chassisBody);
    }
  }
}
