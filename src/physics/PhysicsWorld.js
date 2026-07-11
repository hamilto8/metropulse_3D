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
    this.playerVehicles = new Set();
    this.weatherMode = 'clear';
    this.weatherGripMultiplier = 1.0;
    this.initGround();
  }

  initGround() {
    // Static ground slab at Y = -1 with thickness 2 (top surface exactly at Y = 0.0)
    // CANNON.Box uses halfExtents, so (500, 1, 500) creates a 1000x2x1000 ground block
    const groundShape = new CANNON.Box(new CANNON.Vec3(500, 1, 500));
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.groundMaterial,
      shape: groundShape
    });
    groundBody.position.set(0, -1, 0);
    this.world.addBody(groundBody);
    this.groundBody = groundBody;
  }

  initCountrysideTerrain(cityBuilder) {
    if (!cityBuilder || typeof cityBuilder.getHillHeight !== 'function') return;

    // Create a continuous, smooth CANNON.Heightfield covering the countryside (X: 400 to 820, Z: -400 to 400)
    // This creates a seamless triangulated physics terrain with ZERO vertical steps or invisible walls.
    const startX = 400;
    const startZ = 400;
    const elementSize = 5;
    const numX = 85;
    const numY = 161;

    const matrix = [];
    for (let i = 0; i < numX; i++) {
      matrix.push([]);
      for (let j = 0; j < numY; j++) {
        const worldX = startX + i * elementSize;
        const worldZ = startZ - j * elementSize;
        const h = cityBuilder.getHillHeight(worldX, worldZ);
        matrix[i].push(h);
      }
    }

    const hfShape = new CANNON.Heightfield(matrix, {
      elementSize: elementSize
    });

    const hfBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.groundMaterial
    });
    hfBody.addShape(hfShape);

    // Position at start corner and rotate -PI/2 around X axis so CANNON local Z maps to world +Y
    hfBody.position.set(startX, 0, startZ);
    hfBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);

    this.world.addBody(hfBody);
    this.countrysideTerrainBody = hfBody;
  }

  setWeatherFriction(weatherMode) {
    this.weatherMode = weatherMode;
    if (weatherMode === 'rain') {
      // Slick asphalt drifting in heavy rain!
      this.wheelGroundContact.friction = 0.28;
      this.weatherGripMultiplier = 0.48;
    } else if (weatherMode === 'thunderstorm') {
      // Drenched asphalt, super slick drifting storm!
      this.wheelGroundContact.friction = 0.22;
      this.weatherGripMultiplier = 0.38;
    } else if (weatherMode === 'mist') {
      this.wheelGroundContact.friction = 0.55;
      this.weatherGripMultiplier = 0.72;
    } else {
      this.wheelGroundContact.friction = 0.85;
      this.weatherGripMultiplier = 1.0;
    }

    // RaycastVehicle wheels are rays rather than rigid wheel bodies, so their
    // traction does not come from ContactMaterial. Propagate weather grip to
    // every active player vehicle explicitly.
    for (const vehicle of this.playerVehicles) {
      if (vehicle && typeof vehicle.applyWeatherGrip === 'function') {
        vehicle.applyWeatherGrip(this.weatherGripMultiplier);
      }
    }
  }

  registerPlayerVehicle(vehicle) {
    if (!vehicle) return;
    this.playerVehicles.add(vehicle);
    if (typeof vehicle.applyWeatherGrip === 'function') {
      vehicle.applyWeatherGrip(this.weatherGripMultiplier);
    }
  }

  unregisterPlayerVehicle(vehicle) {
    this.playerVehicles.delete(vehicle);
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

  removeStaticCollider(body) {
    if (!body) return;
    if (this.world.bodies.includes(body)) {
      this.world.removeBody(body);
    }
  }

  restoreStaticCollider(body) {
    if (!body) return;
    if (!this.world.bodies.includes(body)) {
      this.world.addBody(body);
    }
    if (!this.staticBodies.includes(body)) {
      this.staticBodies.push(body);
    }
  }

  addKinematicBoxCollider(position, size) {
    const halfExtents = new CANNON.Vec3(
      (size.x || size.width || 1) * 0.5,
      (size.y || size.height || 1) * 0.5,
      (size.z || size.depth || 1) * 0.5
    );
    const boxShape = new CANNON.Box(halfExtents);
    const boxBody = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      material: this.obstacleMaterial,
      shape: boxShape
    });
    boxBody.position.set(position.x, position.y, position.z);
    this.world.addBody(boxBody);
    return boxBody;
  }

  step(delta) {
    // Fixed time step 1/120s with up to 10 sub-steps to eliminate tunneling
    const dt = Math.min(delta, 0.1);
    this.world.step(1 / 120, dt, 10);
  }
}
