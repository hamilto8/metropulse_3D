import * as THREE from 'three';
import { getBuildingSpec } from './BuildingCatalog.js';

const WORLD_BOUNDS = Object.freeze({
  minX: -190,
  maxX: 810,
  minZ: -390,
  maxZ: 390
});

const CORE_LANDMARKS = Object.freeze([
  { name: 'Central Park', minX: -96, maxX: -54, minZ: -96, maxZ: -54 },
  { name: 'Suspension Bridge', minX: 105, maxX: 215, minZ: -16, maxZ: 16 },
  { name: 'Rocket Launch Complex', minX: 668, maxX: 742, minZ: -318, maxZ: -238 },
  { name: 'Mission Control', minX: 716, maxX: 760, minZ: -268, maxZ: -224 },
  { name: 'Space Billboard', minX: 598, maxX: 646, minZ: -182, maxZ: -138 }
]);

const EXISTING_ROAD_X = Object.freeze([-100, -50, 0, 50, 100, 210, 260, 310, 450, 550, 650, 750]);
const EXISTING_ROAD_Z = Object.freeze([-100, -50, 0, 50, 100]);
const ROAD_HALF_WIDTH_WITH_CLEARANCE = 9;

const ZONE_DEFINITIONS = Object.freeze({
  RES: { canonical: 'RESIDENTIAL', color: 0x22c55e, happiness: 1.2, landValue: 1.5 },
  RESIDENTIAL: { canonical: 'RESIDENTIAL', color: 0x22c55e, happiness: 1.2, landValue: 1.5 },
  COM: { canonical: 'COMMERCIAL', color: 0xd946ef, happiness: 0.3, landValue: 2.2 },
  COMMERCIAL: { canonical: 'COMMERCIAL', color: 0xd946ef, happiness: 0.3, landValue: 2.2 },
  IND: { canonical: 'INDUSTRIAL', color: 0xf97316, happiness: -1.5, landValue: -1 },
  INDUSTRIAL: { canonical: 'INDUSTRIAL', color: 0xf97316, happiness: -1.5, landValue: -1 },
  OFFICE: { canonical: 'OFFICE', color: 0x38bdf8, happiness: 0.4, landValue: 1.8 },
  POWER: { canonical: 'POWER_SERVICE', color: 0xfacc15, happiness: 0.2, landValue: 0.4 },
  WATER: { canonical: 'WATER_SERVICE', color: 0x06b6d4, happiness: 0.8, landValue: 0.7 },
  FIRE: { canonical: 'FIRE_SERVICE', color: 0xef4444, happiness: 1.5, landValue: 1.2 }
});

function rectsOverlap(a, b) {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function callOptional(target, methodNames, args = []) {
  if (!target) return { called: false, value: undefined };
  for (const methodName of methodNames) {
    if (typeof target[methodName] === 'function') {
      return { called: true, value: target[methodName](...args) };
    }
  }
  return { called: false, value: undefined };
}

export class CityEditorSystem {
  constructor(app) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.camera = app.sceneManager.camera;
    this.rendererElement = app.sceneManager.renderer?.domElement || null;

    this.isActive = false;
    this.isDeleteMode = false;
    this.toolMode = 'PLACE';
    this.selectedStructure = null;
    this.selectionHelper = null;
    this.gridSnap = true;
    this.snapSize = 10;
    this.rotationY = 0;
    this.zoningMode = null;
    this.nextUserBuildingId = 1;
    this.zoneParcels = app.zoneParcels || new Map();
    app.zoneParcels = this.zoneParcels;
    this.zoneOverlayGroup = new THREE.Group();
    this.zoneOverlayGroup.name = 'CityZoneOverlays';
    // Zoning is an editor aid, not part of the authored world. Keeping this
    // hidden by default also prevents restored parcels from leaking into the
    // management view before CityEditorUI has synchronized the game mode.
    this.zoneOverlayGroup.visible = false;
    this.scene.add(this.zoneOverlayGroup);

    this.selectedSpec = getBuildingSpec('NEOTECH_HQ');
    this.ghostGroup = null;
    this.structurePreview = null;
    this.shadowFootprint = null;
    this.currentHit = { x: 0, y: 0, z: 0, valid: false };

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.intersectPoint = new THREE.Vector3();

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  syncZoneOverlayVisibility() {
    const visible = Boolean(this.isActive && this.zoningMode);
    this.zoneOverlayGroup.visible = visible;
    return visible;
  }

  createZoneOverlayMesh(x, z, definition) {
    const size = this.snapSize * 3.6;
    const segments = Math.max(2, Math.ceil(size / 6));
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // A single flat plane intersects MetroPulse's rolling countryside and is
    // perceived as an irregular colored blob. Drape the editor overlay over
    // the sampled terrain instead, with a small consistent visual offset.
    const baseY = this.app.cityBuilder?.getHillHeight?.(x, z) || 0;
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const worldX = x + positions.getX(index);
      const worldZ = z + positions.getZ(index);
      const terrainY = this.app.cityBuilder?.getHillHeight?.(worldX, worldZ) ?? baseY;
      positions.setY(index, terrainY - baseY + 0.14);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: definition.color,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      })
    );
    mesh.position.set(x, baseY, z);
    mesh.renderOrder = 4;
    mesh.userData.zoneType = definition.canonical;
    return mesh;
  }

  activate() {
    if (this.isActive) return false;
    if (!this.camera || !this.rendererElement) {
      this.app.uiManager?.showToast('⚠️ City Editor unavailable: camera or renderer is not ready');
      return false;
    }

    this.isActive = true;
    this.isDeleteMode = false;
    this.currentHit.valid = false;
    this.syncZoneOverlayVisibility();

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKeyDown);

    this.updateGhostMesh();
    this.app.uiManager?.showToast('🏗️ City Editor Active - Select a structure, then click the map to build');
    return true;
  }

  deactivate() {
    if (!this.isActive) return false;
    this.isActive = false;

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDown);

    this.disposeGhostGroup();
    this.clearStructureSelection();
    this.currentHit.valid = false;
    this.syncZoneOverlayVisibility();
    return true;
  }

  selectBuilding(specId) {
    const spec = getBuildingSpec(specId);
    if (!spec) return false;
    this.selectedSpec = spec;
    this.toolMode = 'PLACE';
    this.clearStructureSelection();
    this.zoningMode = null;
    this.isDeleteMode = false;
    this.syncZoneOverlayVisibility();
    this.updateGhostMesh();
    return true;
  }

  setZoningMode(zoneType) {
    const normalized = typeof zoneType === 'string' ? zoneType.trim().toUpperCase() : '';
    const definition = ZONE_DEFINITIONS[normalized];
    if (!definition) return false;
    this.zoningMode = definition.canonical;
    this.toolMode = 'ZONE';
    this.clearStructureSelection();
    this.isDeleteMode = false;
    this.disposeGhostGroup();
    this.syncZoneOverlayVisibility();
    this.app.uiManager?.showToast(`🗺️ Zoning tool active: ${normalized}`);
    return true;
  }

  clearZoningMode() {
    if (!this.zoningMode) return false;
    this.zoningMode = null;
    this.syncZoneOverlayVisibility();
    this.updateGhostMesh();
    return true;
  }

  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    return this.gridSnap;
  }

  toggleDeleteMode() {
    this.isDeleteMode = !this.isDeleteMode;
    this.toolMode = this.isDeleteMode ? 'DELETE' : 'PLACE';
    this.zoningMode = null;
    this.syncZoneOverlayVisibility();
    if (this.isDeleteMode) {
      this.clearStructureSelection();
      this.disposeGhostGroup();
    } else {
      this.updateGhostMesh();
    }
    return this.isDeleteMode;
  }

  setTool(tool) {
    const normalized = String(tool || '').toUpperCase();
    if (!['PLACE', 'MOVE', 'ROTATE', 'DELETE'].includes(normalized)) return false;
    this.toolMode = normalized;
    this.zoningMode = null;
    this.syncZoneOverlayVisibility();
    this.isDeleteMode = normalized === 'DELETE';
    if (normalized === 'PLACE') {
      this.clearStructureSelection();
      this.updateGhostMesh();
    } else {
      this.disposeGhostGroup();
      if (normalized === 'DELETE') this.clearStructureSelection();
    }
    return true;
  }

  clearStructureSelection() {
    this.selectedStructure = null;
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.geometry?.dispose?.();
      this.selectionHelper.material?.dispose?.();
      this.selectionHelper = null;
    }
  }

  selectStructureAtMouse() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const buildings = (this.app.buildingFactory?.buildings || []).filter(building => (
      building?.isUserPlaced && !building.isDestroyed && building.group
    ));
    for (const building of buildings.reverse()) {
      if (this.raycaster.intersectObject(building.group, true).length === 0) continue;
      this.clearStructureSelection();
      this.selectedStructure = building;
      this.selectedSpec = building.spec;
      this.rotationY = building.group.rotation.y;
      this.selectionHelper = new THREE.BoxHelper(building.group, 0x00f0ff);
      this.selectionHelper.name = 'SelectedCityStructure';
      this.scene.add(this.selectionHelper);
      this.app.uiManager?.showToast(`✥ Selected ${building.name}. Click a valid destination to move it.`);
      return building;
    }
    this.clearStructureSelection();
    this.app.uiManager?.showToast('ℹ️ Select a structure built with the City Editor.');
    return null;
  }

  rotateSelection() {
    if (this.selectedStructure && (this.toolMode === 'MOVE' || this.toolMode === 'ROTATE')) {
      const building = this.selectedStructure;
      const isRoad = building.spec?.generatorType === 'ROAD_SEGMENT';
      if (isRoad) this.app.trafficSystem?.unregisterRoadSegment?.(building, building.spec);
      building.group.rotation.y = (building.group.rotation.y + Math.PI / 2) % (Math.PI * 2);
      this.rotationY = building.group.rotation.y;
      const quarterTurns = Math.round(this.rotationY / (Math.PI / 2)) % 2;
      const width = building.spec?.footprint?.width || building.plot.width;
      const depth = building.spec?.footprint?.depth || building.plot.depth;
      building.plot.width = quarterTurns === 0 ? width : depth;
      building.plot.depth = quarterTurns === 0 ? depth : width;
      if (building.physicsBody?.quaternion) {
        building.physicsBody.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, this.rotationY);
      }
      if (isRoad) this.app.trafficSystem?.registerRoadSegment?.(building, building.spec);
      this.selectionHelper?.update?.();
      this.app.uiManager?.showToast(`↻ Rotated ${building.name} 90°.`);
      this.app.persistenceSystem?.scheduleSave?.();
      return this.rotationY;
    }
    this.rotationY = (this.rotationY + Math.PI / 2) % (Math.PI * 2);
    if (this.ghostGroup) {
      this.ghostGroup.rotation.y = this.rotationY;
    }
    if (this.currentHit) {
      this.currentHit.valid = this.checkPlacementValidity(
        this.currentHit.x,
        this.currentHit.z,
        this.currentHit.y
      );
      this.updateGhostValidityAppearance(this.currentHit.valid);
    }
    return this.rotationY;
  }

  getOrientedFootprint(spec = this.selectedSpec, rotationY = this.rotationY) {
    const width = spec?.footprint?.width || 1;
    const depth = spec?.footprint?.depth || 1;
    const quarterTurns = Math.abs(Math.round(rotationY / (Math.PI / 2))) % 2;
    return quarterTurns === 0
      ? { width, depth }
      : { width: depth, depth: width };
  }

  getPlacementRect(x, z, clearance = 2, spec = this.selectedSpec, rotationY = this.rotationY) {
    const footprint = this.getOrientedFootprint(spec, rotationY);
    return {
      minX: x - footprint.width / 2 - clearance,
      maxX: x + footprint.width / 2 + clearance,
      minZ: z - footprint.depth / 2 - clearance,
      maxZ: z + footprint.depth / 2 + clearance
    };
  }

  disposeGhostGroup() {
    if (!this.ghostGroup) return;
    this.scene.remove(this.ghostGroup);
    this.ghostGroup.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material.dispose());
      } else {
        child.material?.dispose();
      }
    });
    this.ghostGroup = null;
    this.structurePreview = null;
    this.shadowFootprint = null;
  }

  updateGhostMesh() {
    this.disposeGhostGroup();
    if (!this.selectedSpec || !this.isActive || this.isDeleteMode || this.zoningMode) return false;

    const footprint = this.getOrientedFootprint();
    const height = this.selectedSpec.height || 30;
    const baseColor = this.selectedSpec.baseColor ?? 0x334455;

    this.ghostGroup = new THREE.Group();
    this.structurePreview = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(1, footprint.width - 2), height, Math.max(1, footprint.depth - 2)),
      new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: 0x00ff88,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.58,
        roughness: 0.45,
        metalness: 0.2,
        depthWrite: false
      })
    );
    this.structurePreview.position.y = height / 2;
    this.structurePreview.castShadow = false;
    this.structurePreview.receiveShadow = false;
    this.ghostGroup.add(this.structurePreview);

    this.shadowFootprint = new THREE.Mesh(
      new THREE.PlaneGeometry(footprint.width + 3, footprint.depth + 3),
      new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.52,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.shadowFootprint.rotation.x = -Math.PI / 2;
    this.shadowFootprint.position.y = 0.2;
    this.ghostGroup.add(this.shadowFootprint);

    this.ghostGroup.rotation.y = this.rotationY;
    if (this.currentHit) {
      this.ghostGroup.position.set(this.currentHit.x, this.currentHit.y, this.currentHit.z);
      this.updateGhostValidityAppearance(this.currentHit.valid);
    }
    this.scene.add(this.ghostGroup);
    return true;
  }

  updateGhostValidityAppearance(valid) {
    const colorHex = valid ? 0x00ff88 : 0xff2244;
    if (this.shadowFootprint?.material) {
      this.shadowFootprint.material.color.setHex(colorHex);
      this.shadowFootprint.material.opacity = valid ? 0.52 : 0.75;
    }
    if (this.structurePreview?.material) {
      this.structurePreview.material.emissive.setHex(colorHex);
      this.structurePreview.material.emissiveIntensity = valid ? 0.35 : 0.7;
    }
  }

  isPointerOnEditorCanvas(target) {
    return Boolean(this.rendererElement && target === this.rendererElement);
  }

  onPointerMove(event) {
    if (!this.isActive || !this.isPointerOnEditorCanvas(event.target)) return;

    const rect = this.rendererElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHitFromNdc(x, y);
  }

  updateControllerCursor(x, y) {
    if (!this.isActive || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return this.updateHitFromNdc(x, y);
  }

  updateHitFromNdc(x, y) {
    this.mouse.set(x, y);

    this.raycaster.setFromCamera(this.mouse, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.intersectPoint)) {
      this.currentHit.valid = false;
      this.updateGhostValidityAppearance(false);
      return false;
    }

    let targetX = this.intersectPoint.x;
    let targetZ = this.intersectPoint.z;
    if (this.gridSnap) {
      targetX = Math.round(targetX / this.snapSize) * this.snapSize;
      targetZ = Math.round(targetZ / this.snapSize) * this.snapSize;
    }

    const terrainY = typeof this.app.cityBuilder?.getHillHeight === 'function'
      ? this.app.cityBuilder.getHillHeight(targetX, targetZ)
      : 0;
    const valid = this.zoningMode
      ? this.checkZoningValidity(targetX, targetZ, terrainY)
      : this.checkPlacementValidity(
        targetX,
        targetZ,
        terrainY,
        this.toolMode === 'MOVE' ? this.selectedStructure : null
      );
    this.currentHit = { x: targetX, y: terrainY, z: targetZ, valid };

    if (this.ghostGroup) {
      this.ghostGroup.position.set(targetX, terrainY, targetZ);
      this.ghostGroup.rotation.y = this.rotationY;
      this.updateGhostValidityAppearance(valid);
    }
    return valid;
  }

  checkPlacementValidity(x, z, y = 0, ignoreBuilding = null) {
    return this.isPlacementValid({
      spec: this.selectedSpec,
      rotationY: this.rotationY,
      x,
      z,
      y,
      ignoreBuilding
    });
  }

  isPlacementValid({
    spec,
    rotationY = 0,
    x,
    z,
    y = 0,
    ignoreBuilding = null,
    allowCountrysideReplacement = false,
    ignorePlayer = false
  } = {}) {
    if (!spec || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;

    const placementRect = this.getPlacementRect(x, z, 2, spec, rotationY);
    if (
      placementRect.minX < WORLD_BOUNDS.minX ||
      placementRect.maxX > WORLD_BOUNDS.maxX ||
      placementRect.minZ < WORLD_BOUNDS.minZ ||
      placementRect.maxZ > WORLD_BOUNDS.maxZ
    ) {
      return false;
    }

    if (CORE_LANDMARKS.some(landmark => rectsOverlap(placementRect, landmark))) return false;
    if (this.overlapsExistingRoad(placementRect)) return false;
    const overlapsWater = this.overlapsWater(placementRect, y);
    const isBridgeSegment = spec.roadType === 'BRIDGE';
    if (overlapsWater && !isBridgeSegment) return false;
    if (!allowCountrysideReplacement) {
      const cityBuilder = this.app.cityBuilder;
      const overlapsCountryside = typeof cityBuilder?.hasCountrysideOccupancyOverlap === 'function'
        ? cityBuilder.hasCountrysideOccupancyOverlap(placementRect)
        : (cityBuilder?.countrysideOccupancy || []).some(envelope => rectsOverlap(placementRect, envelope));
      if (overlapsCountryside) return false;
    }

    const buildings = this.app.buildingFactory?.buildings || [];
    for (const building of buildings) {
      if (building === ignoreBuilding) continue;
      if (!building || building.isDestroyed || !building.plot) continue;
      const width = building.plot.width || 30;
      const depth = building.plot.depth || 30;
      const buildingRect = {
        minX: building.plot.x - width / 2,
        maxX: building.plot.x + width / 2,
        minZ: building.plot.z - depth / 2,
        maxZ: building.plot.z + depth / 2
      };
      if (rectsOverlap(placementRect, buildingRect)) return false;
    }

    const playerPosition = ignorePlayer ? null : this.getControlledPlayerPosition();
    if (
      playerPosition &&
      playerPosition.x > placementRect.minX - 4 &&
      playerPosition.x < placementRect.maxX + 4 &&
      playerPosition.z > placementRect.minZ - 4 &&
      playerPosition.z < placementRect.maxZ + 4
    ) {
      return false;
    }

    return this.isDistrictUnlocked(x, z, spec);
  }

  checkZoningValidity(x, z, y = 0) {
    if (!this.zoningMode || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX || z < WORLD_BOUNDS.minZ || z > WORLD_BOUNDS.maxZ) {
      return false;
    }
    const parcel = { minX: x - 5, maxX: x + 5, minZ: z - 5, maxZ: z + 5 };
    if (CORE_LANDMARKS.some(landmark => rectsOverlap(parcel, landmark))) return false;
    if (this.overlapsWater(parcel, y)) return false;
    return this.isDistrictUnlocked(x, z, { id: `ZONE_${this.zoningMode}`, category: this.zoningMode });
  }

  overlapsExistingRoad(rect) {
    const horizontalRange = { minX: -160, maxX: 810 };
    for (const roadZ of EXISTING_ROAD_Z) {
      const roadRect = {
        minX: horizontalRange.minX,
        maxX: horizontalRange.maxX,
        minZ: roadZ - ROAD_HALF_WIDTH_WITH_CLEARANCE,
        maxZ: roadZ + ROAD_HALF_WIDTH_WITH_CLEARANCE
      };
      if (rectsOverlap(rect, roadRect)) return true;
    }

    for (const roadX of EXISTING_ROAD_X) {
      const roadRect = {
        minX: roadX - ROAD_HALF_WIDTH_WITH_CLEARANCE,
        maxX: roadX + ROAD_HALF_WIDTH_WITH_CLEARANCE,
        minZ: -110,
        maxZ: 110
      };
      if (rectsOverlap(rect, roadRect)) return true;
    }

    const accessRoad = { minX: 691, maxX: 709, minZ: -290, maxZ: -91 };
    const missionControlSpur = { minX: 691, maxX: 760, minZ: -253, maxZ: -237 };
    return rectsOverlap(rect, accessRoad) || rectsOverlap(rect, missionControlSpur);
  }

  overlapsWater(rect, y) {
    if (typeof this.app.cityBuilder?.isInWater !== 'function') return false;
    const samplePoints = [
      { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 },
      { x: rect.minX, z: rect.minZ },
      { x: rect.minX, z: rect.maxZ },
      { x: rect.maxX, z: rect.minZ },
      { x: rect.maxX, z: rect.maxZ }
    ];
    return samplePoints.some(point => this.app.cityBuilder.isInWater({ x: point.x, y, z: point.z }));
  }

  getControlledPlayerPosition() {
    const controlledVehicle = this.app.trafficSystem?.controlledVehicle;
    if (controlledVehicle?.physicsVehicle?.chassisBody?.position) {
      return controlledVehicle.physicsVehicle.chassisBody.position;
    }
    if (controlledVehicle?.mesh?.position) return controlledVehicle.mesh.position;

    const controlledPedestrian = this.app.pedestrianSystem?.controlledPedestrian;
    if (controlledPedestrian?.mesh?.position) return controlledPedestrian.mesh.position;

    if (this.app.playerVehicle?.chassisBody?.position) return this.app.playerVehicle.chassisBody.position;
    return null;
  }

  isDistrictUnlocked(x, z, spec = this.selectedSpec) {
    const context = { x, z, spec, editor: this };

    // The economy model exposes district state by stable ID rather than world
    // coordinate. Keep that mapping at this integration boundary.
    const economy = this.getEconomyController();
    if (x >= 185 && x <= 420 && typeof economy?.isDistrictUnlocked === 'function') {
      try {
        if (!economy.isDistrictUnlocked('EAST_CYBER_METROPOLIS')) return false;
      } catch (error) {
        console.warn('City editor economy district check failed; placement blocked for safety.', error);
        return false;
      }
    }

    const providers = [this.app.districtSystem, this.app.gameManager].filter(Boolean);
    for (const provider of providers) {
      try {
        const result = callOptional(
          provider,
          ['canBuildAt', 'isDistrictUnlockedAt', 'canPlaceBuilding'],
          [x, z, spec, context]
        );
        if (result.called && result.value === false) return false;
      } catch (error) {
        console.warn('City editor district check failed; placement blocked for safety.', error);
        return false;
      }
    }
    return true;
  }

  getPlacementCost(spec = this.selectedSpec) {
    const cost = Number(spec?.cost || 0);
    return Number.isFinite(cost) && cost > 0 ? cost : 0;
  }

  getEconomyController() {
    return this.app.economySystem || this.app.economy || this.app.gameManager?.economy || null;
  }

  getAvailableCredits() {
    const controllers = [this.getEconomyController(), this.app.gameManager].filter(Boolean);
    for (const controller of controllers) {
      const result = callOptional(controller, ['getAvailableCredits', 'getCredits', 'getBalance'], []);
      const methodValue = Number(result.value);
      if (result.called && Number.isFinite(methodValue)) return methodValue;
      for (const property of ['credits', 'cash', 'balance', 'budget', 'treasury']) {
        const propertyValue = Number(controller[property]);
        if (Number.isFinite(propertyValue)) return propertyValue;
      }
    }
    return null;
  }

  canAfford(spec = this.selectedSpec) {
    const cost = this.getPlacementCost(spec);
    if (cost <= 0) return true;

    const context = { reason: 'building-placement', spec, editor: this };
    const controllers = [this.getEconomyController(), this.app.gameManager].filter(Boolean);
    for (const controller of controllers) {
      const result = callOptional(controller, ['canAffordBuilding', 'canAfford'], [cost, spec, context]);
      if (result.called) return result.value !== false;
    }

    const availableCredits = this.getAvailableCredits();
    return availableCredits == null || availableCredits >= cost;
  }

  chargeForPlacement(spec) {
    const cost = this.getPlacementCost(spec);
    if (cost <= 0) return true;
    const context = {
      source: 'building-placement',
      referenceId: spec?.id || null,
      reason: 'building-placement',
      spec,
      editor: this
    };
    const controllers = [this.getEconomyController(), this.app.gameManager].filter(Boolean);
    for (const controller of controllers) {
      const result = callOptional(controller, ['spendCredits', 'spend', 'debit'], [cost, context]);
      if (result.called) return result.value !== false;
    }
    return true;
  }

  refundPlacement(spec, building, amount = this.getPlacementCost(spec)) {
    if (amount <= 0) return false;
    const context = {
      source: 'building-refund',
      referenceId: building?.economyId || building?.id || spec?.id || null,
      reason: 'building-refund',
      spec,
      building,
      editor: this
    };
    const controllers = [this.getEconomyController(), this.app.gameManager].filter(Boolean);
    for (const controller of controllers) {
      const result = callOptional(controller, ['refundCredits', 'refund', 'credit', 'earn'], [amount, context]);
      if (result.called) return result.value !== false;
    }
    return false;
  }

  createEconomyBuildingRecord(building, spec) {
    const id = building.economyId || building.id || `USER_BUILDING_${this.nextUserBuildingId++}`;
    building.economyId = id;
    building.id = building.id || id;
    const happinessModifier = Number(spec.happiness ?? spec.happinessModifier ?? 0);
    const amenityRadius = Math.max(0, Number(spec.amenityRadius ?? 0));
    const sourcePosition = building.plot || building.group?.position;
    const position = Number.isFinite(sourcePosition?.x) && Number.isFinite(sourcePosition?.z)
      ? { x: sourcePosition.x, z: sourcePosition.z }
      : undefined;

    return {
      id,
      name: building.name || spec.name || id,
      kind: spec.category || spec.generatorType || spec.id,
      value: Math.max(0, Number(spec.value ?? spec.cost ?? 0)),
      employees: Math.max(0, Math.round(Number(spec.employees || 0))),
      population: Math.max(0, Math.round(Number(spec.residents || spec.population || 0))),
      status: spec.status || 'ACTIVE',
      operational: true,
      // EconomySystem currently models positive passive income; upkeep remains
      // available on the source spec for a future expense system.
      passiveIncomeRate: Math.max(0, Number(spec.incomePerMinute || 0) / 60),
      happinessModifier,
      landValueModifier: Number(
        spec.landValueModifier
        ?? (happinessModifier * 0.6 + (amenityRadius > 0 ? 3 : 0))
      ),
      position,
      amenityRadius,
      services: {
        power: {
          capacity: Math.max(0, Number(spec.powerSupply || 0)),
          demand: Math.max(0, Number(spec.powerDemand || 0))
        },
        water: {
          capacity: Math.max(0, Number(spec.waterSupply || 0)),
          demand: Math.max(0, Number(spec.waterDemand || 0))
        },
        fire: {
          capacity: Math.max(0, Number(spec.fireCoverage || 0)),
          demand: Math.max(0, Number(spec.fireDemand || 0))
        }
      }
    };
  }

  notifyStructureRegistered(building, spec) {
    const context = { reason: 'building-placement', building, spec, editor: this };
    const economy = this.getEconomyController();
    if (typeof economy?.registerBuilding === 'function') {
      building.economyRecord = economy.registerBuilding(this.createEconomyBuildingRecord(building, spec));
    }

    callOptional(this.app.gameManager, ['registerPlacedStructure'], [building, spec, context]);
    callOptional(this.app.citySimulation, ['registerPlacedStructure', 'registerBuilding'], [building, spec, context]);
    if (spec.generatorType === 'ROAD_SEGMENT') {
      callOptional(this.app.trafficSystem, ['registerRoadSegment'], [building, spec, context]);
    }
    return true;
  }

  notifyStructureRemoved(building, spec) {
    const context = { reason: 'building-demolition', building, spec, editor: this };
    const economy = this.getEconomyController();
    const economyId = building.economyId || building.id;
    if (economyId && typeof economy?.removeBuilding === 'function') {
      economy.removeBuilding(economyId);
    }

    callOptional(this.app.gameManager, ['removePlacedStructure'], [building, spec, context]);
    callOptional(this.app.citySimulation, ['removePlacedStructure', 'unregisterBuilding'], [building, spec, context]);
    if (spec?.generatorType === 'ROAD_SEGMENT') {
      callOptional(this.app.trafficSystem, ['unregisterRoadSegment'], [building, spec, context]);
    }
    return true;
  }

  onPointerDown(event) {
    if (!this.isActive || event.button !== 0 || !this.isPointerOnEditorCanvas(event.target)) return false;
    this.onPointerMove(event);
    if (this.isDeleteMode) return this.performDeleteAtMouse();
    if (this.zoningMode) return this.applyZoningAtCurrentHit();
    if (this.toolMode === 'MOVE' || this.toolMode === 'ROTATE') {
      if (!this.selectedStructure) return Boolean(this.selectStructureAtMouse());
      if (this.toolMode === 'ROTATE') return Boolean(this.selectStructureAtMouse());
      return this.moveSelectedStructureToCurrentHit();
    }
    return this.placeSelectedBuilding();
  }

  performControllerAction() {
    if (!this.isActive) return false;
    if (this.isDeleteMode) return this.performDeleteAtMouse();
    if (this.zoningMode) return this.applyZoningAtCurrentHit();
    if (this.toolMode === 'MOVE' || this.toolMode === 'ROTATE') {
      if (!this.selectedStructure) return Boolean(this.selectStructureAtMouse());
      if (this.toolMode === 'ROTATE') return Boolean(this.selectStructureAtMouse());
      return this.moveSelectedStructureToCurrentHit();
    }
    return this.placeSelectedBuilding();
  }

  moveSelectedStructureToCurrentHit() {
    const building = this.selectedStructure;
    if (!building || !this.currentHit.valid) {
      this.app.uiManager?.showToast('⚠️ Choose a valid, unoccupied destination.');
      return false;
    }
    if (!this.checkPlacementValidity(this.currentHit.x, this.currentHit.z, this.currentHit.y, building)) {
      this.app.uiManager?.showToast('⚠️ That destination is blocked or outside the unlocked city.');
      return false;
    }

    if (building.spec?.generatorType === 'ROAD_SEGMENT') {
      this.app.trafficSystem?.unregisterRoadSegment?.(building, building.spec);
    }
    const economy = this.getEconomyController();
    const previousPlot = { ...building.plot };
    const previousEconomyRecord = building.economyId && economy?.getBuilding
      ? economy.getBuilding(building.economyId)
      : building.economyRecord;
    try {
      if (building.economyId && economy?.removeBuilding) economy.removeBuilding(building.economyId);
      building.group.position.set(this.currentHit.x, this.currentHit.y, this.currentHit.z);
      building.plot.x = this.currentHit.x;
      building.plot.y = this.currentHit.y;
      building.plot.z = this.currentHit.z;
      if (building.physicsBody?.position) {
        const height = building.spec?.height || building.height || 30;
        building.physicsBody.position.set(this.currentHit.x, this.currentHit.y + height * 0.5, this.currentHit.z);
      }
      if (economy?.registerBuilding) {
        building.economyRecord = economy.registerBuilding(this.createEconomyBuildingRecord(building, building.spec));
      }
      if (building.spec?.generatorType === 'ROAD_SEGMENT') {
        this.app.trafficSystem?.registerRoadSegment?.(building, building.spec);
      }
    } catch (error) {
      console.error('City editor move failed; restoring the previous structure state.', error);
      building.group.position.set(previousPlot.x, previousPlot.y, previousPlot.z);
      Object.assign(building.plot, previousPlot);
      if (building.physicsBody?.position) {
        const height = building.spec?.height || building.height || 30;
        building.physicsBody.position.set(previousPlot.x, previousPlot.y + height * 0.5, previousPlot.z);
      }
      if (previousEconomyRecord && economy?.registerBuilding && !economy.getBuilding?.(previousEconomyRecord.id)) {
        building.economyRecord = economy.registerBuilding(previousEconomyRecord);
      }
      if (building.spec?.generatorType === 'ROAD_SEGMENT') {
        this.app.trafficSystem?.registerRoadSegment?.(building, building.spec);
      }
      this.app.uiManager?.showToast('⚠️ Move failed; the structure was restored safely.');
      return false;
    }
    this.selectionHelper?.update?.();
    this.app.uiManager?.addAlert?.(`✥ Moved ${building.name} to ${Math.round(building.plot.x)}, ${Math.round(building.plot.z)}.`, 'success');
    this.app.persistenceSystem?.scheduleSave?.();
    return true;
  }

  applyZoningAtCurrentHit() {
    if (!this.zoningMode || !this.currentHit.valid) return false;
    const context = { ...this.currentHit, zoneType: this.zoningMode, editor: this };
    const providers = [this.app.zoningSystem, this.app.gameManager].filter(Boolean);
    for (const provider of providers) {
      const result = callOptional(provider, ['setZoneAt', 'applyZoneAt', 'rezoneAt'], [
        this.currentHit.x,
        this.currentHit.z,
        this.zoningMode,
        context
      ]);
      if (!result.called) continue;
      if (result.value === false) {
        this.app.uiManager?.showToast('⚠️ Zoning change rejected by the city simulation');
        return false;
      }
      this.app.uiManager?.addAlert(
        `🗺️ Rezoned parcel at ${this.currentHit.x}, ${this.currentHit.z} as ${this.zoningMode}`,
        'info'
      );
      return true;
    }
    return this.applyLocalZoneParcel();
  }

  applyLocalZoneParcel() {
    const definition = Object.values(ZONE_DEFINITIONS).find(entry => entry.canonical === this.zoningMode);
    if (!definition) return false;

    const { x, y, z } = this.currentHit;
    const key = `${Math.round(x / this.snapSize)},${Math.round(z / this.snapSize)}`;
    const previous = this.zoneParcels.get(key);
    if (previous?.zoneType === definition.canonical) {
      this.app.uiManager?.showToast(`ℹ️ Parcel is already zoned ${definition.canonical}`);
      return true;
    }

    const economy = this.getEconomyController();
    if (previous) {
      previous.mesh?.removeFromParent();
      previous.mesh?.geometry?.dispose();
      previous.mesh?.material?.dispose();
      economy?.adjustHappiness?.(-previous.happinessModifier);
      economy?.adjustLandValue?.(-previous.landValueModifier);
    }

    const mesh = this.createZoneOverlayMesh(x, z, definition);
    this.zoneOverlayGroup.add(mesh);

    const parcel = {
      key,
      x,
      z,
      zoneType: definition.canonical,
      happinessModifier: definition.happiness,
      landValueModifier: definition.landValue,
      mesh
    };
    this.zoneParcels.set(key, parcel);
    economy?.adjustHappiness?.(definition.happiness);
    economy?.adjustLandValue?.(definition.landValue);

    const building = (this.app.buildingFactory?.buildings || []).find(candidate => {
      if (!candidate?.plot || candidate.isDestroyed) return false;
      return Math.abs(candidate.plot.x - x) <= (candidate.plot.width || 30) / 2
        && Math.abs(candidate.plot.z - z) <= (candidate.plot.depth || 30) / 2;
    });
    if (building) {
      building.zone = definition.canonical;
      building.status = `Rezoned: ${definition.canonical}`;
      if (building.info) {
        building.info.Zone = definition.canonical;
        building.info.Status = building.status;
      }
    }

    this.app.uiManager?.addAlert(
      `🗺️ Parcel ${Math.round(x)}, ${Math.round(z)} rezoned ${definition.canonical}.`,
      'success'
    );
    this.app.persistenceSystem?.scheduleSave?.();
    return true;
  }

  serializeWorldEdits() {
    return {
      version: 1,
      buildings: (this.app.buildingFactory?.buildings || [])
        .filter(building => building?.isUserPlaced && !building.isDestroyed && building.spec?.id)
        .map(building => ({
          economyId: building.economyId || null,
          specId: building.spec.id,
          plot: { ...building.plot },
          rotationY: building.group?.rotation?.y || 0
        })),
      zones: [...this.zoneParcels.values()].map(parcel => ({
        key: parcel.key,
        x: parcel.x,
        z: parcel.z,
        zoneType: parcel.zoneType,
        happinessModifier: parcel.happinessModifier,
        landValueModifier: parcel.landValueModifier
      }))
    };
  }

  restoreZoneParcels(records = []) {
    if (!Array.isArray(records)) throw new TypeError('Saved zone parcels must be an array');
    for (const record of records) {
      const definition = Object.values(ZONE_DEFINITIONS).find(entry => entry.canonical === record?.zoneType);
      if (!definition || !Number.isFinite(record.x) || !Number.isFinite(record.z)) continue;
      const key = typeof record.key === 'string'
        ? record.key
        : `${Math.round(record.x / this.snapSize)},${Math.round(record.z / this.snapSize)}`;
      if (this.zoneParcels.has(key)) continue;
      const mesh = this.createZoneOverlayMesh(record.x, record.z, definition);
      this.zoneOverlayGroup.add(mesh);
      this.zoneParcels.set(key, {
        key,
        x: record.x,
        z: record.z,
        zoneType: definition.canonical,
        happinessModifier: Number(record.happinessModifier ?? definition.happiness),
        landValueModifier: Number(record.landValueModifier ?? definition.landValue),
        mesh
      });
    }
    this.syncZoneOverlayVisibility();
    return this.zoneParcels.size;
  }

  performDeleteAtMouse() {
    if (!this.camera) return false;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const buildings = this.app.buildingFactory?.buildings || [];

    for (let index = buildings.length - 1; index >= 0; index--) {
      const building = buildings[index];
      if (!building || building.isDestroyed || !building.group) continue;
      const intersects = this.raycaster.intersectObject(building.group, true);
      if (intersects.length === 0) continue;

      if (!building.isUserPlaced) {
        this.app.uiManager?.showToast('🛡️ Protected City Structure: core infrastructure cannot be demolished');
        return false;
      }

      try {
        this.notifyStructureRemoved(building, building.spec);
      } catch (error) {
        console.error('City editor could not unregister the structure.', error);
        this.app.uiManager?.showToast('⚠️ Demolition cancelled: city simulation rejected the change');
        return false;
      }

      this.scene.remove(building.group);
      building.isDestroyed = true;
      if (building.physicsBody && this.app.physicsWorld) {
        this.app.physicsWorld.world.removeBody(building.physicsBody);
        const staticIndex = this.app.physicsWorld.staticBodies?.indexOf(building.physicsBody) ?? -1;
        if (staticIndex >= 0) this.app.physicsWorld.staticBodies.splice(staticIndex, 1);
      }
      if (building.baseBox) this.app.inspectorHud?.unregisterObject(building.baseBox);

      buildings.splice(index, 1);

      const refundRate = Number.isFinite(Number(building.spec?.refundRate))
        ? Math.max(0, Math.min(1, Number(building.spec.refundRate)))
        : 0.5;
      const refundAmount = Math.round(this.getPlacementCost(building.spec) * refundRate);
      const refundApplied = this.refundPlacement(building.spec, building, refundAmount);

      building.group.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
        else child.material?.dispose();
      });

      this.app.uiManager?.showToast(
        `🗑️ Demolished: ${building.name}${refundApplied ? ` (+$${refundAmount.toLocaleString()} salvage)` : ''}`
      );
      this.clearStructureSelection();
      this.app.persistenceSystem?.scheduleSave?.();
      return true;
    }
    return false;
  }

  placeSelectedBuilding() {
    if (!this.selectedSpec || !this.currentHit.valid || !this.app.buildingFactory?.placeUserBuilding) {
      this.app.uiManager?.showToast('⚠️ Cannot place structure here: blocked, underwater, locked, or out of bounds');
      return false;
    }

    const validNow = this.checkPlacementValidity(this.currentHit.x, this.currentHit.z, this.currentHit.y);
    if (!validNow) {
      this.currentHit.valid = false;
      this.updateGhostValidityAppearance(false);
      this.app.uiManager?.showToast('⚠️ Placement is no longer valid');
      return false;
    }

    if (!this.canAfford(this.selectedSpec)) {
      this.app.uiManager?.showToast(`💳 Insufficient credits for ${this.selectedSpec.name}`);
      return false;
    }
    if (!this.chargeForPlacement(this.selectedSpec)) {
      this.app.uiManager?.showToast('💳 The city treasury rejected this purchase');
      return false;
    }

    const footprint = this.getOrientedFootprint(this.selectedSpec);
    const plot = {
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z,
      width: footprint.width,
      depth: footprint.depth
    };

    let building = null;
    try {
      building = this.app.buildingFactory.placeUserBuilding(plot, this.selectedSpec, this.rotationY);
      if (!building) throw new Error('Building factory returned no structure');
      building.plot.width = footprint.width;
      building.plot.depth = footprint.depth;

      const generatorType = this.selectedSpec.generatorType;
      if (this.app.physicsWorld && generatorType !== 'ROAD_SEGMENT' && generatorType !== 'PARK_PLAZA') {
        const height = this.selectedSpec.height || 30;
        building.physicsBody = this.app.physicsWorld.addStaticBoxCollider(
          new THREE.Vector3(plot.x, plot.y + height * 0.5, plot.z),
          new THREE.Vector3(Math.max(1, plot.width - 2), height, Math.max(1, plot.depth - 2))
        );
      }

      this.notifyStructureRegistered(building, this.selectedSpec);
    } catch (error) {
      console.error('City editor placement failed.', error);
      if (building) {
        try {
          this.notifyStructureRemoved(building, this.selectedSpec);
        } catch (rollbackError) {
          console.error('City editor economy rollback failed.', rollbackError);
        }
        if (building.physicsBody && this.app.physicsWorld) {
          this.app.physicsWorld.world.removeBody(building.physicsBody);
          const staticIndex = this.app.physicsWorld.staticBodies?.indexOf(building.physicsBody) ?? -1;
          if (staticIndex >= 0) this.app.physicsWorld.staticBodies.splice(staticIndex, 1);
        }
        const buildingIndex = this.app.buildingFactory.buildings?.indexOf(building) ?? -1;
        if (buildingIndex >= 0) this.app.buildingFactory.buildings.splice(buildingIndex, 1);
        if (building.baseBox) this.app.inspectorHud?.unregisterObject(building.baseBox);
      }
      this.refundPlacement(this.selectedSpec, building, this.getPlacementCost(this.selectedSpec));
      if (building?.group) this.scene.remove(building.group);
      this.app.uiManager?.showToast('⚠️ Construction failed; purchase was refunded');
      return false;
    }

    const cost = this.getPlacementCost(this.selectedSpec);
    const chargedEconomy = Boolean(this.getEconomyController());
    this.app.uiManager?.showToast(
      `🏗️ Constructed: ${this.selectedSpec.name}${chargedEconomy && cost > 0 ? ` (-$${cost.toLocaleString()})` : ''}`
    );
    this.app.uiManager?.addAlert?.(`🏗️ New structure registered: ${this.selectedSpec.name}`, 'success');
    this.app.persistenceSystem?.scheduleSave?.();

    this.currentHit.valid = this.checkPlacementValidity(plot.x, plot.z, plot.y);
    this.updateGhostValidityAppearance(this.currentHit.valid);
    return true;
  }

  onKeyDown(event) {
    if (!this.isActive) return;
    const tagName = event.target?.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || event.target?.isContentEditable) return;

    if (event.key === 'g' || event.key === 'G') {
      const snapped = this.toggleGridSnap();
      this.app.uiManager?.showToast(`Grid Snapping: ${snapped ? `ON (${this.snapSize}m)` : 'OFF'}`);
    }
  }
}
