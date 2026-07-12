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
    // Match the two rendered city land masses. The former 1000 m slab covered
    // the rivers and overlapped x=400..500 of the countryside heightfield,
    // causing wheel rays to alternate between flat ground and the hillside.
    this.groundBodies = [
      this.addSurfaceBox({ x: -182.5, y: -1, z: 0 }, { x: 635, y: 2, z: 800 }),
      this.addSurfaceBox({ x: 282.5, y: -1, z: 0 }, { x: 195, y: 2, z: 800 })
    ];
    this.groundBody = this.groundBodies[0];
  }

  addSurfaceBox(position, size, { rotationY = 0 } = {}) {
    const shape = new CANNON.Box(new CANNON.Vec3(size.x * 0.5, size.y * 0.5, size.z * 0.5));
    const body = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial, shape });
    body.position.set(position.x, position.y, position.z);
    if (rotationY) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
    this.world.addBody(body);
    return body;
  }

  initCountrysideTerrain(cityBuilder) {
    if (!cityBuilder || typeof cityBuilder.getHillHeight !== 'function') return;

    // cannon-es Heightfield left one-sided raycast gaps in the negative-Z half
    // of this rotated terrain. An explicit consistently-wound Trimesh keeps
    // every wheel ray on the same surface used by the rendered countryside.
    const startX = 420;
    const startZ = -400;
    const elementSize = 5;
    const numX = 82;
    const numY = 161;
    const vertices = [];
    const indices = [];
    for (let i = 0; i < numX; i++) {
      for (let j = 0; j < numY; j++) {
        const worldX = startX + i * elementSize;
        const worldZ = startZ + j * elementSize;
        vertices.push(worldX, cityBuilder.getHillHeight(worldX, worldZ), worldZ);
      }
    }
    for (let i = 0; i < numX - 1; i++) {
      for (let j = 0; j < numY - 1; j++) {
        const a = i * numY + j;
        const b = (i + 1) * numY + j;
        const c = (i + 1) * numY + j + 1;
        const d = i * numY + j + 1;
        indices.push(a, c, b, a, d, c);
      }
    }
    const terrainBody = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMaterial });
    terrainBody.addShape(new CANNON.Trimesh(vertices, indices));
    this.world.addBody(terrainBody);
    this.countrysideTerrainBody = terrainBody;

    for (const deck of cityBuilder.drivableDecks || []) {
      this.addSurfaceBox(
        { x: (deck.minX + deck.maxX) * 0.5, y: deck.height - 0.5, z: (deck.minZ + deck.maxZ) * 0.5 },
        { x: deck.maxX - deck.minX, y: 1, z: deck.maxZ - deck.minZ }
      );
    }
    for (const surface of cityBuilder.surfaceColliders || []) {
      this.addSurfaceBox(surface.position, surface.size, { rotationY: surface.rotationY || 0 });
    }
    for (const obstacle of cityBuilder.sceneryColliders || []) {
      this.addStaticBoxCollider(obstacle.position, obstacle.size, { rotationY: obstacle.rotationY || 0 });
    }
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

  addStaticBoxCollider(position, size, { rotationY = 0 } = {}) {
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
    if (rotationY) boxBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotationY);
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
