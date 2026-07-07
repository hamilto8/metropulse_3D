import * as THREE from 'three';
import { Pedestrian } from '../entities/Pedestrian.js';

export class PedestrianSystem {
  constructor(app) {
    this.app = app;
    this.pedestrians = [];
    this.waypoints = [];
    
    this.initWaypoints();
    this.spawnPedestrians(36);
  }

  initWaypoints() {
    // Generate sidewalk loops around blocks and Central Park
    this.waypoints = [];

    // Sidewalk edges around roads at x/z = -100, -50, 0, 50, 100
    const roadCoords = [-100, -50, 0, 50, 100];
    const offsets = [-9, 9]; // Sidewalk distance from road center

    for (const r of roadCoords) {
      for (const off of offsets) {
        for (let pos = -90; pos <= 90; pos += 15) {
          this.waypoints.push(new THREE.Vector3(r + off, 0.4, pos));
          this.waypoints.push(new THREE.Vector3(pos, 0.4, r + off));
        }
      }
    }

    // Add Central Park internal paths
    for (let p = -88; p <= -62; p += 6) {
      this.waypoints.push(new THREE.Vector3(p, 0.7, p));
      this.waypoints.push(new THREE.Vector3(p, 0.7, -150 - p));
    }
  }

  spawnPedestrians(count) {
    const types = ['BUSINESS', 'CASUAL', 'JOGGER', 'CASUAL', 'BUSINESS', 'CASUAL'];
    const colors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xe11d48, 0x475569];
    const firstNames = ['Alex', 'Jordan', 'Elena', 'Marcus', 'Sophia', 'Liam', 'Chloe', 'David', 'Maya', 'Lucas', 'Zoe', 'Daniel'];
    const lastNames = ['V.', 'K.', 'M.', 'S.', 'R.', 'T.', 'L.', 'H.', 'W.', 'P.', 'B.', 'N.'];

    for (let i = 0; i < count; i++) {
      const pType = types[i % types.length];
      const color = colors[i % colors.length];
      const fname = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lname = lastNames[Math.floor(Math.random() * lastNames.length)];
      const name = `${fname} ${lname}`;

      const ped = new Pedestrian(pType, color, name);
      
      // Pick starting waypoint
      const startWp = this.waypoints[Math.floor(Math.random() * this.waypoints.length)].clone();
      ped.mesh.position.copy(startWp);

      // Pick target waypoint
      ped.targetWaypoint = this.pickNextWaypoint(startWp);
      ped.mesh.lookAt(ped.targetWaypoint);

      this.app.sceneManager.scene.add(ped.mesh);
      this.pedestrians.push(ped);
    }
  }

  pickNextWaypoint(currentPos) {
    // Find waypoints within 12 to 25 units distance
    const candidates = [];
    for (const wp of this.waypoints) {
      const dist = currentPos.distanceTo(wp);
      if (dist > 8 && dist < 26) {
        candidates.push(wp);
      }
    }

    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)].clone();
    } else {
      return this.waypoints[Math.floor(Math.random() * this.waypoints.length)].clone();
    }
  }

  update(delta) {
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      const pos = p.mesh.position;

      // 1. Check avoidance with other pedestrians or vehicles
      let isBlocked = false;

      // Check nearby vehicles
      if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
        for (const v of this.app.trafficSystem.vehicles) {
          if (pos.distanceTo(v.mesh.position) < 5.0 && v.speed > 1.0) {
            isBlocked = true;
            break;
          }
        }
      }

      if (isBlocked) {
        p.targetSpeed = 0;
      } else {
        p.targetSpeed = p.maxSpeed;
      }

      // Smooth acceleration
      if (p.speed < p.targetSpeed) {
        p.speed = Math.min(p.targetSpeed, p.speed + 8 * delta);
      } else if (p.speed > p.targetSpeed) {
        p.speed = Math.max(p.targetSpeed, p.speed - 12 * delta);
      }

      // 2. Move towards waypoint
      if (p.targetWaypoint) {
        const dist = pos.distanceTo(p.targetWaypoint);
        if (dist < 1.5) {
          p.targetWaypoint = this.pickNextWaypoint(pos);
        }

        const dir = p.targetWaypoint.clone().sub(pos).normalize();
        const targetAngle = Math.atan2(dir.x, dir.z);
        
        let currentAngle = p.mesh.rotation.y;
        let diff = targetAngle - currentAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        p.mesh.rotation.y += diff * 6.0 * delta;

        const moveStep = p.speed * delta;
        p.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
        p.mesh.position.y = pos.x < -60 && pos.z < -60 ? 0.7 : 0.4; // Slightly higher in park
      }

      // 3. Update walk animation
      p.update(delta);
    }
  }
}
