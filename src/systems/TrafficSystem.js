import * as THREE from 'three';
import { Vehicle } from '../entities/Vehicle.js';

export class TrafficSystem {
  constructor(app) {
    this.app = app;
    this.vehicles = [];
    this.waypoints = [];
    this.laneOffset = 3.5;
    this.roadCoords = [-100, -50, 0, 50, 100];

    this.initWaypoints();
    this.spawnVehicles(24);
  }

  initWaypoints() {
    // We will generate waypoint loops along the road grid
    // For each intersection, there are 4 approaching waypoints and 4 departing waypoints
    this.graph = new Map(); // key: "x,z", value: array of next waypoint coordinates

    const coords = this.roadCoords;
    const off = this.laneOffset;

    // Build straight segments along X roads
    for (const z of coords) {
      // Eastbound (z + off)
      for (let i = 0; i < coords.length; i++) {
        const x = coords[i];
        const nextX = coords[(i + 1) % coords.length];
        const current = `${x},${z + off}`;
        const next = `${nextX},${z + off}`;
        if (!this.graph.has(current)) this.graph.set(current, []);
        this.graph.get(current).push(new THREE.Vector3(nextX, 0, z + off));
      }
      // Westbound (z - off)
      for (let i = coords.length - 1; i >= 0; i--) {
        const x = coords[i];
        const prevX = coords[(i - 1 + coords.length) % coords.length];
        const current = `${x},${z - off}`;
        const next = `${prevX},${z - off}`;
        if (!this.graph.has(current)) this.graph.set(current, []);
        this.graph.get(current).push(new THREE.Vector3(prevX, 0, z - off));
      }
    }

    // Build straight segments along Z roads
    for (const x of coords) {
      // Northbound (x + off)
      for (let i = 0; i < coords.length; i++) {
        const z = coords[i];
        const nextZ = coords[(i + 1) % coords.length];
        const current = `${x + off},${z}`;
        const next = `${x + off},${nextZ}`;
        if (!this.graph.has(current)) this.graph.set(current, []);
        this.graph.get(current).push(new THREE.Vector3(x + off, 0, nextZ));
      }
      // Southbound (x - off)
      for (let i = coords.length - 1; i >= 0; i--) {
        const z = coords[i];
        const prevZ = coords[(i - 1 + coords.length) % coords.length];
        const current = `${x - off},${z}`;
        const next = `${x - off},${prevZ}`;
        if (!this.graph.has(current)) this.graph.set(current, []);
        this.graph.get(current).push(new THREE.Vector3(x - off, 0, prevZ));
      }
    }

    // Add turning options at intersection crossings!
    for (const x of coords) {
      for (const z of coords) {
        // At intersection (x, z), connect lanes
        // From Eastbound (x, z+off) -> Northbound (x+off, z+off to nextZ) or Southbound (x-off, z+off)
        const eb = `${x},${z + off}`;
        if (this.graph.has(eb)) {
          this.graph.get(eb).push(new THREE.Vector3(x + off, 0, z + 20)); // Right turn
          this.graph.get(eb).push(new THREE.Vector3(x - off, 0, z - 20)); // Left turn
        }

        // From Westbound (x, z-off)
        const wb = `${x},${z - off}`;
        if (this.graph.has(wb)) {
          this.graph.get(wb).push(new THREE.Vector3(x - off, 0, z - 20));
          this.graph.get(wb).push(new THREE.Vector3(x + off, 0, z + 20));
        }

        // From Northbound (x+off, z)
        const nb = `${x + off},${z}`;
        if (this.graph.has(nb)) {
          this.graph.get(nb).push(new THREE.Vector3(x - 20, 0, z + off));
          this.graph.get(nb).push(new THREE.Vector3(x + 20, 0, z - off));
        }

        // From Southbound (x-off, z)
        const sb = `${x - off},${z}`;
        if (this.graph.has(sb)) {
          this.graph.get(sb).push(new THREE.Vector3(x + 20, 0, z - off));
          this.graph.get(sb).push(new THREE.Vector3(x - 20, 0, z + off));
        }
      }
    }
  }

  spawnVehicles(count) {
    const types = ['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'TAXI', 'POLICE', 'SEDAN', 'SEDAN'];
    const colors = [0xdf0054, 0x00f0ff, 0xffcc00, 0x22ee44, 0xeeeeee, 0x1a1a24, 0xff5500, 0x7000ff];
    const names = [
      'Cyber Cruiser 2099', 'Apex GT Turbo', 'Metro Transit Bus #42', 'Express Freight Truck',
      'City Yellow Cab #88', 'Metro Police Cruiser #01', 'Neo Tech autonomous Sedan', 'Quantum Sport Coupe'
    ];

    const allNodes = Array.from(this.graph.keys());

    for (let i = 0; i < count; i++) {
      const typeIdx = i % types.length;
      const vType = types[typeIdx];
      const color = colors[i % colors.length];
      const name = `${names[typeIdx]} #${i + 10}`;

      const vehicle = new Vehicle(vType, color, name);
      
      // Pick random starting node
      const nodeStr = allNodes[i % allNodes.length];
      const [nx, nz] = nodeStr.split(',').map(Number);
      vehicle.mesh.position.set(nx, 0, nz);

      // Pick target waypoint
      const possibleNexts = this.graph.get(nodeStr);
      if (possibleNexts && possibleNexts.length > 0) {
        vehicle.targetWaypoint = possibleNexts[Math.floor(Math.random() * possibleNexts.length)].clone();
      } else {
        vehicle.targetWaypoint = new THREE.Vector3(0, 0, 0);
      }

      // Initial orientation
      vehicle.mesh.lookAt(vehicle.targetWaypoint);

      this.app.sceneManager.scene.add(vehicle.mesh);
      this.vehicles.push(vehicle);
    }
  }

  update(delta) {
    // Check collisions and move vehicles
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const pos = v.mesh.position;

      // 1. Collision avoidance check with vehicle ahead
      let isBlocked = false;
      for (let j = 0; j < this.vehicles.length; j++) {
        if (i === j) continue;
        const other = this.vehicles[j];
        const dist = pos.distanceTo(other.mesh.position);
        
        // If other vehicle is within 10 units and roughly in front
        if (dist < 11) {
          const toOther = other.mesh.position.clone().sub(pos).normalize();
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
          if (toOther.dot(forward) > 0.6) {
            isBlocked = true;
            break;
          }
        }
      }

      // 2. Adjust target speed based on traffic
      if (isBlocked) {
        v.targetSpeed = 0;
      } else {
        v.targetSpeed = v.maxSpeed;
      }

      // Smoothly accelerate or brake
      if (v.speed < v.targetSpeed) {
        v.speed = Math.min(v.targetSpeed, v.speed + v.acceleration * delta);
      } else if (v.speed > v.targetSpeed) {
        v.speed = Math.max(v.targetSpeed, v.speed - v.acceleration * 1.5 * delta);
      }

      // 3. Move towards targetWaypoint
      if (v.targetWaypoint) {
        const distToWaypoint = pos.distanceTo(v.targetWaypoint);
        if (distToWaypoint < 3.0) {
          // Reached waypoint! Pick next node
          const approxKey = `${Math.round(v.targetWaypoint.x / 3.5) * 3.5},${Math.round(v.targetWaypoint.z / 3.5) * 3.5}`;
          
          // Find best matching key in graph
          let nextList = null;
          for (const [k, list] of this.graph.entries()) {
            const [kx, kz] = k.split(',').map(Number);
            if (Math.abs(kx - v.targetWaypoint.x) < 5 && Math.abs(kz - v.targetWaypoint.z) < 5) {
              nextList = list;
              break;
            }
          }

          if (nextList && nextList.length > 0) {
            v.targetWaypoint = nextList[Math.floor(Math.random() * nextList.length)].clone();
          } else {
            // Fallback loop back to center
            v.targetWaypoint.set((Math.random() - 0.5) * 150, 0, (Math.random() - 0.5) * 150);
          }
        }

        // Calculate rotation towards waypoint
        const dir = v.targetWaypoint.clone().sub(pos).normalize();
        const targetAngle = Math.atan2(dir.x, dir.z);
        
        // Smooth rotation
        let currentAngle = v.mesh.rotation.y;
        let diff = targetAngle - currentAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        v.mesh.rotation.y += diff * 5.0 * delta;

        // Advance position
        const moveStep = v.speed * delta;
        v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
        v.mesh.position.y = 0; // Keep on road
      }

      // 4. Update vehicle animations & wheels
      v.update(delta);

      // 5. Check if police car passing near camera to trigger Doppler siren sound
      if (v.isPolice && v.speed > 5 && this.app.audioSystem && this.app.audioSystem.isEnabled) {
        const camDist = pos.distanceTo(this.app.sceneManager.camera.position);
        if (camDist < 40 && Math.random() < 0.005) {
          this.app.audioSystem.playSiren(2.0);
        }
      }
    }
  }
}
