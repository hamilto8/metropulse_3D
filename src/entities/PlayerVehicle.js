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

    this.initPhysics(initialPosition || mesh.position, initialRotation || mesh.rotation);
  }

  initPhysics(pos, rot) {
    // 1. Chassis rigid body
    const chassisShape = new CANNON.Box(new CANNON.Vec3(1.1, 0.6, 2.1));
    this.chassisBody = new CANNON.Body({
      mass: 1200,
      material: this.physicsWorld.wheelMaterial
    });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.3, 0));
    this.chassisBody.position.set(pos.x, pos.y + 1.2, pos.z);

    if (rot) {
      const q = new THREE.Quaternion().setFromEuler(rot);
      this.chassisBody.quaternion.set(q.x, q.y, q.z, q.w);
    }

    // 2. Create RaycastVehicle
    this.raycastVehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2
    });

    const wheelOptions = {
      radius: 0.48,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 42,
      suspensionRestLength: 0.45,
      frictionSlip: 5.0,
      dampingRelaxation: 2.3,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.08,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
      maxSuspensionTravel: 0.3,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true
    };

    // Front Left (wheel 0)
    wheelOptions.chassisConnectionPointLocal.set(0.95, 0.1, 1.4);
    this.raycastVehicle.addWheel(wheelOptions);

    // Front Right (wheel 1)
    wheelOptions.chassisConnectionPointLocal.set(-0.95, 0.1, 1.4);
    this.raycastVehicle.addWheel(wheelOptions);

    // Rear Left (wheel 2)
    wheelOptions.chassisConnectionPointLocal.set(0.95, 0.1, -1.4);
    this.raycastVehicle.addWheel(wheelOptions);

    // Rear Right (wheel 3)
    wheelOptions.chassisConnectionPointLocal.set(-0.95, 0.1, -1.4);
    this.raycastVehicle.addWheel(wheelOptions);

    this.raycastVehicle.addToWorld(this.physicsWorld.world);
  }

  applyInput(keys, delta) {
    if (!keys) return;

    const isForward = keys['w'] || keys['arrowup'];
    const isReverse = keys['s'] || keys['arrowdown'];
    const isLeft = keys['a'] || keys['arrowleft'];
    const isRight = keys['d'] || keys['arrowright'];
    const isHandbrake = keys[' '];

    const maxEngineForce = 3800;
    const maxBrakeForce = 120;
    const maxSteerVal = 0.52;

    // Steering interpolation
    let targetSteering = 0;
    if (isLeft) targetSteering = maxSteerVal;
    if (isRight) targetSteering = -maxSteerVal;
    this.currentSteering += (targetSteering - this.currentSteering) * Math.min(1.0, delta * 12.0);

    this.raycastVehicle.setSteeringValue(this.currentSteering, 0);
    this.raycastVehicle.setSteeringValue(this.currentSteering, 1);

    // Engine & Braking
    let engineForce = 0;
    let brakeForce = 0;

    const currentForwardSpeed = this.chassisBody.velocity.dot(
      this.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1))
    );

    if (isForward) {
      if (currentForwardSpeed < -1.5) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = maxEngineForce;
      }
    } else if (isReverse) {
      if (currentForwardSpeed > 1.5) {
        brakeForce = maxBrakeForce;
      } else {
        engineForce = -maxEngineForce * 0.65;
      }
    }

    if (isHandbrake) {
      brakeForce = maxBrakeForce * 1.8;
    }

    // Apply engine force to all 4 wheels (AWD responsive drive)
    for (let i = 0; i < 4; i++) {
      this.raycastVehicle.applyEngineForce(engineForce, i);
      this.raycastVehicle.setBrake(brakeForce, i);
    }
  }

  syncMesh() {
    if (!this.mesh || !this.chassisBody) return;

    // Sync chassis transform to Three.js mesh
    this.mesh.position.copy(this.chassisBody.position);
    this.mesh.position.y -= 0.35; // Align visual center with suspension
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

  resetPosition(yOffset = 2.0) {
    if (!this.chassisBody) return;
    // Flip upright if rolled over
    this.chassisBody.position.y += yOffset;
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
