import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class PlayerVehicle {
  constructor(mesh, physicsWorld, initialPosition = null, initialRotation = null) {
    this.mesh = mesh;
    this.physicsWorld = physicsWorld;
    this.type = 'VEHICLE';
    this.isPhysicsControlled = true;
    this.currentSteering = 0;
    this.speedKmH = 0;
    this.gear = 1;
    this.info = {
      'Status': '🏎️ PHYSICS ACTION MODE',
      'Engine': 'Twin-Turbo V6 (cannon-es)',
      'Drive': 'AWD RaycastVehicle',
      'Speed': '0 km/h'
    };

    const startPos = initialPosition || mesh.position;
    const startRot = initialRotation || mesh.rotation;
    this.initPhysics(startPos, startRot);
  }

  initPhysics(pos, rot) {
    // 1. Chassis rigid body (box halfExtents: width 0.95m, height 0.45m, length 1.9m)
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.95, 0.45, 1.9));
    this.chassisBody = new CANNON.Body({
      mass: 1100,
      material: this.physicsWorld.wheelMaterial
    });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.2, 0));
    
    // Position chassis at Y = 1.05 so wheels rest precisely on road Y = 0.0
    this.chassisBody.position.set(pos.x, 1.05, pos.z);

    if (rot) {
      const q = new THREE.Quaternion().setFromEuler(rot);
      this.chassisBody.quaternion.set(q.x, q.y, q.z, q.w);
    }
    this.chassisBody.linearDamping = 0.15;
    this.chassisBody.angularDamping = 0.25;

    // 2. Create RaycastVehicle
    this.raycastVehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2
    });

    // Create distinct options object per wheel to prevent shared vector references
    const createWheelOptions = (connectionPoint) => ({
      radius: 0.42,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 48,
      suspensionRestLength: 0.45,
      frictionSlip: 6.0,
      dampingRelaxation: 2.8,
      dampingCompression: 4.5,
      maxSuspensionForce: 100000,
      rollInfluence: 0.05,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: connectionPoint,
      maxSuspensionTravel: 0.28,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true
    });

    // Front Left (wheel 0)
    this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(0.9, -0.05, 1.35)));

    // Front Right (wheel 1)
    this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-0.9, -0.05, 1.35)));

    // Rear Left (wheel 2)
    this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(0.9, -0.05, -1.35)));

    // Rear Right (wheel 3)
    this.raycastVehicle.addWheel(createWheelOptions(new CANNON.Vec3(-0.9, -0.05, -1.35)));

    this.raycastVehicle.addToWorld(this.physicsWorld.world);
  }

  applyInput(keys, delta) {
    if (!keys || !this.chassisBody) return;

    const isForward = keys['w'] || keys['arrowup'];
    const isReverse = keys['s'] || keys['arrowdown'];
    const isLeft = keys['a'] || keys['arrowleft'];
    const isRight = keys['d'] || keys['arrowright'];
    const isHandbrake = keys[' '];

    // Calculate forward speed along vehicle forward vector (+Z local)
    const forwardVec = new CANNON.Vec3(0, 0, 1);
    this.chassisBody.quaternion.vmult(forwardVec, forwardVec);
    const currentForwardSpeed = this.chassisBody.velocity.dot(forwardVec);

    const maxEngineForce = 4500;
    const maxBrakeForce = 160;
    const maxSteerVal = 0.55;

    // 1. Crisp Steering Angle + Direct Arcade Yaw Torque
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
        // Dampen angular velocity when not steering so the car tracks straight
        this.chassisBody.angularVelocity.y *= 0.85;
      }
    }

    // 2. Engine & Braking
    let engineForce = 0;
    let brakeForce = 0;

    if (isForward) {
      if (currentForwardSpeed < -1.0) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = maxEngineForce;
        // Direct forward thrust along current orientation
        const thrust = forwardVec.clone();
        thrust.scale(22000 * delta, thrust);
        this.chassisBody.applyForce(thrust, this.chassisBody.position);
      }
    } else if (isReverse) {
      if (currentForwardSpeed > 1.0) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = -maxEngineForce * 0.75;
        const revThrust = forwardVec.clone();
        revThrust.scale(-14000 * delta, revThrust);
        this.chassisBody.applyForce(revThrust, this.chassisBody.position);
      }
    } else {
      // Natural rolling resistance
      brakeForce = 15;
    }

    if (isHandbrake) {
      brakeForce = maxBrakeForce * 2.5;
    }

    // 3. Lateral grip stabilization (prevents sideways ice-skating unless handbraking)
    if (!isHandbrake && Math.abs(currentForwardSpeed) > 1.0) {
      const rightVec = new CANNON.Vec3(1, 0, 0);
      this.chassisBody.quaternion.vmult(rightVec, rightVec);
      const lateralVel = this.chassisBody.velocity.dot(rightVec);
      // Counteract sideways slide for clean arcade cornering
      const antiDrift = rightVec.clone();
      antiDrift.scale(-lateralVel * this.chassisBody.mass * 9.0 * delta, antiDrift);
      this.chassisBody.applyForce(antiDrift, this.chassisBody.position);
    }

    // 4. Aerodynamic downforce
    const speed = this.chassisBody.velocity.length();
    if (speed > 2) {
      const downForce = new CANNON.Vec3(0, -200 * speed, 0);
      this.chassisBody.applyForce(downForce, this.chassisBody.position);
    }

    for (let i = 0; i < 4; i++) {
      this.raycastVehicle.applyEngineForce(engineForce, i);
      this.raycastVehicle.setBrake(brakeForce, i);
    }
  }

  syncMesh() {
    if (!this.mesh || !this.chassisBody) return;

    // Sync chassis transform to visual Three.js mesh
    this.mesh.position.copy(this.chassisBody.position);
    // Offset Y so wheels rest exactly on ground level (Y = 0)
    this.mesh.position.y -= 0.55;
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

  resetPosition(yOffset = 1.2) {
    if (!this.chassisBody) return;
    // Flip upright if rolled over
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
