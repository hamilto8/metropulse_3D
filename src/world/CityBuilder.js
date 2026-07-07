import * as THREE from 'three';

export class CityBuilder {
  constructor(scene, inspectorHud) {
    this.scene = scene;
    this.inspectorHud = inspectorHud;
    this.streetlamps = [];
    this.buildingPlots = [];
    this.roadNetwork = {
      intersections: [],
      lanes: []
    };
    this.sidewalkNetwork = [];
  }

  build() {
    this.createGround();
    this.createRoadGrid();
    this.createCentralPark();
    this.createStreetFurniture();
  }

  createGround() {
    // Main dark base ground
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0c0f1d,
      roughness: 0.9,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  createRoadGrid() {
    // Grid settings: roads at x/z = -100, -50, 0, 50, 100
    const roadCoords = [-100, -50, 0, 50, 100];
    const roadWidth = 14;
    const sidewalkWidth = 4;
    const blockSize = 50 - roadWidth;

    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x1a1e29,
      roughness: 0.85,
      metalness: 0.15
    });

    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x2e3548,
      roughness: 0.7,
      metalness: 0.1
    });

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 }); // Yellow road dividing line
    const whiteLineMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee }); // White crosswalks

    // 1. Create Roads along X and Z
    for (const pos of roadCoords) {
      // X-axis road
      const roadX = new THREE.Mesh(new THREE.PlaneGeometry(300, roadWidth), asphaltMat);
      roadX.rotation.x = -Math.PI / 2;
      roadX.position.set(0, 0.01, pos);
      roadX.receiveShadow = true;
      this.scene.add(roadX);

      // Yellow dividing line X
      const lineX = new THREE.Mesh(new THREE.PlaneGeometry(280, 0.4), lineMat);
      lineX.rotation.x = -Math.PI / 2;
      lineX.position.set(0, 0.02, pos);
      this.scene.add(lineX);

      // Z-axis road
      const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 300), asphaltMat);
      roadZ.rotation.x = -Math.PI / 2;
      roadZ.position.set(pos, 0.01, 0);
      roadZ.receiveShadow = true;
      this.scene.add(roadZ);

      // Yellow dividing line Z
      const lineZ = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 280), lineMat);
      lineZ.rotation.x = -Math.PI / 2;
      lineZ.position.set(pos, 0.02, 0);
      this.scene.add(lineZ);
    }

    // 2. Create Intersections & Crosswalks
    for (const x of roadCoords) {
      for (const z of roadCoords) {
        this.roadNetwork.intersections.push(new THREE.Vector3(x, 0, z));

        // Create 4 crosswalk stripes around intersection
        const offsets = [
          { x: 0, z: roadWidth / 2 + 1.5, rot: 0 },
          { x: 0, z: -(roadWidth / 2 + 1.5), rot: 0 },
          { x: roadWidth / 2 + 1.5, z: 0, rot: Math.PI / 2 },
          { x: -(roadWidth / 2 + 1.5), z: 0, rot: Math.PI / 2 }
        ];

        for (const off of offsets) {
          for (let s = -4; s <= 4; s += 2) {
            const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3), whiteLineMat);
            stripe.rotation.x = -Math.PI / 2;
            stripe.rotation.z = off.rot;
            if (off.rot === 0) {
              stripe.position.set(x + s, 0.03, z + off.z);
            } else {
              stripe.position.set(x + off.x, 0.03, z + s);
            }
            this.scene.add(stripe);
          }
        }
      }
    }

    // 3. Create City Blocks (Sidewalk tiles + Plots)
    const blockCenters = [-75, -25, 25, 75];
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        const isPark = (bx === -75 && bz === -75);

        // Sidewalk base block
        const sidewalkGeo = new THREE.BoxGeometry(blockSize + sidewalkWidth * 2, 0.4, blockSize + sidewalkWidth * 2);
        const sidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
        sidewalk.position.set(bx, 0.2, bz);
        sidewalk.receiveShadow = true;
        this.scene.add(sidewalk);

        // Register sidewalk center as waypoint for pedestrians
        this.sidewalkNetwork.push(new THREE.Vector3(bx, 0.4, bz));

        if (!isPark) {
          // Inner plot for building
          this.buildingPlots.push({
            x: bx,
            z: bz,
            width: blockSize - 4,
            depth: blockSize - 4
          });
        }
      }
    }
  }

  createCentralPark() {
    const parkCenter = { x: -75, z: -75 };
    const parkSize = 32;

    // Grass turf
    const grassGeo = new THREE.BoxGeometry(parkSize, 0.5, parkSize);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x1b4d2e,
      roughness: 0.9,
      metalness: 0.05
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.set(parkCenter.x, 0.45, parkCenter.z);
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Diagonal walking paths
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x8c857b, roughness: 0.9 });
    const path1 = new THREE.Mesh(new THREE.PlaneGeometry(parkSize * 1.3, 3), pathMat);
    path1.rotation.x = -Math.PI / 2;
    path1.rotation.z = Math.PI / 4;
    path1.position.set(parkCenter.x, 0.71, parkCenter.z);
    this.scene.add(path1);

    const path2 = new THREE.Mesh(new THREE.PlaneGeometry(parkSize * 1.3, 3), pathMat);
    path2.rotation.x = -Math.PI / 2;
    path2.rotation.z = -Math.PI / 4;
    path2.position.set(parkCenter.x, 0.71, parkCenter.z);
    this.scene.add(path2);

    // Glowing Central Fountain
    const poolGeo = new THREE.CylinderGeometry(6, 6, 0.8, 24);
    const poolMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.4 });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(parkCenter.x, 0.8, parkCenter.z);
    pool.castShadow = true;
    pool.receiveShadow = true;
    this.scene.add(pool);

    const waterGeo = new THREE.CylinderGeometry(5.4, 5.4, 0.6, 24);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.85
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(parkCenter.x, 0.9, parkCenter.z);
    this.scene.add(water);

    // Fountain center spout & neon ring
    const spoutGeo = new THREE.CylinderGeometry(1, 1.5, 3, 16);
    const spout = new THREE.Mesh(spoutGeo, poolMat);
    spout.position.set(parkCenter.x, 2.0, parkCenter.z);
    this.scene.add(spout);

    const ringGeo = new THREE.TorusGeometry(3.5, 0.2, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.5
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(parkCenter.x, 1.8, parkCenter.z);
    this.scene.add(ring);

    // Add Park Trees
    const treePositions = [
      { x: -85, z: -85 }, { x: -65, z: -85 },
      { x: -85, z: -65 }, { x: -65, z: -65 },
      { x: -90, z: -75 }, { x: -60, z: -75 },
      { x: -75, z: -90 }, { x: -75, z: -60 }
    ];

    for (const tPos of treePositions) {
      this.createTree(tPos.x, 0.7, tPos.z);
    }
  }

  createTree(x, y, z) {
    const treeGroup = new THREE.Group();

    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    treeGroup.add(trunk);

    // Foliage layers (low poly cones/dodecahedrons)
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1e824c, roughness: 0.8 });
    const leaves1 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.5, 1), leavesMat);
    leaves1.position.y = 3.5;
    leaves1.castShadow = true;
    treeGroup.add(leaves1);

    const leaves2 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.8, 1), leavesMat);
    leaves2.position.y = 5.2;
    leaves2.castShadow = true;
    treeGroup.add(leaves2);

    treeGroup.position.set(x, y, z);
    this.scene.add(treeGroup);
  }

  createStreetFurniture() {
    // Add streetlamps along sidewalk edges
    const roadCoords = [-100, -50, 0, 50, 100];
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xffaa00,
      emissiveIntensity: 0 // Will turn on at night
    });

    const lampPositions = [];
    for (const r of roadCoords) {
      for (let pos = -85; pos <= 85; pos += 30) {
        if (Math.abs(pos % 50) > 10) { // Don't block crosswalks
          lampPositions.push({ x: r + 8, z: pos, rot: -Math.PI / 2 });
          lampPositions.push({ x: r - 8, z: pos, rot: Math.PI / 2 });
          lampPositions.push({ x: pos, z: r + 8, rot: 0 });
          lampPositions.push({ x: pos, z: r - 8, rot: Math.PI });
        }
      }
    }

    for (const lPos of lampPositions) {
      const lampGroup = new THREE.Group();

      // Pole
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 8, 8), lampMat);
      pole.position.y = 4;
      pole.castShadow = true;
      lampGroup.add(pole);

      // Arm
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.5), lampMat);
      arm.position.set(0, 7.8, 1.0);
      lampGroup.add(arm);

      // Bulb
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), bulbMat.clone());
      bulb.position.set(0, 7.5, 2.0);
      lampGroup.add(bulb);

      // Spot Light Cone (for night effect)
      const spotLight = new THREE.SpotLight(0xffb84d, 0); // Start off
      spotLight.position.set(0, 7.5, 2.0);
      spotLight.target.position.set(0, 0, 2.0);
      spotLight.angle = Math.PI / 5;
      spotLight.penumbra = 0.5;
      spotLight.distance = 25;
      spotLight.castShadow = false; // Performance optimization
      lampGroup.add(spotLight);
      lampGroup.add(spotLight.target);

      lampGroup.position.set(lPos.x, 0.4, lPos.z);
      lampGroup.rotation.y = lPos.rot;
      this.scene.add(lampGroup);

      this.streetlamps.push({ bulb: bulb, light: spotLight });
    }
  }
}
