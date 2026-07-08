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
    this.spawnVehicles(28);
  }

  initWaypoints() {
    const coords = this.roadCoords;
    const off = this.laneOffset;

    for (const rx of coords) {
      for (const rz of coords) {
        this.nodes.set(`EB_IN:${rx},${rz}`, new TrafficNode(`EB_IN:${rx},${rz}`, rx - 10, rz + off));
        this.nodes.set(`EB_OUT:${rx},${rz}`, new TrafficNode(`EB_OUT:${rx},${rz}`, rx + 10, rz + off));

        this.nodes.set(`WB_IN:${rx},${rz}`, new TrafficNode(`WB_IN:${rx},${rz}`, rx + 10, rz - off));
        this.nodes.set(`WB_OUT:${rx},${rz}`, new TrafficNode(`WB_OUT:${rx},${rz}`, rx - 10, rz - off));

        this.nodes.set(`SB_IN:${rx},${rz}`, new TrafficNode(`SB_IN:${rx},${rz}`, rx - off, rz - 10));
        this.nodes.set(`SB_OUT:${rx},${rz}`, new TrafficNode(`SB_OUT:${rx},${rz}`, rx - off, rz + 10));

        this.nodes.set(`NB_IN:${rx},${rz}`, new TrafficNode(`NB_IN:${rx},${rz}`, rx + off, rz + 10));
        this.nodes.set(`NB_OUT:${rx},${rz}`, new TrafficNode(`NB_OUT:${rx},${rz}`, rx + off, rz - 10));
      }
    }

    for (let i = 0; i < coords.length - 1; i++) {
      const c1 = coords[i];
      const c2 = coords[i + 1];

      for (const rz of coords) {
        const ebOut = this.nodes.get(`EB_OUT:${c1},${rz}`);
        const ebIn = this.nodes.get(`EB_IN:${c2},${rz}`);
        if (ebOut && ebIn) ebOut.nextNodes.push(ebIn);

        const wbOut = this.nodes.get(`WB_OUT:${c2},${rz}`);
        const wbIn = this.nodes.get(`WB_IN:${c1},${rz}`);
        if (wbOut && wbIn) wbOut.nextNodes.push(wbIn);
      }

      for (const rx of coords) {
        const sbOut = this.nodes.get(`SB_OUT:${rx},${c1}`);
        const sbIn = this.nodes.get(`SB_IN:${rx},${c2}`);
        if (sbOut && sbIn) sbOut.nextNodes.push(sbIn);

        const nbOut = this.nodes.get(`NB_OUT:${rx},${c2}`);
        const nbIn = this.nodes.get(`NB_IN:${rx},${c1}`);
        if (nbOut && nbIn) nbOut.nextNodes.push(nbIn);
      }
    }

    for (const rx of coords) {
      for (const rz of coords) {
        const ebIn = this.nodes.get(`EB_IN:${rx},${rz}`);
        if (ebIn) {
          if (rx < 100) ebIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rz < 100) ebIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rz > -100) ebIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
        }

        const wbIn = this.nodes.get(`WB_IN:${rx},${rz}`);
        if (wbIn) {
          if (rx > -100) wbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rz > -100) wbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rz < 100) wbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
        }

        const sbIn = this.nodes.get(`SB_IN:${rx},${rz}`);
        if (sbIn) {
          if (rz < 100) sbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rx > -100) sbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rx < 100) sbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
        }

        const nbIn = this.nodes.get(`NB_IN:${rx},${rz}`);
        if (nbIn) {
          if (rz > -100) nbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rx < 100) nbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rx > -100) nbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
        }
      }
    }
  }

  spawnVehicles(count) {
    const types = ['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'TAXI', 'POLICE', 'POLICE', 'SEDAN'];
    const colors = [0xdf0054, 0x00f0ff, 0xffcc00, 0x22ee44, 0xeeeeee, 0x1a1a24, 0x1a1a24, 0xff5500];
    const names = [
      'Cyber Cruiser 2099', 'Apex GT Turbo', 'Metro Transit Bus #42', 'Express Freight Truck',
      'City Yellow Cab #88', 'Metro Police Cruiser #01', 'Metro Police Interceptor #02', 'Neo Tech autonomous Sedan'
    ];

    const outNodes = Array.from(this.nodes.values()).filter(n => n.id.includes('_OUT') && n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const typeIdx = i % types.length;
      const vType = types[typeIdx];
      const color = colors[i % colors.length];
      const name = `${names[typeIdx]} #${i + 10}`;

      const vehicle = new Vehicle(vType, color, name);
      vehicle.crashed = false;
      vehicle.crashTimer = 0;
      vehicle.emergencyTarget = null;
      vehicle.normalMaxSpeed = vehicle.maxSpeed;

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

  dispatchPolice(crashPos) {
    const policeVehicles = this.vehicles.filter(v => v.isPolice && !v.crashed);
    
    // Sort police by distance to crash site
    policeVehicles.sort((a, b) => {
      return a.mesh.position.distanceTo(crashPos) - b.mesh.position.distanceTo(crashPos);
    });

    // Dispatch up to 2 closest police cruisers to rush to the crash scene
    const responders = policeVehicles.slice(0, 2);
    for (const p of responders) {
      p.emergencyTarget = crashPos.clone();
      p.maxSpeed = 42; // High speed pursuit/response
      p.targetSpeed = 42;
      if (this.app.audioSystem && this.app.audioSystem.isEnabled) {
        this.app.audioSystem.playSiren(4.0);
      }
    }
  }

  update(delta) {
    const funMode = this.app.funMode;

    // Check collisions between cars in Fun Mode!
    if (funMode) {
      for (let i = 0; i < this.vehicles.length; i++) {
        for (let j = i + 1; j < this.vehicles.length; j++) {
          const v1 = this.vehicles[i];
          const v2 = this.vehicles[j];
          if (v1.crashed || v2.crashed) continue;

          const dist = v1.mesh.position.distanceTo(v2.mesh.position);
          if (dist < 3.8) {
            // MAYHEM COLLISION!
            v1.crashed = true;
            v1.speed = 0;
            v1.targetSpeed = 0;
            v1.crashTimer = 16.0;
            v1.mesh.rotation.z = (Math.random() - 0.5) * 0.9; // Wrecked tilt

            v2.crashed = true;
            v2.speed = 0;
            v2.targetSpeed = 0;
            v2.crashTimer = 16.0;
            v2.mesh.rotation.z = (Math.random() - 0.5) * 0.9;

            const crashPos = v1.mesh.position.clone().add(v2.mesh.position).multiplyScalar(0.5);
            
            // Trigger explosion visual and audio effects
            if (this.app.explosionManager) {
              this.app.explosionManager.createExplosion(crashPos);
            }
            if (this.app.audioSystem) {
              this.app.audioSystem.playExplosion();
            }

            // Police rush to the scene of the accident
            this.dispatchPolice(crashPos);
          }
        }
      }
    }

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const pos = v.mesh.position;

      // Handle crashed state recovery
      if (v.crashed) {
        v.crashTimer -= delta;
        if (v.crashTimer <= 0) {
          // Clear accident and resume driving
          v.crashed = false;
          v.mesh.rotation.z = 0;
          v.speed = 12;
          v.maxSpeed = v.normalMaxSpeed || 18;
          
          // Release any responding police cars
          for (const p of this.vehicles) {
            if (p.isPolice && p.emergencyTarget) {
              p.emergencyTarget = null;
              p.maxSpeed = p.normalMaxSpeed || 20;
            }
          }
        }
        v.update(delta);
        continue;
      }

      // Handle emergency police rushing to crash site
      if (v.isPolice && v.emergencyTarget) {
        const distToCrash = pos.distanceTo(v.emergencyTarget);
        if (distToCrash < 10.0) {
          // Arrived at the scene of the accident! Secure the area
          v.speed = 0;
          v.targetSpeed = 0;
        } else {
          v.targetSpeed = v.maxSpeed;
          if (v.speed < v.targetSpeed) {
            v.speed = Math.min(v.targetSpeed, v.speed + v.acceleration * 2 * delta);
          }
          // Steer directly towards accident scene at high speed
          const dir = v.emergencyTarget.clone().sub(pos).normalize();
          const targetAngle = Math.atan2(dir.x, dir.z);

          let currentAngle = v.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          v.mesh.rotation.y += diff * 8.0 * delta;

          const moveStep = v.speed * delta;
          v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
          v.mesh.position.y = 0;
        }
        v.update(delta);
        continue;
      }

      // 1. Normal Collision avoidance check with vehicle ahead
      let isBlocked = false;
      for (let j = 0; j < this.vehicles.length; j++) {
        if (i === j) continue;
        const other = this.vehicles[j];
        const dist = pos.distanceTo(other.mesh.position);

        if (dist < 11) {
          const toOther = other.mesh.position.clone().sub(pos).normalize();
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
          if (toOther.dot(forward) > 0.65) {
            // In Fun Mode, ignore collision avoidance so cars smash into each other!
            if (!funMode) {
              isBlocked = true;
              break;
            } else {
              // Accelerate slightly before crash for maximum mayhem!
              v.targetSpeed = v.maxSpeed * 1.3;
            }
          }
        }
      }

      if (!funMode) {
        if (isBlocked) {
          v.targetSpeed = 0;
        } else {
          v.targetSpeed = v.maxSpeed;
        }
      } else if (!isBlocked) {
        v.targetSpeed = v.maxSpeed * 1.2;
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
          v.currentNode = v.targetNode;
          if (v.currentNode.nextNodes.length > 0) {
            v.targetNode = v.currentNode.nextNodes[Math.floor(Math.random() * v.currentNode.nextNodes.length)];
          } else {
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
          v.mesh.position.y = 0;
        }
      }

      // 3. Update vehicle animations & wheels
      v.update(delta);

      // 4. Check Doppler siren sound for normal police patrol
      if (v.isPolice && v.speed > 5 && !v.emergencyTarget && this.app.audioSystem && this.app.audioSystem.isEnabled) {
        const camDist = pos.distanceTo(this.app.sceneManager.camera.position);
        if (camDist < 40 && Math.random() < 0.005) {
          this.app.audioSystem.playSiren(2.0);
        }
      }
    }
  }
}
