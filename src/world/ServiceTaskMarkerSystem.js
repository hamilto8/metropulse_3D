import * as THREE from 'three';

const COLORS = Object.freeze({ CLEANUP: 0xffb020, REPAIR: 0x22d3ee });

/** Three.js-only projection of scheduled service work. Domain state stays in the outcome ledger. */
export class ServiceTaskMarkerSystem {
  constructor({ scene, incidentResponseService, groundHeight = () => 0 } = {}) {
    if (!scene?.add || !scene?.remove) throw new TypeError('ServiceTaskMarkerSystem requires a Three.js scene');
    if (!incidentResponseService?.getWorkOrders || !incidentResponseService?.outcomes?.subscribe) {
      throw new TypeError('ServiceTaskMarkerSystem requires IncidentResponseService');
    }
    if (typeof groundHeight !== 'function') throw new TypeError('groundHeight must be a function');
    this.scene = scene;
    this.response = incidentResponseService;
    this.groundHeight = groundHeight;
    this.markers = new Map();
    this.ringGeometry = new THREE.TorusGeometry(4, 0.28, 8, 32);
    this.beaconGeometry = new THREE.CylinderGeometry(0.12, 0.12, 8, 8);
    this.unsubscribe = this.response.outcomes.subscribe(() => this.refresh());
    this.refresh();
  }

  refresh() {
    const desired = new Map(this.response.getWorkOrders()
      .filter(order => order.actionable)
      .map(order => [order.id, order]));
    for (const [id, marker] of this.markers) {
      if (desired.has(id)) continue;
      this.scene.remove(marker.group);
      marker.material.dispose();
      this.markers.delete(id);
    }
    for (const [id, order] of desired) {
      const existing = this.markers.get(id);
      if (existing) {
        existing.order = order;
        continue;
      }
      const color = COLORS[order.workType] || COLORS.REPAIR;
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, depthWrite: false });
      const ring = new THREE.Mesh(this.ringGeometry, material);
      ring.rotation.x = Math.PI / 2;
      const beacon = new THREE.Mesh(this.beaconGeometry, material);
      beacon.position.y = 4;
      const group = new THREE.Group();
      group.name = `service-task-marker:${id}`;
      group.userData = { kind: 'SERVICE_TASK_MARKER', workOrderId: id };
      group.add(ring, beacon);
      const y = Number(this.groundHeight(order.position.x, order.position.z)) || 0;
      group.position.set(order.position.x, y + 0.35, order.position.z);
      this.scene.add(group);
      this.markers.set(id, { group, material, order });
    }
    return this.markers.size;
  }

  update(_delta, elapsed = 0) {
    for (const marker of this.markers.values()) {
      const pulse = 1 + Math.sin(elapsed * 3) * 0.08;
      marker.group.scale.setScalar(pulse);
      marker.group.rotation.y = elapsed * 0.6;
      marker.material.opacity = 0.68 + Math.sin(elapsed * 4) * 0.12;
    }
  }

  destroy() {
    this.unsubscribe?.();
    for (const marker of this.markers.values()) {
      this.scene.remove(marker.group);
      marker.material.dispose();
    }
    this.markers.clear();
    this.ringGeometry.dispose();
    this.beaconGeometry.dispose();
  }
}

export default ServiceTaskMarkerSystem;
