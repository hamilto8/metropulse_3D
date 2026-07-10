import * as THREE from 'three';

export class CityBuilder {
  constructor(scene, inspectorHud, billboardCanvas) {
    this.scene = scene;
    this.inspectorHud = inspectorHud;
    this.billboardCanvas = billboardCanvas;
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
    this.createRiverAndBridge();
    this.createCentralPark();
    this.createStreetFurniture();
    this.createCountrysideNature();
    this.createCountrysideSuburb();
    this.createRocketCenter(700, -280);
  }

  createCountrysideNature() {
    // Scatter trees randomly across countryside hills (X: 440 to 800)
    // Avoid Z values directly near the roads to prevent trees growing on the streets!
    // The road Z coords are: -100, -50, 0, 50, 100
    for (let i = 0; i < 90; i++) {
      const x = 440 + Math.random() * 340;
      const z = -350 + Math.random() * 700;

      // Check distance to roads to avoid blocking streets
      let nearRoad = false;
      for (const rz of [-100, -50, 0, 50, 100]) {
        if (Math.abs(z - rz) < 12.0) {
          nearRoad = true;
          break;
        }
      }
      // Also avoid the road X coords (450, 550, 650, 750)
      for (const rx of [450, 550, 650, 750]) {
        if (Math.abs(x - rx) < 12.0) {
          nearRoad = true;
          break;
        }
      }

      // Avoid rocket launchpad and billboard areas
      const nearRocket = (x > 670 && x < 730 && z > -310 && z < -250);
      const nearBillboardSpace = (x > 600 && x < 644 && z > -180 && z < -140);
      if (nearRocket || nearBillboardSpace) {
        continue;
      }
      
      if (!nearRoad) {
        const y = this.getHillHeight(x, z);
        this.createTree(x, y - 0.2, z);
      }
    }
  }

  createCountrysideSuburb() {
    // Grid locations for houses
    // Roads X are: 450, 550, 650, 750
    // Midpoints X: 500, 600, 700
    // Roads Z are: -100, -50, 0, 50, 100
    // Midpoints Z: -75, -25, 25, 75
    const midX = [500, 600, 700];
    const midZ = [-125, -75, -25, 25, 75, 125];

    for (const hx of midX) {
      for (const hz of midZ) {
        // 80% chance to spawn a house at each grid position to look organic and have some empty fields
        if (Math.random() < 0.8) {
          // Offset slightly from a strict grid to look natural and cozy
          const xOffset = (Math.random() - 0.5) * 6.0;
          const zOffset = (Math.random() - 0.5) * 6.0;
          this.createSuburbanHouse(hx + xOffset, hz + zOffset);
        }
      }
    }
  }

  createGabledRoofGeometry(width, height, depth) {
    const geo = new THREE.BufferGeometry();
    const w2 = width / 2;
    const d2 = depth / 2;

    // 6 vertices defining the triangular prism
    const vertices = new Float32Array([
      // Front Triangle
      -w2, 0, d2,      // 0: left front bottom
       w2, 0, d2,      // 1: right front bottom
        0, height, d2, // 2: peak front

      // Back Triangle
      -w2, 0, -d2,     // 3: left back bottom
       w2, 0, -d2,     // 4: right back bottom
        0, height, -d2 // 5: peak back
    ]);

    // Triangle indices (12 triangles = 8 faces)
    const indices = [
      // Front face
      0, 1, 2,
      // Back face
      4, 3, 5,
      // Left slope
      3, 0, 2,
      3, 2, 5,
      // Right slope
      1, 4, 5,
      1, 5, 2,
      // Bottom face
      3, 4, 1,
      3, 1, 0
    ];

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  createSuburbanHouse(x, z) {
    const houseGroup = new THREE.Group();
    const terrainY = this.getHillHeight(x, z);
    houseGroup.position.set(x, terrainY, z);

    // Randomize colors for a cute suburban variety
    const bodyColors = [0xdfd3c3, 0xa3b899, 0xb8b5ff, 0xfce38a, 0xe23e57, 0x3f72af, 0x95e1d3];
    const wallColor = bodyColors[Math.floor(Math.random() * bodyColors.length)];

    // 1. House Body (Walls)
    const wallWidth = 10;
    const wallHeight = 6;
    const wallDepth = 8;
    const houseBodyGeo = new THREE.BoxGeometry(wallWidth, wallHeight, wallDepth);
    const houseBodyMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.8,
      metalness: 0.1
    });
    const houseBody = new THREE.Mesh(houseBodyGeo, houseBodyMat);
    houseBody.position.y = wallHeight / 2;
    houseBody.castShadow = true;
    houseBody.receiveShadow = true;
    houseGroup.add(houseBody);

    // 2. Gabled Roof (using a perfect procedural triangular prism)
    const roofWidth = wallWidth + 1.6;
    const roofHeight = 3.5;
    const roofDepth = wallDepth + 0.8;
    const roofGeo = this.createGabledRoofGeometry(roofWidth, roofHeight, roofDepth);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x5c3d2e, // Warm brown roof tiles
      roughness: 0.9,
      metalness: 0.1
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = wallHeight;
    roof.castShadow = true;
    houseGroup.add(roof);

    // 3. Cozy Lit Windows (Yellow glowing planes)
    const windowGeo = new THREE.PlaneGeometry(1.2, 1.6);
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xffe066,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
      roughness: 0.2
    });

    // Windows on Front face
    const winFrontL = new THREE.Mesh(windowGeo, windowMat);
    winFrontL.position.set(-2.2, 2.5, wallDepth / 2 + 0.02);
    houseGroup.add(winFrontL);

    const winFrontR = new THREE.Mesh(windowGeo, windowMat);
    winFrontR.position.set(2.2, 2.5, wallDepth / 2 + 0.02);
    houseGroup.add(winFrontR);

    // Windows on Back face
    const winBackL = new THREE.Mesh(windowGeo, windowMat);
    winBackL.position.set(-2.2, 2.5, -wallDepth / 2 - 0.02);
    winBackL.rotation.y = Math.PI;
    houseGroup.add(winBackL);

    const winBackR = new THREE.Mesh(windowGeo, windowMat);
    winBackR.position.set(2.2, 2.5, -wallDepth / 2 - 0.02);
    winBackR.rotation.y = Math.PI;
    houseGroup.add(winBackR);

    // 4. Little Wooden Door
    const doorGeo = new THREE.PlaneGeometry(1.8, 3.2);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x3e2723, // Dark mahogany door
      roughness: 0.85
    });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 1.6, wallDepth / 2 + 0.03);
    houseGroup.add(door);

    // Tiny porch light sphere
    const bulbGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffddaa });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(1.4, 2.8, wallDepth / 2 + 0.15);
    houseGroup.add(bulb);

    // 5. Stone Chimney
    const chimneyGeo = new THREE.BoxGeometry(1.2, 4.0, 1.2);
    const chimneyMat = new THREE.MeshStandardMaterial({
      color: 0x6d4c41, // Terracotta chimney
      roughness: 0.9
    });
    const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
    chimney.position.set(-2.8, wallHeight + 2.5, -1.5);
    chimney.castShadow = true;
    houseGroup.add(chimney);

    // Rotate house slightly for organic suburban feel
    houseGroup.rotation.y = (Math.random() - 0.5) * 0.15;

    this.scene.add(houseGroup);
  }

  createGround() {
    // 1. West Ground Plane
    const westGeo = new THREE.PlaneGeometry(335, 800);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0c0f1d,
      roughness: 0.9,
      metalness: 0.1
    });
    const westGround = new THREE.Mesh(westGeo, groundMat);
    westGround.rotation.x = -Math.PI / 2;
    westGround.position.set(-32.5, -0.1, 0);
    westGround.receiveShadow = true;
    this.scene.add(westGround);

    // 2. East Ground Plane (Resized to end at X = 380: width 245, centered at 257.5)
    const eastGeo = new THREE.PlaneGeometry(245, 800);
    const eastGround = new THREE.Mesh(eastGeo, groundMat);
    eastGround.rotation.x = -Math.PI / 2;
    eastGround.position.set(257.5, -0.1, 0);
    eastGround.receiveShadow = true;
    this.scene.add(eastGround);

    // 3. First River Basin Bottom (X: 135 to 185)
    const basinGeo = new THREE.PlaneGeometry(50, 800);
    const basinMat = new THREE.MeshStandardMaterial({ color: 0x05070f, roughness: 1.0 });
    const basin = new THREE.Mesh(basinGeo, basinMat);
    basin.rotation.x = -Math.PI / 2;
    basin.position.set(160, -4.0, 0);
    this.scene.add(basin);

    // 3.5 Second River Basin Bottom (X: 380 to 420, width 40, centered at 400)
    const basinGeo2 = new THREE.PlaneGeometry(40, 800);
    const basin2 = new THREE.Mesh(basinGeo2, basinMat);
    basin2.rotation.x = -Math.PI / 2;
    basin2.position.set(400, -4.0, 0);
    this.scene.add(basin2);

    // 4. Countryside Ground Plane with rolling hills (X: 420 to 820)
    const countrysideGeo = new THREE.PlaneGeometry(400, 800, 50, 80);
    const posAttr = countrysideGeo.attributes.position;
    const colors = [];
    const colorGrass = new THREE.Color(0x3b7a57); // Forest green
    const colorDirt = new THREE.Color(0x705335);  // Rich dirt brown

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getY(i);
      const worldX = 620 + vx;
      const worldZ = vz;

      // Hill height formula
      const factor = Math.min(1.0, (worldX - 420) / 100);
      const height = (Math.sin(worldX * 0.05) * Math.cos(worldZ * 0.04) * 8 + Math.sin(worldX * 0.02) * 15) * factor;
      posAttr.setZ(i, height);

      // Organic dirt patches based on noise formula
      const noiseVal = Math.sin(worldX * 0.08) * Math.cos(worldZ * 0.06) + Math.sin(worldX * 0.03) * Math.cos(worldZ * 0.03);
      const isDirt = noiseVal > 0.6 && worldX > 450;

      const vertexColor = new THREE.Color();
      if (isDirt) {
        vertexColor.copy(colorDirt).multiplyScalar(0.9 + Math.random() * 0.2);
      } else {
        vertexColor.copy(colorGrass).multiplyScalar(0.9 + Math.random() * 0.2);
      }
      colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }

    countrysideGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    countrysideGeo.computeVertexNormals();

    const countrysideMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.05
    });

    const countrysideGround = new THREE.Mesh(countrysideGeo, countrysideMat);
    countrysideGround.rotation.x = -Math.PI / 2;
    countrysideGround.position.set(620, -0.1, 0);
    countrysideGround.receiveShadow = true;
    this.scene.add(countrysideGround);
  }

  getHillHeight(x, z) {
    if (x >= 420) {
      const factor = Math.min(1.0, (x - 420) / 100);
      return (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 8 + Math.sin(x * 0.02) * 15) * factor;
    }
    return 0.0;
  }

  createRoadGrid() {
    const roadCoordsZ = [-100, -50, 0, 50, 100];
    const roadCoordsX = [-100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750];
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

    // 1. Create Roads along X (West and East segments) and along Z
    for (const posZ of roadCoordsZ) {
      // West road segment (X: -150 to 115, center -17.5, width 265)
      const roadWest = new THREE.Mesh(new THREE.PlaneGeometry(265, roadWidth), asphaltMat);
      roadWest.rotation.x = -Math.PI / 2;
      roadWest.position.set(-17.5, 0.01, posZ);
      roadWest.receiveShadow = true;
      this.scene.add(roadWest);

      const lineWest = new THREE.Mesh(new THREE.PlaneGeometry(265, 0.4), lineMat);
      lineWest.rotation.x = -Math.PI / 2;
      lineWest.position.set(-17.5, 0.02, posZ);
      this.scene.add(lineWest);

      // East road segment (X: 205 to 380, center 292.5, width 175)
      const roadEast = new THREE.Mesh(new THREE.PlaneGeometry(175, roadWidth), asphaltMat);
      roadEast.rotation.x = -Math.PI / 2;
      roadEast.position.set(292.5, 0.01, posZ);
      roadEast.receiveShadow = true;
      this.scene.add(roadEast);

      const lineEast = new THREE.Mesh(new THREE.PlaneGeometry(175, 0.4), lineMat);
      lineEast.rotation.x = -Math.PI / 2;
      lineEast.position.set(292.5, 0.02, posZ);
      this.scene.add(lineEast);

      // Countryside horizontal roads (X: 420 to 800, center 610, width 380)
      const countrySegs = 80;
      const roadCountryGeo = new THREE.PlaneGeometry(380, roadWidth, countrySegs, 1);
      const roadPos = roadCountryGeo.attributes.position;
      for (let i = 0; i < roadPos.count; i++) {
        const lx = roadPos.getX(i);
        const wx = 610 + lx;
        const h = this.getHillHeight(wx, posZ);
        roadPos.setZ(i, h + 0.02);
      }
      roadCountryGeo.computeVertexNormals();
      const roadCountry = new THREE.Mesh(roadCountryGeo, asphaltMat);
      roadCountry.rotation.x = -Math.PI / 2;
      roadCountry.position.set(610, 0, posZ);
      roadCountry.receiveShadow = true;
      this.scene.add(roadCountry);

      const lineCountryGeo = new THREE.PlaneGeometry(380, 0.4, countrySegs, 1);
      const linePos = lineCountryGeo.attributes.position;
      for (let i = 0; i < linePos.count; i++) {
        const lx = linePos.getX(i);
        const wx = 610 + lx;
        const h = this.getHillHeight(wx, posZ);
        linePos.setZ(i, h + 0.03);
      }
      lineCountryGeo.computeVertexNormals();
      const lineCountry = new THREE.Mesh(lineCountryGeo, lineMat);
      lineCountry.rotation.x = -Math.PI / 2;
      lineCountry.position.set(610, 0, posZ);
      this.scene.add(lineCountry);
    }

    for (const posX of roadCoordsX) {
      let roadZ;
      let lineZ;
      if (posX >= 450) {
        // Create segmented road to follow hills
        const segs = 60;
        const roadZGeo = new THREE.PlaneGeometry(roadWidth, 300, 1, segs);
        const posAttr = roadZGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
          const lz = posAttr.getY(i);
          const h = this.getHillHeight(posX, lz);
          posAttr.setZ(i, h + 0.02);
        }
        roadZGeo.computeVertexNormals();
        roadZ = new THREE.Mesh(roadZGeo, asphaltMat);
        roadZ.rotation.x = -Math.PI / 2;
        roadZ.position.set(posX, 0, 0);

        const lineZGeo = new THREE.PlaneGeometry(0.4, 280, 1, segs);
        const linePosAttr = lineZGeo.attributes.position;
        for (let i = 0; i < linePosAttr.count; i++) {
          const lz = linePosAttr.getY(i);
          const h = this.getHillHeight(posX, lz);
          linePosAttr.setZ(i, h + 0.03);
        }
        lineZGeo.computeVertexNormals();
        lineZ = new THREE.Mesh(lineZGeo, lineMat);
        lineZ.rotation.x = -Math.PI / 2;
        lineZ.position.set(posX, 0, 0);
      } else {
        roadZ = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 300), asphaltMat);
        roadZ.rotation.x = -Math.PI / 2;
        roadZ.position.set(posX, 0.01, 0);

        lineZ = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 280), lineMat);
        lineZ.rotation.x = -Math.PI / 2;
        lineZ.position.set(posX, 0.02, 0);
      }
      roadZ.receiveShadow = true;
      this.scene.add(roadZ);
      this.scene.add(lineZ);
    }

    // 2. Create Intersections & Crosswalks (Optimized with InstancedMesh)
    const totalStripes = roadCoordsX.length * roadCoordsZ.length * 4 * 5;
    const stripeGeo = new THREE.PlaneGeometry(1.2, 3);
    stripeGeo.rotateX(-Math.PI / 2);
    const stripeInstanced = new THREE.InstancedMesh(stripeGeo, whiteLineMat, totalStripes);
    let stripeIdx = 0;
    const dummy = new THREE.Object3D();

    for (const x of roadCoordsX) {
      for (const z of roadCoordsZ) {
        this.roadNetwork.intersections.push(new THREE.Vector3(x, 0, z));

        const offsets = [
          { x: 0, z: roadWidth / 2 + 1.5, rot: 0 },
          { x: 0, z: -(roadWidth / 2 + 1.5), rot: 0 },
          { x: roadWidth / 2 + 1.5, z: 0, rot: Math.PI / 2 },
          { x: -(roadWidth / 2 + 1.5), z: 0, rot: Math.PI / 2 }
        ];

        for (const off of offsets) {
          for (let s = -4; s <= 4; s += 2) {
            const targetX = x + (off.rot === 0 ? s : off.x);
            const targetZ = z + (off.rot === 0 ? off.z : s);
            const h = this.getHillHeight(targetX, targetZ);

            dummy.position.set(targetX, h + 0.03, targetZ);
            dummy.rotation.set(0, off.rot, 0);
            dummy.updateMatrix();
            stripeInstanced.setMatrixAt(stripeIdx++, dummy.matrix);
          }
        }
      }
    }
    stripeInstanced.count = stripeIdx;
    this.scene.add(stripeInstanced);

    // 3. Create City Blocks (Sidewalk tiles + Plots for both West and East Districts)
    const blockCentersX = [-75, -25, 25, 75, 235, 285];
    const blockCentersZ = [-75, -25, 25, 75];
    for (const bx of blockCentersX) {
      for (const bz of blockCentersZ) {
        const isPark = (bx === -75 && bz === -75);

        const sidewalkGeo = new THREE.BoxGeometry(blockSize + sidewalkWidth * 2, 0.4, blockSize + sidewalkWidth * 2);
        const sidewalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
        sidewalk.position.set(bx, 0.2, bz);
        sidewalk.receiveShadow = true;
        this.scene.add(sidewalk);

        this.sidewalkNetwork.push(new THREE.Vector3(bx, 0.4, bz));

        if (!isPark) {
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

  createRiverAndBridge() {
    // 1. Shimmering River Water Plane
    const waterGeo = new THREE.PlaneGeometry(50, 800);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x082b42,
      roughness: 0.15,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(160, -1.2, 0);
    this.scene.add(water);

    // 2. Concrete Riverbank Retaining Walls
    const wallGeo = new THREE.BoxGeometry(3, 4.2, 800);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4052, roughness: 0.8 });
    const wallWest = new THREE.Mesh(wallGeo, wallMat);
    wallWest.position.set(133.5, -2.0, 0);
    this.scene.add(wallWest);

    const wallEast = new THREE.Mesh(wallGeo, wallMat);
    wallEast.position.set(186.5, -2.0, 0);
    this.scene.add(wallEast);

    // 3. Grand Suspension Bridge at Z = 0
    const bridgeGroup = new THREE.Group();

    // Road Deck (X: 110 to 210, length 100)
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x222633, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(100, 1.0, 18), deckMat);
    deck.position.set(160, 0.5, 0);
    deck.receiveShadow = true;
    bridgeGroup.add(deck);

    // Bridge dividing lines & sidewalks
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(100, 0.4), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(160, 1.02, 0);
    bridgeGroup.add(line);

    const sideMat = new THREE.MeshStandardMaterial({ color: 0x333b4e });
    const sideN = new THREE.Mesh(new THREE.BoxGeometry(100, 0.4, 3), sideMat);
    sideN.position.set(160, 1.1, -7.5);
    bridgeGroup.add(sideN);

    const sideS = new THREE.Mesh(new THREE.BoxGeometry(100, 0.4, 3), sideMat);
    sideS.position.set(160, 1.1, 7.5);
    bridgeGroup.add(sideS);

    // Suspension Towers (at X = 138 and X = 182)
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.3, metalness: 0.6 });
    const pillarGeo = new THREE.CylinderGeometry(1.2, 1.5, 65, 12);

    for (const tx of [138, 182]) {
      const pN = new THREE.Mesh(pillarGeo, towerMat);
      pN.position.set(tx, 32.5, -8);
      pN.castShadow = true;
      bridgeGroup.add(pN);

      const pS = new THREE.Mesh(pillarGeo, towerMat);
      pS.position.set(tx, 32.5, 8);
      pS.castShadow = true;
      bridgeGroup.add(pS);

      // Cross beams
      for (const ty of [25, 45, 62]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 16), towerMat);
        beam.position.set(tx, ty, 0);
        bridgeGroup.add(beam);
      }

      // Tower beacon lights
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
      const bN = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), beaconMat);
      bN.position.set(tx, 66, -8);
      bridgeGroup.add(bN);
      const bS = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), beaconMat);
      bS.position.set(tx, 66, 8);
      bridgeGroup.add(bS);
    }

    // Suspension Cables & Suspenders
    const cableMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 });
    for (const cz of [-8, 8]) {
      // Main swooping cables (approximate with 4 line cylinder segments)
      const points = [
        new THREE.Vector3(110, 4, cz),
        new THREE.Vector3(138, 65, cz),
        new THREE.Vector3(160, 15, cz),
        new THREE.Vector3(182, 65, cz),
        new THREE.Vector3(210, 4, cz)
      ];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dist = p1.distanceTo(p2);
        const cGeo = new THREE.CylinderGeometry(0.4, 0.4, dist, 6);
        const cMesh = new THREE.Mesh(cGeo, cableMat);
        cMesh.position.copy(p1).add(p2).multiplyScalar(0.5);
        cMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
        bridgeGroup.add(cMesh);
      }

      // Vertical suspenders every 8 units
      for (let sx = 118; sx <= 202; sx += 8) {
        if (Math.abs(sx - 138) < 3 || Math.abs(sx - 182) < 3) continue;
        let cy = 15 + Math.pow((sx - 160) / 22, 2) * 50;
        if (sx < 138) cy = 4 + ((sx - 110) / 28) * 61;
        if (sx > 182) cy = 4 + ((210 - sx) / 28) * 61;
        
        const sLen = Math.max(1, cy - 1.0);
        const sGeo = new THREE.CylinderGeometry(0.15, 0.15, sLen, 6);
        const sMesh = new THREE.Mesh(sGeo, cableMat);
        sMesh.position.set(sx, 1.0 + sLen / 2, cz);
        bridgeGroup.add(sMesh);
      }
    }
    this.scene.add(bridgeGroup);

    // 4. Secondary Highway Truss Bridges at Z = -100, -50, 50, 100
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x445566, metalness: 0.5, roughness: 0.5 });
    for (const bz of [-100, -50, 50, 100]) {
      const bDeck = new THREE.Mesh(new THREE.BoxGeometry(100, 1.0, 16), deckMat);
      bDeck.position.set(160, 0.5, bz);
      bDeck.receiveShadow = true;
      this.scene.add(bDeck);

      const bLine = new THREE.Mesh(new THREE.PlaneGeometry(100, 0.4), lineMat);
      bLine.rotation.x = -Math.PI / 2;
      bLine.position.set(160, 1.02, bz);
      this.scene.add(bLine);

      // Side rail trusses
      const railN = new THREE.Mesh(new THREE.BoxGeometry(100, 2.5, 0.6), trussMat);
      railN.position.set(160, 2.0, bz - 7.5);
      this.scene.add(railN);

      const railS = new THREE.Mesh(new THREE.BoxGeometry(100, 2.5, 0.6), trussMat);
      railS.position.set(160, 2.0, bz + 7.5);
      this.scene.add(railS);
    }

    // --- COUNTRYSIDE RIVER AND BRIDGES ---
    // 5. Countryside River Water Plane (X = 400)
    const waterGeo2 = new THREE.PlaneGeometry(40, 800);
    const water2 = new THREE.Mesh(waterGeo2, waterMat);
    water2.rotation.x = -Math.PI / 2;
    water2.position.set(400, -1.2, 0);
    this.scene.add(water2);

    // 6. Concrete Countryside Riverbank Retaining Walls
    const wallGeo2 = new THREE.BoxGeometry(3, 4.2, 800);
    const wallWest2 = new THREE.Mesh(wallGeo2, wallMat);
    wallWest2.position.set(378.5, -2.0, 0);
    this.scene.add(wallWest2);

    const wallEast2 = new THREE.Mesh(wallGeo2, wallMat);
    wallEast2.position.set(421.5, -2.0, 0);
    this.scene.add(wallEast2);

    // 7. Stone Arch Bridges across Countryside River (Z: -100, -50, 0, 50, 100)
    for (const bz of [-100, -50, 0, 50, 100]) {
      this.createSecondBridge(bz);
    }
  }

  createSecondBridge(bz) {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3d312a, roughness: 0.9 }); // Dark rustic stone
    const bridgeWidth = 14;

    // Bridge Deck (X: 380 to 420, Y: 0.5, Z: bz)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(40, 1.0, bridgeWidth + 2), deckMat);
    deck.position.set(400, 0.5, bz);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Arch support
    const archMat = new THREE.MeshStandardMaterial({ color: 0x4a433f, roughness: 0.8 });
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, bridgeWidth + 1.8, 16, 1, false, 0, Math.PI), archMat);
    arch.rotation.z = Math.PI / 2;
    arch.rotation.x = Math.PI / 2;
    arch.position.set(400, -1.8, bz);
    this.scene.add(arch);

    // Stone side rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0x5a534f, roughness: 0.8 });
    const railN = new THREE.Mesh(new THREE.BoxGeometry(40, 1.5, 1.0), railMat);
    railN.position.set(400, 1.3, bz - (bridgeWidth / 2 + 0.5));
    this.scene.add(railN);

    const railS = new THREE.Mesh(new THREE.BoxGeometry(40, 1.5, 1.0), railMat);
    railS.position.set(400, 1.3, bz + (bridgeWidth / 2 + 0.5));
    this.scene.add(railS);

    // Add yellow divider lines on deck
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.4), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(400, 1.02, bz);
    this.scene.add(line);
  }

  createCentralPark() {
    const parkCenter = { x: -75, z: -75 };
    const parkSize = 32;

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

    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    treeGroup.add(trunk);

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
    // High performance optimization: replace 120 THREE.SpotLight objects with volumetric light cones!
    const roadCoordsX = [-100, -50, 0, 50, 100, 210, 260, 310];
    const roadCoordsZ = [-100, -50, 0, 50, 100];
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xffaa00,
      emissiveIntensity: 0 // Will turn on at night
    });

    const coneGeo = new THREE.ConeGeometry(2.5, 7, 8, 1, true);
    coneGeo.translate(0, -3.5, 0);

    const lampPositions = [];
    for (const r of roadCoordsX) {
      for (let pos = -85; pos <= 85; pos += 30) {
        if (Math.abs(pos % 50) > 10) {
          lampPositions.push({ x: r + 8, z: pos, rot: -Math.PI / 2 });
          lampPositions.push({ x: r - 8, z: pos, rot: Math.PI / 2 });
        }
      }
    }
    for (const r of roadCoordsZ) {
      for (let pos = -135; pos <= 335; pos += 30) {
        if (pos > 115 && pos < 205) continue; // Skip river water gap (bridge has its own lighting)
        if (Math.abs(pos % 50) > 10) {
          lampPositions.push({ x: pos, z: r + 8, rot: 0 });
          lampPositions.push({ x: pos, z: r - 8, rot: Math.PI });
        }
      }
    }

    for (const lPos of lampPositions) {
      const lampGroup = new THREE.Group();

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 8, 8), lampMat);
      pole.position.y = 4;
      pole.castShadow = true;
      lampGroup.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.5), lampMat);
      arm.position.set(0, 7.8, 1.0);
      lampGroup.add(arm);

      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), bulbMat.clone());
      bulb.position.set(0, 7.5, 2.0);
      lampGroup.add(bulb);

      // High-perf volumetric cone (costs 0 GPU lighting evaluations!)
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xffb84d,
        transparent: true,
        opacity: 0, // Turn on at night
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0, 7.5, 2.0);
      lampGroup.add(cone);

      lampGroup.position.set(lPos.x, 0.4, lPos.z);
      lampGroup.rotation.y = lPos.rot;
      this.scene.add(lampGroup);

      this.streetlamps.push({ bulb: bulb, cone: coneMat, group: lampGroup, pos: lampGroup.position });
    }
  }

  createRocketCenter(x, z) {
    const centerGroup = new THREE.Group();
    const terrainY = this.getHillHeight(x, z);
    centerGroup.position.set(x, terrainY, z);

    // 1. Concrete Launchpad (diameter 36, height 1.5)
    const padGeo = new THREE.CylinderGeometry(18, 18, 1.5, 8);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x2b2d42,
      roughness: 0.8,
      metalness: 0.2
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.y = 0.75;
    pad.receiveShadow = true;
    pad.castShadow = true;
    centerGroup.add(pad);

    // Red safety border around pad
    const borderGeo = new THREE.TorusGeometry(18, 0.4, 8, 24);
    borderGeo.rotateX(Math.PI / 2);
    const borderMat = new THREE.MeshBasicMaterial({ color: 0xef233c });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.y = 1.5;
    centerGroup.add(border);

    // 2. Launch Tower (Gantry) next to rocket (offset X = -10, Z = 0)
    const towerHeight = 55;
    const towerGroup = new THREE.Group();
    towerGroup.position.set(-10, 0, 0);

    // Main vertical beams (4 corner cylinders)
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0xd90429, // Warning red steel
      metalness: 0.8,
      roughness: 0.3
    });
    const verticalBeamGeo = new THREE.CylinderGeometry(0.3, 0.3, towerHeight, 8);
    const beamOffsets = [
      { x: -2.5, z: -2.5 },
      { x: 2.5, z: -2.5 },
      { x: -2.5, z: 2.5 },
      { x: 2.5, z: 2.5 }
    ];
    for (const offset of beamOffsets) {
      const beam = new THREE.Mesh(verticalBeamGeo, beamMat);
      beam.position.set(offset.x, towerHeight / 2, offset.z);
      beam.castShadow = true;
      beam.receiveShadow = true;
      towerGroup.add(beam);
    }

    // Horizontal truss platforms every 8 units
    const platformGeo = new THREE.BoxGeometry(5.2, 0.4, 5.2);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x2b2d42,
      roughness: 0.7,
      metalness: 0.5
    });
    for (let h = 8; h <= towerHeight; h += 8) {
      const platform = new THREE.Mesh(platformGeo, platformMat);
      platform.position.set(0, h, 0);
      platform.castShadow = true;
      platform.receiveShadow = true;
      towerGroup.add(platform);

      // Add a yellow warning flashing beacon light at top platform corners
      if (h === towerHeight) {
        const beaconGeo = new THREE.SphereGeometry(0.5, 8, 8);
        const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffb703 });
        const beacon = new THREE.Mesh(beaconGeo, beaconMat);
        beacon.position.set(2.5, h + 0.4, 2.5);
        towerGroup.add(beacon);

        const beacon2 = new THREE.Mesh(beaconGeo, beaconMat);
        beacon2.position.set(-2.5, h + 0.4, -2.5);
        towerGroup.add(beacon2);
      }
    }

    // Diagonal support trusses
    const diagGeo = new THREE.BoxGeometry(0.15, 9.2, 0.15);
    const diagMat = new THREE.MeshStandardMaterial({ color: 0xd90429, roughness: 0.5 });
    for (let h = 4; h < towerHeight; h += 8) {
      const diag1 = new THREE.Mesh(diagGeo, diagMat);
      diag1.position.set(0, h, -2.5);
      diag1.rotation.z = Math.PI / 6;
      towerGroup.add(diag1);

      const diag2 = new THREE.Mesh(diagGeo, diagMat);
      diag2.position.set(0, h, -2.5);
      diag2.rotation.z = -Math.PI / 6;
      towerGroup.add(diag2);
    }

    centerGroup.add(towerGroup);

    // 3. Rocket (offset X = 0, Z = 0)
    const rocketGroup = new THREE.Group();
    rocketGroup.position.set(0, 1.5, 0); // Sit on top of launchpad base Y=1.5

    const mainBodyMat = new THREE.MeshStandardMaterial({
      color: 0xedf2f4,
      roughness: 0.3,
      metalness: 0.2
    }); // Clean white rocket body
    const detailMat = new THREE.MeshStandardMaterial({
      color: 0xef233c,
      roughness: 0.4,
      metalness: 0.1
    }); // Red nose/fins
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x8d99ae,
      metalness: 0.9,
      roughness: 0.1
    });

    // Stage 1 (Booster): Height 25, Radius 3.2
    const s1Geo = new THREE.CylinderGeometry(3.2, 3.2, 25, 16);
    const s1 = new THREE.Mesh(s1Geo, mainBodyMat);
    s1.position.y = 12.5;
    s1.castShadow = true;
    s1.receiveShadow = true;
    rocketGroup.add(s1);

    // Red ring divider
    const ringGeo = new THREE.TorusGeometry(3.3, 0.2, 8, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, detailMat);
    ring.position.y = 25;
    rocketGroup.add(ring);

    // Stage 2: Height 15, Radius 2.8
    const s2Geo = new THREE.CylinderGeometry(2.8, 2.8, 15, 16);
    const s2 = new THREE.Mesh(s2Geo, mainBodyMat);
    s2.position.y = 25 + 7.5;
    s2.castShadow = true;
    s2.receiveShadow = true;
    rocketGroup.add(s2);

    // Nose Cone: Height 8
    const noseGeo = new THREE.ConeGeometry(2.8, 8, 16);
    const nose = new THREE.Mesh(noseGeo, detailMat);
    nose.position.y = 40 + 4;
    nose.castShadow = true;
    nose.receiveShadow = true;
    rocketGroup.add(nose);

    // 4 fins at bottom base (rotations 0, 90, 180, 270)
    const finGeo = new THREE.BoxGeometry(0.3, 6.0, 3.2);
    for (let i = 0; i < 4; i++) {
      const finGroup = new THREE.Group();
      finGroup.rotation.y = (i * Math.PI) / 2;
      const fin = new THREE.Mesh(finGeo, detailMat);
      fin.position.set(3.2 + 1.6, 3.0, 0);
      fin.castShadow = true;
      fin.receiveShadow = true;
      finGroup.add(fin);
      rocketGroup.add(finGroup);
    }

    // Engine bell nozzle
    const nozzleGeo = new THREE.CylinderGeometry(1.5, 2.4, 2.0, 12, 1, true);
    const nozzle = new THREE.Mesh(nozzleGeo, metalMat);
    nozzle.position.y = -1.0;
    nozzle.castShadow = true;
    rocketGroup.add(nozzle);

    // Thruster fiery particles / static glow cone
    const flameGeo = new THREE.ConeGeometry(2.2, 8.0, 16);
    flameGeo.rotateX(Math.PI);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff3a00,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = -5.0;
    flame.visible = false;
    rocketGroup.add(flame);
    this.rocketFlame = flame;

    // Create vapor particle pool for blastoff prep
    this.rocketVapors = [];
    const vaporGeo = new THREE.SphereGeometry(2.0, 8, 8);
    for (let i = 0; i < 20; i++) {
      const vaporMat = new THREE.MeshStandardMaterial({
        color: 0xf0f2f5,
        roughness: 0.9,
        transparent: true,
        opacity: 0.0,
        depthWrite: false
      });
      const vaporMesh = new THREE.Mesh(vaporGeo, vaporMat);
      
      // Store initial state for animation resets
      vaporMesh.userData = {
        age: Math.random() * 2.0,
        lifetime: 1.5 + Math.random() * 1.5,
        speedY: 8.0 + Math.random() * 6.0,
        offsetX: (Math.random() - 0.5) * 1.5,
        offsetZ: (Math.random() - 0.5) * 1.5
      };

      vaporMesh.position.set(
        vaporMesh.userData.offsetX,
        18.5,
        vaporMesh.userData.offsetZ
      );
      vaporMesh.visible = false;
      centerGroup.add(vaporMesh);
      this.rocketVapors.push(vaporMesh);
    }

    centerGroup.add(rocketGroup);
    this.rocketGroup = rocketGroup;
    this.rocketAltitude = 1.5;
    this.rocketVelocityY = 0.0;
    this.scene.add(centerGroup);

    // 4. Large Nearby Electronic Space Billboard (Double-sided, parallel to road at X = 622, Z = -160)
    if (this.billboardCanvas) {
      const billboardX = 622;
      const billboardZ = -160;
      const billboardY = this.getHillHeight(billboardX, billboardZ);

      const billboardGroup = new THREE.Group();
      billboardGroup.position.set(billboardX, billboardY, billboardZ);
      billboardGroup.rotation.y = 0; // Front faces North, Back faces South

      // A. Front Screen mesh (facing North, Z = 0.08)
      const screenMeshF = this.billboardCanvas.createAdBillboard('SPACE_PROGRAM', 32, 18);
      screenMeshF.position.set(0, 19, 0.08);
      screenMeshF.castShadow = true;
      billboardGroup.add(screenMeshF);

      // B. Back Screen mesh (facing South, Z = -0.08, rotated Math.PI)
      const screenMeshB = this.billboardCanvas.createAdBillboard('SPACE_PROGRAM', 32, 18);
      screenMeshB.position.set(0, 19, -0.08);
      screenMeshB.rotation.y = Math.PI;
      screenMeshB.castShadow = true;
      billboardGroup.add(screenMeshB);

      // C. Support pillars on the left/right edges (no clipping)
      const pillarGeo = new THREE.CylinderGeometry(0.8, 0.8, 22, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x1a1e29,
        roughness: 0.5,
        metalness: 0.8
      });
      const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
      pillarL.position.set(-16.2, 10, 0);
      pillarL.castShadow = true;
      billboardGroup.add(pillarL);

      const pillarR = new THREE.Mesh(pillarGeo, pillarMat);
      pillarR.position.set(16.2, 10, 0);
      pillarR.castShadow = true;
      billboardGroup.add(pillarR);

      // D. Top and bottom horizontal frame borders to sandwich the screens
      const frameBarGeo = new THREE.BoxGeometry(32.4, 1.0, 1.2);
      
      const bottomBar = new THREE.Mesh(frameBarGeo, pillarMat);
      bottomBar.position.set(0, 9.5, 0);
      bottomBar.castShadow = true;
      billboardGroup.add(bottomBar);

      const topBar = new THREE.Mesh(frameBarGeo, pillarMat);
      topBar.position.set(0, 28.5, 0);
      topBar.castShadow = true;
      billboardGroup.add(topBar);

      this.scene.add(billboardGroup);
    }
  }

  resetRocket() {
    if (this.rocketGroup) {
      this.rocketAltitude = 1.5;
      this.rocketVelocityY = 0.0;
      this.rocketGroup.position.y = 1.5;
    }
    if (this.rocketFlame) {
      this.rocketFlame.visible = false;
      this.rocketFlame.scale.set(1, 1, 1);
    }
    if (this.rocketVapors) {
      for (const vapor of this.rocketVapors) {
        vapor.visible = false;
      }
    }
  }
}
