import * as THREE from 'three';
import { getBuildingSpec } from './BuildingCatalog.js';

export class CityEditorSystem {
  constructor(app) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.camera = app.camera;
    this.isActive = false;
    this.isDeleteMode = false;
    this.gridSnap = true;
    this.snapSize = 10;
    this.rotationY = 0;

    this.selectedSpec = getBuildingSpec('NEOTECH_HQ');
    this.ghostMesh = null;
    this.currentHit = { x: 0, y: 0, z: 0, valid: true };

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(0, 0);

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.isDeleteMode = false;

    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKeyDown);

    this.updateGhostMesh();
    if (this.app.uiManager) {
      this.app.uiManager.showToast('🏗️ City Editor Active - Select buildings to expand the map');
    }
  }

  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDown);

    if (this.ghostGroup) {
      this.scene.remove(this.ghostGroup);
      this.ghostGroup = null;
    }
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    }
  }

  selectBuilding(specId) {
    this.selectedSpec = getBuildingSpec(specId);
    this.isDeleteMode = false;
    this.updateGhostMesh();
  }

  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    return this.gridSnap;
  }

  toggleDeleteMode() {
    this.isDeleteMode = !this.isDeleteMode;
    if (this.isDeleteMode && this.ghostGroup) {
      this.scene.remove(this.ghostGroup);
      this.ghostGroup = null;
    } else if (!this.isDeleteMode) {
      this.updateGhostMesh();
    }
    return this.isDeleteMode;
  }

  rotateSelection() {
    this.rotationY = (this.rotationY + Math.PI / 2) % (Math.PI * 2);
    if (this.ghostGroup) {
      this.ghostGroup.rotation.y = this.rotationY;
    }
  }

  updateGhostMesh() {
    if (!this.selectedSpec || !this.isActive || this.isDeleteMode) {
      if (this.ghostGroup) {
        this.scene.remove(this.ghostGroup);
        this.ghostGroup = null;
      }
      return;
    }

    if (this.ghostGroup) {
      this.scene.remove(this.ghostGroup);
    }

    this.ghostGroup = new THREE.Group();

    const w = this.selectedSpec.footprint.width;
    const d = this.selectedSpec.footprint.depth;
    const h = this.selectedSpec.height || 30;

    // 1. Full 3D Structure Preview
    if (this.app.buildingFactory && typeof this.app.buildingFactory.createStructurePreviewGroup === 'function') {
      this.structurePreview = this.app.buildingFactory.createStructurePreviewGroup(this.selectedSpec, 0x00ff88);
    } else {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.45 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = h / 2;
      this.structurePreview = new THREE.Group();
      this.structurePreview.add(mesh);
    }
    this.ghostGroup.add(this.structurePreview);

    // 2. Red / Green Shadow Footprint directly beneath the preview
    const footprintGeo = new THREE.PlaneGeometry(w + 3, d + 3);
    this.shadowFootprint = new THREE.Mesh(
      footprintGeo,
      new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide
      })
    );
    this.shadowFootprint.rotation.x = -Math.PI / 2;
    this.shadowFootprint.position.y = 0.25;
    this.ghostGroup.add(this.shadowFootprint);

    this.ghostGroup.rotation.y = this.rotationY;
    this.scene.add(this.ghostGroup);
  }

  onPointerMove(e) {
    if (!this.isActive) return;
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const planeNormal = new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane(planeNormal, 0);
    const intersectPoint = new THREE.Vector3();

    if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
      let targetX = intersectPoint.x;
      let targetZ = intersectPoint.z;

      if (this.gridSnap) {
        targetX = Math.round(targetX / this.snapSize) * this.snapSize;
        targetZ = Math.round(targetZ / this.snapSize) * this.snapSize;
      }

      let terrainY = 0;
      if (this.app.cityBuilder && typeof this.app.cityBuilder.getHillHeight === 'function') {
        terrainY = this.app.cityBuilder.getHillHeight(targetX, targetZ);
      }

      const valid = this.checkPlacementValidity(targetX, targetZ, terrainY);
      this.currentHit = { x: targetX, y: terrainY, z: targetZ, valid };

      if (this.ghostGroup) {
        this.ghostGroup.position.set(targetX, terrainY, targetZ);
        this.ghostGroup.rotation.y = this.rotationY;

        const statusColorHex = valid ? 0x00ff88 : 0xff2244;
        const statusColor = new THREE.Color(statusColorHex);

        if (this.shadowFootprint) {
          this.shadowFootprint.material.color.setHex(statusColorHex);
          this.shadowFootprint.material.opacity = valid ? 0.52 : 0.75;
        }

        if (this.structurePreview) {
          this.structurePreview.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
              child.material.emissive.copy(statusColor);
              child.material.emissiveIntensity = valid ? 0.35 : 0.65;
            }
          });
        }
      }
    }
  }

  checkPlacementValidity(x, z, y = 0) {
    if (!this.selectedSpec) return false;

    // 1. World Boundaries check so placement cannot fall off or break map
    if (x < -360 || x > 660 || z < -360 || z > 360) return false;
    if (y < -1.5) return false; // Prevent placing underwater

    const w = this.selectedSpec.footprint.width;
    const d = this.selectedSpec.footprint.depth;

    const minX = x - w / 2 - 2;
    const maxX = x + w / 2 + 2;
    const minZ = z - d / 2 - 2;
    const maxZ = z + d / 2 + 2;

    // 2. Protect Core Landmarks: Rocket Launchpad & Suspension Bridge
    if (maxX > 675 && minX < 735 && maxZ > -315 && minZ < -245) return false;
    if (maxX > -465 && minX < -285 && maxZ > -25 && minZ < 25) return false;

    // 3. Prevent overlapping existing buildings or structures
    const buildings = this.app.buildingFactory ? this.app.buildingFactory.buildings : [];
    for (const b of buildings) {
      if (!b || b.isDestroyed || !b.plot) continue;
      const bw = b.plot.width || 30;
      const bd = b.plot.depth || 30;
      const bMinX = b.plot.x - bw / 2;
      const bMaxX = b.plot.x + bw / 2;
      const bMinZ = b.plot.z - bd / 2;
      const bMaxZ = b.plot.z + bd / 2;

      if (maxX > bMinX && minX < bMaxX && maxZ > bMinZ && minZ < bMaxZ) {
        return false;
      }
    }

    // 4. Prevent placing directly on top of the player's vehicle
    if (this.app.playerVehicle && this.app.playerVehicle.chassisBody) {
      const px = this.app.playerVehicle.chassisBody.position.x;
      const pz = this.app.playerVehicle.chassisBody.position.z;
      if (px > minX - 4 && px < maxX + 4 && pz > minZ - 4 && pz < maxZ + 4) {
        return false;
      }
    }

    return true;
  }

  onPointerDown(e) {
    if (!this.isActive || e.button !== 0) return;
    if (e.target.closest('.city-editor-ui, .hud-container, .inspector-hud')) return;

    if (this.isDeleteMode) {
      this.performDeleteAtMouse();
    } else {
      this.placeSelectedBuilding();
    }
  }

  performDeleteAtMouse() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const buildings = this.app.buildingFactory ? this.app.buildingFactory.buildings : [];

    for (let i = buildings.length - 1; i >= 0; i--) {
      const b = buildings[i];
      if (!b || b.isDestroyed || !b.group) continue;

      const intersects = this.raycaster.intersectObjects(b.group.children, true);
      if (intersects.length > 0) {
        // Protect essential city infrastructure so player cannot break the map
        if (!b.isUserPlaced) {
          if (this.app.uiManager) {
            this.app.uiManager.showToast('🛡️ Protected City Structure: Core infrastructure cannot be demolished');
          }
          return;
        }

        this.scene.remove(b.group);
        b.isDestroyed = true;
        if (b.physicsBody && this.app.physicsWorld) {
          this.app.physicsWorld.world.removeBody(b.physicsBody);
        }
        if (this.app.inspectorHud && b.baseBox) {
          this.app.inspectorHud.unregisterObject(b.baseBox);
        }
        if (this.app.uiManager) {
          this.app.uiManager.showToast(`🗑️ Demolished structure: ${b.name}`);
        }
        break;
      }
    }
  }

  placeSelectedBuilding() {
    if (!this.selectedSpec || !this.currentHit.valid) {
      if (this.app.uiManager && !this.currentHit.valid) {
        this.app.uiManager.showToast('⚠️ Cannot place structure here: Overlaps existing building or road');
      }
      return;
    }

    const plot = {
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z,
      width: this.selectedSpec.footprint.width,
      depth: this.selectedSpec.footprint.depth
    };

    const buildingObj = this.app.buildingFactory.placeUserBuilding(plot, this.selectedSpec, this.rotationY);

    if (this.app.physicsWorld) {
      const h = this.selectedSpec.height || 30;
      const colliderBody = this.app.physicsWorld.addStaticBoxCollider(
        new THREE.Vector3(plot.x, plot.y + h * 0.5, plot.z),
        new THREE.Vector3(plot.width - 2, h, plot.depth - 2)
      );
      buildingObj.physicsBody = colliderBody;
    }

    if (this.app.uiManager) {
      this.app.uiManager.showToast(`🏗️ Constructed: ${this.selectedSpec.name}`);
    }
  }

  selectBuilding(specId) {
    this.selectedSpec = getBuildingSpec(specId);
    this.isDeleteMode = false;
    this.updateGhostMesh();
  }

  toggleGridSnap() {
    this.gridSnap = !this.gridSnap;
    return this.gridSnap;
  }

  toggleDeleteMode() {
    this.isDeleteMode = !this.isDeleteMode;
    if (this.isDeleteMode && this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      this.ghostMesh = null;
    } else if (!this.isDeleteMode) {
      this.updateGhostMesh();
    }
    return this.isDeleteMode;
  }

  rotateSelection() {
    this.rotationY = (this.rotationY + Math.PI / 2) % (Math.PI * 2);
    if (this.ghostMesh) {
      this.ghostMesh.rotation.y = this.rotationY;
    }
  }

  updateGhostMesh() {
    if (!this.selectedSpec || !this.isActive || this.isDeleteMode) return;

    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
    }

    const w = this.selectedSpec.footprint.width;
    const d = this.selectedSpec.footprint.depth;
    const h = this.selectedSpec.height || 30;

    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.45,
      wireframe: false
    });

    this.ghostMesh = new THREE.Mesh(geo, mat);
    this.ghostMesh.position.y = h / 2;
    this.ghostMesh.rotation.y = this.rotationY;
    this.scene.add(this.ghostMesh);
  }

  onPointerMove(e) {
    if (!this.isActive) return;
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Track intersection along horizontal ground plane or terrain
    const planeNormal = new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane(planeNormal, 0);
    const intersectPoint = new THREE.Vector3();

    if (this.raycaster.ray.intersectPlane(plane, intersectPoint)) {
      let targetX = intersectPoint.x;
      let targetZ = intersectPoint.z;

      if (this.gridSnap) {
        targetX = Math.round(targetX / this.snapSize) * this.snapSize;
        targetZ = Math.round(targetZ / this.snapSize) * this.snapSize;
      }

      let terrainY = 0;
      if (this.app.cityBuilder && typeof this.app.cityBuilder.getHillHeight === 'function') {
        terrainY = this.app.cityBuilder.getHillHeight(targetX, targetZ);
      }

      const valid = this.checkPlacementValidity(targetX, targetZ);
      this.currentHit = { x: targetX, y: terrainY, z: targetZ, valid };

      if (this.ghostMesh) {
        const h = this.selectedSpec.height || 30;
        this.ghostMesh.position.set(targetX, terrainY + h / 2, targetZ);
        this.ghostMesh.material.color.setHex(valid ? 0x00ff88 : 0xff3344);
      }
    }
  }

  checkPlacementValidity(x, z) {
    if (!this.selectedSpec) return false;
    const w = this.selectedSpec.footprint.width;
    const d = this.selectedSpec.footprint.depth;

    const minX = x - w / 2 - 2;
    const maxX = x + w / 2 + 2;
    const minZ = z - d / 2 - 2;
    const maxZ = z + d / 2 + 2;

    const buildings = this.app.buildingFactory ? this.app.buildingFactory.buildings : [];
    for (const b of buildings) {
      if (!b || b.isDestroyed || !b.plot) continue;
      const bw = b.plot.width || 30;
      const bd = b.plot.depth || 30;
      const bMinX = b.plot.x - bw / 2;
      const bMaxX = b.plot.x + bw / 2;
      const bMinZ = b.plot.z - bd / 2;
      const bMaxZ = b.plot.z + bd / 2;

      // Check overlap AABB
      if (maxX > bMinX && minX < bMaxX && maxZ > bMinZ && minZ < bMaxZ) {
        return false;
      }
    }
    return true;
  }

  onPointerDown(e) {
    if (!this.isActive || e.button !== 0) return;
    // Don't intercept clicks inside UI panels
    if (e.target.closest('.city-editor-ui, .hud-container, .inspector-hud')) return;

    if (this.isDeleteMode) {
      this.performDeleteAtMouse();
    } else {
      this.placeSelectedBuilding();
    }
  }

  performDeleteAtMouse() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const buildings = this.app.buildingFactory ? this.app.buildingFactory.buildings : [];

    for (let i = buildings.length - 1; i >= 0; i--) {
      const b = buildings[i];
      if (!b || !b.isUserPlaced || b.isDestroyed || !b.group) continue;

      const intersects = this.raycaster.intersectObjects(b.group.children, true);
      if (intersects.length > 0) {
        this.scene.remove(b.group);
        b.isDestroyed = true;
        if (b.physicsBody && this.app.physicsWorld) {
          this.app.physicsWorld.world.removeBody(b.physicsBody);
        }
        if (this.app.uiManager) {
          this.app.uiManager.showToast(`Removed user building: ${b.name}`);
        }
        break;
      }
    }
  }

  placeSelectedBuilding() {
    if (!this.selectedSpec || !this.currentHit.valid) {
      if (this.app.uiManager && !this.currentHit.valid) {
        this.app.uiManager.showToast('⚠️ Cannot place structure here: Overlaps existing building or road');
      }
      return;
    }

    const plot = {
      x: this.currentHit.x,
      y: this.currentHit.y,
      z: this.currentHit.z,
      width: this.selectedSpec.footprint.width,
      depth: this.selectedSpec.footprint.depth
    };

    const buildingObj = this.app.buildingFactory.placeUserBuilding(plot, this.selectedSpec, this.rotationY);

    // Create and register CANNON static box collider
    if (this.app.physicsWorld) {
      const h = this.selectedSpec.height || 30;
      const colliderBody = this.app.physicsWorld.addStaticBoxCollider(
        new THREE.Vector3(plot.x, plot.y + h * 0.5, plot.z),
        new THREE.Vector3(plot.width - 2, h, plot.depth - 2)
      );
      buildingObj.physicsBody = colliderBody;
    }

    if (this.app.uiManager) {
      this.app.uiManager.showToast(`🏗️ Constructed: ${this.selectedSpec.name}`);
    }
  }

  onKeyDown(e) {
    if (!this.isActive) return;
    if (e.key === 'r' || e.key === 'R') {
      this.rotateSelection();
    } else if (e.key === 'g' || e.key === 'G') {
      const snapped = this.toggleGridSnap();
      if (this.app.uiManager) {
        this.app.uiManager.showToast(`Grid Snapping: ${snapped ? 'ON (10m)' : 'OFF'}`);
      }
    } else if (e.key === 'Escape') {
      this.deactivate();
      if (this.app.uiManager && this.app.uiManager.cityEditorUI) {
        this.app.uiManager.cityEditorUI.hide();
      }
    }
  }
}
