import * as THREE from 'three';
import { Vehicle } from '../entities/Vehicle.js';

class TrafficNode {
  constructor(id, x, z) {
    this.id = id;
    this.pos = new THREE.Vector3(x, 0, z);
    this.nextNodes = [];
  }
}

export class TrafficSystem {
  constructor(app) {
    this.app = app;
    this.vehicles = [];
    this.nodes = new Map();
    this.roadCoords = [-100, -50, 0, 50, 100];
    this.laneOffset = 3.5; // Right-hand traffic lane center

    this.initWaypoints();
    this.spawnVehicles(24);
  }

  initWaypoints() {
    const coords = this.roadCoords;
    const off = this.laneOffset;

    // 1. Create Approach (IN) and Depart (OUT) nodes for every intersection
    for (const rx of coords) {
      for (const rz of coords) {
        // Eastbound (moving +X along Z = rz + off)
        this.nodes.set(`EB_IN:${rx},${rz}`, new TrafficNode(`EB_IN:${rx},${rz}`, rx - 10, rz + off));
        this.nodes.set(`EB_OUT:${rx},${rz}`, new TrafficNode(`EB_OUT:${rx},${rz}`, rx + 10, rz + off));

        // Westbound (moving -X along Z = rz - off)
        this.nodes.set(`WB_IN:${rx},${rz}`, new TrafficNode(`WB_IN:${rx},${rz}`, rx + 10, rz - off));
        this.nodes.set(`WB_OUT:${rx},${rz}`, new TrafficNode(`WB_OUT:${rx},${rz}`, rx - 10, rz - off));

        // Southbound (moving +Z along X = rx - off)
        this.nodes.set(`SB_IN:${rx},${rz}`, new TrafficNode(`SB_IN:${rx},${rz}`, rx - off, rz - 10));
        this.nodes.set(`SB_OUT:${rx},${rz}`, new TrafficNode(`SB_OUT:${rx},${rz}`, rx - off, rz + 10));

        // Northbound (moving -Z along X = rx + off)
        this.nodes.set(`NB_IN:${rx},${rz}`, new TrafficNode(`NB_IN:${rx},${rz}`, rx + off, rz + 10));
        this.nodes.set(`NB_OUT:${rx},${rz}`, new TrafficNode(`NB_OUT:${rx},${rz}`, rx + off, rz - 10));
      }
    }

    // 2. Connect straight road segments between consecutive intersections
    for (let i = 0; i < coords.length - 1; i++) {
      const c1 = coords[i];
      const c2 = coords[i + 1];

      for (const rz of coords) {
        // Eastbound straight segment from c1 to c2
        const ebOut = this.nodes.get(`EB_OUT:${c1},${rz}`);
        const ebIn = this.nodes.get(`EB_IN:${c2},${rz}`);
        if (ebOut && ebIn) ebOut.nextNodes.push(ebIn);

        // Westbound straight segment from c2 to c1
        const wbOut = this.nodes.get(`WB_OUT:${c2},${rz}`);
        const wbIn = this.nodes.get(`WB_IN:${c1},${rz}`);
        if (wbOut && wbIn) wbOut.nextNodes.push(wbIn);
      }

      for (const rx of coords) {
        // Southbound straight segment from c1 to c2
        const sbOut = this.nodes.get(`SB_OUT:${rx},${c1}`);
        const sbIn = this.nodes.get(`SB_IN:${rx},${c2}`);
        if (sbOut && sbIn) sbOut.nextNodes.push(sbIn);

        // Northbound straight segment from c2 to c1
        const nbOut = this.nodes.get(`NB_OUT:${rx},${c2}`);
        const nbIn = this.nodes.get(`NB_IN:${rx},${c1}`);
        if (nbOut && nbIn) nbOut.nextNodes.push(nbIn);
      }
    }

    // 3. Connect turning rules inside every intersection
    for (const rx of coords) {
      for (const rz of coords) {
        // From Eastbound Approach
        const ebIn = this.nodes.get(`EB_IN:${rx},${rz}`);
        if (ebIn) {
          if (rx < 100) ebIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`)); // Straight
          if (rz < 100) ebIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`)); // Right turn
          if (rz > -100) ebIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`)); // Left turn
        }

        // From Westbound Approach
        const wbIn = this.nodes.get(`WB_IN:${rx},${rz}`);
        if (wbIn) {
          if (rx > -100) wbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`)); // Straight
          if (rz > -100) wbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`)); // Right turn
          if (rz < 100) wbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`)); // Left turn
        }

        // From Southbound Approach
        const sbIn = this.nodes.get(`SB_IN:${rx},${rz}`);
        if (sbIn) {
          if (rz < 100) sbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`)); // Straight
          if (rx > -100) sbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`)); // Right turn
          if (rx < 100) sbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`)); // Left turn
        }

        // From Northbound Approach
        const nbIn = this.nodes.get(`NB_IN:${rx},${rz}`);
        if (nbIn) {
          if (rz > -100) nbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`)); // Straight
          if (rx < 100) nbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`)); // Right turn
          if (rx > -100) nbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`)); // Left turn
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

    // Get all OUT nodes (starting positions at departures of intersections)
    const outNodes = Array.from(this.nodes.values()).filter(n => n.id.includes('_OUT') && n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const typeIdx = i % types.length;
      const vType = types[typeIdx];
      const color = colors[i % colors.length];
      const name = `${names[typeIdx]} #${i + 10}`;

      const vehicle = new Vehicle(vType, color, name);

      // Pick a starting node
      const startNode = outNodes[i % outNodes.length];
      vehicle.mesh.position.copy(startNode.pos);
      vehicle.currentNode = startNode;
      vehicle.targetNode = startNode.nextNodes[0];

      if (vehicle.targetNode) {
        vehicle.mesh.lookAt(vehicle.targetNode.pos);
      }

      this.app.sceneManager.scene.add(vehicle.mesh);
      this.vehicles.push(vehicle);
    }
  }

  update(delta) {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const pos = v.mesh.position;

      // 1. Collision avoidance check with vehicle ahead
      let isBlocked = false;
      for (let j = 0; j < this.vehicles.length; j++) {
        if (i === j) continue;
        const other = this.vehicles[j];
        const dist = pos.distanceTo(other.mesh.position);

        if (dist < 11) {
          const toOther = other.mesh.position.clone().sub(pos).normalize();
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
          if (toOther.dot(forward) > 0.65) {
            isBlocked = true;
            break;
          }
        }
      }

      if (isBlocked) {
        v.targetSpeed = 0;
      } else {
        v.targetSpeed = v.maxSpeed;
      }

      if (v.speed < v.targetSpeed) {
        v.speed = Math.min(v.targetSpeed, v.speed + v.acceleration * delta);
      } else if (v.speed > v.targetSpeed) {
        v.speed = Math.max(v.targetSpeed, v.speed - v.acceleration * 1.8 * delta);
      }

      // 2. Steer along road graph towards target node
      if (v.targetNode) {
        const distToTarget = pos.distanceTo(v.targetNode.pos);
        if (distToTarget < 2.5) {
          // Reached node! Pick next valid connected node along the road graph
          v.currentNode = v.targetNode;
          if (v.currentNode.nextNodes.length > 0) {
            v.targetNode = v.currentNode.nextNodes[Math.floor(Math.random() * v.currentNode.nextNodes.length)];
          } else {
            // Should never happen with our closed graph, but safety fallback
            v.speed = 0;
          }
        }

        if (v.targetNode) {
          const dir = v.targetNode.pos.clone().sub(pos).normalize();
          const targetAngle = Math.atan2(dir.x, dir.z);

          let currentAngle = v.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          v.mesh.rotation.y += diff * 6.0 * delta;

          const moveStep = v.speed * delta;
          v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
          v.mesh.position.y = 0; // Strictly adhere to road surface
        }
      }

      // 3. Update vehicle animations & wheels
      v.update(delta);

      // 4. Check Doppler siren sound for police cars
      if (v.isPolice && v.speed > 5 && this.app.audioSystem && this.app.audioSystem.isEnabled) {
        const camDist = pos.distanceTo(this.app.sceneManager.camera.position);
        if (camDist < 40 && Math.random() < 0.005) {
          this.app.audioSystem.playSiren(2.0);
        }
      }
    }
  }
}
