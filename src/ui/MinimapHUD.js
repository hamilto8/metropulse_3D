export class MinimapHUD {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('minimap-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.radius = 65; // Canvas size 140x140
    this.zoom = 0.55; // World units to pixels
    this.lastUpdate = 0;
  }

  update(now) {
    if (!this.ctx || !this.canvas) {
      this.canvas = document.getElementById('minimap-canvas');
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
      return;
    }
    // Update at ~30 FPS
    if (now - this.lastUpdate < 0.033) return;
    this.lastUpdate = now;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    // 1. Background circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = 'rgba(13, 18, 36, 0.9)';
    ctx.fillRect(0, 0, w, h);

    // Center world position (camera target)
    let centerPos = { x: 0, z: 0 };
    if (this.app && this.app.sceneManager && this.app.sceneManager.controls) {
      centerPos.x = this.app.sceneManager.controls.target.x;
      centerPos.z = this.app.sceneManager.controls.target.z;
    }

    // 2. Draw radar grid lines & concentric rings
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius * 0.45, 0, Math.PI * 2);
    ctx.arc(cx, cy, this.radius * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - this.radius, cy);
    ctx.lineTo(cx + this.radius, cy);
    ctx.moveTo(cx, cy - this.radius);
    ctx.lineTo(cx, cy + this.radius);
    ctx.stroke();

    // 3. Draw Road lines around center
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
    ctx.lineWidth = 3;
    const gridStep = 40;
    const minX = Math.floor((centerPos.x - 150) / gridStep) * gridStep;
    const maxX = Math.ceil((centerPos.x + 150) / gridStep) * gridStep;
    const minZ = Math.floor((centerPos.z - 150) / gridStep) * gridStep;
    const maxZ = Math.ceil((centerPos.z + 150) / gridStep) * gridStep;

    ctx.beginPath();
    for (let x = minX; x <= maxX; x += gridStep) {
      const px = cx + (x - centerPos.x) * this.zoom;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let z = minZ; z <= maxZ; z += gridStep) {
      const py = cy + (z - centerPos.z) * this.zoom;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();

    // 4. Draw Pedestrians (blue blips)
    if (this.app.pedestrianSystem && this.app.pedestrianSystem.pedestrians) {
      ctx.fillStyle = '#00f0ff';
      for (const p of this.app.pedestrianSystem.pedestrians) {
        if (!p.mesh) continue;
        const px = cx + (p.mesh.position.x - centerPos.x) * this.zoom;
        const py = cy + (p.mesh.position.z - centerPos.z) * this.zoom;
        const dist = Math.hypot(px - cx, py - cy);
        if (dist > this.radius - 4) continue;

        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Draw Vehicles (red blips)
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      ctx.fillStyle = '#ff2255';
      for (const v of this.app.trafficSystem.vehicles) {
        if (!v.mesh) continue;
        const px = cx + (v.mesh.position.x - centerPos.x) * this.zoom;
        const py = cy + (v.mesh.position.z - centerPos.z) * this.zoom;
        const dist = Math.hypot(px - cx, py - cy);
        if (dist > this.radius - 4) continue;

        ctx.beginPath();
        ctx.arc(px, py, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. Center Reticle (active camera target)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // 7. Outer radar ring glow
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}
