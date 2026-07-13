import * as THREE from 'three';
import {
  createSuspensionBridge,
  SUSPENSION_BRIDGE_LAYOUT
} from './SuspensionBridge.js';
import { createCompactSuspensionBridge } from './CompactSuspensionBridge.js';
import { createBridgeBarrierColliders } from './BridgeSafety.js';
import {
  canPlaceCountrysideStructure,
  COUNTRYSIDE_GRID,
  createSuburbanParcels,
  footprintsOverlap,
  getFootprintEnvelope,
  SUBURBAN_HOME_RULES
} from './CountrysidePlan.js';
import { createStreetLampLayout } from './StreetFurnitureLayout.js';

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
    this.drivableDecks = [];
    this.surfaceColliders = [];
    this.sceneryColliders = [];
    this.countrysideOccupancy = [];
    this.countrysideScenery = [];
  }

  build() {
    this.createGround();
    this.createRoadGrid();
    this.createRiverAndBridge();
    this.createCentralPark();
    this.createStreetFurniture();
    this.createCountrysideSuburb();
    this.createCountrysideNature();
    this.createRocketCenter(700, -280);
    this.createMissionControlFacility(735, -245);
  }

  createCountrysideNature() {
    // Scatter trees only on unreserved countryside land. Houses are generated
    // first so nature respects both the road plan and occupied residential lots.
    const bounds = COUNTRYSIDE_GRID.buildableBounds;
    const treeFootprint = { width: 5, depth: 5 };
    for (let i = 0; i < 90; i++) {
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
      if (!canPlaceCountrysideStructure(
        { x, z },
        treeFootprint,
        { setback: 1, occupied: this.countrysideOccupancy }
      )) continue;

      const y = this.getHillHeight(x, z);
      const tree = this.createTree(x, y - 0.2, z);
      const envelope = getFootprintEnvelope(
        { x, z },
        treeFootprint,
        { setback: 1, kind: 'TREE' }
      );
      if (!tree || !envelope) continue;
      this.countrysideOccupancy.push(envelope);
      this.countrysideScenery.push({
        kind: 'TREE',
        group: tree.group,
        collider: tree.collider,
        envelope
      });
    }
  }

  createCountrysideSuburb() {
    for (const parcel of createSuburbanParcels()) {
      // Empty parcels keep the district visually rural without weakening the
      // deterministic zoning and setback rules.
      if (Math.random() >= SUBURBAN_HOME_RULES.occupancyProbability) continue;
      this.createSuburbanHouse(parcel.x, parcel.z, {
        parcelId: parcel.id,
        rotationY: parcel.rotationY
      });
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

  createSuburbanHouse(x, z, { parcelId = null, rotationY = 0 } = {}) {
    if (!canPlaceCountrysideStructure(
      { x, z },
      SUBURBAN_HOME_RULES.footprint,
      {
        rotationY,
        setback: SUBURBAN_HOME_RULES.roadSetback,
        occupied: this.countrysideOccupancy
      }
    )) return null;

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

    // Every parcel fronts a road on the shared grid; visual variety comes from
    // color and vacant lots rather than geometry drifting out of its zone.
    const houseId = parcelId || `suburban-${x}-${z}`;
    houseGroup.rotation.y = Number.isFinite(rotationY) ? rotationY : 0;
    houseGroup.name = houseId;
    houseGroup.userData.landUse = 'SUBURBAN_RESIDENTIAL';
    houseGroup.userData.parcelId = houseId;

    this.scene.add(houseGroup);
    const collider = {
      position: { x, y: terrainY + wallHeight / 2, z },
      size: { x: wallWidth, y: wallHeight, z: wallDepth },
      rotationY: houseGroup.rotation.y,
      kind: 'suburban-house'
    };
    const envelope = getFootprintEnvelope(
      { x, z },
      SUBURBAN_HOME_RULES.footprint,
      { rotationY: houseGroup.rotation.y, kind: 'HOUSE', id: houseId }
    );
    this.sceneryColliders.push(collider);
    this.countrysideOccupancy.push(envelope);
    this.countrysideScenery.push({
      kind: 'HOUSE',
      group: houseGroup,
      collider,
      envelope
    });
    return houseGroup;
  }

  getCountrysideOccupancyConflicts(rect, { kinds = ['HOUSE', 'TREE'] } = {}) {
    if (!rect) return [];
    const allowedKinds = new Set(kinds);
    return this.countrysideOccupancy.filter(envelope => (
      allowedKinds.has(envelope?.kind) && footprintsOverlap(rect, envelope)
    ));
  }

  hasCountrysideOccupancyOverlap(rect, options) {
    return this.getCountrysideOccupancyConflicts(rect, options).length > 0;
  }

  removeCountrysideSceneryOverlapping(rect, { kinds = ['HOUSE', 'TREE'] } = {}) {
    if (!rect) return [];
    const allowedKinds = new Set(kinds);
    const removed = [];

    for (let index = this.countrysideScenery.length - 1; index >= 0; index -= 1) {
      const scenery = this.countrysideScenery[index];
      if (!allowedKinds.has(scenery?.kind) || !footprintsOverlap(rect, scenery.envelope)) continue;

      scenery.group?.removeFromParent?.();
      scenery.group?.traverse?.(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach(material => material?.dispose?.());
        else child.material?.dispose?.();
      });

      const colliderIndex = this.sceneryColliders.indexOf(scenery.collider);
      if (colliderIndex >= 0) this.sceneryColliders.splice(colliderIndex, 1);
      const occupancyIndex = this.countrysideOccupancy.indexOf(scenery.envelope);
      if (occupancyIndex >= 0) this.countrysideOccupancy.splice(occupancyIndex, 1);
      this.countrysideScenery.splice(index, 1);
      removed.push(scenery);
    }

    return removed;
  }

  isInWater(pos) {
    if (!pos) return false;
    const x = pos.x;
    const y = pos.y;
    const z = pos.z;

    const userBridgeHeight = this.getUserBridgeDeckHeight(x, z);
    if (userBridgeHeight !== null && y >= userBridgeHeight - 1) return false;

    const builtInBridgeHeight = this.getBuiltInBridgeDeckHeight(x, z);
    if (builtInBridgeHeight !== null && y >= builtInBridgeHeight - 1) return false;

    // River 1 (X: 135 to 185)
    if (x >= 135 && x <= 185) {
      return true;
    }

    // River 2 (X: 380 to 420)
    if (x >= 380 && x <= 420) {
      return true;
    }

    return false;
  }

  registerDrivableDeck(minX, maxX, minZ, maxZ, height = 0) {
    if (!this.drivableDecks) this.drivableDecks = [];
    this.drivableDecks.push({ minX, maxX, minZ, maxZ, height });
  }

  registerBridgeBarriers(configuration) {
    if (!this.sceneryColliders) this.sceneryColliders = [];
    const colliders = Array.isArray(configuration)
      ? configuration
      : createBridgeBarrierColliders(configuration);
    const validColliders = colliders.filter(collider => (
      collider?.kind === 'bridge-barrier'
      && Number.isFinite(collider.position?.x)
      && Number.isFinite(collider.position?.y)
      && Number.isFinite(collider.position?.z)
      && collider.size?.x > 0
      && collider.size?.y > 0
      && collider.size?.z > 0
    ));
    this.sceneryColliders.push(...validColliders);
    return validColliders;
  }

  addCompactSuspensionBridge(options) {
    const bridge = createCompactSuspensionBridge(options);
    const layout = bridge.userData.layout;
    this.scene.add(bridge);
    this.registerDrivableDeck(
      layout.centerX - layout.length * 0.5,
      layout.centerX + layout.length * 0.5,
      layout.centerZ - layout.drivableWidth * 0.5,
      layout.centerZ + layout.drivableWidth * 0.5,
      layout.deckHeight
    );
    this.registerBridgeBarriers(bridge.userData.barrierColliders);
    return bridge;
  }

  getBuiltInBridgeDeckHeight(x, z) {
    for (const deck of this.drivableDecks || []) {
      if (x >= deck.minX && x <= deck.maxX && z >= deck.minZ && z <= deck.maxZ) {
        return deck.height;
      }
    }
    return null;
  }

  getTerrainHeight(x, z) {
    const userBridgeHeight = this.getUserBridgeDeckHeight(x, z);
    if (userBridgeHeight !== null) return userBridgeHeight;

    const bridgeHeight = this.getBuiltInBridgeDeckHeight(x, z);
    if (bridgeHeight !== null) return bridgeHeight;

    if ((x >= 135 && x <= 185) || (x >= 380 && x <= 420)) return -4;
    if (x >= 420) return this.getHillHeight(x, z);

    // Traffic lanes take precedence over overlapping decorative sidewalk
    // meshes. The visual blocks extend four metres into the outer lanes.
    const cityRoadX = [-100, -50, 0, 50, 100, 210, 260, 310];
    const cityRoadZ = [-100, -50, 0, 50, 100];
    const onCityRoad = cityRoadX.some(roadX => Math.abs(x - roadX) <= 7)
      || cityRoadZ.some(roadZ => Math.abs(z - roadZ) <= 7);
    if (onCityRoad) return 0;

    if (x < -60 && z < -60 && x > -100 && z > -100) return 0.7;
    const blockCentersX = [-75, -25, 25, 75, 235, 285];
    const blockCentersZ = [-75, -25, 25, 75];
    for (const bx of blockCentersX) {
      for (const bz of blockCentersZ) {
        if (Math.abs(x - bx) < 22 && Math.abs(z - bz) < 22) return 0.4;
      }
    }
    return 0;
  }

  isWithinDrivableBounds(x, z) {
    return Number.isFinite(x)
      && Number.isFinite(z)
      && x >= -498
      && x <= 818
      && z >= -398
      && z <= 398;
  }

  getUserBridgeDeckHeight(x, z) {
    const segments = this.app?.trafficSystem?.placedRoadSegments;
    if (!segments) return null;

    for (const record of segments.values()) {
      const building = record?.building;
      const spec = record?.spec || building?.spec;
      if (!building?.plot || building.isDestroyed || spec?.roadType !== 'BRIDGE') continue;

      const rotationY = building.group?.rotation?.y || 0;
      const dx = x - building.plot.x;
      const dz = z - building.plot.z;
      const cosine = Math.cos(rotationY);
      const sine = Math.sin(rotationY);
      const localX = dx * cosine - dz * sine;
      const localZ = dx * sine + dz * cosine;
      const halfWidth = Number(building.plot.width || spec.footprint?.width || 30) * 0.5;
      const halfDepth = Number(building.plot.depth || spec.footprint?.depth || 30) * 0.5;
      if (Math.abs(localX) > halfWidth || Math.abs(localZ) > halfDepth) continue;

      const baseY = Number.isFinite(building.plot.y)
        ? building.plot.y
        : (building.group?.position?.y || 0);
      return baseY + 0.45;
    }
    return null;
  }

  createGround() {
    // 1. West Ground Plane
    const westGeo = new THREE.PlaneGeometry(335, 800);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1e2534,
      roughness: 0.85,
      metalness: 0.1
    });
    const westGround = new THREE.Mesh(westGeo, groundMat);
    westGround.rotation.x = -Math.PI / 2;
    westGround.position.set(-32.5, -0.1, 0);
    westGround.receiveShadow = true;
    this.scene.add(westGround);

    // 2. East Ground Plane (X: 185 to 380: width 195, centered at 282.5)
    const eastGeo = new THREE.PlaneGeometry(195, 800);
    const eastGround = new THREE.Mesh(eastGeo, groundMat);
    eastGround.rotation.x = -Math.PI / 2;
    eastGround.position.set(282.5, -0.1, 0);
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
    const countrysideGeo = new THREE.PlaneGeometry(400, 800, 160, 320);
    const posAttr = countrysideGeo.attributes.position;
    const colors = [];
    const colorGrass = new THREE.Color(0x3b7a57); // Forest green
    const colorDirt = new THREE.Color(0x705335);  // Rich dirt brown

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getY(i);
      const worldX = 620 + vx;
      const worldZ = -vz;

      // Graded hill height formula matching roadbeds and intersections
      const height = this.getHillHeight(worldX, worldZ);
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
    countrysideGround.position.set(620, 0, 0);
    countrysideGround.receiveShadow = true;
    this.scene.add(countrysideGround);
  }

  getHillHeightRaw(x, z) {
    if (x >= 420) {
      const factor = Math.min(1.0, (x - 420) / 100);
      // Preserve the rural silhouette without the former 20%+ road grades,
      // which unloaded suspension and launched vehicles at intersections.
      return (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 1.8 + Math.sin(x * 0.02) * 3.4) * factor;
    }
    return 0.0;
  }

  getIntersectionHeight(rx, rz) {
    if (rx <= 420) return 0.0;
    if (rx === 700 && rz === -100) {
      return 0.5 * (this.getHillHeightRaw(650, -100) + this.getHillHeightRaw(750, -100));
    }
    return this.getHillHeightRaw(rx, rz);
  }

  getHillHeight(x, z) {
    if (x < 420) return 0.0;
    const rawHeight = this.getHillHeightRaw(x, z);

    // Special Rocket Launch Pad & Mission Control Facility Area (X: 660 to 765, Z: -90 to -315)
    if (x >= 630 && x <= 795 && z <= -70 && z >= -345) {
      const h_start = this.getIntersectionHeight(700, -100);
      const h_pad = this.getHillHeightRaw(700, -280);

      const distToRoadX = Math.abs(x - 700);
      let targetHeight = null;

      // Rocket Access Road (X=700, Z from -100 to -280)
      if (distToRoadX <= 7.5 && z <= -100 && z >= -280) {
        const t = (z - -100) / (-280 - -100);
        const st = t * t * (3 - 2 * t);
        targetHeight = h_start + (h_pad - h_start) * st;
      }

      // Rocket pad plateau (radius 22)
      const distToPad = Math.hypot(x - 700, z - -280);
      if (distToPad <= 22) {
        targetHeight = h_pad;
      }

      // Mission Control Facility plateau (radius 20 at 735, -245)
      const distToFacility = Math.hypot(x - 735, z - -245);
      if (distToFacility <= 20) {
        targetHeight = h_pad;
      }

      // Horizontal access road to Mission Control (Z = -245, X from 700 to 735)
      if (x >= 700 && x <= 735 && Math.abs(z - -245) <= 6.5) {
        const accessT = (-245 - -100) / (-280 - -100);
        const smoothAccessT = accessT * accessT * (3 - 2 * accessT);
        const accessJunctionHeight = h_start + (h_pad - h_start) * smoothAccessT;
        const spurT = Math.min(1, (x - 700) / 10);
        const smoothSpurT = spurT * spurT * (3 - 2 * spurT);
        targetHeight = accessJunctionHeight + (h_pad - accessJunctionHeight) * smoothSpurT;
      }

      if (targetHeight !== null) {
        return targetHeight;
      }

      // Blend toward the local feature elevation. The old implementation
      // blended every shoulder toward the distant launch-pad elevation, which
      // created a multi-metre cliff beside the access-road junction.
      const blendCandidates = [];
      // South of the main east-west road, feather the access road into the
      // hills. At the junction itself the regular intersection profiler must
      // remain authoritative or the two shoulder formulas form a seam.
      if (z <= -100 && z >= -280) {
        const t = (z - -100) / (-280 - -100);
        const smoothRoadT = t * t * (3 - 2 * t);
        blendCandidates.push({
          distance: Math.max(0, distToRoadX - 7.5),
          height: h_start + (h_pad - h_start) * smoothRoadT
        });
      }
      blendCandidates.push(
        { distance: Math.max(0, distToPad - 22), height: h_pad },
        { distance: Math.max(0, distToFacility - 20), height: h_pad }
      );
      if (x >= 700 && x <= 735) {
        blendCandidates.push({ distance: Math.max(0, Math.abs(z + 245) - 6.5), height: h_pad });
      }
      const strongestFeature = blendCandidates.reduce((strongest, candidate) => {
        if (candidate.distance >= 20) return strongest;
        const t = candidate.distance / 20;
        const edgeBlend = 1 - t * t * (3 - 2 * t);
        const influence = edgeBlend * (candidate.influenceScale ?? 1);
        return influence > strongest.influence ? { ...candidate, influence } : strongest;
      }, { influence: 0, height: rawHeight });

      if (strongestFeature.influence > 0) {
        const normalRoadDistance = Math.max(0, Math.abs(z + 100) - 8);
        const normalRoadT = Math.min(1, normalRoadDistance / 20);
        const normalRoadInfluence = 1 - normalRoadT * normalRoadT * (3 - 2 * normalRoadT);
        if (strongestFeature.influence > normalRoadInfluence) {
          return rawHeight + (strongestFeature.height - rawHeight) * strongestFeature.influence;
        }
      }
    }

    const coordsX = [...COUNTRYSIDE_GRID.verticalRoadCenters, COUNTRYSIDE_GRID.rocketAccessRoad.centerX]
      .sort((a, b) => a - b);
    const coordsZ = COUNTRYSIDE_GRID.horizontalRoadCenters;

    // Find nearest coordinates
    let rx = coordsX[0];
    let minDistX = Math.abs(x - rx);
    for (let i = 1; i < coordsX.length; i++) {
      const d = Math.abs(x - coordsX[i]);
      if (d < minDistX) {
        minDistX = d;
        rx = coordsX[i];
      }
    }

    let rz = coordsZ[0];
    let minDistZ = Math.abs(z - rz);
    for (let i = 1; i < coordsZ.length; i++) {
      const d = Math.abs(z - coordsZ[i]);
      if (d < minDistZ) {
        minDistZ = d;
        rz = coordsZ[i];
      }
    }

    const roadHalfWidth = COUNTRYSIDE_GRID.roadWidth * 0.5 + 1;
    const blendDistance = 20.0;
    const verticalRoadCore = z >= -100 && z <= 100;

    // 1. Inside any intersection plateau
    if (minDistX <= roadHalfWidth && minDistZ <= roadHalfWidth) {
      return this.getIntersectionHeight(rx, rz);
    }

    // 2. Calculate centerline height for horizontal road at (x, rz)
    let rx1 = 420, rx2 = 450;
    if (x <= 450) {
      rx1 = 420; rx2 = 450;
    } else if (x >= 750) {
      rx1 = 750; rx2 = 800;
    } else {
      for (let i = 0; i < coordsX.length - 1; i++) {
        if (x >= coordsX[i] && x <= coordsX[i + 1]) {
          rx1 = coordsX[i];
          rx2 = coordsX[i + 1];
          break;
        }
      }
    }
    const startX = rx1 === 420 ? 420 : rx1 + roadHalfWidth;
    const endX = rx2 === 800 ? 800 : rx2 - roadHalfWidth;
    const h1_x = this.getIntersectionHeight(rx1, rz);
    const h2_x = rx2 === 800 ? this.getIntersectionHeight(750, rz) : this.getIntersectionHeight(rx2, rz);
    let h_horiz = h1_x;
    if (x >= endX) {
      h_horiz = h2_x;
    } else if (x > startX) {
      const tx = (x - startX) / (endX - startX);
      const stx = tx * tx * (3 - 2 * tx);
      h_horiz = h1_x + (h2_x - h1_x) * stx;
    }

    // 3. Calculate centerline height for vertical road at (rx, z)
    let rz1 = -100, rz2 = -50;
    if (z <= -100) {
      rz1 = -100; rz2 = -100;
    } else if (z >= 100) {
      rz1 = 100; rz2 = 100;
    } else {
      for (let i = 0; i < coordsZ.length - 1; i++) {
        if (z >= coordsZ[i] && z <= coordsZ[i + 1]) {
          rz1 = coordsZ[i];
          rz2 = coordsZ[i + 1];
          break;
        }
      }
    }
    const startZ = rz1 + roadHalfWidth;
    const endZ = rz2 - roadHalfWidth;
    const h1_z = this.getIntersectionHeight(rx, rz1);
    const h2_z = this.getIntersectionHeight(rx, rz2);
    let h_vert = h1_z;
    if (rz1 !== rz2) {
      if (z >= endZ) {
        h_vert = h2_z;
      } else if (z > startZ) {
        const tz = (z - startZ) / (endZ - startZ);
        const stz = tz * tz * (3 - 2 * tz);
        h_vert = h1_z + (h2_z - h1_z) * stz;
      }
    }

    // 4. On road bed
    if (minDistZ <= roadHalfWidth) {
      return h_horiz;
    }
    if (verticalRoadCore && minDistX <= roadHalfWidth) {
      return h_vert;
    }

    // 5. Smooth blending zone around roads
    const distToHoriz = minDistZ - roadHalfWidth;
    const distToVert = Math.hypot(
      Math.max(0, minDistX - roadHalfWidth),
      Math.max(0, Math.abs(z) - 100)
    );
    const nearestRoadDist = Math.min(distToHoriz, distToVert);

    if (nearestRoadDist < blendDistance) {
      const t = nearestRoadDist / blendDistance;
      const smoothT = t * t * (3 - 2 * t);
      const horizontalWeight = Math.max(0, blendDistance - distToHoriz) ** 2;
      const verticalWeight = Math.max(0, blendDistance - distToVert) ** 2;
      const totalWeight = horizontalWeight + verticalWeight;
      const nearestRoadHeight = totalWeight > 0
        ? (h_horiz * horizontalWeight + h_vert * verticalWeight) / totalWeight
        : rawHeight;
      return nearestRoadHeight + (rawHeight - nearestRoadHeight) * smoothT;
    }

    return rawHeight;
  }

  createRoadGrid() {
    const roadCoordsZ = COUNTRYSIDE_GRID.horizontalRoadCenters;
    const roadCoordsX = [
      -100, -50, 0, 50, 100, 210, 260, 310,
      ...COUNTRYSIDE_GRID.verticalRoadCenters
    ];
    const roadWidth = COUNTRYSIDE_GRID.roadWidth;
    const sidewalkWidth = 4;
    const blockSize = 50 - roadWidth;

    const asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x2c3344,
      roughness: 0.78,
      metalness: 0.18
    });

    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x647488,
      roughness: 0.65,
      metalness: 0.12
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
      const countrySegs = 190;
      const roadCountryGeo = new THREE.PlaneGeometry(380, roadWidth, countrySegs, 1);
      const roadPos = roadCountryGeo.attributes.position;
      for (let i = 0; i < roadPos.count; i++) {
        const lx = roadPos.getX(i);
        const ly = roadPos.getY(i);
        const wx = 610 + lx;
        const wz = posZ - ly;
        const h = this.getHillHeight(wx, wz);
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
        const ly = linePos.getY(i);
        const wx = 610 + lx;
        const wz = posZ - ly;
        const h = this.getHillHeight(wx, wz);
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
        // Create segmented road to follow hills exactly from Z = -100 to Z = 100
        const segs = 120;
        const roadZGeo = new THREE.PlaneGeometry(roadWidth, 200, 1, segs);
        const posAttr = roadZGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
          const lx = posAttr.getX(i);
          const ly = posAttr.getY(i);
          const wx = posX + lx;
          const wz = -ly; // Correct Z-inversion: after -Math.PI/2 rotation around X, local +Y is world -Z
          const h = this.getHillHeight(wx, wz);
          posAttr.setZ(i, h + 0.02);
        }
        roadZGeo.computeVertexNormals();
        roadZ = new THREE.Mesh(roadZGeo, asphaltMat);
        roadZ.rotation.x = -Math.PI / 2;
        roadZ.position.set(posX, 0, 0);

        const lineZGeo = new THREE.PlaneGeometry(0.4, 200, 1, segs);
        const linePosAttr = lineZGeo.attributes.position;
        for (let i = 0; i < linePosAttr.count; i++) {
          const lx = linePosAttr.getX(i);
          const ly = linePosAttr.getY(i);
          const wx = posX + lx;
          const wz = -ly;
          const h = this.getHillHeight(wx, wz);
          linePosAttr.setZ(i, h + 0.03);
        }
        lineZGeo.computeVertexNormals();
        lineZ = new THREE.Mesh(lineZGeo, lineMat);
        lineZ.rotation.x = -Math.PI / 2;
        lineZ.position.set(posX, 0, 0);
      } else {
        roadZ = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 200), asphaltMat);
        roadZ.rotation.x = -Math.PI / 2;
        roadZ.position.set(posX, 0.01, 0);

        lineZ = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 200), lineMat);
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

    // Rocket Access Road (X = 700, Z from -100 to -280)
    const accessSegs = 90;
    const accessRoadGeo = new THREE.PlaneGeometry(14, 180, 1, accessSegs);
    const accessPos = accessRoadGeo.attributes.position;
    for (let i = 0; i < accessPos.count; i++) {
      const lx = accessPos.getX(i);
      const ly = accessPos.getY(i);
      const wx = 700 + lx;
      const wz = -190 - ly;
      const h = this.getHillHeight(wx, wz);
      accessPos.setZ(i, h + 0.02);
    }
    accessRoadGeo.computeVertexNormals();
    const accessRoad = new THREE.Mesh(accessRoadGeo, asphaltMat);
    accessRoad.rotation.x = -Math.PI / 2;
    accessRoad.position.set(700, 0, -190);
    accessRoad.receiveShadow = true;
    this.scene.add(accessRoad);

    const accessLineGeo = new THREE.PlaneGeometry(0.4, 180, 1, accessSegs);
    const accessLinePos = accessLineGeo.attributes.position;
    for (let i = 0; i < accessLinePos.count; i++) {
      const lx = accessLinePos.getX(i);
      const ly = accessLinePos.getY(i);
      const wx = 700 + lx;
      const wz = -190 - ly;
      const h = this.getHillHeight(wx, wz);
      accessLinePos.setZ(i, h + 0.03);
    }
    accessLineGeo.computeVertexNormals();
    const accessLine = new THREE.Mesh(accessLineGeo, lineMat);
    accessLine.rotation.x = -Math.PI / 2;
    accessLine.position.set(700, 0, -190);
    this.scene.add(accessLine);

    // Spur Road to Mission Control Facility (Z = -245, X from 700 to 735)
    const spurGeo = new THREE.PlaneGeometry(35, 12, 20, 1);
    const spurPos = spurGeo.attributes.position;
    for (let i = 0; i < spurPos.count; i++) {
      const lx = spurPos.getX(i);
      const ly = spurPos.getY(i);
      const wx = 717.5 + lx;
      const wz = -245 - ly;
      const h = this.getHillHeight(wx, wz);
      spurPos.setZ(i, h + 0.02);
    }
    spurGeo.computeVertexNormals();
    const spurRoad = new THREE.Mesh(spurGeo, asphaltMat);
    spurRoad.rotation.x = -Math.PI / 2;
    spurRoad.position.set(717.5, 0, -245);
    spurRoad.receiveShadow = true;
    this.scene.add(spurRoad);

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
    // 1. Dynamic Shimmering Blue Flowing River Water Shader
    const waterUniforms = {
      uTime: { value: 0.0 },
      uColorDeep: { value: new THREE.Color(0x004488) },
      uColorShimmer: { value: new THREE.Color(0x00e5ff) },
      uOpacity: { value: 0.88 }
    };
    this.waterUniforms = waterUniforms;

    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vWaveHeight;
        uniform float uTime;

        void main() {
          vUv = uv;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          
          float wave1 = sin(worldPosition.x * 0.35 + uTime * 2.2) * cos(worldPosition.z * 0.35 + uTime * 1.8) * 0.22;
          float wave2 = sin(worldPosition.x * 0.8 - uTime * 3.2 + worldPosition.z * 0.6) * 0.12;
          vWaveHeight = wave1 + wave2;
          
          worldPosition.y += vWaveHeight;
          vWorldPosition = worldPosition.xyz;
          
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vWaveHeight;
        uniform vec3 uColorDeep;
        uniform vec3 uColorShimmer;
        uniform float uOpacity;
        uniform float uTime;

        void main() {
          float ripple = sin(vWorldPosition.x * 2.8 + uTime * 3.5) * sin(vWorldPosition.z * 2.8 - uTime * 2.9);
          float shimmer = smoothstep(0.35, 0.95, ripple) * 0.55 + smoothstep(0.05, 0.3, vWaveHeight) * 0.45;
          
          vec3 finalColor = mix(uColorDeep, uColorShimmer, clamp(shimmer + 0.15, 0.0, 1.0));
          
          gl_FragColor = vec4(finalColor, uOpacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

    // River 1 Shimmering Water Plane (X: 135 to 185)
    const waterGeo1 = new THREE.PlaneGeometry(50, 800, 60, 240);
    const water1 = new THREE.Mesh(waterGeo1, waterMat);
    water1.rotation.x = -Math.PI / 2;
    water1.position.set(160, -1.2, 0);
    this.scene.add(water1);

    // 2. Concrete Riverbank Retaining Walls
    const wallGeo = new THREE.BoxGeometry(3, 4.2, 800);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4052, roughness: 0.8 });
    const wallWest1 = new THREE.Mesh(wallGeo, wallMat);
    wallWest1.position.set(133.5, -2.0, 0);
    this.scene.add(wallWest1);

    const wallEast1 = new THREE.Mesh(wallGeo, wallMat);
    wallEast1.position.set(186.5, -2.0, 0);
    this.scene.add(wallEast1);

    // 3. Grand Suspension Bridge at Z = 0
    const bridgeGroup = createSuspensionBridge();
    const bridgeLayout = SUSPENSION_BRIDGE_LAYOUT;
    this.registerDrivableDeck(
      bridgeLayout.deckStartX,
      bridgeLayout.deckEndX,
      -bridgeLayout.deckWidth / 2,
      bridgeLayout.deckWidth / 2,
      0
    );
    this.registerBridgeBarriers({
      centerX: (bridgeLayout.deckStartX + bridgeLayout.deckEndX) * 0.5,
      centerZ: 0,
      length: bridgeLayout.deckEndX - bridgeLayout.deckStartX,
      width: bridgeLayout.deckWidth,
      deckHeight: 0,
      bridgeId: 'grand-suspension'
    });
    this.scene.add(bridgeGroup);

    // 4. Medium-span urban suspension bridges at Z = -100, -50, 50, 100.
    // Open rails and low towers preserve sight lines while giving each river
    // crossing a stronger visual identity than the former solid box rails.
    const urbanThemes = ['VIOLET', 'CYAN', 'AMBER', 'VIOLET'];
    for (const [index, bz] of [-100, -50, 50, 100].entries()) {
      this.addCompactSuspensionBridge({
        id: `urban-${index}`,
        centerX: 160,
        centerZ: bz,
        length: 100,
        width: 16,
        drivableWidth: 14.6,
        towerHeight: 9,
        profile: 'CLASSIC',
        theme: urbanThemes[index]
      });
    }

    // --- COUNTRYSIDE RIVER AND BRIDGES ---
    // 5. Countryside River Water Plane (X = 400)
    const waterGeo2 = new THREE.PlaneGeometry(40, 800, 48, 240);
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

    // 7. Low-profile self-anchored suspension bridges across the countryside
    // river (Z: -100, -50, 0, 50, 100).
    for (const [index, bz] of [-100, -50, 0, 50, 100].entries()) {
      this.createSecondBridge(bz, index);
    }
  }

  createSecondBridge(bz, index = 0) {
    const themes = ['AMBER', 'CYAN', 'VIOLET', 'CYAN', 'AMBER'];
    return this.addCompactSuspensionBridge({
      id: `countryside-${index}`,
      centerX: 400,
      centerZ: bz,
      length: 40,
      width: 16,
      drivableWidth: 14,
      towerHeight: 6.5,
      profile: 'SELF_ANCHORED',
      theme: themes[index % themes.length]
    });
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
    this.surfaceColliders.push({
      position: { x: parkCenter.x, y: 0.45, z: parkCenter.z },
      size: { x: parkSize, y: 0.5, z: parkSize },
      kind: 'park'
    });

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
    const collider = {
      position: { x, y: y + 2.5, z },
      size: { x: 1.2, y: 5, z: 1.2 },
      kind: 'tree-trunk'
    };
    this.sceneryColliders.push(collider);
    return { group: treeGroup, collider };
  }

  createStreetFurniture() {
    // Add streetlamps along sidewalk edges
    // High performance optimization: replace 120 THREE.SpotLight objects with volumetric light cones!
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffd58a,
      emissive: 0xffc46b,
      emissiveIntensity: 0 // Will turn on at night
    });

    const coneGeo = new THREE.ConeGeometry(2.5, 7, 8, 1, true);
    coneGeo.translate(0, -3.5, 0);
    const poolGeo = new THREE.CircleGeometry(3.25, 16);

    const lampPositions = createStreetLampLayout();

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
        color: 0xffd08a,
        transparent: true,
        opacity: 0, // Turn on at night
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(0, 7.5, 2.0);
      lampGroup.add(cone);

      // A soft ground pool carries most of the illumination cue. This reads
      // better than a large opaque cone while retaining the graphic retro style.
      const poolMat = new THREE.MeshBasicMaterial({
        color: 0xffc56e,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1
      });
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.035, 2.0);
      lampGroup.add(pool);

      lampGroup.position.set(lPos.x, 0.4, lPos.z);
      lampGroup.rotation.y = lPos.rot;
      this.scene.add(lampGroup);

      this.streetlamps.push({
        bulb,
        cone: coneMat,
        pool: poolMat,
        group: lampGroup,
        pos: lampGroup.position
      });
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

  createMissionControlFacility(x, z) {
    const facilityGroup = new THREE.Group();
    const terrainY = this.getHillHeight(x, z);
    facilityGroup.position.set(x, terrainY, z);

    // 1. Foundation Plaza / Apron (26 x 0.6 x 20)
    const apronGeo = new THREE.BoxGeometry(26, 0.6, 20);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x3d405b,
      roughness: 0.85,
      metalness: 0.1
    });
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.y = 0.3;
    apron.receiveShadow = true;
    facilityGroup.add(apron);

    // 2. Main Control Bunker Building (18 x 10 x 12)
    const bunkerGeo = new THREE.BoxGeometry(18, 10, 12);
    const bunkerMat = new THREE.MeshStandardMaterial({
      color: 0xe0e1dd,
      roughness: 0.4,
      metalness: 0.2
    });
    const bunker = new THREE.Mesh(bunkerGeo, bunkerMat);
    bunker.position.y = 5.3;
    bunker.castShadow = true;
    bunker.receiveShadow = true;
    facilityGroup.add(bunker);

    // 3. Observation Glass Bay facing launchpad (west face towards rocket)
    const glassGeo = new THREE.BoxGeometry(1.2, 5.5, 9);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x00b4d8,
      emissive: 0x0077b6,
      emissiveIntensity: 0.45,
      roughness: 0.1,
      metalness: 0.8
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(-8.8, 6.0, 0);
    facilityGroup.add(glass);

    // 4. Glowing Blue LED Eaves Trim
    const trimGeo = new THREE.BoxGeometry(18.4, 0.3, 12.4);
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = 9.8;
    facilityGroup.add(trim);

    // 5. Roof Radar / Telemetry Dome & Satellite Dish
    const domeGeo = new THREE.SphereGeometry(2.8, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.set(4, 10.3, -2);
    facilityGroup.add(dome);

    // Satellite Dish assembly
    const dishMastGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 8);
    const dishMastMat = new THREE.MeshStandardMaterial({ color: 0x4f5d75, metalness: 0.7 });
    const dishMast = new THREE.Mesh(dishMastGeo, dishMastMat);
    dishMast.position.set(-3, 11.5, 2);
    facilityGroup.add(dishMast);

    const dishGeo = new THREE.ConeGeometry(2.5, 1.2, 16, 1, true);
    dishGeo.rotateX(Math.PI / 4);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xfaf0ca,
      roughness: 0.5,
      metalness: 0.3,
      side: THREE.DoubleSide
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(-3, 13.2, 2);
    facilityGroup.add(dish);

    // 6. Glowing Red Aviation Warning Beacon on Roof
    const beaconGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(-3, 14.1, 2);
    facilityGroup.add(beacon);

    this.scene.add(facilityGroup);
  }

  update(delta) {
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value += delta;
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
