import * as THREE from 'three';
import { BRIDGE_POLICIES, TRAFFIC_ACCESS } from '../systems/TrafficProductivityModel.js';

const PRIORITY_POSITIONS = Object.freeze([112, 134, 156, 178, 200]);

/**
 * Thin Three.js adapter for the authoritative mobility snapshot. It owns only
 * derived street markings; policy, congestion, outages, and road connectivity
 * remain plain domain data in TrafficProductivityModel.
 */
export class MobilityStreetFeedbackSystem {
  constructor({ scene, model, roadProvider, groundHeight = () => 0 } = {}) {
    if (!scene?.add) throw new TypeError('scene is required');
    if (!model?.snapshot || !model?.subscribe) throw new TypeError('model must expose snapshot() and subscribe()');
    this.scene = scene;
    this.model = model;
    this.roadProvider = roadProvider;
    this.groundHeight = groundHeight;
    this.group = new THREE.Group();
    this.group.name = 'MobilityStreetFeedback';
    this.scene.add(this.group);
    this.elapsed = 0;

    this.priorityMaterial = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });
    this.warningMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.85
    });
    this.closedMaterial = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1
    });
    this.connectedRoadMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.75
    });
    this.disconnectedRoadMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.9
    });
    this.priorityGeometry = new THREE.ConeGeometry(1.1, 3.2, 3);
    this.warningGeometry = new THREE.CylinderGeometry(0.45, 0.8, 2.4, 10);
    this.roadGeometry = new THREE.TorusGeometry(2.2, 0.22, 8, 24);
    this.priorityMarkers = [];
    this.disruptionMarkers = [];
    this.roadMarkers = new Map();
    this.#createBridgeMarkers();
    this.unsubscribe = this.model.subscribe(event => this.render(event.current), { emitCurrent: true });
  }

  #createBridgeMarkers() {
    for (const x of PRIORITY_POSITIONS) {
      for (const z of [-5.2, 5.2]) {
        const marker = new THREE.Mesh(this.priorityGeometry, this.priorityMaterial);
        marker.name = 'FreightPriorityChevron';
        marker.rotation.set(Math.PI / 2, 0, z < 0 ? -Math.PI / 2 : Math.PI / 2);
        marker.position.set(x, 0.14, z);
        marker.renderOrder = 6;
        this.group.add(marker);
        this.priorityMarkers.push(marker);
      }
    }
    for (const x of [103, 207]) {
      for (const z of [-7, 7]) {
        const marker = new THREE.Mesh(this.warningGeometry, this.warningMaterial);
        marker.name = 'BridgeDisruptionBeacon';
        marker.position.set(x, 1.2, z);
        this.group.add(marker);
        this.disruptionMarkers.push(marker);
      }
    }
  }

  render(snapshot = this.model.snapshot()) {
    if (!snapshot) return false;
    const priorityVisible = snapshot.policy.id === BRIDGE_POLICIES.FREIGHT_PRIORITY
      && snapshot.bridge.access !== TRAFFIC_ACCESS.CLOSED;
    for (const marker of this.priorityMarkers) marker.visible = priorityVisible;

    const disruptionVisible = snapshot.bridge.outageActive
      || snapshot.bridge.access !== TRAFFIC_ACCESS.OPEN;
    const disruptionMaterial = snapshot.bridge.access === TRAFFIC_ACCESS.CLOSED
      ? this.closedMaterial
      : this.warningMaterial;
    for (const marker of this.disruptionMarkers) {
      marker.visible = disruptionVisible;
      marker.material = disruptionMaterial;
    }

    const network = this.roadProvider?.getRoadNetworkSnapshot?.() || { segments: [] };
    const seen = new Set();
    for (const segment of network.segments || []) {
      if (!segment.position) continue;
      seen.add(segment.id);
      let marker = this.roadMarkers.get(segment.id);
      if (!marker) {
        marker = new THREE.Mesh(this.roadGeometry, this.connectedRoadMaterial);
        marker.name = `RoadConnectivity:${segment.id}`;
        marker.rotation.x = Math.PI / 2;
        this.group.add(marker);
        this.roadMarkers.set(segment.id, marker);
      }
      marker.material = segment.connected ? this.connectedRoadMaterial : this.disconnectedRoadMaterial;
      marker.position.set(
        segment.position.x,
        this.groundHeight(segment.position.x, segment.position.z) + 0.22,
        segment.position.z
      );
    }
    for (const [id, marker] of this.roadMarkers) {
      if (seen.has(id)) continue;
      marker.removeFromParent();
      this.roadMarkers.delete(id);
    }
    this.group.userData.streetStatus = snapshot.bridge.streetStatus;
    return true;
  }

  update(deltaSeconds, elapsed = null) {
    this.elapsed = Number.isFinite(elapsed) ? elapsed : this.elapsed + deltaSeconds;
    const pulse = 0.72 + Math.sin(this.elapsed * 4) * 0.22;
    this.warningMaterial.emissiveIntensity = pulse;
    this.closedMaterial.emissiveIntensity = pulse + 0.25;
  }

  dispose() {
    this.unsubscribe?.();
    this.group.removeFromParent();
    this.priorityGeometry.dispose();
    this.warningGeometry.dispose();
    this.roadGeometry.dispose();
    this.priorityMaterial.dispose();
    this.warningMaterial.dispose();
    this.closedMaterial.dispose();
    this.connectedRoadMaterial.dispose();
    this.disconnectedRoadMaterial.dispose();
    this.roadMarkers.clear();
  }
}

export default MobilityStreetFeedbackSystem;
