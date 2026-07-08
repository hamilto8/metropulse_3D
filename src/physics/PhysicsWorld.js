import * as CANNON from 'cannon-es';

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -25, 0); // Responsive arcade-style gravity
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;

    // Contact Materials
    this.groundMaterial = new CANNON.Material('groundMaterial');
    this.wheelMaterial = new CANNON.Material('wheelMaterial');
    this.obstacleMaterial = new CANNON.Material('obstacleMaterial');

    this.wheelGroundContact = new CANNON.ContactMaterial(
      this.wheelMaterial,
      this.groundMaterial,
      {
        friction: 0.85,          // Dry asphalt friction
        restitution: 0.1,        // Very low bounce on road
        contactEquationStiffness: 1000
      }
    );
    this.world.addContactMaterial(this.wheelGroundContact);

    this.wheelObstacleContact = new CANNON.ContactMaterial(
      this.wheelMaterial,
      this.obstacleMaterial,
      {
        friction: 0.3,
        restitution: 0.45        // Energetic bounce off lamp posts and buildings
      }
    );
    this.world.addContactMaterial(this.wheelObstacleContact);

    this.staticBodies = [];
    this.initGround();
  }

  initGround() {
    // Static ground plane at Y = 0
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.groundMaterial,
      shape: new CANNON.Plane()
    });
    // CANNON planes face +Z by default; rotate to face +Y
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.set(0, 0, 0);
    this.world.addBody(groundBody);
    this.groundBody = groundBody;
  }

  setWeatherFriction(weatherMode) {
    if (weatherMode === 'rain') {
      // Slick asphalt drifting in heavy rain!
      this.wheelGroundContact.friction = 0.28;
    } else if (weatherMode === 'mist') {
      this.wheelGroundContact.friction = 0.55;
    } else {
      this.wheelGroundContact.friction = 0.85;
    }
  }

  addStaticBoxCollider(position, size) {
    // size is THREE.Vector3 or object with width, height, depth
    const halfExtents = new CANNON.Vec3(
      (size.x || size.width || 1) * 0.5,
      (size.y || size.height || 1) * 0.5,
      (size.z || size.depth || 1) * 0.5
    );
    const boxShape = new CANNON.Box(halfExtents);
    const boxBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.obstacleMaterial,
      shape: boxShape
    });
    boxBody.position.set(position.x, position.y, position.z);
    this.world.addBody(boxBody);
    this.staticBodies.push(boxBody);
    return boxBody;
  }

  step(delta) {
    // Fixed time step 1/60s with up to 3 sub-steps for stability
    const dt = Math.min(delta, 0.1);
    this.world.step(1 / 60, dt, 3);
  }
}
