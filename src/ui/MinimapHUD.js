import * as THREE from 'three';

export class MinimapHUD {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('minimap-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.radius = 65;
    this.zoom = 0.55;
    this.lastUpdate = 0;
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.orthoCamera.up.set(0, 0, -1);
    this._projectedPosition = new THREE.Vector3();
  }

  getPosition(entity) {
    return entity?.mesh?.position || entity?.position || null;
  }

  getFocusTarget() {
    const controlledVehicle = this.app?.trafficSystem?.controlledVehicle;
    if (controlledVehicle?.mesh?.position) return { entity: controlledVehicle, position: controlledVehicle.mesh.position };

    const controlledPedestrian = this.app?.pedestrianSystem?.controlledPedestrian;
    if (controlledPedestrian?.mesh?.position) {
      return { entity: controlledPedestrian, position: controlledPedestrian.mesh.position };
    }

    const followedTarget = this.app?.sceneManager?.followTarget;
    if (followedTarget?.mesh?.position) return { entity: followedTarget, position: followedTarget.mesh.position };

    const cameraTarget = this.app?.sceneManager?.controls?.target;
    return {
      entity: null,
      position: cameraTarget || { x: 0, z: 0 }
    };
  }

  worldToCanvas(position, centerPosition, cx, cy) {
    if (this.orthoCamera && this.canvas) {
      this._projectedPosition
        .set(position.x, position.y || 0, position.z)
        .project(this.orthoCamera);
      return {
        x: (this._projectedPosition.x * 0.5 + 0.5) * this.canvas.width,
        y: (-this._projectedPosition.y * 0.5 + 0.5) * this.canvas.height
      };
    }
    return {
      x: cx + (position.x - centerPosition.x) * this.zoom,
      y: cy + (position.z - centerPosition.z) * this.zoom
    };
  }

  updateOrthoCamera(centerPosition, width, height) {
    const halfExtent = this.radius / this.zoom;
    const aspect = width / Math.max(1, height);
    this.orthoCamera.left = -halfExtent * aspect;
    this.orthoCamera.right = halfExtent * aspect;
    this.orthoCamera.top = halfExtent;
    this.orthoCamera.bottom = -halfExtent;
    this.orthoCamera.position.set(centerPosition.x, 500, centerPosition.z);
    this.orthoCamera.lookAt(centerPosition.x, 0, centerPosition.z);
    this.orthoCamera.updateProjectionMatrix();
    this.orthoCamera.updateMatrixWorld(true);
  }

  isInsideRadar(point, cx, cy, padding = 4) {
    return Math.hypot(point.x - cx, point.y - cy) <= this.radius - padding;
  }

  drawWorldLine(ctx, from, to, centerPosition, cx, cy) {
    const start = this.worldToCanvas(from, centerPosition, cx, cy);
    const end = this.worldToCanvas(to, centerPosition, cx, cy);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  }

  drawBaseMap(ctx, centerPosition, cx, cy, width, height) {
    ctx.fillStyle = 'rgba(13, 18, 36, 0.92)';
    ctx.fillRect(0, 0, width, height);

    // The two river channels are stable world landmarks and make the radar
    // materially easier to orient than an arbitrary square grid.
    ctx.fillStyle = 'rgba(0, 112, 190, 0.22)';
    for (const river of [
      { minX: 135, maxX: 185 },
      { minX: 380, maxX: 420 }
    ]) {
      const topLeft = this.worldToCanvas({ x: river.minX, z: centerPosition.z - 200 }, centerPosition, cx, cy);
      const bottomRight = this.worldToCanvas({ x: river.maxX, z: centerPosition.z + 200 }, centerPosition, cx, cy);
      ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    }

    ctx.strokeStyle = 'rgba(100, 116, 139, 0.42)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const intersections = this.app?.cityBuilder?.roadNetwork?.intersections || [];
    if (intersections.length > 0) {
      const roadXs = [...new Set(intersections.map(point => point.x))];
      const roadZs = [...new Set(intersections.map(point => point.z))];
      for (const roadZ of roadZs) {
        this.drawWorldLine(
          ctx,
          { x: -150, z: roadZ },
          { x: 800, z: roadZ },
          centerPosition,
          cx,
          cy
        );
      }
      for (const roadX of roadXs) {
        this.drawWorldLine(
          ctx,
          { x: roadX, z: -110 },
          { x: roadX, z: 110 },
          centerPosition,
          cx,
          cy
        );
      }
    } else {
      // Stable fallback for startup/testing before CityBuilder is available.
      const gridStep = 50;
      const minX = Math.floor((centerPosition.x - 150) / gridStep) * gridStep;
      const maxX = Math.ceil((centerPosition.x + 150) / gridStep) * gridStep;
      const minZ = Math.floor((centerPosition.z - 150) / gridStep) * gridStep;
      const maxZ = Math.ceil((centerPosition.z + 150) / gridStep) * gridStep;
      for (let x = minX; x <= maxX; x += gridStep) {
        this.drawWorldLine(ctx, { x, z: minZ }, { x, z: maxZ }, centerPosition, cx, cy);
      }
      for (let z = minZ; z <= maxZ; z += gridStep) {
        this.drawWorldLine(ctx, { x: minX, z }, { x: maxX, z }, centerPosition, cx, cy);
      }
    }
    ctx.stroke();

    // Radar range rings and axes.
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius * 0.45, 0, Math.PI * 2);
    ctx.arc(cx, cy, this.radius * 0.85, 0, Math.PI * 2);
    ctx.moveTo(cx - this.radius, cy);
    ctx.lineTo(cx + this.radius, cy);
    ctx.moveTo(cx, cy - this.radius);
    ctx.lineTo(cx, cy + this.radius);
    ctx.stroke();
  }

  drawTrafficHeatmap(ctx, centerPosition, cx, cy) {
    const heatmapToggle = document.getElementById('toggle-heatmap');
    if (!heatmapToggle?.checked) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const vehicle of this.app?.trafficSystem?.vehicles || []) {
      if (vehicle?.isParked) continue;
      const position = vehicle?.mesh?.position;
      if (!position) continue;
      const point = this.worldToCanvas(position, centerPosition, cx, cy);
      if (!this.isInsideRadar(point, cx, cy, -12)) continue;

      const maxSpeed = Math.max(1, Math.abs(vehicle.maxSpeed || 1));
      const movingRatio = Math.min(1, Math.abs(vehicle.speed || 0) / maxSpeed);
      const congestion = vehicle.crashed ? 1 : 1 - movingRatio;
      const radius = 7 + congestion * 9;
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
      const coreColor = congestion > 0.68 ? 'rgba(255, 34, 68, 0.7)' : 'rgba(255, 184, 0, 0.55)';
      gradient.addColorStop(0, coreColor);
      gradient.addColorStop(1, 'rgba(255, 34, 68, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMissionMarkers(ctx, centerPosition, cx, cy) {
    const missionSystem = this.app?.missionSystem;
    if (!missionSystem) return;

    for (const pickup of missionSystem.pickupRings || []) {
      if (!pickup?.group?.visible) continue;
      const point = this.worldToCanvas(pickup.group.position, centerPosition, cx, cy);
      if (!this.isInsideRadar(point, cx, cy, 6)) continue;

      ctx.fillStyle = '#00f0ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#071225';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', point.x, point.y + 0.5);
    }

    const activeMission = missionSystem.activeMission;
    const objective = activeMission?.missionType || activeMission?.objectiveType;
    const dropoff = missionSystem.getNavigationTarget?.() || activeMission?.dropoff;
    if (dropoff && objective !== 'SURVIVAL') {
      this.drawWaypointMarker(ctx, dropoff, centerPosition, cx, cy);
    }
  }

  drawWaypointMarker(ctx, waypoint, centerPosition, cx, cy) {
    const rawPoint = this.worldToCanvas(waypoint, centerPosition, cx, cy);
    const offsetX = rawPoint.x - cx;
    const offsetY = rawPoint.y - cy;
    const distance = Math.hypot(offsetX, offsetY);
    const maxDistance = this.radius - 10;
    const scale = distance > maxDistance ? maxDistance / Math.max(distance, 0.001) : 1;
    const point = { x: cx + offsetX * scale, y: cy + offsetY * scale };

    ctx.strokeStyle = 'rgba(68, 255, 136, 0.48)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#44ff88';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-4.5, -4.5, 9, 9);
    ctx.strokeRect(-4.5, -4.5, 9, 9);
    ctx.restore();
  }

  drawAgents(ctx, centerPosition, cx, cy, focusEntity) {
    ctx.fillStyle = '#00f0ff';
    for (const pedestrian of this.app?.pedestrianSystem?.pedestrians || []) {
      if (pedestrian === focusEntity || !pedestrian?.mesh?.position) continue;
      const point = this.worldToCanvas(pedestrian.mesh.position, centerPosition, cx, cy);
      if (!this.isInsideRadar(point, cx, cy)) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ff5577';
    for (const vehicle of this.app?.trafficSystem?.vehicles || []) {
      if (vehicle === focusEntity || !vehicle?.mesh?.position) continue;
      const point = this.worldToCanvas(vehicle.mesh.position, centerPosition, cx, cy);
      if (!this.isInsideRadar(point, cx, cy)) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPlayerMarker(ctx, entity, cx, cy) {
    if (!entity) return;
    const heading = entity.mesh?.rotation?.y || 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(5, -6);
    ctx.lineTo(0, -3.5);
    ctx.lineTo(-5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  update(now) {
    if (!this.ctx || !this.canvas) {
      this.canvas = document.getElementById('minimap-canvas');
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
      return;
    }
    if (now - this.lastUpdate < 0.033) return;
    this.lastUpdate = now;

    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const focus = this.getFocusTarget();
    const centerPosition = focus.position;
    this.updateOrthoCamera(centerPosition, width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, Math.PI * 2);
    ctx.clip();

    this.drawBaseMap(ctx, centerPosition, cx, cy, width, height);
    this.drawTrafficHeatmap(ctx, centerPosition, cx, cy);
    this.drawMissionMarkers(ctx, centerPosition, cx, cy);
    this.drawAgents(ctx, centerPosition, cx, cy, focus.entity);
    this.drawPlayerMarker(ctx, focus.entity, cx, cy);

    if (!focus.entity) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', cx, 3);
  }
}
