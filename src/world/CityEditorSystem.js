import * as THREE from 'three';
import {
  getBuildingSpec,
  getCatalogAccess,
  getDefaultBuildingSpec
} from './BuildingCatalog.js';
import { createBuildingEconomyRecord } from '../systems/BuildingEconomyAdapter.js';
import { getZoneDefinition, WORLD_BOUNDS } from '../data/ContentDefinitions.js';
import {
  isMvpDevelopmentZone,
  normalizeZoneId
} from './ConstructionVocabulary.js';
import {
  evaluatePlacement,
  isOrdinaryDevelopment
} from './PlacementIntelligence.js';
import { runWorldEditTransaction } from './WorldEditTransaction.js';
import { ECONOMY_BALANCE } from '../systems/EconomyBalance.js';

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
const ZONE_PARCEL_SIZE = 30;
const ZONING_COST = ECONOMY_BALANCE.construction.zoningCost;
const ROAD_ACCESS_DISTANCE = 12;

function rectsOverlap(a, b) {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function rectDistance(a, b) {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dz = Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ, 0);
  return Math.hypot(dx, dz);
}

function finiteTerrainHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

function findOptionalMethod(target, methodNames) {
  if (!target) return null;
  const name = methodNames.find(methodName => typeof target[methodName] === 'function');
  return name ? target[name].bind(target) : null;
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

    this.selectedSpec = getDefaultBuildingSpec();
    this.ghostGroup = null;
    this.structurePreview = null;
    this.shadowFootprint = null;
    this.currentHit = { x: 0, y: 0, z: 0, valid: false, validation: null };
    this.placementListeners = new Set();

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

  subscribePlacementValidation(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== 'function') throw new TypeError('placement listener must be a function');
    this.placementListeners.add(listener);
    if (emitCurrent) listener(this.currentHit.validation);
    return () => this.placementListeners.delete(listener);
  }

  publishPlacementValidation(validation) {
    for (const listener of [...(this.placementListeners || [])]) {
      try {
        listener(validation);
      } catch (error) {
        console.error('City editor placement listener failed.', error);
      }
    }
    return validation;
  }

  createZoneOverlayMesh(x, z, definition) {
    const size = ZONE_PARCEL_SIZE - 1;
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
    mesh.userData.zoneType = definition.id;
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
    this.currentHit.validation = null;
    this.publishPlacementValidation(null);
    this.syncZoneOverlayVisibility();
    return true;
  }

  selectBuilding(specId) {
    const spec = getBuildingSpec(specId);
    if (!spec) return false;
    const access = this.getBuildingAccess(spec);
    if (!access.unlocked) {
      this.app.uiManager?.showToast(`🔒 ${spec.name}: ${access.reason}`);
      return false;
    }
    this.selectedSpec = spec;
    this.toolMode = 'PLACE';
    this.clearStructureSelection();
    this.zoningMode = null;
    this.isDeleteMode = false;
    this.syncZoneOverlayVisibility();
    this.updateGhostMesh();
    this.refreshCurrentPlacementValidation();
    return true;
  }

  setZoningMode(zoneType) {
    const normalized = normalizeZoneId(zoneType);
    if (!isMvpDevelopmentZone(normalized)) return false;
    const definition = getZoneDefinition(normalized);
    if (!definition) return false;
    this.zoningMode = definition.id;
    this.toolMode = 'ZONE';
    this.clearStructureSelection();
    this.isDeleteMode = false;
    this.disposeGhostGroup();
    this.currentHit.validation = null;
    this.publishPlacementValidation(null);
    this.syncZoneOverlayVisibility();
    this.app.uiManager?.showToast(`🗺️ Zoning tool active: ${definition.label}`);
    return true;
  }

  clearZoningMode() {
    if (!this.zoningMode) return false;
    this.zoningMode = null;
    this.syncZoneOverlayVisibility();
    this.updateGhostMesh();
    this.refreshCurrentPlacementValidation();
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
      this.currentHit.validation = null;
      this.publishPlacementValidation(null);
    } else {
      this.updateGhostMesh();
      this.refreshCurrentPlacementValidation();
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
      this.refreshCurrentPlacementValidation();
    } else {
      this.disposeGhostGroup();
      this.currentHit.validation = null;
      this.publishPlacementValidation(null);
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
      this.refreshCurrentPlacementValidation();
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
      const nextRotation = (building.group.rotation.y + Math.PI / 2) % (Math.PI * 2);
      const validation = this.getPlacementValidation({
        spec: building.spec,
        rotationY: nextRotation,
        x: building.plot.x,
        y: building.plot.y,
        z: building.plot.z,
        ignoreBuilding: building,
        allowCountrysideReplacement: true,
        ignorePlayer: true
      });
      if (!validation.valid) {
        this.publishPlacementValidation(validation);
        this.app.uiManager?.showToast(`⚠️ ${validation.primaryBlocker.message} ${validation.primaryBlocker.remedy}`);
        return false;
      }
      const isRoad = building.spec?.generatorType === 'ROAD_SEGMENT';
      const previousRotation = building.group.rotation.y;
      const previousPlot = { ...building.plot };
      const colliderShape = building.physicsBody?.shapes?.[0];
      const previousHalfExtents = colliderShape?.halfExtents
        ? {
            x: colliderShape.halfExtents.x,
            y: colliderShape.halfExtents.y,
            z: colliderShape.halfExtents.z
          }
        : null;
      const width = building.spec?.footprint?.width || building.plot.width;
      const depth = building.spec?.footprint?.depth || building.plot.depth;
      try {
        runWorldEditTransaction('rotate-structure', transaction => {
          if (isRoad) {
            this.addOptionalParticipantStep(transaction, {
              label: 'detach road before rotation',
              participant: this.app.trafficSystem,
              applyMethods: ['unregisterRoadSegment'],
              compensateMethods: ['registerRoadSegment'],
              applyArgs: [building, building.spec],
              compensateArgs: [building, building.spec]
            });
          }
          transaction.step('rotate world and physics footprint', () => {
            building.group.rotation.y = nextRotation;
            const nextQuarterTurns = Math.abs(Math.round(nextRotation / (Math.PI / 2))) % 2;
            building.plot.width = nextQuarterTurns === 0 ? width : depth;
            building.plot.depth = nextQuarterTurns === 0 ? depth : width;
            if (colliderShape?.halfExtents) {
              const height = building.spec?.height || 30;
              colliderShape.halfExtents.set(
                Math.max(1, building.plot.width - 2) * 0.5,
                height * 0.5,
                Math.max(1, building.plot.depth - 2) * 0.5
              );
              colliderShape.updateConvexPolyhedronRepresentation?.();
              building.physicsBody.updateBoundingRadius?.();
              building.physicsBody.quaternion.set(0, 0, 0, 1);
              building.physicsBody.aabbNeedsUpdate = true;
            }
            return true;
          }, () => {
            building.group.rotation.y = previousRotation;
            Object.assign(building.plot, previousPlot);
            if (previousHalfExtents && colliderShape?.halfExtents) {
              colliderShape.halfExtents.set(previousHalfExtents.x, previousHalfExtents.y, previousHalfExtents.z);
              colliderShape.updateConvexPolyhedronRepresentation?.();
              building.physicsBody.updateBoundingRadius?.();
              building.physicsBody.aabbNeedsUpdate = true;
            }
          });
          if (isRoad) {
            this.addOptionalParticipantStep(transaction, {
              label: 'attach rotated road',
              participant: this.app.trafficSystem,
              applyMethods: ['registerRoadSegment'],
              compensateMethods: ['unregisterRoadSegment'],
              applyArgs: [building, building.spec],
              compensateArgs: [building, building.spec]
            });
          }
        });
      } catch (error) {
        console.error('City editor rotation failed; restoring the previous orientation.', error);
        this.app.uiManager?.showToast('⚠️ Rotation failed; the structure was restored safely.');
        return false;
      }
      this.rotationY = building.group.rotation.y;
      this.selectionHelper?.update?.();
      this.app.uiManager?.showToast(`↻ Rotated ${building.name} 90°.`);
      this.app.saveService?.scheduleSave?.('world-edit');
      this.refreshCurrentPlacementValidation();
      return this.rotationY;
    }
    this.rotationY = (this.rotationY + Math.PI / 2) % (Math.PI * 2);
    if (this.ghostGroup) {
      this.ghostGroup.rotation.y = this.rotationY;
    }
    if (this.currentHit) {
      const validation = this.getPlacementValidation({
        spec: this.selectedSpec,
        rotationY: this.rotationY,
        x: this.currentHit.x,
        y: this.currentHit.y,
        z: this.currentHit.z,
        ignoreBuilding: this.toolMode === 'MOVE' ? this.selectedStructure : null
      });
      this.currentHit.validation = validation;
      this.currentHit.valid = validation.valid;
      this.publishPlacementValidation(validation);
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
      this.currentHit.validation = null;
      this.publishPlacementValidation(null);
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
    const validation = this.zoningMode
      ? null
      : this.getPlacementValidation({
        spec: this.selectedSpec,
        rotationY: this.rotationY,
        x: targetX,
        z: targetZ,
        y: terrainY,
        ignoreBuilding: this.toolMode === 'MOVE' ? this.selectedStructure : null
      });
    const valid = this.zoningMode
      ? this.checkZoningValidity(targetX, targetZ, terrainY)
      : validation.valid;
    this.currentHit = { x: targetX, y: terrainY, z: targetZ, valid, validation };
    this.publishPlacementValidation(validation);

    if (this.ghostGroup) {
      this.ghostGroup.position.set(targetX, terrainY, targetZ);
      this.ghostGroup.rotation.y = this.rotationY;
      this.updateGhostValidityAppearance(valid);
    }
    return valid;
  }

  checkPlacementValidity(x, z, y = 0, ignoreBuilding = null) {
    return this.getPlacementValidation({
      spec: this.selectedSpec,
      rotationY: this.rotationY,
      x,
      z,
      y,
      ignoreBuilding
    }).valid;
  }

  refreshCurrentPlacementValidation() {
    if (!this.currentHit || this.zoningMode || !this.selectedSpec) return null;
    const validation = this.getPlacementValidation({
      spec: this.selectedSpec,
      rotationY: this.rotationY,
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z,
      ignoreBuilding: this.toolMode === 'MOVE' ? this.selectedStructure : null
    });
    this.currentHit.validation = validation;
    this.currentHit.valid = validation.valid;
    this.updateGhostValidityAppearance(validation.valid);
    return this.publishPlacementValidation(validation);
  }

  getPlacementValidation({
    spec,
    rotationY = 0,
    x,
    z,
    y = 0,
    ignoreBuilding = null,
    allowCountrysideReplacement = false,
    ignorePlayer = false
  } = {}) {
    if (!spec || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return evaluatePlacement({ spec, position: { x, y, z } });
    }
    const zone = this.getZoneAt(x, z);
    const clearance = spec?.generatorType === 'ROAD_SEGMENT' ? 0 : 2;
    const placementRect = this.getPlacementRect(x, z, clearance, spec, rotationY);
    const footprintRect = this.getPlacementRect(x, z, 0, spec, rotationY);
    const inBounds = Boolean(spec) && (
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ) && !(
      placementRect.minX < WORLD_BOUNDS.minX ||
      placementRect.maxX > WORLD_BOUNDS.maxX ||
      placementRect.minZ < WORLD_BOUNDS.minZ ||
      placementRect.maxZ > WORLD_BOUNDS.maxZ
    );
    const protectedLandmark = CORE_LANDMARKS.find(landmark => rectsOverlap(placementRect, landmark)) || null;
    const authoredRoads = this.getAuthoredRoadRects();
    const roadOverlap = authoredRoads.some(road => rectsOverlap(placementRect, road));
    let collision = null;
    if (!allowCountrysideReplacement) {
      const cityBuilder = this.app.cityBuilder;
      const overlapsCountryside = typeof cityBuilder?.hasCountrysideOccupancyOverlap === 'function'
        ? cityBuilder.hasCountrysideOccupancyOverlap(placementRect)
        : (cityBuilder?.countrysideOccupancy || []).some(envelope => rectsOverlap(placementRect, envelope));
      if (overlapsCountryside) collision = {
        kind: 'SCENERY',
        name: 'protected countryside scenery',
        message: 'The footprint collides with protected countryside scenery.',
        remedy: 'Choose a cleared parcel; restored construction may replace scenery only through the save migration path.'
      };
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
      if (rectsOverlap(placementRect, buildingRect)) {
        collision = {
          kind: 'BUILDING',
          id: building.economyId || building.id || null,
          name: building.name || 'another structure'
        };
        break;
      }
    }

    const playerPosition = ignorePlayer ? null : this.getControlledPlayerPosition();
    const playerOccupied = Boolean(
      playerPosition &&
      playerPosition.x > placementRect.minX - 4 &&
      playerPosition.x < placementRect.maxX + 4 &&
      playerPosition.z > placementRect.minZ - 4 &&
      playerPosition.z < placementRect.maxZ + 4
    );
    const roadAccessRects = [
      ...authoredRoads,
      ...this.getConnectedPlacedRoadRects(ignoreBuilding)
    ];
    const hasRoadAccess = !isOrdinaryDevelopment(spec)
      || roadAccessRects.some(road => rectDistance(footprintRect, road) <= ROAD_ACCESS_DISTANCE);
    const economy = this.getEconomyController();
    let economySnapshot = {};
    try {
      economySnapshot = economy?.snapshot?.() || {};
    } catch (error) {
      console.warn('City editor economy preview failed; service-dependent placement will fail closed.', error);
    }
    const maxSlopeDegrees = Number.isFinite(Number(spec?.maxSlopeDegrees))
      ? Number(spec.maxSlopeDegrees)
      : spec?.generatorType === 'ROAD_SEGMENT' ? 12 : 8;
    const spendingDecision = economy?.evaluateSpending?.(this.getPlacementCost(spec), {
      source: 'building-placement',
      spec
    }) || null;

    return evaluatePlacement({
      spec,
      position: { x, y, z },
      access: spec ? this.getBuildingAccess(spec) : { unlocked: false },
      district: this.getDistrictAccess(x, z, spec),
      inBounds,
      protectedLandmark: protectedLandmark?.name || null,
      water: this.overlapsWater(footprintRect, y),
      slopeDegrees: this.getTerrainSlopeDegrees(footprintRect),
      maxSlopeDegrees,
      playerOccupied,
      roadOverlap,
      collision,
      zone: zone ? { ...zone, label: getZoneDefinition(zone.zoneType)?.label || zone.zoneType } : null,
      zoneCompatible: !zone || this.isSpecCompatibleWithZone(spec, zone.zoneType),
      requiresRoadAccess: isOrdinaryDevelopment(spec),
      hasRoadAccess,
      economySnapshot,
      availableCredits: this.getAvailableCredits(),
      spendingDecision
    });
  }

  isPlacementValid(options = {}) {
    return this.getPlacementValidation(options).valid;
  }

  getZoneAt(x, z) {
    for (const parcel of this.zoneParcels?.values?.() || []) {
      if (
        Math.abs(parcel.x - x) < ZONE_PARCEL_SIZE / 2
        && Math.abs(parcel.z - z) < ZONE_PARCEL_SIZE / 2
      ) return parcel;
    }
    return null;
  }

  isSpecCompatibleWithZone(spec, zoneType) {
    if (!spec || !zoneType || spec.category === 'INFRASTRUCTURE') return true;
    const normalizedZone = normalizeZoneId(zoneType);
    const allowed = {
      RESIDENTIAL: ['RESIDENTIAL'],
      COMMERCIAL: ['COMMERCIAL'],
      OPERATIONS: ['OPERATIONS'],
      FACILITIES: [
        'RESIDENTIAL', 'COMMERCIAL', 'OPERATIONS',
        'POWER_SERVICE', 'WATER_SERVICE', 'FIRE_SERVICE'
      ]
    };
    return (allowed[spec.category] || []).includes(normalizedZone);
  }

  getProgressionValues() {
    return this.app.progressionSystem?.snapshot?.()?.values
      || this.app.missionOutcomeService?.snapshot?.()?.progression
      || this.app.progression
      || {};
  }

  getBuildingAccess(spec = this.selectedSpec) {
    return getCatalogAccess(spec, this.getProgressionValues());
  }

  checkZoningValidity(x, z, y = 0) {
    if (!this.zoningMode || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const parcelX = Math.round(x / ZONE_PARCEL_SIZE) * ZONE_PARCEL_SIZE;
    const parcelZ = Math.round(z / ZONE_PARCEL_SIZE) * ZONE_PARCEL_SIZE;
    const halfSize = ZONE_PARCEL_SIZE / 2;
    if (
      parcelX - halfSize < WORLD_BOUNDS.minX
      || parcelX + halfSize > WORLD_BOUNDS.maxX
      || parcelZ - halfSize < WORLD_BOUNDS.minZ
      || parcelZ + halfSize > WORLD_BOUNDS.maxZ
    ) {
      return false;
    }
    const parcel = {
      minX: parcelX - halfSize,
      maxX: parcelX + halfSize,
      minZ: parcelZ - halfSize,
      maxZ: parcelZ + halfSize
    };
    if (CORE_LANDMARKS.some(landmark => rectsOverlap(parcel, landmark))) return false;
    if (this.overlapsWater(parcel, y)) return false;
    return this.isDistrictUnlocked(parcelX, parcelZ, { id: `ZONE_${this.zoningMode}`, category: this.zoningMode });
  }

  getAuthoredRoadRects() {
    const roads = [];
    const horizontalRange = { minX: -160, maxX: 810 };
    for (const roadZ of EXISTING_ROAD_Z) {
      roads.push({
        minX: horizontalRange.minX,
        maxX: horizontalRange.maxX,
        minZ: roadZ - ROAD_HALF_WIDTH_WITH_CLEARANCE,
        maxZ: roadZ + ROAD_HALF_WIDTH_WITH_CLEARANCE
      });
    }

    for (const roadX of EXISTING_ROAD_X) {
      roads.push({
        minX: roadX - ROAD_HALF_WIDTH_WITH_CLEARANCE,
        maxX: roadX + ROAD_HALF_WIDTH_WITH_CLEARANCE,
        minZ: -110,
        maxZ: 110
      });
    }
    roads.push(
      { minX: 691, maxX: 709, minZ: -290, maxZ: -91 },
      { minX: 691, maxX: 760, minZ: -253, maxZ: -237 }
    );
    return roads;
  }

  getConnectedPlacedRoadRects(ignoreBuilding = null) {
    const trafficRoads = this.app.trafficSystem?.placedRoadSegments;
    return (this.app.buildingFactory?.buildings || [])
      .filter(building => {
        if (!building || building === ignoreBuilding || building.isDestroyed || !building.plot) return false;
        if (building.spec?.generatorType !== 'ROAD_SEGMENT') return false;
        if (!trafficRoads?.get) return true;
        const id = String(building.trafficRoadId || building.economyId || building.id || '');
        return trafficRoads.get(id)?.connected === true;
      })
      .map(building => ({
        minX: building.plot.x - (building.plot.width || 30) / 2,
        maxX: building.plot.x + (building.plot.width || 30) / 2,
        minZ: building.plot.z - (building.plot.depth || 30) / 2,
        maxZ: building.plot.z + (building.plot.depth || 30) / 2
      }));
  }

  overlapsExistingRoad(rect) {
    return this.getAuthoredRoadRects().some(road => rectsOverlap(rect, road));
  }

  getTerrainSlopeDegrees(rect) {
    const getHeight = this.app.cityBuilder?.getHillHeight;
    if (typeof getHeight !== 'function') return 0;
    const width = Math.max(1, rect.maxX - rect.minX);
    const depth = Math.max(1, rect.maxZ - rect.minZ);
    const northWest = finiteTerrainHeight(getHeight.call(this.app.cityBuilder, rect.minX, rect.minZ));
    const northEast = finiteTerrainHeight(getHeight.call(this.app.cityBuilder, rect.maxX, rect.minZ));
    const southWest = finiteTerrainHeight(getHeight.call(this.app.cityBuilder, rect.minX, rect.maxZ));
    const southEast = finiteTerrainHeight(getHeight.call(this.app.cityBuilder, rect.maxX, rect.maxZ));
    const gradientX = (((northEast + southEast) - (northWest + southWest)) * 0.5) / width;
    const gradientZ = (((southWest + southEast) - (northWest + northEast)) * 0.5) / depth;
    return Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
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

  getDistrictAccess(x, z, spec = this.selectedSpec) {
    const context = { x, z, spec, editor: this };

    // The economy model exposes district state by stable ID rather than world
    // coordinate. Keep that mapping at this integration boundary.
    const economy = this.getEconomyController();
    if (x >= 185 && x <= 420 && typeof economy?.isDistrictUnlocked === 'function') {
      try {
        if (!economy.isDistrictUnlocked('EAST_CYBER_METROPOLIS')) return {
          allowed: false,
          id: 'EAST_CYBER_METROPOLIS',
          reason: 'East Cyber-Metropolis is locked.',
          remedy: 'Unlock East Cyber-Metropolis from City Tools or choose a West Core parcel.'
        };
      } catch (error) {
        console.warn('City editor economy district check failed; placement blocked for safety.', error);
        return {
          allowed: false,
          reason: 'District access could not be verified.',
          remedy: 'Choose a known unlocked parcel and retry.'
        };
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
        if (result.called && result.value === false) return {
          allowed: false,
          reason: 'The city plan restricts development on this parcel.',
          remedy: 'Choose an unlocked district or complete its prerequisite objective.'
        };
      } catch (error) {
        console.warn('City editor district check failed; placement blocked for safety.', error);
        return {
          allowed: false,
          reason: 'District access could not be verified.',
          remedy: 'Choose a known unlocked parcel and retry.'
        };
      }
    }
    return { allowed: true, id: null, reason: null, remedy: null };
  }

  isDistrictUnlocked(x, z, spec = this.selectedSpec) {
    return this.getDistrictAccess(x, z, spec).allowed;
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
      if (typeof controller.evaluateSpending === 'function') {
        return controller.evaluateSpending(cost, { ...context, source: 'building-placement' }).allowed;
      }
      const result = callOptional(controller, ['canAffordBuilding', 'canAfford'], [cost, spec, context]);
      if (result.called) return result.value !== false;
    }

    const availableCredits = this.getAvailableCredits();
    return availableCredits == null || availableCredits >= cost;
  }

  addEconomyAdjustmentStep(transaction, {
    direction,
    amount,
    spec,
    building = null,
    source
  }) {
    if (amount <= 0) return false;
    const controller = [this.getEconomyController(), this.app.gameManager]
      .find(candidate => candidate && (
        findOptionalMethod(candidate, direction === 'DEBIT'
          ? ['spendCredits', 'spend', 'debit']
          : ['refundCredits', 'refund', 'credit', 'earn'])
      ));
    if (!controller) return false;
    const debit = findOptionalMethod(controller, ['spendCredits', 'spend', 'debit']);
    const credit = findOptionalMethod(controller, ['refundCredits', 'refund', 'credit', 'earn']);
    if (!debit || !credit) throw new Error('Economy controller does not support reversible world edits');
    const context = {
      source,
      referenceId: building?.economyId || building?.id || spec?.id || null,
      reason: source,
      spec,
      building,
      editor: this
    };
    let adjusted = false;
    return direction === 'DEBIT'
      ? transaction.step('debit treasury', () => {
        const result = debit(amount, context);
        adjusted = result !== false;
        return result;
      }, () => {
        if (adjusted) credit(amount, { ...context, source: `${source}-rollback` });
      })
      : transaction.step('credit treasury', () => {
        const result = credit(amount, context);
        adjusted = result !== false;
        return result;
      }, () => {
        if (!adjusted) return;
        if (debit(amount, { ...context, source: `${source}-rollback` }) === false) {
          throw new Error('Treasury rejected refund rollback');
        }
      });
  }

  addOptionalParticipantStep(transaction, {
    label,
    participant,
    applyMethods,
    compensateMethods,
    applyArgs,
    compensateArgs
  }) {
    const apply = findOptionalMethod(participant, applyMethods);
    if (!apply) return false;
    const compensate = findOptionalMethod(participant, compensateMethods);
    if (!compensate) throw new Error(`${label} participant does not expose a rollback operation`);
    transaction.step(label, () => apply(...applyArgs), () => compensate(...compensateArgs));
    return true;
  }

  registerStructureInTransaction(transaction, building, spec, reason = 'building-placement') {
    const economy = this.getEconomyController();
    if (typeof economy?.registerBuilding === 'function') {
      const record = this.createEconomyBuildingRecord(building, spec);
      let registered = false;
      building.economyRecord = transaction.step(
        'register economy building',
        () => {
          const result = economy.registerBuilding(record);
          registered = true;
          return result;
        },
        () => {
          if (registered) economy.removeBuilding?.(record.id);
        }
      );
    }
    const context = { reason, building, spec, editor: this };
    this.addOptionalParticipantStep(transaction, {
      label: 'register game structure',
      participant: this.app.gameManager,
      applyMethods: ['registerPlacedStructure'],
      compensateMethods: ['removePlacedStructure'],
      applyArgs: [building, spec, context],
      compensateArgs: [building, spec, context]
    });
    this.addOptionalParticipantStep(transaction, {
      label: 'register city simulation structure',
      participant: this.app.citySimulation,
      applyMethods: ['registerPlacedStructure', 'registerBuilding'],
      compensateMethods: ['removePlacedStructure', 'unregisterBuilding'],
      applyArgs: [building, spec, context],
      compensateArgs: [building, spec, context]
    });
    if (spec.generatorType === 'ROAD_SEGMENT') {
      this.addOptionalParticipantStep(transaction, {
        label: 'register traffic road',
        participant: this.app.trafficSystem,
        applyMethods: ['registerRoadSegment'],
        compensateMethods: ['unregisterRoadSegment'],
        applyArgs: [building, spec, context],
        compensateArgs: [building, spec, context]
      });
    }
  }

  unregisterStructureInTransaction(transaction, building, spec, reason = 'building-demolition') {
    const context = { reason, building, spec, editor: this };
    if (spec?.generatorType === 'ROAD_SEGMENT') {
      this.addOptionalParticipantStep(transaction, {
        label: 'unregister traffic road',
        participant: this.app.trafficSystem,
        applyMethods: ['unregisterRoadSegment'],
        compensateMethods: ['registerRoadSegment'],
        applyArgs: [building, spec, context],
        compensateArgs: [building, spec, context]
      });
    }
    this.addOptionalParticipantStep(transaction, {
      label: 'unregister city simulation structure',
      participant: this.app.citySimulation,
      applyMethods: ['removePlacedStructure', 'unregisterBuilding'],
      compensateMethods: ['registerPlacedStructure', 'registerBuilding'],
      applyArgs: [building, spec, context],
      compensateArgs: [building, spec, context]
    });
    this.addOptionalParticipantStep(transaction, {
      label: 'unregister game structure',
      participant: this.app.gameManager,
      applyMethods: ['removePlacedStructure'],
      compensateMethods: ['registerPlacedStructure'],
      applyArgs: [building, spec, context],
      compensateArgs: [building, spec, context]
    });
    const economy = this.getEconomyController();
    const economyId = building.economyId || building.id;
    if (economyId && typeof economy?.removeBuilding === 'function') {
      let previousRecord = null;
      transaction.step(
        'unregister economy building',
        () => {
          previousRecord = economy.removeBuilding(economyId);
          return previousRecord || true;
        },
        () => {
          if (previousRecord && !economy.getBuilding?.(economyId)) {
            building.economyRecord = economy.registerBuilding(previousRecord);
          }
        }
      );
    }
  }

  detachBuilding(building, { dispose = false } = {}) {
    if (!building) return false;
    this.scene.remove(building.group);
    const buildings = this.app.buildingFactory?.buildings || [];
    const index = buildings.indexOf(building);
    if (index >= 0) buildings.splice(index, 1);
    if (building.baseBox) this.app.inspectorHud?.unregisterObject(building.baseBox);
    if (dispose) this.disposeBuildingResources(building);
    return true;
  }

  disposeBuildingResources(building) {
    const geometries = new Set();
    const materials = new Set();
    building?.group?.traverse?.(child => {
      if (child.geometry) geometries.add(child.geometry);
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of childMaterials) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
  }

  createEconomyBuildingRecord(building, spec) {
    const id = building.economyId || building.id || `USER_BUILDING_${this.nextUserBuildingId++}`;
    building.economyId = id;
    building.id = building.id || id;
    return createBuildingEconomyRecord(building, { spec, id });
  }

  reserveUserBuildingId(id) {
    const match = /^USER_BUILDING_(\d+)$/.exec(String(id || ''));
    if (!match) return this.nextUserBuildingId;
    this.nextUserBuildingId = Math.max(
      this.nextUserBuildingId,
      Number(match[1]) + 1
    );
    return this.nextUserBuildingId;
  }

  onPointerDown(event) {
    if (!this.isActive
      || !this.app?.inputManager?.mouseEventMatchesAction?.(event, 'PLACE', 'BUILDER')
      || !this.isPointerOnEditorCanvas(event.target)) return false;
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
    if (!building) {
      this.app.uiManager?.showToast('⚠️ Select a user-built structure first.');
      return false;
    }
    const validation = this.getPlacementValidation({
      spec: building.spec,
      rotationY: building.group.rotation?.y || 0,
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z,
      ignoreBuilding: building
    });
    if (!validation.valid) {
      this.currentHit.validation = validation;
      this.currentHit.valid = false;
      this.publishPlacementValidation(validation);
      this.app.uiManager?.showToast(`⚠️ ${validation.primaryBlocker.message} ${validation.primaryBlocker.remedy}`);
      return false;
    }

    const economy = this.getEconomyController();
    const previousPlot = { ...building.plot };
    const previousEconomyRecord = building.economyId && economy?.getBuilding
      ? economy.getBuilding(building.economyId)
      : building.economyRecord;
    try {
      runWorldEditTransaction('move-structure', transaction => {
        if (building.spec?.generatorType === 'ROAD_SEGMENT') {
          this.addOptionalParticipantStep(transaction, {
            label: 'detach old traffic road',
            participant: this.app.trafficSystem,
            applyMethods: ['unregisterRoadSegment'],
            compensateMethods: ['registerRoadSegment'],
            applyArgs: [building, building.spec],
            compensateArgs: [building, building.spec]
          });
        }
        if (building.economyId && economy?.removeBuilding) {
          transaction.step(
            'detach old economy record',
            () => economy.removeBuilding(building.economyId) || true,
            () => {
              if (previousEconomyRecord && !economy.getBuilding?.(building.economyId)) {
                building.economyRecord = economy.registerBuilding(previousEconomyRecord);
              }
            }
          );
        }
        transaction.step('move world and physics transforms', () => {
          building.group.position.set(this.currentHit.x, this.currentHit.y, this.currentHit.z);
          building.plot.x = this.currentHit.x;
          building.plot.y = this.currentHit.y;
          building.plot.z = this.currentHit.z;
          if (building.physicsBody?.position) {
            const height = building.spec?.height || building.height || 30;
            building.physicsBody.position.set(this.currentHit.x, this.currentHit.y + height * 0.5, this.currentHit.z);
            building.physicsBody.aabbNeedsUpdate = true;
          }
          return true;
        }, () => {
          building.group.position.set(previousPlot.x, previousPlot.y, previousPlot.z);
          Object.assign(building.plot, previousPlot);
          if (building.physicsBody?.position) {
            const height = building.spec?.height || building.height || 30;
            building.physicsBody.position.set(previousPlot.x, previousPlot.y + height * 0.5, previousPlot.z);
            building.physicsBody.aabbNeedsUpdate = true;
          }
        });
        if (economy?.registerBuilding) {
          transaction.step('attach moved economy record', () => {
            building.economyRecord = economy.registerBuilding(this.createEconomyBuildingRecord(building, building.spec));
            return building.economyRecord;
          }, () => economy.removeBuilding?.(building.economyId));
        }
        if (building.spec?.generatorType === 'ROAD_SEGMENT') {
          this.addOptionalParticipantStep(transaction, {
            label: 'attach moved traffic road',
            participant: this.app.trafficSystem,
            applyMethods: ['registerRoadSegment'],
            compensateMethods: ['unregisterRoadSegment'],
            applyArgs: [building, building.spec],
            compensateArgs: [building, building.spec]
          });
        }
      });
    } catch (error) {
      console.error('City editor move failed; restoring the previous structure state.', error);
      this.app.uiManager?.showToast('⚠️ Move failed; the structure was restored safely.');
      return false;
    }
    this.selectionHelper?.update?.();
    this.app.uiManager?.addAlert?.(`✥ Moved ${building.name} to ${Math.round(building.plot.x)}, ${Math.round(building.plot.z)}.`, 'success');
    this.app.saveService?.scheduleSave?.('world-edit');
    this.refreshCurrentPlacementValidation();
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
    const definition = getZoneDefinition(this.zoningMode);
    if (!definition) return false;

    const x = Math.round(this.currentHit.x / ZONE_PARCEL_SIZE) * ZONE_PARCEL_SIZE;
    const z = Math.round(this.currentHit.z / ZONE_PARCEL_SIZE) * ZONE_PARCEL_SIZE;
    const key = `${Math.round(x / ZONE_PARCEL_SIZE)},${Math.round(z / ZONE_PARCEL_SIZE)}`;
    const previous = this.zoneParcels.get(key);
    if (previous?.zoneType === definition.id) {
      this.app.uiManager?.showToast(`ℹ️ Parcel is already zoned ${definition.label}`);
      return true;
    }

    const economy = this.getEconomyController();
    const building = (this.app.buildingFactory?.buildings || []).find(candidate => {
      if (!candidate?.plot || candidate.isDestroyed) return false;
      return Math.abs(candidate.plot.x - x) <= (candidate.plot.width || 30) / 2
        && Math.abs(candidate.plot.z - z) <= (candidate.plot.depth || 30) / 2;
    });
    if (building?.spec && !this.isSpecCompatibleWithZone(building.spec, definition.id)) {
      this.app.uiManager?.showToast(`⚠️ ${building.name} is incompatible with ${definition.label} zoning`);
      return false;
    }
    const zoningContext = { source: 'zoning', referenceId: key };
    const zoningDecision = economy?.evaluateSpending?.(ZONING_COST, zoningContext) || null;
    if (zoningDecision && !zoningDecision.allowed) {
      this.app.uiManager?.showToast(`💳 ${zoningDecision.reason} ${zoningDecision.remedy || ''}`.trim());
      return false;
    }
    if (typeof economy?.spend === 'function' && !economy.spend(ZONING_COST, zoningContext)) {
      this.app.uiManager?.showToast(`💳 Rezoning requires $${ZONING_COST.toLocaleString()}`);
      return false;
    }
    if (previous) {
      previous.mesh?.removeFromParent();
      previous.mesh?.geometry?.dispose();
      previous.mesh?.material?.dispose();
    }

    const mesh = this.createZoneOverlayMesh(x, z, definition);
    this.zoneOverlayGroup.add(mesh);

    const parcel = {
      key,
      x,
      z,
      zoneType: definition.id,
      happinessModifier: definition.happiness,
      landValueModifier: definition.landValue,
      mesh
    };
    this.zoneParcels.set(key, parcel);
    if (typeof economy?.setZoneEffect === 'function') {
      economy.setZoneEffect({
        id: key,
        type: definition.id,
        x,
        z,
        happinessModifier: definition.happiness,
        landValueModifier: definition.landValue
      });
    } else {
      // Compatibility for alternate economy providers without explicit zones.
      if (previous) {
        economy?.adjustHappiness?.(-previous.happinessModifier);
        economy?.adjustLandValue?.(-previous.landValueModifier);
      }
      economy?.adjustHappiness?.(definition.happiness);
      economy?.adjustLandValue?.(definition.landValue);
    }
    if (building) {
      building.zone = definition.id;
      building.status = `Rezoned: ${definition.label}`;
      if (building.info) {
        building.info.Zone = definition.label;
        building.info.Status = building.status;
      }
    }

    this.app.uiManager?.addAlert(
      `🗺️ Parcel ${Math.round(x)}, ${Math.round(z)} rezoned ${definition.label} (-$${ZONING_COST.toLocaleString()}).`,
      'success'
    );
    this.app.saveService?.scheduleSave?.('world-edit');
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
      const definition = getZoneDefinition(record?.zoneType);
      if (!definition || !Number.isFinite(record.x) || !Number.isFinite(record.z)) continue;
      const key = typeof record.key === 'string'
        ? record.key
        : `${Math.round(record.x / ZONE_PARCEL_SIZE)},${Math.round(record.z / ZONE_PARCEL_SIZE)}`;
      if (this.zoneParcels.has(key)) continue;
      const mesh = this.createZoneOverlayMesh(record.x, record.z, definition);
      this.zoneOverlayGroup.add(mesh);
      this.zoneParcels.set(key, {
        key,
        x: record.x,
        z: record.z,
        zoneType: definition.id,
        happinessModifier: Number(record.happinessModifier ?? definition.happiness),
        landValueModifier: Number(record.landValueModifier ?? definition.landValue),
        mesh
      });
      const economy = this.getEconomyController();
      if (typeof economy?.setZoneEffect === 'function' && !economy.getZoneEffect?.(key)) {
        economy.setZoneEffect({
          id: key,
          type: definition.id,
          x: record.x,
          z: record.z,
          happinessModifier: Number(record.happinessModifier ?? definition.happiness),
          landValueModifier: Number(record.landValueModifier ?? definition.landValue)
        });
      }
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

      const refundRate = Number.isFinite(Number(building.spec?.refundRate))
        ? Math.max(0, Math.min(1, Number(building.spec.refundRate)))
        : ECONOMY_BALANCE.construction.defaultSalvageRate;
      const refundAmount = Math.round(this.getPlacementCost(building.spec) * refundRate);
      const originalIndex = index;
      const previousDestroyed = building.isDestroyed;
      try {
        runWorldEditTransaction('demolish-structure', transaction => {
          this.unregisterStructureInTransaction(transaction, building, building.spec);
          if (building.physicsBody && this.app.physicsWorld) {
            transaction.step(
              'remove physics collider',
              () => {
                this.app.physicsWorld.removeStaticCollider(building.physicsBody);
                return true;
              },
              () => this.app.physicsWorld.restoreStaticCollider(building.physicsBody)
            );
          }
          if (building.baseBox && this.app.inspectorHud) {
            transaction.step(
              'unregister inspector target',
              () => {
                this.app.inspectorHud.unregisterObject(building.baseBox);
                return true;
              },
              () => this.app.inspectorHud.registerObject(building.baseBox, building)
            );
          }
          transaction.step('remove rendered structure', () => {
            this.scene.remove(building.group);
            buildings.splice(originalIndex, 1);
            building.isDestroyed = true;
            return true;
          }, () => {
            building.isDestroyed = previousDestroyed;
            if (!buildings.includes(building)) buildings.splice(Math.min(originalIndex, buildings.length), 0, building);
            this.scene.add(building.group);
          });
          this.addEconomyAdjustmentStep(transaction, {
            direction: 'CREDIT',
            amount: refundAmount,
            spec: building.spec,
            building,
            source: 'building-salvage'
          });
        });
      } catch (error) {
        console.error('City editor demolition failed; restoring the structure.', error);
        this.app.uiManager?.showToast('⚠️ Demolition failed; the structure was restored safely.');
        return false;
      }
      this.disposeBuildingResources(building);

      this.app.uiManager?.showToast(
        `🗑️ Demolished: ${building.name}${refundAmount > 0 ? ` (+$${refundAmount.toLocaleString()} salvage)` : ''}`
      );
      this.clearStructureSelection();
      this.app.saveService?.scheduleSave?.('world-edit');
      return true;
    }
    return false;
  }

  placeSelectedBuilding() {
    if (!this.selectedSpec || !this.app.buildingFactory?.placeUserBuilding) {
      this.app.uiManager?.showToast('⚠️ Select an available construction blueprint first.');
      return false;
    }

    const validation = this.getPlacementValidation({
      spec: this.selectedSpec,
      rotationY: this.rotationY,
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z
    });
    this.currentHit.validation = validation;
    this.publishPlacementValidation(validation);
    if (!validation.valid) {
      this.currentHit.valid = false;
      this.updateGhostValidityAppearance(false);
      this.app.uiManager?.showToast(`⚠️ ${validation.primaryBlocker.message} ${validation.primaryBlocker.remedy}`);
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
      runWorldEditTransaction('place-structure', transaction => {
        this.addEconomyAdjustmentStep(transaction, {
          direction: 'DEBIT',
          amount: validation.preview.cost,
          spec: this.selectedSpec,
          source: 'building-placement'
        });
        building = transaction.step('create rendered structure', () => {
          const created = this.app.buildingFactory.placeUserBuilding(plot, this.selectedSpec, this.rotationY);
          if (!created) throw new Error('Building factory returned no structure');
          building = created;
          created.plot.width = footprint.width;
          created.plot.depth = footprint.depth;
          return created;
        }, created => this.detachBuilding(created || building, { dispose: true }));

        const generatorType = this.selectedSpec.generatorType;
        if (this.app.physicsWorld && generatorType !== 'ROAD_SEGMENT' && generatorType !== 'PARK_PLAZA') {
          const height = this.selectedSpec.height || 30;
          building.physicsBody = transaction.step(
            'create physics collider',
            () => this.app.physicsWorld.addStaticBoxCollider(
              new THREE.Vector3(plot.x, plot.y + height * 0.5, plot.z),
              new THREE.Vector3(Math.max(1, plot.width - 2), height, Math.max(1, plot.depth - 2))
            ),
            body => this.app.physicsWorld.removeStaticCollider(body || building?.physicsBody)
          );
        }
        this.registerStructureInTransaction(transaction, building, this.selectedSpec);
      });
    } catch (error) {
      console.error('City editor placement failed.', error);
      this.app.uiManager?.showToast('⚠️ Construction failed; the world edit was rolled back safely.');
      return false;
    }

    const cost = this.getPlacementCost(this.selectedSpec);
    const chargedEconomy = Boolean(this.getEconomyController());
    this.app.uiManager?.showToast(
      `🏗️ Constructed: ${this.selectedSpec.name}${chargedEconomy && cost > 0 ? ` (-$${cost.toLocaleString()})` : ''}`
    );
    this.app.uiManager?.addAlert?.(`🏗️ New structure registered: ${this.selectedSpec.name}`, 'success');
    this.app.saveService?.scheduleSave?.('world-edit');

    this.refreshCurrentPlacementValidation();
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
