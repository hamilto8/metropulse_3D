import * as THREE from 'three';

const UPDATE_INTERVAL_SECONDS = 0.6;

/**
 * Lightweight world-space congestion overlay. It bins the existing kinematic
 * traffic simulation instead of adding another simulation or per-frame pass.
 */
export class TrafficHeatmapSystem {
  constructor(app, { cellSize = 40 } = {}) {
    this.app = app;
    this.cellSize = cellSize;
    this.visible = false;
    this.timer = 0;
    this.cells = new Map();
    this.hotspots = [];

    this.group = new THREE.Group();
    this.group.name = 'TrafficCongestionHeatmap';
    this.group.visible = false;
    this.group.renderOrder = 5;
    this.geometry = new THREE.CircleGeometry(cellSize * 0.48, 24);
    this.geometry.rotateX(-Math.PI / 2);
    app.sceneManager.scene.add(this.group);
  }

  setVisible(enabled) {
    this.visible = Boolean(enabled);
    this.group.visible = this.visible;
    this.timer = UPDATE_INTERVAL_SECONDS;
    if (this.visible) this.rebuild();
    return this.visible;
  }

  toggle() {
    return this.setVisible(!this.visible);
  }

  update(delta) {
    if (!this.visible) return;
    this.timer += delta;
    if (this.timer < UPDATE_INTERVAL_SECONDS) return;
    this.timer = 0;
    this.rebuild();
  }

  rebuild() {
    const bins = new Map();
    const vehicles = this.app.trafficSystem?.vehicles || [];

    for (const vehicle of vehicles) {
      if (!vehicle?.mesh || vehicle.isParked) continue;
      const xIndex = Math.round(vehicle.mesh.position.x / this.cellSize);
      const zIndex = Math.round(vehicle.mesh.position.z / this.cellSize);
      const key = `${xIndex},${zIndex}`;
      const bin = bins.get(key) || { key, xIndex, zIndex, vehicles: 0, weight: 0, crashed: 0 };
      const speed = Math.abs(vehicle.speed || 0);
      const stoppedWeight = speed < 0.8 ? 1.25 : speed < 4 ? 0.75 : 0.25;
      const crashWeight = vehicle.crashed || vehicle.onFire ? 2.75 : 0;
      bin.vehicles += 1;
      bin.crashed += crashWeight > 0 ? 1 : 0;
      bin.weight += stoppedWeight + crashWeight;
      bins.set(key, bin);
    }

    const seen = new Set();
    this.hotspots = [];
    for (const bin of bins.values()) {
      if (bin.weight < 0.5) continue;
      seen.add(bin.key);
      const intensity = Math.max(0.08, Math.min(1, bin.weight / 6));
      const x = bin.xIndex * this.cellSize;
      const z = bin.zIndex * this.cellSize;
      const y = this.app.pedestrianSystem?.getTerrainHeight?.(x, z) ?? 0;
      let mesh = this.cells.get(bin.key);

      if (!mesh) {
        mesh = new THREE.Mesh(
          this.geometry,
          new THREE.MeshBasicMaterial({
            color: 0x22c55e,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
          })
        );
        mesh.renderOrder = 5;
        this.cells.set(bin.key, mesh);
        this.group.add(mesh);
      }

      mesh.position.set(x, y + 0.18, z);
      mesh.scale.setScalar(0.7 + intensity * 0.65);
      mesh.material.color.setHSL((1 - intensity) * 0.34, 0.95, 0.5);
      mesh.material.opacity = 0.1 + intensity * 0.42;
      mesh.visible = true;
      this.hotspots.push({ x, z, intensity, vehicles: bin.vehicles, crashed: bin.crashed });
    }

    for (const [key, mesh] of this.cells) {
      if (seen.has(key)) continue;
      this.group.remove(mesh);
      mesh.material.dispose();
      this.cells.delete(key);
    }

    this.hotspots.sort((a, b) => b.intensity - a.intensity);
  }

  dispose() {
    for (const mesh of this.cells.values()) mesh.material.dispose();
    this.cells.clear();
    this.geometry.dispose();
    this.group.removeFromParent();
  }
}
