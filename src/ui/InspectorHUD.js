import * as THREE from 'three';

export class InspectorHUD {
  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.interactiveObjects = [];
    
    this.initClickEvent();
  }

  registerObject(mesh, entityData) {
    if (!mesh) return;
    mesh.userData.entityData = entityData;
    this.interactiveObjects.push(mesh);
  }

  unregisterObject(mesh) {
    const idx = this.interactiveObjects.indexOf(mesh);
    if (idx !== -1) {
      this.interactiveObjects.splice(idx, 1);
    }
  }

  initClickEvent() {
    window.addEventListener('click', (event) => {
      // Don't raycast if clicking UI elements
      if (event.target.closest('header, aside, footer, button, input')) {
        return;
      }

      const rect = this.app.sceneManager.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.app.sceneManager.camera);
      
      const intersects = this.raycaster.intersectObjects(this.interactiveObjects, true);
      
      if (intersects.length > 0) {
        // Find top-most object with entityData
        let hitObject = null;
        for (const hit of intersects) {
          let curr = hit.object;
          while (curr && !curr.userData.entityData) {
            curr = curr.parent;
          }
          if (curr && curr.userData.entityData) {
            hitObject = curr.userData.entityData;
            break;
          }
        }

        if (hitObject) {
          this.app.uiManager.showInspector(hitObject);
          // Play a subtle UI click or select sound if enabled
          if (this.app.audioSystem) {
            this.app.audioSystem.playUIClick();
          }
        }
      }
    });
  }
}
